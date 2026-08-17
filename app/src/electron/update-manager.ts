import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { UpdateState } from "../shared/protocol";

type PersistedUpdateHealth = {
  version: 1;
  installedFrom?: string;
  expectedVersion?: string;
  launchAttempts: number;
  healthyVersion?: string;
};

type UpdateManagerOptions = {
  updater: UpdateDriver;
  currentVersion?: string;
  packaged?: boolean;
  feedUrl?: string;
  channel?: string;
  statePath?: string;
};

type UpdateInfo = { version: string };
type UpdateDriver = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<{ updateInfo?: UpdateInfo } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

const MAX_DETAIL = 500;

function safeDetail(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(/https?:\/\/[^\s]+/gi, "[update endpoint]").slice(0, MAX_DETAIL);
}

function validFeedUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export class UpdateManager {
  private readonly updater: UpdateDriver;
  private readonly currentVersion: string;
  private readonly feedUrl?: string;
  private readonly channel: string;
  private readonly statePath: string;
  private state: UpdateState;
  private health: PersistedUpdateHealth;
  private checkPromise: Promise<UpdateState> | null = null;

  constructor(options: UpdateManagerOptions) {
    this.updater = options.updater;
    this.currentVersion = options.currentVersion ?? "0.0.0";
    this.feedUrl = validFeedUrl(options.feedUrl ?? process.env.RUX_UPDATE_FEED_URL);
    this.channel = (options.channel ?? process.env.RUX_UPDATE_CHANNEL ?? "stable").replace(/[^a-z0-9._-]/gi, "").slice(0, 40) || "stable";
    this.statePath = options.statePath ?? resolve(process.cwd(), "update-health.json");
    const configured = (options.packaged ?? false) && Boolean(this.feedUrl);
    this.state = { phase: configured ? "idle" : "disabled", currentVersion: this.currentVersion, channel: this.channel, configured, ...(!configured ? { detail: "正式签名更新 Feed 尚未配置" } : {}) };
    this.health = this.loadHealth();
    this.noteLaunch();
    if (configured) this.configureUpdater();
  }

  getState(): UpdateState {
    return { ...this.state, rollbackPending: this.health.expectedVersion === this.currentVersion && this.health.healthyVersion !== this.currentVersion };
  }

  async check(): Promise<UpdateState> {
    if (!this.state.configured) return this.getState();
    if (this.checkPromise) return this.checkPromise;
    this.state = { ...this.state, phase: "checking", detail: undefined, progressPercent: undefined };
    this.checkPromise = this.updater.checkForUpdates()
      .then((result) => {
        if (!result?.updateInfo || result.updateInfo.version === this.currentVersion) this.state = { ...this.state, phase: "idle", detail: "当前已是最新版本" };
        return this.getState();
      })
      .catch((error) => {
        this.state = { ...this.state, phase: "error", detail: safeDetail(error) };
        return this.getState();
      })
      .finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async download(): Promise<UpdateState> {
    if (this.state.phase !== "available") throw new Error("No verified update is available for download");
    this.state = { ...this.state, phase: "downloading", progressPercent: 0 };
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.state = { ...this.state, phase: "error", detail: safeDetail(error) };
    }
    return this.getState();
  }

  install(): void {
    if (this.state.phase !== "downloaded" || !this.state.updateVersion) throw new Error("No signature-verified update is ready to install");
    this.health = { version: 1, installedFrom: this.currentVersion, expectedVersion: this.state.updateVersion, launchAttempts: 0, healthyVersion: this.health.healthyVersion };
    this.persistHealth();
    this.state = { ...this.state, phase: "installing" };
    this.updater.quitAndInstall(false, true);
  }

  confirmHealthy(): UpdateState {
    this.health = { version: 1, launchAttempts: 0, healthyVersion: this.currentVersion };
    this.persistHealth();
    return this.getState();
  }

  async recoverIfNeeded(): Promise<UpdateState> {
    if (!this.state.configured || !this.state.rollbackPending || this.health.launchAttempts < 2 || !this.health.installedFrom || !this.feedUrl) return this.getState();
    const rollbackVersion = this.health.installedFrom;
    this.updater.allowDowngrade = true;
    this.updater.setFeedURL({ provider: "generic", url: `${this.feedUrl}/rollback/${encodeURIComponent(rollbackVersion)}` });
    this.state = { ...this.state, phase: "checking", detail: `正在检查上一健康版本 ${rollbackVersion} 的签名回滚包` };
    try {
      const result = await this.updater.checkForUpdates();
      if (result?.updateInfo?.version !== rollbackVersion) throw new Error("Rollback feed did not return the exact previous healthy version");
      await this.updater.downloadUpdate();
      if (this.state.phase !== "downloaded" || this.state.updateVersion !== rollbackVersion) throw new Error("Rollback package did not pass updater verification");
      this.install();
    } catch (error) {
      this.state = { ...this.state, phase: "error", rollbackPending: true, detail: safeDetail(error) };
    }
    return this.getState();
  }

  private configureUpdater(): void {
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = this.channel !== "stable";
    this.updater.channel = this.channel;
    this.updater.setFeedURL({ provider: "generic", url: this.feedUrl! });
    this.updater.on("update-available", (info: UpdateInfo) => { this.state = { ...this.state, phase: "available", updateVersion: info.version, detail: "更新元数据与分阶段资格已通过，等待用户下载" }; });
    this.updater.on("update-not-available", () => { this.state = { ...this.state, phase: "idle", detail: "当前已是最新版本" }; });
    this.updater.on("download-progress", (progress) => { this.state = { ...this.state, phase: "downloading", progressPercent: Math.max(0, Math.min(100, progress.percent)) }; });
    this.updater.on("update-downloaded", (info: UpdateInfo) => { this.state = { ...this.state, phase: "downloaded", updateVersion: info.version, progressPercent: 100, detail: "签名与哈希校验通过，等待用户确认重启安装" }; });
    this.updater.on("error", (error) => { this.state = { ...this.state, phase: "error", detail: safeDetail(error) }; });
  }

  private loadHealth(): PersistedUpdateHealth {
    try {
      const value = JSON.parse(readFileSync(this.statePath, "utf8")) as Partial<PersistedUpdateHealth>;
      if (value.version === 1 && Number.isInteger(value.launchAttempts) && (value.launchAttempts ?? -1) >= 0) return { version: 1, launchAttempts: value.launchAttempts!, ...(value.installedFrom ? { installedFrom: String(value.installedFrom) } : {}), ...(value.expectedVersion ? { expectedVersion: String(value.expectedVersion) } : {}), ...(value.healthyVersion ? { healthyVersion: String(value.healthyVersion) } : {}) };
    } catch { /* start with an empty health checkpoint */ }
    return { version: 1, launchAttempts: 0 };
  }

  private noteLaunch(): void {
    if (this.health.expectedVersion !== this.currentVersion || this.health.healthyVersion === this.currentVersion) return;
    this.health.launchAttempts += 1;
    this.persistHealth();
    if (this.health.launchAttempts >= 2) this.state = { ...this.state, detail: "新版本连续两次未确认健康；已停止自动更新，请从已签名 Release 安装上一健康版本", rollbackPending: true };
  }

  private persistHealth(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.health, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.statePath);
  }
}
