import { app, BrowserWindow, clipboard, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { clipboardTextSchema, externalUrlSchema, messageTargetSchema, parseInput, projectIdSchema, terminalResizeSchema, terminalWriteSchema } from "../shared/ipc";
import type { IpcRegistrar, ResolveProject } from "./ipc-types";
import { resolveProjectMessageFile } from "./message-target";
import { TerminalManager } from "./terminal-manager";

type RuntimeStatus = { installed: boolean; version: string; path: string };
type Dependencies = { getWindow: () => BrowserWindow | null; resolveProject: ResolveProject; terminalManager: TerminalManager; codexStatus: () => Promise<RuntimeStatus> };

async function resolveMessageFile(deps: Dependencies, projectId: string, requestedPath: string): Promise<string> {
  const project = await deps.resolveProject(projectId);
  return await resolveProjectMessageFile(project.path, requestedPath);
}

async function openMessageFile(path: string): Promise<void> {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}

export function registerTerminalSystemIpc(ipc: IpcRegistrar, deps: Dependencies): void {
  ipc.handle("terminal:start", async (event, value) => { const project = await deps.resolveProject(parseInput(projectIdSchema, value)); const sender = event.sender; deps.terminalManager.start(sender.id, project.path, (data) => { if (!sender.isDestroyed()) sender.send("terminal:data", data); }); return { started: true, cwd: project.path }; });
  ipc.handle("terminal:write", async (event, value) => { deps.terminalManager.write(event.sender.id, parseInput(terminalWriteSchema, value)); return { written: true }; });
  ipc.handle("terminal:resize", async (event, value) => { const input = parseInput(terminalResizeSchema, value); deps.terminalManager.resize(event.sender.id, input.cols, input.rows); return { resized: true }; });
  ipc.handle("terminal:stop", async (event) => { deps.terminalManager.stop(event.sender.id); return { stopped: true }; });
  ipc.handle("system:open-path", async (_event, value) => { const project = await deps.resolveProject(parseInput(projectIdSchema, value)); const error = await shell.openPath(project.path); if (error) throw new Error(error); return { opened: true }; });
  ipc.handle("system:choose-files", async () => { const options = { properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections"> }; const window = deps.getWindow(); const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options); return result.canceled ? [] : result.filePaths; });
  ipc.handle("system:copy", async (_event, value) => { clipboard.writeText(parseInput(clipboardTextSchema, value)); return { copied: true }; });
  ipc.handle("system:open-external", async (_event, value) => { await shell.openExternal(parseInput(externalUrlSchema, value)); return { opened: true }; });
  ipc.handle("system:open-message-target", async (_event, value) => {
    const target = parseInput(messageTargetSchema, value);
    if (target.kind === "link") await shell.openExternal(target.url);
    else await openMessageFile(await resolveMessageFile(deps, target.projectId, target.path));
    return { opened: true };
  });
  ipc.handle("system:message-context-menu", async (event, value) => {
    const target = parseInput(messageTargetSchema, value);
    let template: MenuItemConstructorOptions[];
    if (target.kind === "link") {
      template = [
        { label: "打开链接", click: () => { void shell.openExternal(target.url); } },
        { label: "复制链接", click: () => clipboard.writeText(target.url) },
      ];
    } else {
      const file = await resolveMessageFile(deps, target.projectId, target.path);
      const info = await stat(file);
      const copyableContent = info.size <= 1_000_000 ? await readFile(file, "utf8").then((text) => text.includes("\0") ? null : text).catch(() => null) : null;
      const vscodeUrl = `vscode://file${pathToFileURL(file).pathname}`;
      template = [
        { label: "打开文件", click: () => { void openMessageFile(file); } },
        { label: "在 VS Code 中打开", click: () => { void shell.openExternal(vscodeUrl); } },
        { type: "separator" },
        { label: "复制路径", click: () => clipboard.writeText(file) },
        { label: "复制文件内容", enabled: copyableContent !== null, click: () => { if (copyableContent !== null) clipboard.writeText(copyableContent); } },
        { label: process.platform === "darwin" ? "在 Finder 中显示" : process.platform === "win32" ? "在文件资源管理器中显示" : "在文件管理器中显示", click: () => shell.showItemInFolder(file) },
      ];
    }
    const window = BrowserWindow.fromWebContents(event.sender) ?? deps.getWindow();
    Menu.buildFromTemplate(template).popup(window ? { window } : {});
    return { shown: true };
  });
  ipc.handle("system:info", async () => { const codex = await deps.codexStatus(); return { appVersion: app.getVersion(), electronVersion: process.versions.electron, chromeVersion: process.versions.chrome, nodeVersion: process.versions.node, platform: process.platform, arch: process.arch, codexVersion: codex.installed ? codex.version : `${codex.version}（未下载）`, codexPath: codex.installed ? codex.path : "首次使用时自动下载" }; });
}
