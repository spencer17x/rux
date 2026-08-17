import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UpdateManager } from "../src/electron/update-manager.ts";

class FakeUpdater extends EventEmitter {
  constructor(nextVersion = "1.1.0") { super(); this.nextVersion = nextVersion; }
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = false;
  channel = null;
  feed = null;
  installed = false;
  setFeedURL(feed) { this.feed = feed; }
  async checkForUpdates() {
    const updateInfo = { version: this.nextVersion, files: [], releaseDate: new Date().toISOString(), stagingPercentage: 10 };
    this.emit("update-available", updateInfo);
    return { updateInfo };
  }
  async downloadUpdate() {
    this.emit("download-progress", { percent: 42 });
    this.emit("update-downloaded", { version: this.nextVersion, files: [], releaseDate: new Date().toISOString() });
    return [];
  }
  quitAndInstall() { this.installed = true; }
}

test("signed updater is explicit, staged by electron-updater, and health-checkpointed before install", async () => {
  const updater = new FakeUpdater();
  const statePath = join(mkdtempSync(join(tmpdir(), "rux-update-")), "health.json");
  const manager = new UpdateManager({ updater, currentVersion: "1.0.0", packaged: true, feedUrl: "https://updates.example/rux", channel: "stable", statePath });
  assert.equal(manager.getState().phase, "idle");
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.deepEqual(updater.feed, { provider: "generic", url: "https://updates.example/rux" });
  assert.equal((await manager.check()).phase, "available");
  assert.equal((await manager.download()).phase, "downloaded");
  manager.install();
  assert.equal(updater.installed, true);

  const firstNewLaunch = new UpdateManager({ updater: new FakeUpdater(), currentVersion: "1.1.0", packaged: true, feedUrl: "https://updates.example/rux", statePath });
  assert.equal(firstNewLaunch.getState().rollbackPending, true);
  firstNewLaunch.confirmHealthy();
  const healthyRelaunch = new UpdateManager({ updater: new FakeUpdater(), currentVersion: "1.1.0", packaged: true, feedUrl: "https://updates.example/rux", statePath });
  assert.equal(healthyRelaunch.getState().rollbackPending, false);
});

test("two unhealthy launches accept only the exact previous signed version from the rollback feed", async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), "rux-update-rollback-")), "health.json");
  const initialUpdater = new FakeUpdater("1.1.0");
  const initial = new UpdateManager({ updater: initialUpdater, currentVersion: "1.0.0", packaged: true, feedUrl: "https://updates.example/rux", statePath });
  await initial.check();
  await initial.download();
  initial.install();
  new UpdateManager({ updater: new FakeUpdater(), currentVersion: "1.1.0", packaged: true, feedUrl: "https://updates.example/rux", statePath });
  const rollbackUpdater = new FakeUpdater("1.0.0");
  const secondFailedLaunch = new UpdateManager({ updater: rollbackUpdater, currentVersion: "1.1.0", packaged: true, feedUrl: "https://updates.example/rux", statePath });
  assert.equal(secondFailedLaunch.getState().rollbackPending, true);
  await secondFailedLaunch.recoverIfNeeded();
  assert.equal(rollbackUpdater.allowDowngrade, true);
  assert.deepEqual(rollbackUpdater.feed, { provider: "generic", url: "https://updates.example/rux/rollback/1.0.0" });
  assert.equal(rollbackUpdater.installed, true);
});

test("updater fails closed for unsigned development builds and unsafe feeds", async () => {
  const updater = new FakeUpdater();
  const manager = new UpdateManager({ updater, currentVersion: "1.0.0", packaged: false, feedUrl: "http://updates.example/rux", statePath: join(mkdtempSync(join(tmpdir(), "rux-update-disabled-")), "health.json") });
  assert.equal(manager.getState().phase, "disabled");
  assert.equal(manager.getState().configured, false);
  assert.equal((await manager.check()).phase, "disabled");
  assert.equal(updater.feed, null);
});
