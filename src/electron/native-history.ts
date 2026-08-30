import type { ClaudeCodeClient } from "./agents/claude-code";
import type { CodexAppServerClient } from "./agents/codex-app-server";
import type { PiRuntimeClient } from "./agents/pi-runtime";
import type { StoredThread, StoredWorkspace } from "./state-database";

type RuxPart = Record<string, any> & { type: string };
type RuxMessage = { id: string; role: "user" | "assistant"; parts: RuxPart[]; text?: string; attachments?: string[]; status?: string; error?: string; agentId?: string };
type HistoryStatus = "complete" | "error" | "incomplete";

function nativeId(thread: StoredThread): string {
  return thread.nativeSessionId || thread.codexThreadId || "";
}

function itemPart(item: Record<string, any>): RuxPart | null {
  if (item.type === "agentMessage") return { type: "text", text: item.text || "", status: { type: "complete" }, _itemId: item.id };
  if (item.type === "plan") return { type: "reasoning", text: item.text || "", unstable_summary: "计划", status: { type: "complete" }, _itemId: item.id };
  if (item.type === "reasoning") return { type: "reasoning", text: [...(item.summary || []), ...(item.content || [])].join("\n"), status: { type: "complete" }, _itemId: item.id };
  const supported = ["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "collabAgentToolCall", "subAgentActivity"];
  if (!supported.includes(item.type)) return null;
  const args = item.type === "commandExecution" ? { command: item.command, cwd: item.cwd }
    : item.type === "fileChange" ? { changes: item.changes }
      : item.type === "mcpToolCall" ? { server: item.server, tool: item.tool, ...(item.arguments || {}) }
        : item.type === "webSearch" ? { query: item.query || item.action?.query || "" }
          : { ...item };
  const result = item.type === "commandExecution" ? { output: item.aggregatedOutput || "", exitCode: item.exitCode, status: item.status }
    : item.type === "fileChange" ? { summary: `${item.changes?.length || 0} 个文件变更`, changes: item.changes, status: item.status }
      : item.type === "mcpToolCall" ? (item.error ? { error: item.error } : item.result || { status: item.status })
        : item.type === "dynamicToolCall" ? { output: (item.contentItems || []).map((part: Record<string, any>) => part.text || JSON.stringify(part)).join("\n"), contentItems: item.contentItems, success: item.success, status: item.status }
          : { status: item.status || "completed", action: item.action, agentsStates: item.agentsStates };
  return { type: "tool-call", toolCallId: item.id, toolName: item.type, args, argsText: JSON.stringify(args), result, isError: ["failed", "declined"].includes(item.status), _itemId: item.id };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: any) => typeof part === "string" ? part : part?.text || part?.content || "").filter(Boolean).join("\n");
}

function contentAttachments(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: any) => {
    const value = part?.path || part?.url || part?.image_url;
    return typeof value === "string" && value ? [value] : [];
  });
}

function historyStatus(value: unknown): HistoryStatus {
  const status = String(value || "").toLowerCase();
  if (["completed", "complete", "success", "succeeded", "stop", "end_turn"].includes(status)) return "complete";
  if (["failed", "error"].includes(status)) return "error";
  return "incomplete";
}

function toolPart(id: string, name: string, input: Record<string, any> = {}): RuxPart {
  const normalized = name.toLowerCase();
  if (["bash", "powershell"].includes(normalized)) return { type: "tool-call", toolCallId: id, toolName: "commandExecution", args: { command: input.command || input.script || "", cwd: input.cwd || "" }, argsText: JSON.stringify(input), _itemId: id };
  if (["edit", "write", "notebookedit"].includes(normalized)) return { type: "tool-call", toolCallId: id, toolName: "fileChange", args: { path: input.path || input.file_path || input.notebook_path || "", changes: [{ path: input.path || input.file_path || input.notebook_path || "", kind: name, diff: input.content || input.new_string || input.newText || "" }] }, argsText: JSON.stringify(input), _itemId: id };
  if (name.startsWith("mcp__")) return { type: "tool-call", toolCallId: id, toolName: "mcpToolCall", args: { server: name.split("__")[1] || "mcp", tool: name, ...input }, argsText: JSON.stringify(input), _itemId: id };
  return { type: "tool-call", toolCallId: id, toolName: "dynamicToolCall", args: { tool: name, ...input }, argsText: JSON.stringify(input), _itemId: id };
}

function attachToolResult(message: RuxMessage | null, toolCallId: string, output: string, isError: boolean): void {
  if (!message) return;
  const part = message.parts.find((item) => item.toolCallId === toolCallId || item._itemId === toolCallId);
  if (!part) return;
  part.result = { output, status: isError ? "failed" : "completed" };
  part.isError = isError;
}

function codexMessages(thread: Record<string, any>, agentId: string): RuxMessage[] {
  return (thread.turns || []).flatMap((turn: Record<string, any>, turnIndex: number) => {
    const items = Array.isArray(turn.items) ? turn.items : [];
    const userItems = items.filter((item: any) => item.type === "userMessage");
    const assistantParts = items.filter((item: any) => item.type !== "userMessage").map(itemPart).filter(Boolean) as RuxPart[];
    const result: RuxMessage[] = [];
    if (userItems.length) {
      const text = userItems.map((item: any) => contentText(item.content)).filter(Boolean).join("\n\n");
      const attachments = userItems.flatMap((item: any) => contentAttachments(item.content));
      result.push({ id: userItems[0]?.id || `${turn.id || turnIndex}:user`, role: "user", text, parts: [{ type: "text", text }], ...(attachments.length ? { attachments } : {}), agentId });
    }
    const status = historyStatus(turn.status);
    const error = String(turn.error?.message || turn.error || "");
    if (assistantParts.length || (userItems.length && status !== "complete")) result.push({ id: `${turn.id || turnIndex}:assistant`, role: "assistant", parts: error && !assistantParts.length ? [{ type: "text", text: error, status: { type: "incomplete", reason: "error" } }] : assistantParts, status, ...(error ? { error } : {}), agentId });
    return result;
  });
}

function claudeMessages(entries: any[], agentId: string): RuxMessage[] {
  const result: RuxMessage[] = [];
  let assistant: RuxMessage | null = null;
  for (const [index, entry] of entries.entries()) {
    const message = entry.message || {};
    const blocks = Array.isArray(message.content) ? message.content : [{ type: "text", text: contentText(message.content) }];
    if (entry.type === "user" || message.role === "user") {
      const toolResults = blocks.filter((block: any) => block.type === "tool_result");
      for (const block of toolResults) attachToolResult(assistant, String(block.tool_use_id || ""), contentText(block.content), Boolean(block.is_error));
      const text = blocks.filter((block: any) => block.type !== "tool_result").map((block: any) => block.text || "").filter(Boolean).join("\n");
      if (text) {
        result.push({ id: entry.uuid || `${entry.session_id || "claude"}:${index}`, role: "user", text, parts: [{ type: "text", text }], attachments: contentAttachments(message.content), agentId });
        assistant = null;
      }
      continue;
    }
    if (entry.type === "assistant" || message.role === "assistant") {
      if (!assistant || assistant.status === "complete" || assistant.status === "error") {
        assistant = { id: entry.uuid || `${entry.session_id || "claude"}:${index}:assistant`, role: "assistant", parts: [], status: "incomplete", agentId };
        result.push(assistant);
      }
      blocks.forEach((block: any, blockIndex: number) => {
        if (block.type === "text" && block.text) assistant!.parts.push({ type: "text", text: block.text, status: { type: "complete" } });
        else if (block.type === "thinking") assistant!.parts.push({ type: "reasoning", text: block.thinking || "", status: { type: "complete" } });
        else if (block.type === "tool_use") assistant!.parts.push(toolPart(String(block.id || `${entry.uuid || index}:${blockIndex}`), String(block.name || "Tool"), block.input || {}));
      });
      const stopReason = message.stop_reason || message.stopReason;
      if (stopReason && stopReason !== "tool_use") assistant.status = historyStatus(stopReason);
      continue;
    }
    if (entry.type === "result" && assistant) {
      const failed = entry.subtype !== "success" || entry.is_error;
      assistant.status = failed ? "error" : "complete";
      if (failed) assistant.error = Array.isArray(entry.errors) ? entry.errors.join("\n") : entry.result || "Claude Code 执行失败";
    }
  }
  return result.filter((message) => message.role === "user" || message.parts.length || message.status !== "complete");
}

function piMessages(entries: any[], agentId: string): RuxMessage[] {
  const byId = new Map(entries.filter((entry) => entry?.id).map((entry) => [String(entry.id), entry]));
  const leaf = [...entries].reverse().find((entry) => entry?.id);
  const activeEntries: any[] = [];
  const visited = new Set<string>();
  let cursor = leaf;
  while (cursor?.id && !visited.has(String(cursor.id))) {
    visited.add(String(cursor.id)); activeEntries.unshift(cursor);
    cursor = cursor.parentId ? byId.get(String(cursor.parentId)) : null;
  }
  const source = activeEntries.length ? activeEntries : entries;
  const result: RuxMessage[] = [];
  let assistant: RuxMessage | null = null;
  for (const [index, entry] of source.entries()) {
    const message = entry.message || entry;
    if (message.role === "user") {
      const text = contentText(message.content ?? message.text);
      if (text) result.push({ id: String(entry.id || message.id || `pi:${index}`), role: "user", text, parts: [{ type: "text", text }], attachments: contentAttachments(message.content), agentId });
      assistant = null;
      continue;
    }
    if (message.role === "assistant") {
      if (!assistant || assistant.status === "complete" || assistant.status === "error") {
        assistant = { id: String(entry.id || message.id || `pi:${index}:assistant`), role: "assistant", parts: [], status: "incomplete", agentId };
        result.push(assistant);
      }
      const blocks = Array.isArray(message.content) ? message.content : [{ type: "text", text: contentText(message.content ?? message.text) }];
      blocks.forEach((block: any, blockIndex: number) => {
        if (block.type === "text" && block.text) assistant!.parts.push({ type: "text", text: block.text, status: { type: "complete" } });
        else if (block.type === "thinking") assistant!.parts.push({ type: "reasoning", text: block.thinking || "", status: { type: "complete" } });
        else if (block.type === "toolCall") assistant!.parts.push(toolPart(String(block.id || `${entry.id || index}:${blockIndex}`), String(block.name || "Tool"), block.arguments || {}));
      });
      assistant.status = historyStatus(message.stopReason);
      if (message.errorMessage) { assistant.status = "error"; assistant.error = message.errorMessage; }
      continue;
    }
    if (message.role === "toolResult") {
      attachToolResult(assistant, String(message.toolCallId || ""), contentText(message.content), Boolean(message.isError));
      continue;
    }
    if (message.role === "bashExecution") {
      if (!assistant) { assistant = { id: String(entry.id || `pi:${index}:bash`), role: "assistant", parts: [], status: "incomplete", agentId }; result.push(assistant); }
      const id = String(entry.id || `pi:${index}:bash`); const part = toolPart(id, "bash", { command: message.command }); part.result = { output: message.output || "", exitCode: message.exitCode, status: message.cancelled ? "failed" : "completed" }; part.isError = Boolean(message.cancelled || (typeof message.exitCode === "number" && message.exitCode !== 0)); assistant.parts.push(part);
    }
  }
  return result.filter((message) => message.role === "user" || message.parts.length || message.status !== "complete");
}

export class NativeHistoryService {
  private readonly authoritative = new Set<string>();

  constructor(private readonly codex: CodexAppServerClient, private readonly claude: ClaudeCodeClient, private readonly pi: PiRuntimeClient) {}

  markAuthoritative(threadId: string): void {
    if (threadId) this.authoritative.add(threadId);
  }

  async load(workspace: StoredWorkspace, fallback: Record<string, unknown[]>): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};
    const projectByThread = new Map(workspace.projects.flatMap((project) => project.threads.map((thread) => [thread.id, project.path] as const)));
    const threads = [...workspace.projects.flatMap((project) => project.threads), ...workspace.standaloneThreads];
    for (const thread of threads) {
      const id = nativeId(thread);
      if (!id) { if (fallback[thread.id]) result[thread.id] = fallback[thread.id]; continue; }
      try {
        const agentId = thread.agentId || "codex";
        const messages = agentId === "claude-code" ? claudeMessages(await this.claude.readSession(id, projectByThread.get(thread.id)), agentId)
          : agentId === "pi" ? piMessages(await this.pi.readSession(id), agentId)
            : codexMessages(await this.codex.readThread(id) || {}, agentId);
        result[thread.id] = messages;
        this.authoritative.add(thread.id);
      } catch {
        if (fallback[thread.id]) result[thread.id] = fallback[thread.id];
      }
    }
    return result;
  }

  filterFallback(workspace: StoredWorkspace, messages: Record<string, unknown[]>, existing: Set<string>): Record<string, unknown[]> {
    const nativeThreads = new Set([...workspace.projects.flatMap((project) => project.threads), ...workspace.standaloneThreads].filter((thread) => nativeId(thread)).map((thread) => thread.id));
    return Object.fromEntries(Object.entries(messages).filter(([threadId]) => !nativeThreads.has(threadId) || (existing.has(threadId) && !this.authoritative.has(threadId))));
  }
}
