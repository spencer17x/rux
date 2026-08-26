import { app, clipboard, dialog, shell, type BrowserWindow } from "electron";
import { clipboardTextSchema, externalUrlSchema, parseInput, projectIdSchema, terminalResizeSchema, terminalWriteSchema } from "../shared/ipc";
import type { IpcRegistrar, ResolveProject } from "./ipc-types";
import { TerminalManager } from "./terminal-manager";

type RuntimeStatus = { installed: boolean; version: string; path: string };
type Dependencies = { getWindow: () => BrowserWindow | null; resolveProject: ResolveProject; terminalManager: TerminalManager; codexStatus: () => Promise<RuntimeStatus> };

export function registerTerminalSystemIpc(ipc: IpcRegistrar, deps: Dependencies): void {
  ipc.handle("terminal:start", async (event, value) => { const project = await deps.resolveProject(parseInput(projectIdSchema, value)); const sender = event.sender; deps.terminalManager.start(sender.id, project.path, (data) => { if (!sender.isDestroyed()) sender.send("terminal:data", data); }); return { started: true, cwd: project.path }; });
  ipc.handle("terminal:write", async (event, value) => { deps.terminalManager.write(event.sender.id, parseInput(terminalWriteSchema, value)); return { written: true }; });
  ipc.handle("terminal:resize", async (event, value) => { const input = parseInput(terminalResizeSchema, value); deps.terminalManager.resize(event.sender.id, input.cols, input.rows); return { resized: true }; });
  ipc.handle("terminal:stop", async (event) => { deps.terminalManager.stop(event.sender.id); return { stopped: true }; });
  ipc.handle("system:open-path", async (_event, value) => { const project = await deps.resolveProject(parseInput(projectIdSchema, value)); const error = await shell.openPath(project.path); if (error) throw new Error(error); return { opened: true }; });
  ipc.handle("system:choose-files", async () => { const options = { properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections"> }; const window = deps.getWindow(); const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options); return result.canceled ? [] : result.filePaths; });
  ipc.handle("system:copy", async (_event, value) => { clipboard.writeText(parseInput(clipboardTextSchema, value)); return { copied: true }; });
  ipc.handle("system:open-external", async (_event, value) => { await shell.openExternal(parseInput(externalUrlSchema, value)); return { opened: true }; });
  ipc.handle("system:info", async () => { const codex = await deps.codexStatus(); return { appVersion: app.getVersion(), electronVersion: process.versions.electron, chromeVersion: process.versions.chrome, nodeVersion: process.versions.node, platform: process.platform, arch: process.arch, codexVersion: codex.installed ? codex.version : `${codex.version}（未下载）`, codexPath: codex.installed ? codex.path : "首次使用时自动下载" }; });
}
