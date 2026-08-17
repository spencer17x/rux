import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC_CHANNELS,
  type DesktopInfo,
  type RuntimeEvent,
  type RendererRuntimeMethod,
  type SessionImportParams,
  type SessionImportResult,
  type SessionAttributionMigrateParams,
  type SessionAttributionMigrateResult,
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
  type NativeProviderConnectionImpactPreview,
  type NativeProviderConnectionImpactPreviewParams,
  type NativeProviderConnectionInput,
  type NativeProviderConnectionDeleteParams,
  type NativeProviderConnectionTestParams,
  type NativeProviderConnectionTestResult,
  type NativeProviderCredentialDiagnostics,
  type NativeProviderCredentialMigrationParams,
  type NativeProviderCredentialMigrationResult,
  type LocalProductEventSummary,
  type UpdateState,
  type RuntimeRequestMap,
  type RuxDesktopApi,
  type TaskStateSaveResult,
  type WorkspaceState,
  type WorkspaceOpenResult,
  type WorkspaceOpenTarget,
  type WorkspaceTaskState,
  type BoardLoadParams,
  type BoardMutationParams,
  type BoardSnapshot,
  type ProjectWorkingCopiesParams,
  type ProjectWorkingCopyAuthorizeParams,
  type ProjectWorkingCopy,
  type ProjectWorkingCopyCreateParams,
  type ImprovementSummaryParams,
  type ImprovementAnalyzeParams,
  type ImprovementDecideParams,
  type ImprovementSummary,
  type ImprovementSettingsUpdateParams,
  type ImprovementProposeParams,
  type ImprovementExportPreviewParams,
  type ImprovementExportPreview,
  type ImprovementExportCommitParams,
  type ImprovementExportResult,
  type ImprovementEvaluateParams,
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

  chooseContextFiles(): Promise<string[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceChooseFiles) as Promise<string[]>;
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

  loadBoard(params: BoardLoadParams): Promise<BoardSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.boardLoad, params) as Promise<BoardSnapshot>;
  },

  mutateBoard(params: BoardMutationParams): Promise<BoardSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.boardMutate, params) as Promise<BoardSnapshot>;
  },

  listProjectWorkingCopies(params: ProjectWorkingCopiesParams): Promise<ProjectWorkingCopy[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectWorkingCopiesList, params) as Promise<ProjectWorkingCopy[]>;
  },

  authorizeProjectWorkingCopy(params: ProjectWorkingCopyAuthorizeParams): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectWorkingCopyAuthorize, params) as Promise<WorkspaceState>;
  },

  createProjectWorkingCopy(params: ProjectWorkingCopyCreateParams): Promise<WorkspaceState> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectWorkingCopyCreate, params) as Promise<WorkspaceState>;
  },


  getImprovementSummary(params: ImprovementSummaryParams = {}): Promise<ImprovementSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementSummary, params) as Promise<ImprovementSummary>;
  },

  analyzeImprovements(params: ImprovementAnalyzeParams): Promise<ImprovementSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementAnalyze, params) as Promise<ImprovementSummary>;
  },

  decideImprovement(params: ImprovementDecideParams): Promise<ImprovementSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementDecide, params) as Promise<ImprovementSummary>;
  },

  updateImprovementSettings(params: ImprovementSettingsUpdateParams): Promise<ImprovementSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementSettingsUpdate, params) as Promise<ImprovementSummary>;
  },

  proposeImprovement(params: ImprovementProposeParams): Promise<ImprovementSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementPropose, params) as Promise<ImprovementSummary>;
  },

  previewImprovementExport(params: ImprovementExportPreviewParams): Promise<ImprovementExportPreview | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementExportPreview, params) as Promise<ImprovementExportPreview | null>;
  },

  commitImprovementExport(params: ImprovementExportCommitParams): Promise<ImprovementExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementExportCommit, params) as Promise<ImprovementExportResult>;
  },

  evaluateImprovement(params: ImprovementEvaluateParams): Promise<ImprovementSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.improvementEvaluate, params) as Promise<ImprovementSummary>;
  },

  importSession(params: SessionImportParams): Promise<SessionImportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionImport, params) as Promise<SessionImportResult>;
  },

  migrateSessionAttribution(params: SessionAttributionMigrateParams): Promise<SessionAttributionMigrateResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionAttributionMigrate, params) as Promise<SessionAttributionMigrateResult>;
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

  previewProviderConnectionImpact(params: NativeProviderConnectionImpactPreviewParams): Promise<NativeProviderConnectionImpactPreview> {
    return ipcRenderer.invoke(IPC_CHANNELS.providerConnectionImpactPreview, params) as Promise<NativeProviderConnectionImpactPreview>;
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

  getProviderCredentialDiagnostics(): Promise<NativeProviderCredentialDiagnostics> {
    return ipcRenderer.invoke(IPC_CHANNELS.providerCredentialDiagnostics) as Promise<NativeProviderCredentialDiagnostics>;
  },

  migrateProviderCredentials(params: NativeProviderCredentialMigrationParams): Promise<NativeProviderCredentialMigrationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.providerCredentialMigrate, params) as Promise<NativeProviderCredentialMigrationResult>;
  },

  getLocalProductEventSummary(): Promise<LocalProductEventSummary> {
    return ipcRenderer.invoke(IPC_CHANNELS.localProductEventSummary) as Promise<LocalProductEventSummary>;
  },

  getUpdateState(): Promise<UpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateState) as Promise<UpdateState>;
  },

  checkForUpdates(): Promise<UpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateCheck) as Promise<UpdateState>;
  },

  downloadUpdate(): Promise<UpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDownload) as Promise<UpdateState>;
  },

  installUpdate(): Promise<{ accepted: boolean }> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateInstall) as Promise<{ accepted: boolean }>;
  },

  confirmUpdateHealthy(): Promise<UpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateConfirmHealthy) as Promise<UpdateState>;
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
