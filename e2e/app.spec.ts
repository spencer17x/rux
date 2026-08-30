import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  await expect(page.locator("aside.sidebar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "切换左侧面板" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "切换底部面板" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "切换环境信息" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "切换左侧面板" }).click();
  await expect(page.getByText("独立会话", { exact: true }).first()).toBeVisible();
  await page.getByRole("textbox", { name: "消息" }).fill("Create standalone draft");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("进行中", { exact: true })).toBeVisible();
  await expect(page.getByText("Rux 正在继续处理", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "操作批准方式" }).click();
  await page.getByRole("button", { name: /^请求批准 / }).click();
  await expect(page.locator(".toast")).toContainText("请先停止当前任务");
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("进行中", { exact: true })).toBeHidden();
  await expect(page.getByText("Rux 正在继续处理", { exact: true })).toBeHidden();
  await expect(page.getByText("已完成", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "复制会话内容" }).click();
  await expect(page.getByRole("status")).toContainText("会话内容已复制");
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
  const stickySwitch = page.getByRole("switch", { name: "对话 Sticky" });
  await expect(stickySwitch).toHaveAttribute("aria-checked", "true");
  await stickySwitch.click();
  await expect(stickySwitch).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "保存对话设置" }).click();
  await expect(page.locator(".settings-status")).toContainText("已保存");
  await page.getByRole("button", { name: "权限", exact: true }).click();
  await page.getByRole("button", { name: "完全访问", exact: true }).click();
  await page.getByRole("button", { name: "保存权限", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "要开启完整访问权限吗？" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "帮我批准", exact: true }).click();
  await page.getByRole("button", { name: "保存权限", exact: true }).click();
  await page.getByRole("button", { name: "返回 Rux" }).click();
  await page.getByRole("button", { name: "操作批准方式" }).click();
  await page.locator(".permission-option.is-danger").click({ force: true });
  await expect(page.getByRole("alertdialog", { name: "要开启完整访问权限吗？" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "要开启完整访问权限吗？" })).toBeHidden();
  await expect(page.getByRole("button", { name: "操作批准方式" })).toContainText("帮我批准");
  await page.getByRole("button", { name: "操作批准方式" }).click();
  await page.locator(".permission-option.is-danger").click({ force: true });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator(".full-access-banner")).toContainText("完整访问权限已开启");
  await expect(page.getByRole("button", { name: "操作批准方式" })).toContainText("完全访问");
  await page.locator(".full-access-banner").getByRole("button", { name: "关闭" }).click();
  await expect(page.locator(".full-access-banner")).toBeHidden();
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
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true }).last()).toBeVisible();
});

test("deletes a conversation from the sidebar action menu", async () => {
  await page.getByRole("textbox", { name: "消息" }).fill("Create deletable standalone");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "切换左侧面板" }).click();
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

test("keeps unsent standalone drafts isolated and restores them after restart", async () => {
  await page.getByRole("textbox", { name: "消息" }).fill("Persisted conversation");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true })).toBeVisible();
  await expect(page.getByText("已完成", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "切换左侧面板" }).click();
  const persistedThread = page.getByRole("button", { name: "未命名会话", exact: true });
  await expect(persistedThread).toBeVisible();

  await page.getByRole("button", { name: "新建独立会话" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toHaveValue("");
  await page.getByRole("textbox", { name: "消息" }).fill("Unsent per-thread draft");
  await persistedThread.click();
  await expect(page.getByRole("textbox", { name: "消息" })).toHaveValue("");
  await page.getByRole("button", { name: "新建独立会话" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toHaveValue("Unsent per-thread draft");

  await page.waitForTimeout(100);
  await application.close();
  await launchApplication();
  await page.getByRole("button", { name: "切换左侧面板" }).click();
  await page.getByRole("button", { name: "新建独立会话" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toHaveValue("Unsent per-thread draft");
});

test("restores a SQLite project and executes a command through the PTY terminal", async () => {
  test.slow();
  const projectPath = join(testRoot, "project");
  mkdirSync(projectPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: projectPath });
  execFileSync("git", ["config", "user.email", "rux@example.test"], { cwd: projectPath }); execFileSync("git", ["config", "user.name", "Rux Test"], { cwd: projectPath });
  writeFileSync(join(projectPath, "branch.txt"), "base\n"); execFileSync("git", ["add", "branch.txt"], { cwd: projectPath }); execFileSync("git", ["commit", "-m", "base"], { cwd: projectPath });
  execFileSync("git", ["switch", "-c", "feature"], { cwd: projectPath }); writeFileSync(join(projectPath, "branch.txt"), "base\nfeature\n"); execFileSync("git", ["add", "branch.txt"], { cwd: projectPath }); execFileSync("git", ["commit", "-m", "feature"], { cwd: projectPath });
  await page.evaluate(async (path) => {
    await (window as any).rux.projects.import({ path, createThread: true });
  }, projectPath);
  await application.close();
  await launchApplication();
  await expect(page.getByText("project", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "切换环境信息" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "打开位置" }).click();
  await expect(page.getByRole("button", { name: "复制项目路径" })).toBeVisible();
  await page.getByRole("button", { name: "复制项目路径" }).click();
  await expect(page.getByRole("status")).toContainText("项目路径已复制");
  await page.getByRole("button", { name: "切换环境信息" }).click();
  await expect(page.getByRole("complementary", { name: "环境信息" })).toBeVisible();
  await expect(page.getByRole("button", { name: /变更/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交或推送" })).toBeVisible();
  await expect(page.getByRole("button", { name: /比较分支/ })).toBeVisible();
  await page.getByRole("button", { name: /比较分支/ }).click();
  await page.getByRole("menuitem", { name: "main", exact: true }).click();
  await expect(page.getByRole("button", { name: /^分支比较/ })).toBeVisible();
  await expect(page.locator(".real-diff")).toContainText("+feature");
  await page.getByRole("button", { name: "返回对话" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toBeVisible();
  await page.getByRole("button", { name: "切换左侧面板" }).click();
  const projectMenuTrigger = page.getByRole("button", { name: "项目操作 project" });
  await projectMenuTrigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(projectMenuTrigger).toBeFocused();
  await page.getByRole("button", { name: "切换底部面板" }).click();
  await page.getByRole("tab", { name: "侧边聊天" }).click();
  await page.getByRole("textbox", { name: "侧边聊天消息" }).fill("E2E side turn");
  await page.getByRole("button", { name: "发送侧边聊天消息" }).click();
  await expect(page.getByText("Codex 正在回复", { exact: true })).toBeVisible();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true }).last()).toBeVisible();
  await page.getByRole("tab", { name: "终端" }).click();
  const terminalInput = page.locator(".xterm-helper-textarea");
  await terminalInput.focus();
  await terminalInput.pressSequentially("printf RUX_E2E_TERMINAL", { delay: 50 });
  await terminalInput.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("RUX_E2E_TERMINAL", { timeout: 10_000 });
  await expect(page.getByLabel("终端输出")).toContainText("RUX_E2E_TERMINAL");
  await expect(page.getByLabel("终端输出")).not.toContainText("正在启动终端");
});
