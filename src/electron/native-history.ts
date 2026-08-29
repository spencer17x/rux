import type { ClaudeCodeClient } from "./agents/claude-code";
import type { CodexAppServerClient } from "./agents/codex-app-server";
import type { PiRuntimeClient } from "./agents/pi-runtime";
import type { StoredThread, StoredWorkspace } from "./state-database";

type RuxPart = Record<string, any> & { type: string };
type RuxMessage = { id: string; role: "user" | "assistant"; parts: RuxPart[]; text?: string; attachments?: string[]; status?: string; agentId?: string };

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
    if (assistantParts.length) result.push({ id: `${turn.id || turnIndex}:assistant`, role: "assistant", parts: assistantParts, status: turn.status === "failed" ? "error" : "complete", agentId });
    return result;
  });
}

function claudeMessages(entries: any[], agentId: string): RuxMessage[] {
  return entries.flatMap((entry, index) => {
    const message = entry.message || {};
    const role = entry.type === "user" || message.role === "user" ? "user" : entry.type === "assistant" || message.role === "assistant" ? "assistant" : null;
    if (!role) return [];
    const blocks = Array.isArray(message.content) ? message.content : [{ type: "text", text: contentText(message.content) }];
    const parts: RuxPart[] = blocks.flatMap((block: any, blockIndex: number) => {
      if (block.type === "text") return [{ type: "text", text: block.text || "" }];
      if (block.type === "thinking") return [{ type: "reasoning", text: block.thinking || "", status: { type: "complete" } }];
      if (block.type === "tool_use") return [{ type: "tool-call", toolCallId: block.id || `${entry.uuid}:${blockIndex}`, toolName: block.name || "dynamicToolCall", args: block.input || {}, argsText: JSON.stringify(block.input || {}) }];
      if (block.type === "tool_result") return [{ type: "text", text: contentText(block.content) }];
      return [];
    });
    const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    return [{ id: entry.uuid || `${entry.session_id || "claude"}:${index}`, role, parts, ...(text ? { text } : {}), ...(role === "assistant" ? { status: "complete" } : {}), agentId } as RuxMessage];
  });
}

function piMessages(entries: any[], agentId: string): RuxMessage[] {
  return entries.flatMap((entry, index) => {
    const message = entry.message || entry;
    const role = message.role === "user" || message.role === "assistant" ? message.role : null;
    if (!role) return [];
    const text = contentText(message.content ?? message.text);
    if (!text) return [];
    return [{ id: String(message.id || entry.id || `pi:${index}`), role, text, parts: [{ type: "text", text }], ...(role === "assistant" ? { status: "complete" } : {}), agentId } as RuxMessage];
  });
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
