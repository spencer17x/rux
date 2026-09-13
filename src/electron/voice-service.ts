import { app, systemPreferences } from "electron";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VoiceStatus } from "../shared/voice";

export function validateWave(data: Buffer): void {
  if (data.length < 46 || data.length > 6_000_000 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE" || data.toString("ascii", 12, 16) !== "fmt " || data.toString("ascii", 36, 40) !== "data" || data.readUInt32LE(16) !== 16 || data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1 || data.readUInt16LE(34) !== 16 || data.readUInt32LE(40) !== data.length - 44 || data.readUInt32LE(4) !== data.length - 8) throw new Error("录音格式无效");
  const rate = data.readUInt32LE(24);
  if (rate < 8000 || rate > 48000 || data.length - 44 > rate * 2 * 61 || data.readUInt32LE(28) !== rate * 2 || data.readUInt16LE(32) !== 2 || (data.length - 44) % 2) throw new Error("录音时长或采样率无效");
}

export class VoiceService {
  private operations = new Map<string, AbortController>();
  private helper = app.isPackaged ? join(process.resourcesPath, "rux-speech") : join(app.getAppPath(), "out/native/rux-speech");
  async status(): Promise<VoiceStatus> {
    if (process.platform !== "darwin") return { available: false, message: "当前版本的系统语音支持 macOS" };
    try { await access(this.helper); return await this.run(["--status", "zh-CN"], undefined, 5000) as VoiceStatus; }
    catch { return { available: false, message: "系统语音组件不可用，请重新安装 Rux" }; }
  }
  async prepare(id: string): Promise<void> {
    if (this.operations.size) throw new Error("已有语音操作正在进行，请稍候");
    const controller = new AbortController(); this.operations.set(id, controller);
    try {
      const status = await this.status();
      if (controller.signal.aborted) throw new Error("语音输入已取消");
      if (!status.available) throw new Error(status.message);
      if (["denied", "restricted"].includes(status.permission || "")) throw new Error("请在系统设置 → 隐私与安全性 → 语音识别中允许 Rux");
      if (status.permission !== "authorized") await this.run(["--authorize", "zh-CN"], controller.signal, 95_000);
      if (controller.signal.aborted) throw new Error("语音输入已取消");
      if (!await systemPreferences.askForMediaAccess("microphone")) throw new Error("麦克风权限未开启，请在系统设置中允许 Rux 使用麦克风");
      if (controller.signal.aborted) throw new Error("语音输入已取消");
    } finally { this.operations.delete(id); }
  }
  async transcribe(id: string, base64: string): Promise<{ text: string; onDevice?: boolean }> {
    if (this.operations.size) throw new Error("已有语音正在转写，请稍候");
    const data = Buffer.from(base64, "base64"); validateWave(data);
    const controller = new AbortController(); this.operations.set(id, controller);
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(app.getPath("temp"), "rux-voice-"));
      const path = join(directory, "recording.wav"); await writeFile(path, data, { mode: 0o600 });
      return await this.run([path, "zh-CN"], controller.signal, 95_000) as { text: string; onDevice?: boolean };
    } finally { this.operations.delete(id); if (directory) await rm(directory, { recursive: true, force: true }); }
  }
  cancel(id: string): void { this.operations.get(id)?.abort(); }
  stop(): void { for (const controller of this.operations.values()) controller.abort(); }
  private run(args: string[], signal?: AbortSignal, timeout = 95_000): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("语音转写已取消")); return; }
      const child = spawn(this.helper, args, { stdio: ["ignore", "pipe", "pipe"] });
      let output = "", settled = false;
      const finish = (error?: Error, value?: Record<string, any>) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel); child.kill(); error ? reject(error) : resolve(value!); };
      const cancel = () => finish(new Error("语音转写已取消"));
      const timer = setTimeout(() => finish(new Error("系统语音服务响应超时")), timeout);
      signal?.addEventListener("abort", cancel, { once: true });
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.length > 100_000) finish(new Error("语音结果过长")); });
      child.stderr.resume();
      child.on("error", () => finish(new Error("无法启动系统语音组件")));
      child.on("close", () => { if (settled) return; try { const value = JSON.parse(output); finish(value.error ? new Error(value.error) : undefined, value); } catch { finish(new Error("系统语音没有返回有效结果")); } });
    });
  }
}
