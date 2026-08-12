import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { AgentProfileStore } from "../../src/electron/agent-profile-store.ts";
import { TaskStore } from "../../src/electron/task-store.ts";

const [stateRootInput, workspaceInput] = process.argv.slice(2);
if (!stateRootInput || !workspaceInput) {
  throw new Error("Usage: seed-agent-revision-qa.mjs <state-root> <workspace>");
}

const stateRoot = resolve(stateRootInput);
const workspace = realpathSync(resolve(workspaceInput));
mkdirSync(stateRoot, { recursive: true });

const profileStore = new AgentProfileStore(join(stateRoot, "agent-profiles.json"), {
  idFactory: () => "00000000-0000-4000-8000-000000000042",
});
const first = profileStore.create({
  name: "Review Specialist",
  description: "Review a Workspace with an immutable policy.",
  backend: "codex",
  model: "fake-model",
  reasoningEffort: "high",
  instructions: "Revision 1: inspect evidence before changing files.",
  permissionMode: "plan",
  skillIds: ["review"],
  toolIds: ["git.diff"],
  enabled: true,
});
const latest = profileStore.update(first.id, {
  instructions: "Revision 2: inspect evidence, then propose a minimal patch.",
  permissionMode: "acceptEdits",
});

const createdAt = "2026-08-12T08:00:00.000Z";
const workspaceId = createHash("sha256").update(workspace).digest("hex").slice(0, 12);
const taskStore = new TaskStore(
  join(stateRoot, "rux-task-state.sqlite3"),
  undefined,
  (revisionId) => profileStore.getRevision(revisionId),
);
taskStore.save({
  version: 2,
  workspaceId,
  updatedAt: createdAt,
  tasks: [{
    id: "revision-qa-task",
    workspaceId,
    title: "审查现有实现",
    preview: "固定 Review Specialist Revision 1",
    status: "completed",
    updatedAt: "刚刚",
    updatedAtIso: createdAt,
    createdAt,
    agent: first.name,
    adapter: "codex",
    agentProfileId: first.id,
    agentRevisionId: first.latestRevisionId,
    agentRevisionSnapshot: profileStore.getRevision(first.latestRevisionId),
    providerConnection: first.providerConnection,
    permissionMode: first.permissionMode,
    model: first.model,
    modelSource: first.modelSource,
    modelVerificationStatus: first.modelVerificationStatus,
    reasoningEffort: first.reasoningEffort,
    contextFiles: ["README.md"],
    branch: "main",
    elapsed: "4s",
    tokens: "1.2k",
    messages: [
      { id: "revision-message-user", role: "user", text: "请审查当前实现，不要改动历史记录。", time: "刚刚", createdAt },
      { id: "revision-message-agent", role: "assistant", text: "已按 Revision 1 完成审查，历史任务保持可追溯。", time: "刚刚", createdAt, agent: first.name, adapter: "codex" },
    ],
    plan: [],
    activity: [],
    runs: [],
    reviewAcceptances: [],
  }],
});
taskStore.close();

process.stdout.write(`${JSON.stringify({ workspaceId, profileId: first.id, firstRevisionId: first.latestRevisionId, latestRevisionId: latest.latestRevisionId })}\n`);
