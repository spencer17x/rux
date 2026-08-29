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
  await page.getByRole("textbox", { name: "消息" }).fill("Create standalone draft");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /会话操作 未命名会话/ }).click();
  await page.getByRole("menuitem", { name: "重命名会话" }).click();
  await expect(page.getByRole("dialog", { name: "重命名会话" })).toBeVisible();
  await page.getByRole("textbox", { name: "会话名称" }).fill("E2E renamed");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "E2E renamed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加项目" }).click();
  await expect(page.getByRole("dialog", { name: "添加项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置" })).toHaveCount(0);
  await page.getByRole("button", { name: /新建项目 创建空项目/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByRole("textbox", { name: "项目名称" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "添加项目" })).toBeHidden();
  await expect(page.getByRole("button", { name: "添加项目" })).toBeFocused();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "模型与连接" })).toBeVisible();
  await page.getByRole("button", { name: "常规" }).click();
  await expect(page.getByRole("heading", { name: "账户" })).toBeVisible();
  await page.getByRole("button", { name: "返回 Rux" }).click();
  await page.getByRole("button", { name: "选择 Agent 模式" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("button", { name: "选择模型" }).click();
  await expect(page.getByRole("dialog", { name: "选择模型" })).toBeVisible();
  await expect(page.getByRole("menu")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "选择模型" })).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).toBeFocused();
  await page.getByRole("button", { name: "选择 Agent", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(page.getByRole("button", { name: "选择 Agent", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "消息" }).fill("E2E main turn");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true })).toBeVisible();
});

test("deletes a conversation from the sidebar action menu", async () => {
  await page.getByRole("textbox", { name: "消息" }).fill("Create deletable standalone");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /会话操作 未命名会话/ }).last().click();
  await page.getByRole("menuitem", { name: "重命名会话" }).click();
  await page.getByRole("textbox", { name: "会话名称" }).fill("Delete me");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete me", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "会话操作 Delete me" }).click();
  const confirmation = new Promise<void>((resolve) => page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("删除会话"); await dialog.accept(); resolve(); }));
  await page.getByRole("menuitem", { name: "删除会话" }).click();
  await confirmation;
  await expect(page.getByRole("button", { name: "Delete me", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "消息" })).toBeVisible();
});

test("restores a SQLite project and executes a command through the PTY terminal", async () => {
  test.slow();
  const projectPath = join(testRoot, "project");
  mkdirSync(projectPath, { recursive: true });
  await page.evaluate(async (path) => {
    await (window as any).rux.projects.import({ path, createThread: true });
  }, projectPath);
  await application.close();
  await launchApplication();
  await expect(page.getByText("project", { exact: true }).first()).toBeVisible();
  const projectMenuTrigger = page.getByRole("button", { name: "项目操作 project" });
  await projectMenuTrigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(projectMenuTrigger).toBeFocused();
  await page.getByRole("button", { name: "侧边聊天" }).first().click();
  await page.getByRole("textbox", { name: "侧边聊天消息" }).fill("E2E side turn");
  await page.getByRole("button", { name: "发送侧边聊天消息" }).click();
  await expect(page.getByText("Rux 正在回复", { exact: true })).toBeVisible();
  await expect(page.getByText("RUX_E2E_SIDE_OK", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /终端/ }).first().click();
  const terminalInput = page.locator(".xterm-helper-textarea");
  await terminalInput.focus();
  await terminalInput.pressSequentially("printf RUX_E2E_TERMINAL", { delay: 50 });
  await terminalInput.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("RUX_E2E_TERMINAL", { timeout: 10_000 });
  await expect(page.getByLabel("终端输出")).toContainText("RUX_E2E_TERMINAL");
  await expect(page.getByLabel("终端输出")).not.toContainText("正在启动终端");
});
