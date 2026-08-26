import { spawn, type IPty } from "node-pty";

export class TerminalManager {
  private readonly processes = new Map<number, IPty>();

  start(senderId: number, cwd: string, send: (data: string) => void): void {
    this.stop(senderId);
    const shell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : process.env.SHELL || "/bin/zsh";
    const args = process.platform === "win32" ? [] : ["-l"];
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const terminal = spawn(shell, args, { name: "xterm-256color", cols: 120, rows: 30, cwd, env });
    this.processes.set(senderId, terminal); terminal.onData(send); terminal.onExit(({ exitCode }) => { send(`\r\n[进程已退出：${exitCode}]\r\n`); this.processes.delete(senderId); });
  }

  write(senderId: number, data: string): void { const terminal = this.processes.get(senderId); if (!terminal) throw new Error("终端未启动"); terminal.write(data); }
  resize(senderId: number, cols: number, rows: number): void { const terminal = this.processes.get(senderId); if (!terminal) throw new Error("终端未启动"); terminal.resize(cols, rows); }
  stop(senderId: number): void { this.processes.get(senderId)?.kill(); this.processes.delete(senderId); }
  stopAll(): void { for (const terminal of this.processes.values()) terminal.kill(); this.processes.clear(); }
}
