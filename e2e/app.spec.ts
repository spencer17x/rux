import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let application: ElectronApplication;
let page: Page;
let testRoot: string;

async function launchApplication() {
  application = await electron.launch({
    args: [resolve("out/main/main.js"), `--user-data-dir=${join(testRoot, "user-data")}`],
    env: { ...process.env, RUX_E2E: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
}

test.beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), "rux-e2e-"));
  await launchApplication();
});

test.afterEach(async () => {
  if (page && !page.isClosed()) await page.evaluate(() => (window as any).rux.terminal.stop()).catch(() => {});
  await application?.close();
  rmSync(testRoot, { recursive: true, force: true });
});

test("creates the initial standalone conversation and opens typed settings", async () => {
  await expect(page.getByText("独立会话", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "添加项目" }).click();
  await expect(page.getByRole("dialog", { name: "添加项目" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "模型与连接" })).toBeVisible();
  await page.getByRole("button", { name: "常规" }).click();
  await expect(page.getByRole("heading", { name: "账户" })).toBeVisible();
  await page.getByRole("button", { name: "返回 Rux" }).click();
  await page.getByRole("button", { name: /E2E Model/ }).click();
  await expect(page.getByRole("dialog", { name: "选择模型" })).toBeVisible();
});

test("restores a SQLite project and executes a command through the PTY terminal", async () => {
  const projectPath = join(testRoot, "project");
  mkdirSync(projectPath, { recursive: true });
  await page.evaluate(async (path) => {
    await (window as any).rux.projects.import({ path, createThread: true });
  }, projectPath);
  await application.close();
  await launchApplication();
  await expect(page.getByText("project", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /终端/ }).first().click();
  const terminalInput = page.locator(".xterm-helper-textarea");
  await terminalInput.focus();
  await terminalInput.pressSequentially("printf RUX_E2E_TERMINAL", { delay: 50 });
  await terminalInput.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("RUX_E2E_TERMINAL", { timeout: 10_000 });
});
