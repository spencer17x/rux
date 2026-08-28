import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import type { CodexStreamEvent } from "./codex-app-server";
import type { RuntimeCommand } from "../runtime-manager";

type PiRun = {
  runId: string;
  process: ChildProcessWithoutNullStreams;
  sessionFile?: string;
  pending: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>;
  buffer: string;
  decoder: StringDecoder;
  textItems: Map<number, string>;
  thinkingItems: Map<number, string>;
  toolItems: Map<string, Record<string, any>>;
  toolOutput: Map<string, string>;
};

export type PiRuntimeInput = {
  runId: string;
  sessionFile?: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: string;
  mode?: string;
  runtime?: { agentDir: string; env: Record<string, string>; providerId: string } | null;
};

export class PiRuntimeClient {
  private readonly runs = new Map<string, PiRun>();

  constructor(
    private readonly command: () => RuntimeCommand,
    private readonly emit: (event: CodexStreamEvent) => void,
  ) {}

  async listModels(cwd: string, runtime?: PiRuntimeInput["runtime"]): Promise<any[]> {
    const run = this.spawnRun(`models-${randomUUID()}`, cwd, true, runtime);
    try { return (await this.request(run, { type: "get_available_models" }))?.models || []; }
    finally { this.stopRun(run.runId); }
  }

  async readSession(sessionFile: string): Promise<any[]> {
    if (!sessionFile) return [];
    const text = await readFile(sessionFile, "utf8");
    return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }

  async startTurn(input: PiRuntimeInput): Promise<{ runId: string; sessionId: string; turnId: string }> {
    const run = this.spawnRun(input.runId, input.cwd, false, input.runtime);
    if (input.sessionFile) await this.request(run, { type: "switch_session", sessionPath: input.sessionFile });
    if (input.model && input.model !== "default") {
      const separator = input.model.indexOf("/");
      if (separator <= 0) throw new Error("Pi 模型必须使用 provider/modelId 格式");
      await this.request(run, { type: "set_model", provider: input.model.slice(0, separator), modelId: input.model.slice(separator + 1) });
    }
    if (input.reasoning) await this.request(run, { type: "set_thinking_level", level: input.reasoning === "none" ? "off" : input.reasoning });
    const state = await this.request(run, { type: "get_state" });
    run.sessionFile = state?.sessionFile || input.sessionFile;
    if (run.sessionFile) this.emit({ runId: input.runId, type: "thread-started", threadId: run.sessionFile, turnId: input.runId });
    await this.request(run, { type: "prompt", message: input.prompt });
    return { runId: input.runId, sessionId: run.sessionFile || "", turnId: input.runId };
  }

  async interrupt(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    try { await this.request(run, { type: "clear_queue" }); await this.request(run, { type: "abort" }); }
    finally { this.stopRun(runId); }
  }

  stop(): void { for (const id of [...this.runs.keys()]) this.stopRun(id); }

  private spawnRun(runId: string, cwd: string, noSession: boolean, runtime?: PiRuntimeInput["runtime"]): PiRun {
    const command = this.command();
    const child = spawn(command.command, [...command.argsPrefix, "--mode", "rpc", ...(noSession ? ["--no-session"] : [])], {
      cwd,
      env: { ...process.env, ...command.env, ...runtime?.env, ...(runtime?.agentDir ? { PI_CODING_AGENT_DIR: runtime.agentDir } : {}), NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const run: PiRun = { runId, process: child, pending: new Map(), buffer: "", decoder: new StringDecoder("utf8"), textItems: new Map(), thinkingItems: new Map(), toolItems: new Map(), toolOutput: new Map() };
    this.runs.set(runId, run);
    child.stdout.on("data", (chunk: Buffer) => this.consume(run, chunk));
    child.on("error", (error) => this.fail(run, error));
    child.on("close", (code) => { if (this.runs.has(runId) && code !== 0) this.fail(run, new Error(`Pi 已退出（${code ?? 1}）`)); });
    return run;
  }

  private request(run: PiRun, command: Record<string, unknown>): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        run.pending.delete(id);
        reject(new Error(`Pi ${String(command.type || "RPC")} 请求超时`));
      }, 120_000);
      run.pending.set(id, { resolve, reject, timeout });
      try {
        run.process.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
      } catch (error) {
        clearTimeout(timeout);
        run.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  private consume(run: PiRun, chunk: Buffer): void {
    run.buffer += run.decoder.write(chunk);
    let index = run.buffer.indexOf("\n");
    while (index >= 0) {
      let line = run.buffer.slice(0, index);
      run.buffer = run.buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.handleLine(run, line);
      index = run.buffer.indexOf("\n");
    }
  }

  private handleLine(run: PiRun, line: string): void {
    if (!line.trim().startsWith("{")) return;
    let message: Record<string, any>;
    try { message = JSON.parse(line); } catch { return; }
    if (message.type === "response" && message.id) {
      const pending = run.pending.get(message.id);
      if (!pending) return;
      run.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.success === false) pending.reject(new Error(message.error || `Pi ${message.command || "RPC"} 失败`));
      else pending.resolve(message.data);
      return;
    }
    this.handleEvent(run, message);
  }

  private handleEvent(run: PiRun, event: Record<string, any>): void {
    const base = { runId: run.runId, threadId: run.sessionFile, turnId: run.runId };
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent || {};
      const index = Number(update.contentIndex || 0);
      if (update.type === "text_start") {
        const id = `${run.runId}:text:${index}`; run.textItems.set(index, id);
        this.emit({ ...base, type: "item-started", itemId: id, item: { type: "agentMessage", id, text: "" } });
      } else if (update.type === "text_delta") {
        const id = run.textItems.get(index) || `${run.runId}:text:${index}`; run.textItems.set(index, id);
        this.emit({ ...base, type: "text-delta", itemId: id, delta: String(update.delta || "") });
      } else if (update.type === "thinking_start") {
        const id = `${run.runId}:thinking:${index}`; run.thinkingItems.set(index, id);
        this.emit({ ...base, type: "item-started", itemId: id, item: { type: "reasoning", id, summary: [], content: [] } });
      } else if (update.type === "thinking_delta") {
        const id = run.thinkingItems.get(index) || `${run.runId}:thinking:${index}`; run.thinkingItems.set(index, id);
        this.emit({ ...base, type: "reasoning-delta", itemId: id, delta: String(update.delta || "") });
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      const item = this.toolItem(event.toolCallId, event.toolName, event.args, "inProgress");
      run.toolItems.set(event.toolCallId, item);
      this.emit({ ...base, type: "item-started", itemId: event.toolCallId, item });
      return;
    }
    if (event.type === "tool_execution_update") {
      const output = this.resultText(event.partialResult), previous = run.toolOutput.get(event.toolCallId) || "";
      const delta = output.startsWith(previous) ? output.slice(previous.length) : output;
      run.toolOutput.set(event.toolCallId, output);
      if (delta) this.emit({ ...base, type: "tool-output-delta", itemId: event.toolCallId, delta });
      return;
    }
    if (event.type === "tool_execution_end") {
      const previous = run.toolItems.get(event.toolCallId) || this.toolItem(event.toolCallId, event.toolName, {}, "inProgress");
      const output = this.resultText(event.result);
      const item = previous.type === "commandExecution" ? { ...previous, status: event.isError ? "failed" : "completed", aggregatedOutput: output, exitCode: event.isError ? 1 : 0 } : { ...previous, status: event.isError ? "failed" : "completed", success: !event.isError, contentItems: [{ type: "text", text: output }] };
      this.emit({ ...base, type: "item-completed", itemId: event.toolCallId, item });
      return;
    }
    if (event.type === "agent_settled") {
      this.emit({ ...base, type: "turn-completed", status: "completed" });
      this.stopRun(run.runId);
    } else if (event.type === "extension_error" || (event.type === "auto_retry_end" && !event.success)) {
      this.emit({ ...base, type: "error", error: String(event.error || event.finalError || "Pi 执行失败") });
    }
  }

  private toolItem(id: string, name: string, args: Record<string, any>, status: string): Record<string, any> {
    if (name === "bash") return { type: "commandExecution", id, command: String(args?.command || ""), cwd: "", status, aggregatedOutput: null, exitCode: null, durationMs: null };
    if (["edit", "write"].includes(name)) return { type: "fileChange", id, changes: [{ path: String(args?.path || args?.file_path || ""), kind: name, diff: String(args?.content || args?.newText || "") }], status };
    return { type: "dynamicToolCall", id, tool: name, arguments: args || {}, status, contentItems: null, success: null };
  }

  private resultText(result: any): string { return typeof result === "string" ? result : (result?.content || []).map((part: any) => part.text || JSON.stringify(part)).join("\n"); }

  private fail(run: PiRun, error: Error): void {
    for (const pending of run.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    run.pending.clear();
    this.emit({ runId: run.runId, type: "error", threadId: run.sessionFile, turnId: run.runId, error: error.message });
    this.stopRun(run.runId);
  }

  private stopRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    for (const pending of run.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error("Pi 运行已停止")); }
    run.pending.clear();
    run.decoder.end();
    if (!run.process.killed) run.process.kill("SIGTERM");
  }
}
