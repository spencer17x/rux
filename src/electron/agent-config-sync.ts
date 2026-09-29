import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeAgentId } from "./runtime-manager";
import type { AgentDataPaths } from "./agent-data";

export type ConfigCandidate = { name: string; sourceHash: string; targetHash: string | null };
export type ConfigSyncStatus = { agentId: RuntimeAgentId; sourceRoot: string; files: ConfigCandidate[] };
type Manifest = Record<string, Record<string, string>>;

const filesByAgent: Record<RuntimeAgentId, string[]> = {
  codex: ["config.toml"],
  "claude-code": ["settings.json", "settings.local.json"],
  pi: ["settings.json"],
};

async function contents(path: string): Promise<Buffer | null> {
  let info;
  try { info = await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error(`配置文件不可导入：${path}`);
  return readFile(path);
}

function digest(value: Buffer | null): string | null {
  return value === null ? null : createHash("sha256").update(value).digest("hex");
}

export class AgentConfigSync {
  private readonly manifestPath: string;

  constructor(private readonly dataRoot: string, private readonly paths: AgentDataPaths, private readonly sources: Record<RuntimeAgentId, string>) {
    this.manifestPath = join(dataRoot, "agent-config-sync.json");
  }

  async check(agentId: RuntimeAgentId, includeDismissed = false): Promise<ConfigSyncStatus> {
    const manifest = await this.readManifest();
    const files: ConfigCandidate[] = [];
    for (const name of filesByAgent[agentId]) {
      const sourceHash = digest(await contents(join(this.sources[agentId], name)));
      if (!sourceHash) continue;
      const targetHash = digest(await contents(join(this.target(agentId), name)));
      if (sourceHash !== targetHash && (includeDismissed || manifest[agentId]?.[name] !== sourceHash)) files.push({ name, sourceHash, targetHash });
    }
    return { agentId, sourceRoot: this.sources[agentId], files };
  }

  async apply(status: ConfigSyncStatus): Promise<void> {
    await this.verify(status);
    await mkdir(this.target(status.agentId), { recursive: true, mode: 0o700 });
    for (const file of status.files) {
      const bytes = await contents(join(this.sources[status.agentId], file.name));
      if (!bytes || digest(bytes) !== file.sourceHash) throw new Error("外部配置已变化，请重新检查后再同步");
      const destination = join(this.target(status.agentId), file.name);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, destination);
    }
    await this.markSeen(status);
  }

  async dismiss(status: ConfigSyncStatus): Promise<void> {
    await this.verify(status);
    await this.markSeen(status);
  }

  private target(agentId: RuntimeAgentId): string {
    return agentId === "codex" ? this.paths.codexHome : agentId === "claude-code" ? this.paths.claudeHome : join(this.paths.piHome, "pi-agent");
  }

  private async verify(status: ConfigSyncStatus): Promise<void> {
    const current = await this.check(status.agentId, true);
    if (current.sourceRoot !== status.sourceRoot || status.files.some((file) => !current.files.some((candidate) => JSON.stringify(candidate) === JSON.stringify(file)))) throw new Error("配置已变化，请重新检查后再同步");
  }

  private async markSeen(status: ConfigSyncStatus): Promise<void> {
    const manifest = await this.readManifest();
    manifest[status.agentId] ||= {};
    for (const file of status.files) manifest[status.agentId][file.name] = file.sourceHash;
    const temporary = `${this.manifestPath}.${randomUUID()}.tmp`;
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.manifestPath);
  }

  private async readManifest(): Promise<Manifest> {
    try {
      const value = JSON.parse(await readFile(this.manifestPath, "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? value as Manifest : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }
}
