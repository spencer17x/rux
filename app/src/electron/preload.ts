import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC_CHANNELS,
  type DesktopInfo,
  type RuntimeEvent,
  type RendererRuntimeMethod,
  type RuntimeRequestMap,
  type RuxDesktopApi,
  type TaskStateSaveResult,
  type WorkspaceState,
  type WorkspaceOpenResult,
  type WorkspaceOpenTarget,
  type WorkspaceTaskState,
} from "../shared/protocol";

let requestSequence = 0;
let taskStateSaveQueue: Promise<unknown> = Promise.resolve();

const api: RuxDesktopApi = {
  getDesktopInfo(): Promise<DesktopInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.desktopInfo) as Promise<DesktopInfo>;
  },

  getWorkspaceState(): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceState) as Promise<WorkspaceState>;
  },

  chooseWorkspace(): Promise<WorkspaceState | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceChoose) as Promise<WorkspaceState | null>;
  },

  activateWorkspace(path: string): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceActivate, { path }) as Promise<WorkspaceState>;
  },

  openWorkspaceLocation(target?: WorkspaceOpenTarget): Promise<WorkspaceOpenResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceOpen, target ? { target } : undefined) as Promise<WorkspaceOpenResult>;
  },

  loadTaskState(workspaceId?: string): Promise<WorkspaceTaskState> {
    return ipcRenderer.invoke(IPC_CHANNELS.taskStateLoad, workspaceId ? { workspaceId } : {}) as Promise<WorkspaceTaskState>;
  },

  saveTaskState(state: WorkspaceTaskState): Promise<TaskStateSaveResult> {
    const save = taskStateSaveQueue
      .catch(() => undefined)
      .then(() => ipcRenderer.invoke(IPC_CHANNELS.taskStateSave, state) as Promise<TaskStateSaveResult>);
    taskStateSaveQueue = save;
    return save;
  },

  request<M extends RendererRuntimeMethod>(
    method: M,
    params: RuntimeRequestMap[M]["params"],
  ): Promise<RuntimeRequestMap[M]["result"]> {
    requestSequence += 1;
    return ipcRenderer.invoke(IPC_CHANNELS.request, {
      kind: "request",
      id: `${Date.now()}-${requestSequence}`,
      method,
      params,
    }) as Promise<RuntimeRequestMap[M]["result"]>;
  },

  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, runtimeEvent: RuntimeEvent) => {
      listener(runtimeEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.event, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, wrapped);
  },
};

contextBridge.exposeInMainWorld("rux", api);
