import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  boardMutationParamsSchema,
  boardSnapshotSchema,
  type BoardMutationParams,
  type BoardSnapshot,
  type BoardStateColumn,
  type BoardWorkItem,
  type PersistedTask,
} from "../shared/protocol.ts";

type StoredBoards = { version: 1; boards: Record<string, BoardSnapshot> };

const defaultStates = (): BoardStateColumn[] => [
  { id: "todo", name: "待处理", order: 0, semanticRole: "todo" },
  { id: "in-progress", name: "进行中", order: 1, semanticRole: "in-progress" },
  { id: "review", name: "待验收", order: 2, semanticRole: "review" },
  { id: "done", name: "已完成", order: 3, semanticRole: "done" },
];

function emptyBoard(projectId: string): BoardSnapshot {
  return boardSnapshotSchema.parse({
    version: 1,
    projectId,
    revision: 0,
    enabled: true,
    states: defaultStates(),
    items: [],
    transitions: [],
    updatedAt: new Date().toISOString(),
  });
}

function taskCardId(taskId: string): string {
  return `task:${taskId}`;
}

function isWorkspaceStarter(task: PersistedTask): boolean {
  return task.id === `workspace-${task.workspaceId}` && task.messages.length === 0 && task.runs.length === 0;
}

function suggestedState(task: PersistedTask): string {
  if (task.status === "completed") return "review";
  if (task.runs.length > 0) return "in-progress";
  return "todo";
}

function latestRun(task: PersistedTask) {
  return task.runs.at(-1);
}

function taskCard(projectId: string, task: PersistedTask, now: string): BoardWorkItem {
  const run = latestRun(task);
  return {
    id: taskCardId(task.id),
    projectId,
    workspaceId: task.workspaceId,
    type: "task",
    title: task.title,
    description: task.preview,
    stateId: suggestedState(task),
    priority: "medium",
    labels: [],
    acceptanceCriteria: [],
    linkedTaskId: task.id,
    linkedTaskIds: [task.id],
    automationMode: "automatic",
    agent: task.agent,
    model: task.model,
    branch: task.branch,
    taskStatus: task.status,
    ...(run ? { latestRunStatus: run.status } : {}),
    pendingApprovals: run?.permissionRequests.filter((request) => request.status === "pending").length ?? 0,
    createdAt: task.createdAt ?? now,
    updatedAt: task.updatedAtIso ?? now,
  };
}

function synchronizeBoard(board: BoardSnapshot, tasks: PersistedTask[]): { board: BoardSnapshot; changed: boolean } {
  const now = new Date().toISOString();
  const taskMap = new Map(tasks.filter((task) => !isWorkspaceStarter(task)).map((task) => [task.id, task]));
  const existingTaskCards = new Map(board.items.filter((item) => item.type === "task" && item.linkedTaskId).map((item) => [item.linkedTaskId!, item]));
  const transitions = [...board.transitions];
  let changed = false;

  const syncedTaskCards = [...taskMap.values()].filter((task) => board.enabled || existingTaskCards.has(task.id)).map((task) => {
    const generated = taskCard(board.projectId, task, now);
    const existing = existingTaskCards.get(task.id);
    if (!existing) {
      changed = true;
      transitions.push({ id: randomUUID(), workItemId: generated.id, toStateId: generated.stateId, source: "run-rule", ...(latestRun(task) ? { runId: latestRun(task)!.id } : {}), createdAt: now });
      return generated;
    }

    let stateId = existing.stateId;
    if (existing.automationMode === "automatic" && stateId !== "done") {
      const suggested = suggestedState(task);
      if ((stateId === "todo" && suggested === "in-progress") || (["todo", "in-progress"].includes(stateId) && suggested === "review")) {
        transitions.push({ id: randomUUID(), workItemId: existing.id, fromStateId: stateId, toStateId: suggested, source: "run-rule", ...(latestRun(task) ? { runId: latestRun(task)!.id } : {}), createdAt: now });
        stateId = suggested;
      }
    }

    const next = { ...existing, ...generated, stateId, priority: existing.priority, labels: existing.labels, acceptanceCriteria: existing.acceptanceCriteria, automationMode: existing.automationMode, createdAt: existing.createdAt };
    if (JSON.stringify(next) !== JSON.stringify(existing)) changed = true;
    return next;
  });

  if (existingTaskCards.size !== syncedTaskCards.length) changed = true;
  const requirementItems = board.items.filter((item) => item.type === "requirement").map((item) => {
    const linkedTaskIds = item.linkedTaskIds.filter((taskId) => taskMap.has(taskId));
    if (linkedTaskIds.length !== item.linkedTaskIds.length) changed = true;
    return linkedTaskIds.length === item.linkedTaskIds.length ? item : { ...item, linkedTaskIds, updatedAt: now };
  });
  if (!changed) return { board, changed: false };
  return {
    changed: true,
    board: boardSnapshotSchema.parse({
      ...board,
      revision: board.revision + 1,
      items: [...requirementItems, ...syncedTaskCards],
      transitions: transitions.slice(-100_000),
      updatedAt: now,
    }),
  };
}

export class BoardStore {
  readonly #filePath: string;
  #state: StoredBoards;
  #loadError: Error | undefined;

  constructor(filePath: string) {
    this.#filePath = filePath;
    this.#state = this.#load();
  }

  load(projectId: string, tasks: PersistedTask[]): BoardSnapshot {
    this.#assertWritable();
    const current = this.#state.boards[projectId] ?? emptyBoard(projectId);
    const synchronized = synchronizeBoard(current, tasks);
    if (!this.#state.boards[projectId] || synchronized.changed) {
      this.#state.boards[projectId] = synchronized.board;
      this.#persist();
    }
    return synchronized.board;
  }

  mutate(input: BoardMutationParams, tasks: PersistedTask[]): BoardSnapshot {
    this.#assertWritable();
    const params = boardMutationParamsSchema.parse(input);
    const current = this.load(params.projectId, tasks);
    if (current.revision !== params.expectedRevision) throw new Error("BOARD_REVISION_CONFLICT: Board changed; reload before retrying");
    const now = new Date().toISOString();
    const taskIds = new Set(tasks.filter((task) => !isWorkspaceStarter(task)).map((task) => task.id));
    let items = [...current.items];
    let states = [...current.states];
    let enabled = current.enabled;
    let transitions = [...current.transitions];
    const mutation = params.mutation;

    if (mutation.action === "set-enabled") {
      enabled = mutation.enabled;
    } else if (mutation.action === "create-requirement") {
      const linkedTaskIds = mutation.linkedTaskIds ?? [];
      if (linkedTaskIds.some((taskId) => !taskIds.has(taskId))) throw new Error("BOARD_TASK_INVALID: Linked Task must belong to this Project");
      const item: BoardWorkItem = {
        id: randomUUID(),
        projectId: params.projectId,
        type: "requirement",
        title: mutation.title,
        description: mutation.description ?? "",
        stateId: "todo",
        priority: mutation.priority ?? "medium",
        labels: mutation.labels ?? [],
        acceptanceCriteria: mutation.acceptanceCriteria ?? [],
        linkedTaskIds,
        automationMode: "manual",
        createdAt: now,
        updatedAt: now,
      };
      items.push(item);
      transitions.push({ id: randomUUID(), workItemId: item.id, toStateId: item.stateId, source: "user", createdAt: now });
    } else if (mutation.action === "create-state") {
      if (states.length >= 64) throw new Error("BOARD_STATE_LIMIT: Board already has the maximum number of columns");
      states.push({ id: `custom:${randomUUID()}`, name: mutation.name, order: states.length, semanticRole: "custom" });
    } else if (mutation.action === "rename-state") {
      const stateIndex = states.findIndex((state) => state.id === mutation.stateId);
      if (stateIndex < 0) throw new Error("BOARD_STATE_INVALID: Board state does not exist");
      states[stateIndex] = { ...states[stateIndex], name: mutation.name };
    } else if (mutation.action === "reorder-states") {
      if (mutation.stateIds.length !== states.length || new Set(mutation.stateIds).size !== states.length || mutation.stateIds.some((stateId) => !states.some((state) => state.id === stateId))) throw new Error("BOARD_STATE_INVALID: Reorder must contain every Board state exactly once");
      states = mutation.stateIds.map((stateId, order) => ({ ...states.find((state) => state.id === stateId)!, order }));
    } else {
      const index = items.findIndex((item) => item.id === mutation.itemId);
      if (index < 0) throw new Error("BOARD_ITEM_MISSING: Board item no longer exists");
      const item = items[index];
      if (mutation.action === "delete-requirement") {
        if (item.type !== "requirement") throw new Error("BOARD_TASK_CARD_PROTECTED: Deleting a Task card does not delete its Task");
        items.splice(index, 1);
      } else if (mutation.action === "update-requirement") {
        if (item.type !== "requirement") throw new Error("BOARD_TASK_CARD_PROTECTED: Task cards are derived from Task facts");
        const linkedTaskIds = mutation.linkedTaskIds ?? item.linkedTaskIds;
        if (linkedTaskIds.some((taskId) => !taskIds.has(taskId))) throw new Error("BOARD_TASK_INVALID: Linked Task must belong to this Project");
        items[index] = { ...item, ...(mutation.title !== undefined ? { title: mutation.title } : {}), ...(mutation.description !== undefined ? { description: mutation.description } : {}), ...(mutation.priority !== undefined ? { priority: mutation.priority } : {}), ...(mutation.labels !== undefined ? { labels: mutation.labels } : {}), ...(mutation.acceptanceCriteria !== undefined ? { acceptanceCriteria: mutation.acceptanceCriteria } : {}), linkedTaskIds, updatedAt: now };
      } else if (mutation.action === "move-item") {
        if (!current.states.some((state) => state.id === mutation.stateId)) throw new Error("BOARD_STATE_INVALID: Target Board state does not exist");
        if (item.stateId !== mutation.stateId) transitions.push({ id: randomUUID(), workItemId: item.id, fromStateId: item.stateId, toStateId: mutation.stateId, source: "user", createdAt: now });
        items[index] = { ...item, stateId: mutation.stateId, automationMode: "manual", updatedAt: now };
      }
    }

    const next = boardSnapshotSchema.parse({ ...current, revision: current.revision + 1, enabled, states, items, transitions: transitions.slice(-100_000), updatedAt: now });
    this.#state.boards[params.projectId] = next;
    this.#persist();
    return next;
  }

  #assertWritable(): void {
    if (this.#loadError) throw this.#loadError;
  }

  #load(): StoredBoards {
    try {
      const parsed = JSON.parse(readFileSync(this.#filePath, "utf8")) as StoredBoards;
      if (parsed.version !== 1 || !parsed.boards || typeof parsed.boards !== "object") throw new Error(`Unsupported Board Store version: ${String(parsed?.version ?? "missing")}`);
      return { version: 1, boards: Object.fromEntries(Object.entries(parsed.boards).map(([workspaceId, board]) => [workspaceId, boardSnapshotSchema.parse(board)])) };
    } catch (error) {
      try {
        readFileSync(this.#filePath, "utf8");
        this.#loadError = new Error(`Board Store is unreadable and was preserved: ${error instanceof Error ? error.message : String(error)}`);
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT") this.#loadError = new Error(`Board Store cannot be read: ${String(readError)}`);
      }
      return { version: 1, boards: {} };
    }
  }

  #persist(): void {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.#filePath);
  }
}
