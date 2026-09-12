import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StateDatabase } from "../src/electron/state-database";

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
  // Hosted macOS displays can clamp native windows to 1024px. Test the renderer
  // at a known viewport instead of depending on the host's physical work area.
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function restartWithMessages(messages: Record<string, unknown[]>) {
  // Seed only after the renderer has exited: its pending startup/close snapshot
  // can otherwise overwrite messages inserted directly through IPC.
  await application.close();
  const database = new StateDatabase(join(testRoot, "user-data", "rux.sqlite"));
  try {
    database.saveTurnInfo(messages);
    database.saveMessages(messages);
    expect(database.loadMessages()).toEqual(messages);
  } finally { database.close(); }
  await launchApplication();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.rux.messages.list())).toMatchObject(messages);
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
  // Keep this turn running until the permission assertion has completed.
  // A fixed-duration mock races UI actions on a slower CI runner.
  const heldRuns = await application.evaluateHandle(({ ipcMain }) => {
    const runs = new Map<string, Electron.WebContents>();
    ipcMain.removeHandler("agent:start");
    ipcMain.handle("agent:start", (event, input) => {
      runs.set(input.runId, event.sender);
      event.sender.send("agent:event", { runId: input.runId, type: "text-delta", itemId: `text-${input.runId}`, delta: "RUX_E2E_AGENT_OK" });
      return { runId: input.runId, threadId: "e2e-thread", turnId: "e2e-turn" };
    });
    return runs;
  });
  await expect(page.locator("aside.sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  const sidebarToggle = page.getByRole("button", { name: "切换左侧面板" });
  await expect(sidebarToggle).toHaveAttribute("aria-pressed", "true");
  await sidebarToggle.click();
  await expect(page.locator("aside.sidebar")).toHaveCount(0);
  await expect(sidebarToggle).toHaveAttribute("aria-pressed", "false");
  await sidebarToggle.click();
  await expect(page.locator("aside.sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "切换底部面板" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "切换右侧面板" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("独立会话", { exact: true }).first()).toBeVisible();
  await page.getByRole("textbox", { name: "消息" }).fill("Create standalone draft");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("进行中", { exact: true })).toBeVisible();
  await expect(page.getByText("Rux 正在继续处理", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "操作批准方式" }).click();
  await page.getByRole("button", { name: /^请求批准 / }).click();
  await expect(page.locator(".toast")).toContainText("请先停止当前任务");
  await heldRuns.evaluate((runs) => {
    if (runs.size !== 1) throw new Error("Expected one held Agent turn");
    for (const [runId, sender] of runs) sender.send("agent:event", { runId, type: "turn-completed", status: "completed", turnId: "e2e-turn" });
    runs.clear();
  });
  await heldRuns.dispose();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("进行中", { exact: true })).toBeHidden();
  await expect(page.getByText("Rux 正在继续处理", { exact: true })).toBeHidden();
  await expect(page.getByLabel("本轮状态：已完成", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "复制会话内容" }).click();
  await expect(page.getByRole("status")).toContainText("会话内容已复制");
  await page.getByRole("button", { name: /会话操作 未命名会话/ }).click();
  await page.getByRole("menuitem", { name: "重命名会话" }).click();
  await expect(page.getByRole("dialog", { name: "重命名会话" })).toBeVisible();
  await page.getByRole("textbox", { name: "会话名称" }).fill("E2E renamed");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "E2E renamed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加项目" }).click();
  await expect(page.getByRole("dialog", { name: "添加项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /新建项目 创建空项目/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByRole("textbox", { name: "项目名称" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "添加项目" })).toBeHidden();
  await expect(page.getByRole("button", { name: "添加项目" })).toBeFocused();
  await page.getByRole("button", { name: "设置", exact: true }).click();
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
  await page.getByRole("radio", { name: "完全访问", exact: true }).click();
  await page.getByRole("button", { name: "保存权限", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "要开启完整访问权限吗？" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("radio", { name: "帮我批准", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "操作批准方式" })).toContainText("完全访问");
  await expect(page.getByRole("button", { name: "操作批准方式" })).toHaveAttribute("data-permission-mode", "danger-full-access");
  await expect(page.locator(".full-access-banner")).toHaveCount(0);
  await page.getByRole("button", { name: "操作批准方式" }).click();
  await page.getByRole("button", { name: /^帮我批准 / }).click();
  const permissionTrigger = page.getByRole("button", { name: "操作批准方式" });
  await expect(permissionTrigger).toHaveAttribute("data-permission-mode", "workspace-write");
  await expect(permissionTrigger.locator("img.permission-mode-icon")).toHaveCount(1);
  await permissionTrigger.click();
  const selectedPermissionIcon = page.locator(".permission-option.is-selected img.permission-mode-icon");
  await expect(selectedPermissionIcon).toHaveCount(1);
  expect(await permissionTrigger.locator("img.permission-mode-icon").getAttribute("src")).toBe(await selectedPermissionIcon.getAttribute("src"));
  await permissionTrigger.click();
  await page.getByRole("button", { name: "选择 Agent 模式" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("button", { name: "切换模型、推理强度和速度" }).click();
  await expect(page.getByRole("dialog", { name: "切换模型、推理强度和速度" })).toBeVisible();
  await expect(page.locator(".agent-mode-popover")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "切换模型、推理强度和速度" })).toBeHidden();
  await expect(page.getByRole("button", { name: "切换模型、推理强度和速度" })).toBeFocused();
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
  await expect(page.getByLabel("本轮状态：已完成", { exact: true })).toBeVisible();
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
  await expect(page.getByLabel("本轮状态：已完成", { exact: true }).last()).toBeVisible();
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
  await page.getByRole("button", { name: "新建独立会话" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toHaveValue("Unsent per-thread draft");
});

test("navigates between completed turns from the conversation sticky", async () => {
  const messages = await page.evaluate(async () => {
    const thread = await window.rux.projects.addStandalone({ title: "Sticky navigation" });
    const messages = Array.from({ length: 5 }, (_, index) => [{ id: `sticky-user-${index}`, role: "user", text: `Sticky question ${index + 1}`, parts: [{ type: "text", text: `Sticky question ${index + 1}` }] }, { id: `sticky-assistant-${index}`, role: "assistant", status: "complete", parts: [{ type: "text", text: `Completed turn ${index + 1}.\n\n${"Long response content. ".repeat(18)}` }] }]).flat();
    return { [thread.id]: messages };
  });
  await restartWithMessages(messages);
  const currentTurn = page.getByRole("button", { name: /返回当前轮问题/ }); const previous = page.getByRole("button", { name: "切换到上一轮" }); const next = page.getByRole("button", { name: "切换到下一轮" });
  await expect(currentTurn).toBeVisible(); const initialLabel = await currentTurn.getAttribute("aria-label");
  await previous.click(); await page.waitForTimeout(800); expect(await currentTurn.getAttribute("aria-label")).not.toBe(initialLabel);
  await next.click(); await page.waitForTimeout(800); expect(await currentTurn.getAttribute("aria-label")).toBe(initialLabel);
  for (let index = 0; index < 5 && await previous.isEnabled(); index += 1) { await previous.click(); await page.waitForTimeout(300); }
  await expect(previous).toBeDisabled(); await expect(next).toBeEnabled();
  for (let index = 0; index < 5 && await next.isEnabled(); index += 1) { await next.click(); await page.waitForTimeout(300); }
  await expect(next).toBeDisabled(); await expect(previous).toBeEnabled();
  expect(await page.evaluate(() => window.rux.messages.list())).toMatchObject(messages);
});

test("restores a SQLite project and executes a command through the PTY terminal", async ({}, testInfo) => {
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
  await expect(page.getByRole("button", { name: "切换右侧面板" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "复制项目路径" })).toBeVisible();
  await page.getByRole("menuitem", { name: "复制项目路径" }).click();
  await expect(page.getByRole("status")).toContainText("项目路径已复制");
  await page.getByRole("button", { name: "切换右侧面板" }).click();
  await page.getByRole("button", { name: "环境", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "环境信息" })).toBeVisible();
  await expect(page.getByRole("button", { name: /变更/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交或推送" })).toBeVisible();
  await expect(page.getByRole("button", { name: /比较分支/ })).toBeVisible();
  await page.getByRole("button", { name: /比较分支/ }).click();
  await page.getByRole("menuitem", { name: "main", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^分支比较/ })).toBeVisible();
  await expect(page.locator(".real-diff")).toContainText("+feature");
  await expect(page.locator(".diff-line.is-added")).toBeInViewport();
  await expect(page.getByRole("complementary", { name: "环境信息" }).getByRole("button", { name: "提交或推送" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("git-review.png") });
  await page.getByRole("button", { name: "返回对话" }).click();
  await expect(page.getByRole("textbox", { name: "消息" })).toBeVisible();
  const projectMenuTrigger = page.getByRole("button", { name: "项目操作 project" });
  await projectMenuTrigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  const openInFileManager = page.getByRole("menuitem", { name: "在文件管理器中打开", exact: true });
  await expect(openInFileManager).toBeVisible();
  const openItemMetrics = await openInFileManager.evaluate((element) => ({ whiteSpace: getComputedStyle(element).whiteSpace, height: element.getBoundingClientRect().height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(openItemMetrics.whiteSpace).toBe("nowrap"); expect(openItemMetrics.height).toBe(32); expect(openItemMetrics.scrollWidth).toBe(openItemMetrics.clientWidth);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(projectMenuTrigger).toBeFocused();
  await page.getByRole("button", { name: "切换底部面板" }).click();
  await page.getByRole("button", { name: "关闭右侧面板" }).click();
  await page.getByRole("button", { name: "切换工作区工具" }).click();
  await page.getByRole("menuitem", { name: /^侧边聊天/ }).click();
  await page.getByRole("textbox", { name: "侧边聊天消息" }).fill("E2E side turn");
  await page.getByRole("button", { name: "发送侧边聊天消息" }).click();
  await expect(page.getByText("Codex 正在回复", { exact: true })).toBeVisible();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "切换工作区工具" }).click();
  await page.getByRole("menuitem", { name: /^终端/ }).click();
  const terminalInput = page.locator(".xterm-helper-textarea");
  await terminalInput.focus();
  await terminalInput.pressSequentially("printf RUX_E2E_TERMINAL", { delay: 50 });
  await terminalInput.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("RUX_E2E_TERMINAL", { timeout: 10_000 });
  await expect(page.getByLabel("终端输出")).toContainText("RUX_E2E_TERMINAL");
  await expect(page.getByLabel("终端输出")).not.toContainText("正在启动终端");
  await page.getByRole("button", { name: "关闭底部面板" }).click();
  await page.getByRole("button", { name: "切换底部面板" }).click();
  await expect(page.getByLabel("终端输出")).toContainText("RUX_E2E_TERMINAL");
  await page.locator(".xterm-helper-textarea").pressSequentially("printf RUX_TERMINAL_REOPEN");
  await page.locator(".xterm-helper-textarea").press("Enter");
  await expect(page.getByLabel("终端输出")).toContainText("RUX_TERMINAL_REOPEN");
});


test("keeps composer controls within a narrow desktop pane and dismisses menus", async () => {
  await page.setViewportSize({ width: 900, height: 650 });
  const controls = page.locator(".composer-controls");
  const sizes = await controls.evaluate((element) => {
    const parent = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll("button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return { name: button.getAttribute("aria-label"), within: rect.left >= parent.left - 1 && rect.right <= parent.right + 1, height: rect.height };
    });
  });
  expect(sizes.every((control) => control.within && control.height >= 28)).toBe(true);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(page.getByRole("menu", { name: "会话操作", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "消息" }).click();
  await expect(page.getByRole("menu", { name: "会话操作", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "更多", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "切换模型、推理强度和速度", exact: true }).click();
  await page.getByRole("button", { name: "选择模型", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "模型", exact: true }).getByRole("menuitemradio").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "切换模型、推理强度和速度", exact: true })).toBeHidden();
});

test("pastes and drops images, previews drafts and sent images, and retains them after restart", async ({}, testInfo) => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const picked = join(testRoot, "picked.png");
  writeFileSync(picked, Buffer.from(png, "base64"));
  await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, picked);
  await page.getByRole("button", { name: "添加文件", exact: true }).click();
  await expect(page.getByRole("button", { name: "移除附件 picked.png" })).toBeVisible();
  const pickedPreview = page.getByRole("button", { name: "预览图片 picked.png", exact: true });
  await expect.poll(async () => pickedPreview.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await pickedPreview.click();
  const preview = page.getByRole("dialog", { name: "图片预览", exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(async () => preview.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(pickedPreview).toBeFocused();
  await page.getByRole("button", { name: "移除附件 picked.png" }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).evaluate((element, data) => {
    const file = new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], "pasted.png", { type: "image/png" });
    const clipboardData = new DataTransfer(); clipboardData.items.add(file);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, png);
  await expect(page.getByRole("button", { name: "移除附件 pasted.png" })).toBeVisible();
  await expect.poll(async () => page.getByRole("img", { name: "图片附件 pasted.png", exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await page.locator(".composer").evaluate((element, data) => {
    const file = new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], "dropped.png", { type: "image/png" });
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(file);
    element.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
  }, png);
  await expect(page.getByRole("button", { name: "移除附件 dropped.png" })).toBeVisible();
  await expect.poll(async () => page.getByRole("img", { name: "图片附件 dropped.png", exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await page.getByRole("button", { name: "移除附件 pasted.png" }).click();
  await expect(page.getByRole("button", { name: "移除附件 pasted.png" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "移除附件 dropped.png" })).toHaveCount(0);
  await expect(page.getByLabel("消息附件")).toContainText("dropped.png");
  await page.getByLabel("消息附件").getByRole("button", { name: "预览图片 dropped.png", exact: true }).click();
  await expect.poll(async () => preview.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await page.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const all = await window.rux.messages.list() as Record<string, Array<{ role: string; attachments?: string[] }>>;
    return Object.values(all).flat().find(message => message.role === "user")?.attachments?.[0] || "";
  })).toMatch(/attachments.*dropped\.png$/);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加文件", exact: true }).click();
  await expect(page.getByRole("button", { name: "移除附件 picked.png" })).toBeVisible();
  await page.getByRole("textbox", { name: "消息", exact: true }).press("Enter");
  await expect(page.getByText("RUX_E2E_AGENT_OK", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("本轮状态：已完成", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const messages = await window.rux.messages.list() as Record<string, Array<{ attachments?: string[] }>>;
    return Object.values(messages).flat().some((message) => message.attachments?.some((path) => path.endsWith("picked.png")));
  })).toBe(true);
  await application.close();
  rmSync(picked);
  await launchApplication();
  await page.getByRole("button", { name: "预览图片 dropped.png", exact: true }).click();
  await expect.poll(async () => page.getByRole("dialog", { name: "图片预览", exact: true }).getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await page.keyboard.press("Escape");
  // File-picker attachments can disappear outside Rux; keep an actionable error state.
  await page.getByRole("button", { name: "预览图片 picked.png", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "图片预览", exact: true })).toContainText("图片文件不存在或无法读取，请重新添加");
  await page.getByRole("button", { name: "关闭图片预览", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("attachment-preview-states.png") });
});

test("dismisses the account menu outside or with Escape and keeps settings usable", async () => {
  const trigger = page.locator(".profile-row");
  const popover = page.locator(".profile-popover");
  await trigger.click();
  await expect(popover).toBeVisible();
  await popover.locator("strong").click();
  await expect(popover).toBeVisible();
  await page.locator(".conversation-empty h2").click();
  await expect(popover).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.getByRole("textbox", { name: "消息", exact: true }).click();
  await expect(popover).toBeHidden();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await trigger.click();
  await expect(popover).toBeHidden();
  await trigger.click();
  await popover.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "模型与连接", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回 Rux" }).click();
  await expect(popover).toBeHidden();
});

test("offers draft starters without sending and keeps the compact tools usable", async ({}, testInfo) => {
  await expect(page.getByRole("heading", { name: "想构建些什么？" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workbench-empty.png") });
  await page.getByRole("button", { name: "修复问题", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("帮我定位并修复这个问题：");
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeFocused();
  await expect(page.locator(".aui-user-message")).toHaveCount(0);
  await page.getByRole("button", { name: "切换右侧面板", exact: true }).click();
  await expect(page.getByRole("button", { name: "环境", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "终端", exact: true })).toBeDisabled();
  const toolbar = page.locator(".tool-launcher.is-panel");
  const bounds = await toolbar.boundingBox();
  expect(bounds?.height).toBeLessThan(60);
  await page.getByRole("button", { name: "侧边聊天", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "侧边聊天消息", exact: true })).toBeVisible();
});

test("commits model effort on release, keeps the picker open, and preserves outside focus", async ({}, testInfo) => {
  const trigger = page.getByRole("button", { name: "切换模型、推理强度和速度", exact: true });
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "切换模型、推理强度和速度", exact: true });
  const range = picker.getByRole("slider", { name: "推理强度", exact: true });
  const pressEffortKey = async (key: string) => {
    // settings.get() can observe the disk write before React leaves its saving
    // state. locator.press() does not wait for a disabled range to become enabled.
    await expect(picker).toHaveAttribute("aria-busy", "false");
    await expect(range).toBeEnabled();
    await range.press(key);
  };
  await expect(range).toBeVisible();
  const efforts = await page.evaluate(async () => {
    const result = await window.rux.models.list({ agentId: "codex" });
    return (result.models[0] as { supportedReasoningEfforts: Array<{ reasoningEffort: string }> }).supportedReasoningEfforts.map(item => item.reasoningEffort);
  });
  await pressEffortKey("End");
  await expect.poll(async () => page.evaluate(async () => (await window.rux.settings.get()).reasoning)).toBe(efforts.at(-1));
  await expect(picker).toBeVisible();
  await expect(range).toBeEnabled();
  const box = await range.boundingBox();
  if (!box) throw new Error("Missing range bounds");
  await page.mouse.move(box.x + box.width - 7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, { steps: 4 });
  expect(await page.evaluate(async () => (await window.rux.settings.get()).reasoning)).toBe(efforts.at(-1));
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(async () => (await window.rux.settings.get()).reasoning)).toBe(efforts[0]);
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "选择模型", exact: true }).click();
  await picker.getByRole("menuitemradio").first().click();
  await expect(range).toBeVisible();
  await expect.poll(async () => {
    const menu = await picker.boundingBox();
    const anchor = await trigger.boundingBox();
    return Boolean(menu && anchor && menu.y >= 8 && menu.y + menu.height <= anchor.y - 5);
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("model-picker-26903.png") });
  const fastMode = picker.getByRole("switch", { name: "快速模式", exact: true });
  await fastMode.click();
  await expect(fastMode).toHaveAttribute("aria-checked", "true");
  await picker.getByRole("button", { name: "恢复默认模型设置", exact: true }).click();
  await expect(fastMode).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => page.evaluate(async () => (await window.rux.settings.get()).reasoning)).toBe("medium");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "选择模型", exact: true }).click();
  await picker.getByRole("menuitemradio", { name: "GPT-6 Astra", exact: true }).click();
  await expect(range).toHaveAttribute("max", "5");
  // The test Astra catalog has no speed tier; do not offer an unsupported toggle.
  await expect(fastMode).toHaveCount(0);
  await pressEffortKey("End");
  await expect.poll(async () => page.evaluate(async () => (await window.rux.settings.get()).reasoning)).toBe("ultra");
  await expect(picker.getByText("更快消耗使用额度", { exact: true })).toBeVisible();
  await pressEffortKey("ArrowLeft");
  await expect.poll(async () => page.evaluate(async () => (await window.rux.settings.get()).reasoning)).toBe("max");
  await pressEffortKey("ArrowLeft");
  await expect.poll(async () => page.evaluate(async () => (await window.rux.settings.get()).reasoning)).toBe("xhigh");
  await expect(range).toHaveAttribute("aria-valuetext", "极高");
  await page.screenshot({ path: testInfo.outputPath("model-picker-capsule-astra.png") });
  await page.getByRole("textbox", { name: "消息", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeFocused();
  await trigger.click();
  await expect(range).toHaveAttribute("aria-valuetext", "极高");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("resizes and remembers sidebar width with the measured desktop dimensions", async () => {
  const separator = page.getByRole("separator", { name: "调整侧栏宽度", exact: true });
  await expect(separator).toHaveAttribute("aria-valuenow", "300");
  const dimensions = await page.evaluate(() => ({ header: document.querySelector(".topbar")!.getBoundingClientRect().height, content: document.querySelector(".aui-thread-root")!.getBoundingClientRect().width }));
  expect(dimensions.header).toBe(46);
  expect(dimensions.content).toBe(960);
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "310");
  const box = await separator.boundingBox();
  if (!box) throw new Error("Missing sidebar handle");
  await page.mouse.move(box.x + box.width / 2, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + 180, { steps: 4 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "355");
  await application.close();
  await launchApplication();
  await expect(page.getByRole("separator", { name: "调整侧栏宽度", exact: true })).toHaveAttribute("aria-valuenow", "355");
});


test("preserves each turn's model, effort and usage after switching models and restarting", async () => {
  const message = page.getByRole("textbox", { name: "消息", exact: true });
  await message.fill("First metadata turn");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const signatures = page.getByLabel("本轮运行信息", { exact: true });
  await expect(signatures.first()).toContainText("E2E Model");
  await expect(signatures.first()).toContainText("1,560 tokens");
  const firstSignature = (await signatures.first().textContent())!;
  await page.getByRole("button", { name: "切换模型、推理强度和速度", exact: true }).click();
  await page.getByRole("button", { name: "选择模型", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "GPT-6 Astra", exact: true }).click();
  await page.keyboard.press("Escape");
  await message.fill("Second metadata turn");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(signatures.last()).toContainText("GPT-6 Astra");
  await expect(signatures.last()).toContainText("12,480 tokens");
  await expect(signatures.first()).toHaveText(firstSignature);
  await page.getByRole("button", { name: "本轮 Token 明细：12,480", exact: true }).click();
  const usage = page.getByRole("dialog", { name: "本轮 Token 明细", exact: true });
  await expect(usage).toContainText("9,860");
  await expect(usage).toContainText("2,620");
  await page.keyboard.press("Escape");
  await expect(usage).toBeHidden();
  await expect.poll(async () => page.evaluate(async () => {
    const all = await window.rux.messages.list() as Record<string, Array<{ turnInfo?: { usage?: { totalTokens?: number } } }>>;
    return Object.values(all).flat().filter(item => item.turnInfo?.usage?.totalTokens !== undefined).length;
  })).toBe(2);
  await application.close();
  await launchApplication();
  await expect(page.getByLabel("本轮运行信息", { exact: true }).first()).toHaveText(firstSignature);
  await expect(page.getByLabel("本轮运行信息", { exact: true }).last()).toContainText("GPT-6 Astra");
  await expect(page.getByLabel("本轮运行信息", { exact: true }).last()).toContainText("12,480 tokens");
});


test("renders the selected signature layout with readable turn metadata", async ({}, testInfo) => {
  const projectPath = join(testRoot, "rux");
  mkdirSync(projectPath);
  execFileSync("git", ["init", "-b", "main"], { cwd: projectPath });
  const messages = await page.evaluate(async (path) => {
    const project = await window.rux.projects.import({ path, createThread: true }) as { id: string; threads: Array<{ id: string }> };
    const threadId = project.threads[0].id;
    await window.rux.threads.update({ type: "project", projectId: project.id, threadId, title: "优化对话界面" });
    await window.rux.projects.addThread({ projectId: project.id, title: "对话历史设计" });
    await window.rux.projects.addThread({ projectId: project.id, title: "模型选择体验" });
    await window.rux.settings.save({ model: "gpt-6-astra", reasoning: "xhigh", conversationSticky: false });
    return { [threadId]: [
      { id: "visual-u1", role: "user", parts: [{ type: "text", text: "优化项目栏和常用组件。" }] },
      { id: "visual-a1", role: "assistant", agentId: "codex", status: "complete", parts: [{ type: "text", text: "项目与会话的层级已整理，图标、按钮和菜单采用统一规范。\n\n左侧项目栏默认展开，文件明细按需查看。" }, { type: "tool-call", toolName: "fileChange", toolCallId: "visual-files", args: { changes: [{ path: "src/navigation/Sidebar.tsx" }, { path: "src/components/IconButton.tsx" }, { path: "src/workbench-theme.css" }] }, result: { status: "completed" } }], turnInfo: { agentId: "codex", model: "gpt-5.6-sol", reasoning: "high", elapsedMs: 18400, usage: { inputTokens: 4980, outputTokens: 1340, totalTokens: 6320 } } },
      { id: "visual-u2", role: "user", parts: [{ type: "text", text: "每轮显示模型和实际消耗，但不要影响阅读。" }] },
      { id: "visual-a2", role: "assistant", agentId: "codex", status: "complete", parts: [{ type: "text", text: "已将运行信息压缩为一行，保留在每轮回复末尾。\n\n需要核对时可展开明细，其余时间保持简洁。" }], turnInfo: { agentId: "codex", model: "gpt-6-astra", reasoning: "xhigh", elapsedMs: 42600, usage: { inputTokens: 9860, outputTokens: 2620, cachedInputTokens: 6144, reasoningOutputTokens: 1820, totalTokens: 12480 } } },
    ] };
  }, projectPath);
  await restartWithMessages(messages);
  await page.setViewportSize({ width: 1440, height: 1024 });
  expect(await page.evaluate(() => innerHeight)).toBe(1024);
  await expect(page.getByLabel("本轮运行信息", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "本轮 Token 明细：12,480", exact: true })).toBeVisible();
  const footerHeights = await page.locator(".turn-signature").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(footerHeights.every(height => height <= 28)).toBe(true);
  await expect(page.locator(".turn-file-changes")).not.toHaveAttribute("open", "");
  await expect.poll(async () => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("signature-desktop.png") });
  await page.setViewportSize({ width: 900, height: 650 });
  await page.getByRole("button", { name: "本轮 Token 明细：12,480", exact: true }).scrollIntoViewIfNeeded();
  const overflow = await page.locator(".assistant-turn-footer").evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth + 1));
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("signature-narrow.png") });
  expect(await page.evaluate(() => window.rux.messages.list())).toMatchObject(messages);
});


test("shares keyboard and focus behavior across context menus, dialogs and selects", async () => {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("UI foundation test");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("本轮状态：已完成", { exact: true })).toBeVisible();
  const row = page.getByRole("button", { name: "未命名会话", exact: true });
  await row.click({ button: "right" });
  const context = page.getByRole("menu", { name: "会话操作 未命名会话", exact: true });
  await expect(context).toBeVisible();
  await context.getByRole("menuitem", { name: "重命名会话", exact: true }).click();
  const input = page.getByRole("textbox", { name: "会话名称", exact: true });
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(page.getByRole("dialog", { name: "重命名会话", exact: true })).toBeHidden();
  await expect(row).toBeFocused();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const model = page.getByRole("combobox", { name: "默认模型", exact: true });
  await model.press("ArrowDown");
  await page.getByRole("option", { name: "GPT-6 Astra", exact: true }).click();
  await expect(model).toBeFocused();
  await expect(model).toContainText("GPT-6 Astra");
  await page.getByRole("button", { name: "保存默认设置", exact: true }).click();
  await expect(page.locator(".settings-status")).toContainText("已保存");
  await page.getByRole("button", { name: "返回 Rux", exact: true }).click();
  await expect(page.getByRole("button", { name: "切换模型、推理强度和速度", exact: true })).toContainText("GPT-6 Astra");
  await expect(page.getByLabel("本轮运行信息", { exact: true })).toContainText("E2E Model");
});
