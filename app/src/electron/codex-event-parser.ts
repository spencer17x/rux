import type { VerificationEvidence } from "../shared/protocol.ts";
import { createVerificationEvidence } from "./verification-evidence.ts";

type JsonRecord = Record<string, unknown>;

export type CodexUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type CodexNormalizedEvent =
  | { type: "run.metadata"; runId: string; sessionId: string }
  | {
      type: "activity.started" | "activity.completed";
      runId: string;
      activity: {
        id: string;
        kind: "read" | "edit" | "command" | "tool";
        title: string;
        detail: string;
        state: "active" | "done" | "error";
      };
    }
  | { type: "assistant.message"; runId: string; text: string }
  | { type: "assistant.reasoning-summary"; runId: string; text: string }
  | { type: "plan.updated"; runId: string; items: Array<{ text: string; completed: boolean }> }
  | { type: "run.usage"; runId: string; usage: CodexUsage }
  | { type: "verification.recorded"; runId: string; verification: VerificationEvidence }
  | { type: "run.completed"; runId: string }
  | { type: "run.failed"; runId: string; error: string }
  | { type: "run.log"; runId: string; level: "info" | "warning" | "error"; message: string };

export type CodexNormalizeContext = {
  cwd?: string;
  now?: () => string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function itemStatus(item: JsonRecord): "active" | "done" | "error" {
  if (item.status === "failed") return "error";
  if (item.status === "completed") return "done";
  return "active";
}

function lifecycleType(eventType: string, state: "active" | "done" | "error"):
  "activity.started" | "activity.completed" {
  return eventType === "item.started" && state === "active" ? "activity.started" : "activity.completed";
}

function normalizeItem(
  runId: string,
  eventType: string,
  item: JsonRecord,
  context: CodexNormalizeContext,
): CodexNormalizedEvent[] {
  const id = stringValue(item.id) ?? `codex-${Date.now()}`;
  const type = stringValue(item.type);
  const state = itemStatus(item);
  const activityType = lifecycleType(eventType, state);

  if (type === "agent_message" && eventType === "item.completed") {
    const text = stringValue(item.text);
    return text ? [{ type: "assistant.message", runId, text }] : [];
  }
  if (type === "reasoning" && eventType === "item.completed") {
    const text = stringValue(item.text);
    return text ? [{ type: "assistant.reasoning-summary", runId, text }] : [];
  }
  if (type === "todo_list") {
    const items = Array.isArray(item.items)
      ? item.items.flatMap((entry) => isRecord(entry) && stringValue(entry.text)
        ? [{ text: stringValue(entry.text)!, completed: entry.completed === true }]
        : [])
      : [];
    return [{ type: "plan.updated", runId, items }];
  }
  if (type === "command_execution") {
    const command = stringValue(item.command) ?? "Command";
    const events: CodexNormalizedEvent[] = [{
      type: activityType,
      runId,
      activity: { id, kind: "command", title: "运行命令", detail: command, state },
    }];
    if (eventType === "item.completed" && typeof item.exit_code === "number") {
      events.push({
        type: "run.log",
        runId,
        level: item.exit_code === 0 ? "info" : "error",
        message: `命令退出码 ${item.exit_code}: ${command}`,
      });
    }
    if (eventType === "item.completed") {
      events.push({
        type: "verification.recorded",
        runId,
        verification: createVerificationEvidence({
          id,
          runId,
          command,
          cwd: context.cwd,
          output: stringValue(item.aggregated_output) ?? stringValue(item.output) ?? "",
          exitCode: typeof item.exit_code === "number" ? item.exit_code : undefined,
          failed: state === "error",
          finishedAt: context.now?.(),
        }),
      });
    }
    return events;
  }
  if (type === "file_change") {
    const changes = Array.isArray(item.changes)
      ? item.changes.flatMap((change) => isRecord(change) && stringValue(change.path)
        ? [`${stringValue(change.kind) ?? "update"} ${stringValue(change.path)}`]
        : [])
      : [];
    return [{
      type: activityType,
      runId,
      activity: {
        id,
        kind: "edit",
        title: changes.length === 1 ? "修改文件" : `修改 ${changes.length} 个文件`,
        detail: changes.join(", ") || "Rux file change",
        state,
      },
    }];
  }
  if (type === "mcp_tool_call") {
    const server = stringValue(item.server) ?? "MCP";
    const tool = stringValue(item.tool) ?? "tool";
    return [{
      type: activityType,
      runId,
      activity: { id, kind: "tool", title: `调用 ${server}`, detail: tool, state },
    }];
  }
  if (type === "web_search") {
    return [{
      type: activityType,
      runId,
      activity: {
        id,
        kind: "read",
        title: "搜索网络",
        detail: stringValue(item.query) ?? "Rux web search",
        state: eventType === "item.started" ? "active" : "done",
      },
    }];
  }
  if (type === "error") {
    return [{
      type: "run.log",
      runId,
      level: "error",
      message: stringValue(item.message) ?? "Rux item failed",
    }];
  }
  return [];
}

/** Parse and normalize one `codex exec --json` JSONL record. */
export function normalizeCodexJsonLine(
  runId: string,
  line: string,
  context: CodexNormalizeContext = {},
): CodexNormalizedEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [{ type: "run.log", runId, level: "warning", message: "Rux 返回了无法解析的 JSONL 事件" }];
  }
  if (!isRecord(parsed)) return [];

  const type = stringValue(parsed.type);
  if (type === "thread.started") {
    const sessionId = stringValue(parsed.thread_id);
    return sessionId ? [{ type: "run.metadata", runId, sessionId }] : [];
  }
  if (["item.started", "item.updated", "item.completed"].includes(type ?? "") && isRecord(parsed.item)) {
    return normalizeItem(runId, type!, parsed.item, context);
  }
  if (type === "turn.completed") {
    const usage = isRecord(parsed.usage) ? parsed.usage : {};
    return [
      {
        type: "run.usage",
        runId,
        usage: {
          inputTokens: numberValue(usage.input_tokens),
          cachedInputTokens: numberValue(usage.cached_input_tokens),
          outputTokens: numberValue(usage.output_tokens),
          reasoningOutputTokens: numberValue(usage.reasoning_output_tokens),
        },
      },
      { type: "run.completed", runId },
    ];
  }
  if (type === "turn.failed") {
    const error = isRecord(parsed.error) ? stringValue(parsed.error.message) : undefined;
    return [{ type: "run.failed", runId, error: error ?? "Rux turn failed" }];
  }
  if (type === "error") {
    return [{ type: "run.failed", runId, error: stringValue(parsed.message) ?? "Rux stream failed" }];
  }
  return [];
}
