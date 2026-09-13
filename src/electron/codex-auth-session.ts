import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CODEX_LOGIN_REQUIRED } from "../shared/codex-auth";

/** Non-secret provenance/state. OAuth credentials remain owned by Codex. */
export class CodexAuthSession {
  private requiresLogin = true;
  changing = false;
  activeOperations = 0;
  revision = 0;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}
  async initialize(): Promise<void> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8"));
      this.requiresLogin = state.version !== 1 || state.requiresLogin !== false;
    } catch { this.requiresLogin = true; }
    // Legacy installations imported another client's rotating credentials.
    // Keep those files untouched, but require one independent Rux sign-in.
    await this.persist();
  }
  get required(): boolean { return this.requiresLogin; }
  status() { return { connected: false, account: null, reauthRequired: this.requiresLogin, loginInProgress: this.changing, message: this.changing ? "正在登录 Codex，请完成设备授权。" : CODEX_LOGIN_REQUIRED }; }
  assertReady(): void {
    if (this.changing) throw new Error("Codex 正在切换登录状态，请完成登录后再发送消息。");
    if (this.requiresLogin) throw new Error(CODEX_LOGIN_REQUIRED);
  }
  begin(): void { if (this.activeOperations) throw new Error("请先停止正在运行的 Codex 任务，再切换登录账户。"); if (this.changing) throw new Error("Codex 登录操作正在进行中。"); this.changing = true; this.revision++; }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertReady(); this.activeOperations++;
    try { return await operation(); } finally { this.activeOperations--; }
  }
  async expire(): Promise<void> { this.requiresLogin = true; await this.persist(); }
  async finish(success: boolean): Promise<void> {
    this.requiresLogin = true;
    try { if (success) { await this.persist(false); this.requiresLogin = false; } else await this.persist(); }
    finally { this.changing = false; }
  }
  private persist(required = this.requiresLogin): Promise<void> {
    const write = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(this.path, JSON.stringify({ version: 1, requiresLogin: required }), { mode: 0o600 });
    });
    this.writes = write;
    return write;
  }
}
