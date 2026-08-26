import { app, type BrowserWindow } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { access, chmod, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { x as extractTar } from "tar";

export type RuntimeAgentId = "codex" | "claude-code" | "pi";

type RuntimeDefinition = {
  id: RuntimeAgentId;
  version: string;
  packageName: string;
  packageVersion: string;
  executable: string;
  kind: "native" | "node";
};

export type RuntimeProgress = {
  agentId: RuntimeAgentId;
  state: "checking" | "downloading" | "verifying" | "installing" | "ready" | "error";
  received: number;
  total: number;
  percent: number;
  message?: string;
};

export type RuntimeStatus = {
  agentId: RuntimeAgentId;
  version: string;
  installed: boolean;
  path: string;
};

export type RuntimeCommand = {
  command: string;
  argsPrefix: string[];
  env: Record<string, string>;
};

const CODEX_VERSION = "0.149.1";
const CLAUDE_VERSION = "0.3.245";
const PI_VERSION = "0.84.3";

export class RuntimeManager {
  private readonly pending = new Map<RuntimeAgentId, Promise<RuntimeCommand>>();

  constructor(
    private readonly root: string,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  async status(agentId: RuntimeAgentId): Promise<RuntimeStatus> {
    const definition = this.definition(agentId);
    const executable = this.executablePath(definition);
    return { agentId, version: definition.version, installed: await this.exists(executable), path: executable };
  }

  async list(): Promise<RuntimeStatus[]> {
    return await Promise.all((["codex", "claude-code", "pi"] as RuntimeAgentId[]).map((id) => this.status(id)));
  }

  resolveInstalled(agentId: RuntimeAgentId): RuntimeCommand {
    const definition = this.definition(agentId);
    const executable = this.executablePath(definition);
    if (definition.kind === "node") {
      return { command: process.execPath, argsPrefix: [executable], env: { ELECTRON_RUN_AS_NODE: "1" } };
    }
    return { command: executable, argsPrefix: [], env: {} };
  }

  async ensure(agentId: RuntimeAgentId): Promise<RuntimeCommand> {
    const current = this.pending.get(agentId);
    if (current) return await current;
    const task = this.install(agentId).finally(() => this.pending.delete(agentId));
    this.pending.set(agentId, task);
    return await task;
  }

  private async install(agentId: RuntimeAgentId): Promise<RuntimeCommand> {
    const definition = this.definition(agentId);
    const finalDirectory = this.installDirectory(definition);
    const executable = this.executablePath(definition);
    if (await this.exists(executable)) {
      this.emit({ agentId, state: "ready", received: 1, total: 1, percent: 100 });
      return this.resolveInstalled(agentId);
    }
    this.emit({ agentId, state: "checking", received: 0, total: 0, percent: 0 });
    const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(definition.packageName)}/${encodeURIComponent(definition.packageVersion)}`;
    const metadataResponse = await fetch(metadataUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!metadataResponse.ok) throw new Error(`无法读取 ${definition.packageName} 元数据（${metadataResponse.status}）`);
    const metadata = await metadataResponse.json() as { dist?: { tarball?: string; integrity?: string; unpackedSize?: number } };
    const tarballUrl = metadata.dist?.tarball;
    const integrity = metadata.dist?.integrity;
    if (!tarballUrl || !integrity?.startsWith("sha512-")) throw new Error(`${definition.packageName} 缺少可验证的发布完整性信息`);

    const temporaryDirectory = join(this.root, `.tmp-${agentId}-${randomUUID()}`);
    const archivePath = join(temporaryDirectory, "runtime.tgz");
    await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    try {
      const response = await fetch(tarballUrl, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok || !response.body) throw new Error(`下载 ${definition.packageName} 失败（${response.status}）`);
      const total = Number(response.headers.get("content-length")) || Number(metadata.dist?.unpackedSize) || 0;
      const file = await open(archivePath, "w", 0o600);
      const hash = createHash("sha512");
      let received = 0;
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          await file.write(chunk);
          hash.update(chunk);
          received += chunk.length;
          this.emit({ agentId, state: "downloading", received, total, percent: total ? Math.min(99, Math.round(received / total * 100)) : 0 });
        }
      } finally {
        await file.close();
      }
      this.emit({ agentId, state: "verifying", received, total, percent: 99 });
      const actual = `sha512-${hash.digest("base64")}`;
      if (actual !== integrity) throw new Error(`${definition.packageName} 完整性校验失败`);
      this.emit({ agentId, state: "installing", received, total, percent: 99 });
      const extracted = join(temporaryDirectory, "package");
      await mkdir(extracted, { recursive: true, mode: 0o700 });
      await extractTar({ file: archivePath, cwd: extracted, strip: 1, preservePaths: false, strict: true });
      const extractedExecutable = join(extracted, definition.executable);
      await access(extractedExecutable);
      if (definition.kind === "native") await chmod(extractedExecutable, 0o755);
      await writeFile(join(extracted, "rux-runtime.json"), `${JSON.stringify({ agentId, version: definition.version, packageName: definition.packageName, packageVersion: definition.packageVersion, integrity }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await mkdir(join(finalDirectory, ".."), { recursive: true });
      await rename(extracted, finalDirectory);
      await rm(temporaryDirectory, { recursive: true, force: true });
      this.emit({ agentId, state: "ready", received, total, percent: 100 });
      return this.resolveInstalled(agentId);
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      this.emit({ agentId, state: "error", received: 0, total: 0, percent: 0, message: String((error as Error).message || error) });
      throw error;
    }
  }

  private definition(agentId: RuntimeAgentId): RuntimeDefinition {
    const platform = `${process.platform}-${process.arch}`;
    if (agentId === "codex") {
      const targets: Record<string, { suffix: string; triple: string; binary: string }> = {
        "darwin-arm64": { suffix: "darwin-arm64", triple: "aarch64-apple-darwin", binary: "codex" },
        "darwin-x64": { suffix: "darwin-x64", triple: "x86_64-apple-darwin", binary: "codex" },
        "linux-arm64": { suffix: "linux-arm64", triple: "aarch64-unknown-linux-musl", binary: "codex" },
        "linux-x64": { suffix: "linux-x64", triple: "x86_64-unknown-linux-musl", binary: "codex" },
        "win32-arm64": { suffix: "win32-arm64", triple: "aarch64-pc-windows-msvc", binary: "codex.exe" },
        "win32-x64": { suffix: "win32-x64", triple: "x86_64-pc-windows-msvc", binary: "codex.exe" },
      };
      const target = targets[platform];
      if (!target) throw new Error(`Codex 不支持当前平台：${platform}`);
      return { id: agentId, version: CODEX_VERSION, packageName: "@openai/codex", packageVersion: `${CODEX_VERSION}-${target.suffix}`, executable: join("vendor", target.triple, "bin", target.binary), kind: "native" };
    }
    if (agentId === "claude-code") {
      const packages: Record<string, string> = {
        "darwin-arm64": "darwin-arm64", "darwin-x64": "darwin-x64", "linux-arm64": "linux-arm64", "linux-x64": "linux-x64", "win32-arm64": "win32-arm64", "win32-x64": "win32-x64",
      };
      const suffix = packages[platform];
      if (!suffix) throw new Error(`Claude Code 不支持当前平台：${platform}`);
      return { id: agentId, version: CLAUDE_VERSION, packageName: `@anthropic-ai/claude-agent-sdk-${suffix}`, packageVersion: CLAUDE_VERSION, executable: process.platform === "win32" ? "claude.exe" : "claude", kind: "native" };
    }
    return { id: agentId, version: PI_VERSION, packageName: "@earendil-works/pi-coding-agent", packageVersion: PI_VERSION, executable: join("dist", "bundle", "rpc-entry.js"), kind: "node" };
  }

  private installDirectory(definition: RuntimeDefinition): string {
    return join(this.root, definition.id, definition.version, `${process.platform}-${process.arch}`);
  }

  private executablePath(definition: RuntimeDefinition): string {
    return join(this.installDirectory(definition), definition.executable);
  }

  private async exists(path: string): Promise<boolean> {
    try { return (await stat(path)).isFile(); } catch { return false; }
  }

  private emit(progress: RuntimeProgress): void {
    this.getWindow()?.webContents.send("runtime:progress", progress);
  }
}
