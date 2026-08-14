import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC_CHANNELS,
  type DesktopInfo,
  type RuntimeEvent,
  type RendererRuntimeMethod,
  type SessionImportParams,
  type SessionImportResult,
  type SessionRefreshParams,
  type SessionRefreshResult,
  type SessionRebuildParams,
  type SessionRevisionListParams,
  type SessionRevisionListResult,
  type SessionRevisionRestoreParams,
  type HandoffPreviewParams,
  type HandoffPreviewResult,
  type HandoffSummaryGenerateParams,
  type HandoffSummaryGenerateResult,
  type HandoffCommitParams,
  type HandoffCommitResult,
  type LocalDataSummary,
  type LocalDataPreviewParams,
  type LocalDataImpactPreview,
  type LocalDataExecuteParams,
  type LocalDataExecuteResult,
  type LocalDataExportParams,
  type LocalDataExportResult,
  type NativeProviderConnection,
  type NativeProviderConnectionInput,
  type NativeProviderConnectionDeleteParams,
  type NativeProviderConnectionTestParams,
  type NativeProviderConnectionTestResult,
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

  importSession(params: SessionImportParams): Promise<SessionImportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionImport, params) as Promise<SessionImportResult>;
  },

  refreshSession(params: SessionRefreshParams): Promise<SessionRefreshResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRefresh, params) as Promise<SessionRefreshResult>;
  },

  rebuildSession(params: SessionRebuildParams): Promise<SessionRefreshResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRebuild, params) as Promise<SessionRefreshResult>;
  },

  listSessionRevisions(params: SessionRevisionListParams): Promise<SessionRevisionListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRevisionList, params) as Promise<SessionRevisionListResult>;
  },

  restoreSessionRevision(params: SessionRevisionRestoreParams): Promise<SessionRefreshResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRevisionRestore, params) as Promise<SessionRefreshResult>;
  },

  previewHandoff(params: HandoffPreviewParams): Promise<HandoffPreviewResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.handoffPreview, params) as Promise<HandoffPreviewResult>;
  },

  generateHandoffSummary(params: HandoffSummaryGenerateParams): Promise<HandoffSummaryGenerateResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.handoffSummaryGenerate, params) as Promise<HandoffSummaryGenerateResult>;
  },

  commitHandoff(params: HandoffCommitParams): Promise<HandoffCommitResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.handoffCommit, params) as Promise<HandoffCommitResult>;
  },

  getLocalDataSummary(): Promise<LocalDataSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.localDataSummary) as Promise<LocalDataSummary>;
  },

  previewLocalData(params: LocalDataPreviewParams): Promise<LocalDataImpactPreview> {
    return ipcRenderer.invoke(IPC_CHANNELS.localDataPreview, params) as Promise<LocalDataImpactPreview>;
  },

  executeLocalData(params: LocalDataExecuteParams): Promise<LocalDataExecuteResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.localDataExecute, params) as Promise<LocalDataExecuteResult>;
  },

  exportLocalData(params: LocalDataExportParams): Promise<LocalDataExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.localDataExport, params) as Promise<LocalDataExportResult>;
  },

  listProviderConnections(): Promise<NativeProviderConnection[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.providerConnectionList) as Promise<NativeProviderConnection[]>;
  },

  saveProviderConnection(input: NativeProviderConnectionInput): Promise<NativeProviderConnection> {
    return ipcRenderer.invoke(IPC_CHANNELS.providerConnectionSave, input) as Promise<NativeProviderConnection>;
  },

  deleteProviderConnection(params: NativeProviderConnectionDeleteParams): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.providerConnectionDelete, params) as Promise<{ ok: true }>;
  },

  testProviderConnection(params: NativeProviderConnectionTestParams): Promise<NativeProviderConnectionTestResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.providerConnectionTest, params) as Promise<NativeProviderConnectionTestResult>;
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
