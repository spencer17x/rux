import type { IpcMainInvokeEvent } from "electron";

export type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;
export type IpcRegistrar = { handle(channel: string, listener: IpcHandler): void };
export type ProjectAccess = { id: string; name: string; path: string; threads: unknown[] };
export type ResolveProject = (projectId: string) => Promise<ProjectAccess>;
export type ProcessResult = { stdout: string; stderr: string; code: number };
export type RunProcess = (command: string, args: string[], options?: { cwd?: string; input?: string; timeoutMs?: number; env?: Record<string, string> }) => Promise<ProcessResult>;
