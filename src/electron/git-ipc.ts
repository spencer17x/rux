import { shell } from "electron";
import { gitCommitSchema, gitStageSchema, gitSwitchSchema, parseInput, projectFileSchema, projectIdSchema } from "../shared/ipc";
import { GitService } from "./git-service";
import type { IpcRegistrar } from "./ipc-types";

export function registerGitIpc(ipc: IpcRegistrar, service: GitService): void {
  ipc.handle("git:status", async (_event, value) => await service.status(parseInput(projectIdSchema, value)));
  ipc.handle("git:diff", async (_event, value) => { const input = parseInput(projectFileSchema, value); return await service.diff(input.projectId, input.path); });
  ipc.handle("files:list", async (_event, value) => await service.listFiles(parseInput(projectIdSchema, value)));
  ipc.handle("files:open", async (_event, value) => { const input = parseInput(projectFileSchema, value); const error = await shell.openPath(await service.canonicalFile(input.projectId, input.path)); if (error) throw new Error(error); return { opened: true }; });
  ipc.handle("git:branches", async (_event, value) => await service.branches(parseInput(projectIdSchema, value)));
  ipc.handle("git:switch", async (_event, value) => { const input = parseInput(gitSwitchSchema, value); return await service.switchBranch(input.projectId, input.branch); });
  ipc.handle("git:remote", async (_event, value) => await service.remote(parseInput(projectIdSchema, value)));
  ipc.handle("git:commit-push", async (_event, value) => { const input = parseInput(gitCommitSchema, value); return await service.commitPush(input.projectId, input.message.trim(), input.push); });
  ipc.handle("git:stage", async (_event, value) => { const input = parseInput(gitStageSchema, value); return await service.stage(input.projectId, input.paths); });
  ipc.handle("git:discard", async (_event, value) => { const input = parseInput(projectFileSchema, value); return await service.discard(input.projectId, input.path); });
}
