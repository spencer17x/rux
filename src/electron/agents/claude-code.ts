import { query, type ModelInfo, type PermissionMode, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type { CodexStreamEvent } from "./codex-app-server";

export type ClaudeStreamInput = {
  runId: string;
  sessionId?: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: string;
  mode?: string;
};

type ApprovalResolver = {
  resolve: (result: any) => void;
  suggestions?: unknown[];
};

type ActiveClaudeRun = {
  input: ClaudeStreamInput;
  query: Query;
  abortController: AbortController;
  sessionId?: string;
  messageId?: string;
  blocks: Map<number, { id: string; type: string; name?: string; inputText: string; input?: Record<string, unknown> }>;
  toolItems: Map<string, Record<string, any>>;
};

export class ClaudeCodeClient {
  private readonly runs = new Map<string, ActiveClaudeRun>();
  private readonly approvals = new Map<string, ApprovalResolver>();

  constructor(
    private readonly executable: () => string,
    private readonly emit: (event: CodexStreamEvent) => void,
  ) {}

  async listModels(cwd: string): Promise<ModelInfo[]> {
    async function* idle(): AsyncGenerator<any> {
      await new Promise<void>(() => {});
    }
    const instance = query({
      prompt: idle(),
      options: { cwd, pathToClaudeCodeExecutable: this.executable() },
    });
    try {
      return await instance.supportedModels();
    } finally {
      instance.close();
    }
  }

  async accountInfo(cwd: string): Promise<any> {
    async function* idle(): AsyncGenerator<any> {
      await new Promise<void>(() => {});
    }
    const instance = query({ prompt: idle(), options: { cwd, pathToClaudeCodeExecutable: this.executable() } });
    try {
      return await instance.accountInfo();
    } finally {
      instance.close();
    }
  }

  startTurn(input: ClaudeStreamInput): { runId: string; sessionId: string; turnId: string } {
    if (!input.prompt.trim()) throw new Error("消息不能为空");
    const abortController = new AbortController();
    const instance = query({
      prompt: input.prompt,
      options: {
        cwd: input.cwd,
        pathToClaudeCodeExecutable: this.executable(),
        includePartialMessages: true,
        includeHookEvents: true,
        forwardSubagentText: true,
        resume: input.sessionId || undefined,
        model: input.model && input.model !== "default" ? input.model : undefined,
        effort: this.effort(input.reasoning),
        thinking: input.reasoning === "none" ? { type: "disabled" } : { type: "adaptive" },
        permissionMode: this.permissionMode(input.mode),
        allowDangerouslySkipPermissions: input.mode === "bypass-permissions",
        abortController,
        canUseTool: async (toolName, toolInput, options) => {
          const approvalId = `claude:${input.runId}:${options.requestId}`;
          const itemId = options.toolUseID || approvalId;
          this.emit({
            runId: input.runId,
            type: "approval-request",
            threadId: input.sessionId,
            turnId: input.runId,
            itemId,
            approval: {
              id: approvalId,
              method: "claude/canUseTool",
              toolName,
              toolInput,
              title: options.title,
              displayName: options.displayName,
              description: options.description,
              suggestions: options.suggestions,
            },
          });
          return await new Promise((resolve) => {
            const onAbort = () => {
              this.approvals.delete(approvalId);
              resolve({ behavior: "deny", message: "操作已取消", interrupt: true, toolUseID: itemId });
            };
            options.signal.addEventListener("abort", onAbort, { once: true });
            this.approvals.set(approvalId, {
              suggestions: options.suggestions,
              resolve: (result) => {
                options.signal.removeEventListener("abort", onAbort);
                resolve({ ...result, toolUseID: itemId });
              },
            });
          });
        },
      },
    });
    const run: ActiveClaudeRun = {
      input,
      query: instance,
      abortController,
      blocks: new Map(),
      toolItems: new Map(),
    };
    this.runs.set(input.runId, run);
    void this.consume(run);
    return { runId: input.runId, sessionId: input.sessionId || "", turnId: input.runId };
  }

  async interrupt(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    run.abortController.abort();
    run.query.close();
  }

  respondToApproval(approvalId: string, decision: "accept" | "acceptForSession" | "decline"): void {
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new Error("Claude Code 审批请求已失效");
    this.approvals.delete(approvalId);
    if (decision === "decline") {
      pending.resolve({ behavior: "deny", message: "用户拒绝了此操作" });
      return;
    }
    pending.resolve({
      behavior: "allow",
      ...(decision === "acceptForSession" && pending.suggestions?.length ? { updatedPermissions: pending.suggestions } : {}),
    });
  }

  stop(): void {
    for (const run of this.runs.values()) {
      run.abortController.abort();
      run.query.close();
    }
    this.runs.clear();
    for (const pending of this.approvals.values()) pending.resolve({ behavior: "deny", message: "Rux 已退出", interrupt: true });
    this.approvals.clear();
  }

  private async consume(run: ActiveClaudeRun): Promise<void> {
    try {
      for await (const message of run.query) this.handleMessage(run, message);
    } catch (error) {
      if (!run.abortController.signal.aborted) this.emit({ runId: run.input.runId, type: "error", threadId: run.sessionId, turnId: run.input.runId, error: String((error as Error).message || error) });
    } finally {
      this.runs.delete(run.input.runId);
    }
  }

  private handleMessage(run: ActiveClaudeRun, message: SDKMessage): void {
    const sessionId = String((message as any).session_id || run.sessionId || "");
    if (sessionId && sessionId !== run.sessionId) {
      run.sessionId = sessionId;
      this.emit({ runId: run.input.runId, type: "thread-started", threadId: sessionId, turnId: run.input.runId });
    }
    if (message.type === "stream_event") {
      this.handleStreamEvent(run, message.event as any);
      return;
    }
    if (message.type === "assistant") {
      this.handleAssistant(run, message as any);
      return;
    }
    if (message.type === "user") {
      this.handleToolResults(run, message as any);
      return;
    }
    if (message.type === "result") {
      const failed = message.subtype !== "success" || message.is_error;
      this.emit({
        runId: run.input.runId,
        type: "turn-completed",
        threadId: sessionId,
        turnId: run.input.runId,
        status: failed ? "failed" : "completed",
        error: failed ? ("errors" in message ? message.errors.join("\n") : message.result) : undefined,
      });
      return;
    }
    if ((message as any).type === "system" && (message as any).subtype === "permission_denied") {
      const denied = message as any;
      this.emit({ runId: run.input.runId, type: "item-completed", threadId: sessionId, turnId: run.input.runId, itemId: denied.tool_use_id, item: { type: "dynamicToolCall", id: denied.tool_use_id, tool: denied.tool_name, status: "failed", contentItems: [{ type: "text", text: denied.message }], success: false } });
    }
  }

  private handleStreamEvent(run: ActiveClaudeRun, event: Record<string, any>): void {
    if (event.type === "message_start") run.messageId = String(event.message?.id || randomUUID());
    const index = Number(event.index ?? 0);
    const fallbackId = `${run.messageId || run.input.runId}:${index}`;
    if (event.type === "content_block_start") {
      const block = event.content_block || {};
      const id = String(block.id || fallbackId);
      run.blocks.set(index, { id, type: block.type || "text", name: block.name, inputText: "", input: block.input || {} });
      if (block.type === "text") this.emitItem(run, "item-started", id, { type: "agentMessage", id, text: block.text || "" });
      if (block.type === "thinking") this.emitItem(run, "item-started", id, { type: "reasoning", id, summary: [], content: block.thinking ? [block.thinking] : [] });
      return;
    }
    if (event.type === "content_block_delta") {
      const block = run.blocks.get(index);
      if (!block) return;
      const delta = event.delta || {};
      if (delta.type === "text_delta") this.emitDelta(run, "text-delta", block.id, delta.text);
      else if (delta.type === "thinking_delta") this.emitDelta(run, "reasoning-delta", block.id, delta.thinking);
      else if (delta.type === "input_json_delta") block.inputText += String(delta.partial_json || "");
      return;
    }
    if (event.type === "content_block_stop") {
      const block = run.blocks.get(index);
      if (!block) return;
      if (block.type === "tool_use") {
        let input = block.input || {};
        if (block.inputText) {
          try { input = JSON.parse(block.inputText); } catch { input = { partialInput: block.inputText }; }
        }
        const item = this.toolItem(block.id, block.name || "Tool", input, "inProgress");
        run.toolItems.set(block.id, item);
        this.emitItem(run, "item-started", block.id, item);
      }
    }
  }

  private handleAssistant(run: ActiveClaudeRun, message: Record<string, any>): void {
    const messageId = String(message.message?.id || run.messageId || randomUUID());
    for (const [index, block] of (message.message?.content || []).entries()) {
      const id = String(block.id || `${messageId}:${index}`);
      if (block.type === "text") this.emitItem(run, "item-completed", id, { type: "agentMessage", id, text: block.text || "" });
      else if (block.type === "thinking") this.emitItem(run, "item-completed", id, { type: "reasoning", id, summary: [], content: [block.thinking || ""] });
      else if (block.type === "tool_use" && !run.toolItems.has(id)) {
        const item = this.toolItem(id, block.name || "Tool", block.input || {}, "inProgress");
        run.toolItems.set(id, item);
        this.emitItem(run, "item-started", id, item);
      }
    }
  }

  private handleToolResults(run: ActiveClaudeRun, message: Record<string, any>): void {
    const content = Array.isArray(message.message?.content) ? message.message.content : Array.isArray(message.message) ? message.message : [];
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const id = String(block.tool_use_id || randomUUID());
      const previous = run.toolItems.get(id) || this.toolItem(id, "Tool", {}, "inProgress");
      const output = typeof block.content === "string" ? block.content : (block.content || []).map((part: any) => part.text || JSON.stringify(part)).join("\n");
      const completed = previous.type === "commandExecution"
        ? { ...previous, status: block.is_error ? "failed" : "completed", aggregatedOutput: output, exitCode: block.is_error ? 1 : 0 }
        : previous.type === "mcpToolCall"
          ? { ...previous, status: block.is_error ? "failed" : "completed", result: block.is_error ? null : { output }, error: block.is_error ? { message: output } : null }
          : { ...previous, status: block.is_error ? "failed" : "completed", success: !block.is_error, contentItems: [{ type: "text", text: output }] };
      run.toolItems.set(id, completed);
      this.emitItem(run, "item-completed", id, completed);
    }
  }

  private toolItem(id: string, name: string, input: Record<string, unknown>, status: string): Record<string, any> {
    if (name === "Bash") return { type: "commandExecution", id, command: String(input.command || ""), cwd: String(input.cwd || ""), status, aggregatedOutput: null, exitCode: null, durationMs: null };
    if (["Edit", "Write", "NotebookEdit"].includes(name)) return { type: "fileChange", id, changes: [{ path: String(input.file_path || input.notebook_path || ""), kind: name, diff: String(input.new_string || input.content || "") }], status };
    if (name.startsWith("mcp__")) return { type: "mcpToolCall", id, server: name.split("__")[1] || "mcp", tool: name, status, arguments: input, result: null, error: null };
    return { type: "dynamicToolCall", id, tool: name, status, arguments: input, contentItems: null, success: null };
  }

  private emitItem(run: ActiveClaudeRun, type: "item-started" | "item-completed", itemId: string, item: Record<string, unknown>): void {
    this.emit({ runId: run.input.runId, type, threadId: run.sessionId, turnId: run.input.runId, itemId, item });
  }

  private emitDelta(run: ActiveClaudeRun, type: "text-delta" | "reasoning-delta", itemId: string, delta: string): void {
    this.emit({ runId: run.input.runId, type, threadId: run.sessionId, turnId: run.input.runId, itemId, delta: String(delta || "") });
  }

  private permissionMode(mode?: string): PermissionMode {
    const modes: Record<string, PermissionMode> = {
      plan: "plan",
      "accept-edits": "acceptEdits",
      "dont-ask": "dontAsk",
      auto: "auto",
      "bypass-permissions": "bypassPermissions",
    };
    return modes[mode || ""] || "default";
  }

  private effort(value?: string): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
    return ["low", "medium", "high", "xhigh", "max"].includes(String(value)) ? value as any : undefined;
  }
}
