import { userFacingError } from "./errors";

export type MessagePart = Record<string, any> & { type: string };
export type RuxMessage = Record<string, any> & { id: string; role: "user" | "assistant"; parts?: MessagePart[]; status?: string };
export type MessageStore = Record<string, RuxMessage[]>;
export type AgentEvent = Record<string, any> & { type: string; itemId?: string };

export function normalizedMessages(stored: MessageStore): MessageStore {
  return Object.fromEntries(Object.entries(stored).map(([threadId, messages]) => [threadId, messages.map((message) => {
    if (message.status === "running") return { ...message, status: "error", error: "应用已在 Agent 运行期间退出，请重新发送任务" };
    const isError = message.status === "error" || message.error === true || typeof message.error === "string";
    if (!isError) return message;
    return { ...message, status: "error", error: userFacingError(typeof message.error === "string" ? message.error : message.text || "Agent 执行失败"), parts: message.parts?.map((part) => part.type === "text" && part.text ? { ...part, text: userFacingError(part.text) } : part) };
  })]));
}

export function loadLegacyMessages(): MessageStore {
  try {
    const stored = JSON.parse(localStorage.getItem("rux.messages.v1") || "{}") as Record<string, unknown>;
    return normalizedMessages(Object.fromEntries(Object.entries(stored).map(([threadId, threadMessages]) => [threadId, Array.isArray(threadMessages) ? threadMessages as RuxMessage[] : []])));
  } catch {
    return {};
  }
}

export function persistentMessages(messages: MessageStore): MessageStore {
  return Object.fromEntries(Object.entries(messages).map(([threadId, threadMessages]) => [threadId, threadMessages.slice(-200).map((message) => ({
    ...message,
    parts: message.parts?.map((part) => part.result?.output?.length > 200_000 ? { ...part, result: { ...part.result, output: `${part.result.output.slice(0, 200_000)}\n\n[输出已截断]` } } : part),
  }))]));
}

export function messageExportText(message: RuxMessage): string {
  if (message.text) return String(message.text);
  return (message.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").filter(Boolean).join("\n\n");
}

export function completedStickyTurns(messages: RuxMessage[]): Array<{ id: string; text: string }> {
  const turns: Array<{ id: string; text: string }> = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role !== "user" || assistant.role !== "assistant" || assistant.status === "running" || assistant.status === "error" || assistant.status === "incomplete") continue;
    const text = messageExportText(user).trim();
    if (text) turns.push({ id: user.id, text });
  }
  return turns;
}

export function adjacentStickyTurn(turns: Array<{ id: string; text: string }>, activeId: string, direction: -1 | 1): { id: string; text: string } | null {
  const index = turns.findIndex((turn) => turn.id === activeId); if (index < 0) return null;
  return turns[index + direction] || null;
}

function itemToMessagePart(item: Record<string, any>, startedAt = Date.now()): MessagePart | null {
  if (!item?.id) return null;
  if (item.type === "agentMessage") return { type: "text", text: item.text || "", status: { type: "running" }, _itemId: item.id };
  if (item.type === "plan") return { type: "reasoning", text: item.text || "", unstable_summary: "计划", status: { type: "running" }, _itemId: item.id };
  if (item.type === "reasoning") return { type: "reasoning", text: [...(item.summary || []), ...(item.content || [])].join("\n"), status: { type: "running" }, _itemId: item.id };
  const toolName = item.type;
  if (!["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "collabAgentToolCall", "subAgentActivity"].includes(toolName)) return null;
  const args = item.type === "commandExecution"
    ? { command: item.command, cwd: item.cwd }
    : item.type === "fileChange"
      ? { changes: item.changes }
      : item.type === "mcpToolCall"
        ? { server: item.server, tool: item.tool, ...(item.arguments || {}) }
        : item.type === "webSearch"
          ? { query: item.query || item.action?.query || "" }
          : { ...item };
  return { type: "tool-call", toolCallId: item.id, toolName, args, argsText: JSON.stringify(args), timing: { startedAt }, _itemId: item.id };
}

function completedItemResult(item: Record<string, any>): Record<string, any> {
  if (item.type === "commandExecution") return { output: item.aggregatedOutput || "", exitCode: item.exitCode, status: item.status };
  if (item.type === "fileChange") return { summary: `${item.changes?.length || 0} 个文件变更`, changes: item.changes, status: item.status };
  if (item.type === "mcpToolCall") return item.error ? { error: item.error } : item.result || { status: item.status };
  if (item.type === "dynamicToolCall") return { output: (item.contentItems || []).map((part: Record<string, any>) => part.text || JSON.stringify(part)).join("\n"), contentItems: item.contentItems, success: item.success, status: item.status };
  if (item.type === "webSearch") return { status: "completed", action: item.action };
  if (item.type === "collabAgentToolCall" || item.type === "subAgentActivity") return { status: item.status || "completed", agentsStates: item.agentsStates };
  return { status: item.status || "completed" };
}

export function reduceStreamEvent(message: RuxMessage, event: AgentEvent): RuxMessage {
  const parts = [...(message.parts || [])];
  const findPart = () => parts.findIndex((part) => part._itemId === event.itemId || part.toolCallId === event.itemId);
  const updatePart = (create: MessagePart | null, update: (part: MessagePart) => MessagePart) => {
    let index = findPart();
    if (index < 0 && create) { parts.push(create); index = parts.length - 1; }
    if (index >= 0) parts[index] = update(parts[index]);
  };
  if (event.type === "item-started") {
    const part = itemToMessagePart(event.item);
    if (part && findPart() < 0) parts.push(part);
  } else if (event.type === "text-delta") {
    updatePart({ type: "text", text: "", status: { type: "running" }, _itemId: event.itemId }, (part) => ({ ...part, text: `${part.text || ""}${event.delta || ""}` }));
  } else if (event.type === "reasoning-delta") {
    updatePart({ type: "reasoning", text: "", status: { type: "running" }, _itemId: event.itemId }, (part) => ({ ...part, text: `${part.text || ""}${event.delta || ""}` }));
  } else if (event.type === "tool-output-delta") {
    updatePart(null, (part) => ({ ...part, result: { ...(part.result || {}), output: `${part.result?.output || ""}${event.delta || ""}` } }));
  } else if (event.type === "item-completed" && event.item) {
    const item = event.item;
    updatePart(itemToMessagePart(item), (part) => {
      if (item.type === "agentMessage") return { ...part, text: item.text || part.text, status: { type: "complete" } };
      if (item.type === "reasoning" || item.type === "plan") return { ...part, text: item.text || [...(item.summary || []), ...(item.content || [])].join("\n") || part.text, status: { type: "complete" } };
      return { ...part, result: completedItemResult(item), isError: ["failed", "declined"].includes(item.status), timing: { ...(part.timing || {}), completedAt: Date.now() } };
    });
  } else if (event.type === "approval-request" && event.approval) {
    const fileTools = ["Edit", "Write", "NotebookEdit"];
    const toolName = event.approval.method?.includes("fileChange") || fileTools.includes(event.approval.toolName)
      ? "fileChange"
      : event.approval.toolName === "Bash" || event.approval.method?.includes("commandExecution")
        ? "commandExecution"
        : "dynamicToolCall";
    updatePart({ type: "tool-call", toolCallId: event.itemId, toolName, args: { tool: event.approval.toolName, ...event.approval }, argsText: JSON.stringify(event.approval), _itemId: event.itemId }, (part) => ({ ...part, approval: { id: event.approval.id, options: [{ id: "allow-once", kind: "allow-once", label: "允许一次" }, { id: "allow-session", kind: "allow-always", label: "本次会话允许" }, { id: "reject-once", kind: "reject-once", label: "拒绝" }] } }));
  } else if (event.type === "turn-completed") {
    const interrupted = ["interrupted", "cancelled", "canceled", "aborted"].includes(String(event.status || "").toLowerCase());
    return { ...message, parts: parts.map((part) => part.status?.type === "running" ? { ...part, status: { type: interrupted ? "incomplete" : "complete" } } : part), status: event.status === "completed" ? "complete" : interrupted ? "incomplete" : "error", error: event.error ? userFacingError(event.error) : undefined };
  } else if (event.type === "error") {
    const error = userFacingError(event.error || "Agent 执行失败");
    parts.push({ type: "text", text: error, status: { type: "incomplete", reason: "error" }, _itemId: `error-${Date.now()}` });
    return { ...message, parts, status: "error", error };
  }
  return { ...message, parts };
}
