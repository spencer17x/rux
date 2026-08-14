import { z } from "zod";

export const RUX_PROTOCOL_VERSION = 6 as const;

export const IPC_CHANNELS = {
  request: "rux:runtime:request",
  event: "rux:runtime:event",
  desktopInfo: "rux:desktop:info",
  workspaceState: "rux:workspace:state",
  workspaceChoose: "rux:workspace:choose",
  workspaceActivate: "rux:workspace:activate",
  workspaceOpen: "rux:workspace:open",
  taskStateLoad: "rux:task-state:load",
  taskStateSave: "rux:task-state:save",
  sessionImport: "rux:session:import",
  sessionRefresh: "rux:session:refresh",
  sessionRebuild: "rux:session:rebuild",
  sessionRevisionList: "rux:session:revision-list",
  sessionRevisionRestore: "rux:session:revision-restore",
  handoffPreview: "rux:handoff:preview",
  handoffSummaryGenerate: "rux:handoff:summary-generate",
  handoffCommit: "rux:handoff:commit",
  localDataSummary: "rux:local-data:summary",
  localDataPreview: "rux:local-data:preview",
  localDataExecute: "rux:local-data:execute",
  localDataExport: "rux:local-data:export",
  providerConnectionList: "rux:provider-connection:list",
  providerConnectionSave: "rux:provider-connection:save",
  providerConnectionDelete: "rux:provider-connection:delete",
  providerConnectionTest: "rux:provider-connection:test",
} as const;

export const runtimeMethods = [
  "runtime.ping",
  "runtime.shutdown",
  "auth.status",
  "auth.login",
  "auth.cancel",
  "terminal.create",
  "terminal.write",
  "terminal.resize",
  "terminal.dispose",
  "agent.list",
  "agent.model.list",
  "session.list",
  "session.discover",
  "session.preview",
  "session.read",
  "session.resume.check",
  "session.cancel",
  "agent.profile.list",
  "agent.profile.create",
  "agent.profile.update",
  "agent.profile.delete",
  "provider.connection.sync",
  "provider.connection.test",
  "handoff.summary.generate",
  "run.start",
  "run.cancel",
  "permission.decide",
  "run.changes.diff",
  "run.changes.accept",
  "run.changes.previewRestore",
  "run.changes.restore",
  "changes.list",
  "changes.diff",
  "changes.previewRestore",
  "changes.restore",
  "changes.accept",
  "git.branches.list",
  "git.branch.switch",
  "git.commit",
  "git.push",
  "git.compare",
  "context.snapshot",
  "task.state.load",
  "task.state.save",
] as const;

export type RuntimeMethod = (typeof runtimeMethods)[number];
export type RendererRuntimeMethod = Exclude<
  RuntimeMethod,
  "runtime.shutdown" | "session.list" | "session.read" | "session.resume.check" | "handoff.summary.generate" | "provider.connection.sync" | "provider.connection.test"
>;

export interface RuntimeStatus {
  protocolVersion: typeof RUX_PROTOCOL_VERSION;
  pid: number;
  platform: NodeJS.Platform;
  workspaceRoot: string;
  startedAt: string;
}

export interface RuntimeShutdownParams {
  reason: string;
}

export interface TerminalCreateParams {
  cwd?: string;
  cols: number;
  rows: number;
}

export interface TerminalSession {
  terminalId: string;
  shell: string;
  cwd: string;
}

export interface TerminalWriteParams {
  terminalId: string;
  data: string;
}

export interface TerminalResizeParams {
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalDisposeParams {
  terminalId: string;
}

export const authProviderIds = ["claude-code", "chatgpt"] as const;
export type AuthProviderId = (typeof authProviderIds)[number];

export const authConnectionStatuses = ["connected", "signed-out", "not-installed", "error"] as const;
export type AuthConnectionStatus = (typeof authConnectionStatuses)[number];

export const authMethods = ["oauth", "chatgpt", "api-key", "cloud", "unknown"] as const;
export type AuthMethod = (typeof authMethods)[number];

export interface AuthProviderInfo {
  id: AuthProviderId;
  name: string;
  cliName: string;
  status: AuthConnectionStatus;
  installed: boolean;
  canLogin: boolean;
  authMethod?: AuthMethod;
  version?: string;
  executable?: string;
  detail?: string;
  providerConnection?: ProviderConnectionRef;
}

export interface AuthState {
  providers: AuthProviderInfo[];
  checkedAt: string;
}

export interface AuthLoginParams {
  provider: AuthProviderId;
}

export type AuthCancelParams = AuthLoginParams;

export const runAdapters = ["claude-code", "codex", "rux-native", "mock"] as const;
export type RunAdapter = (typeof runAdapters)[number];

export const permissionModes = ["plan", "acceptEdits", "dontAsk"] as const;
export type PermissionMode = (typeof permissionModes)[number];

/**
 * Codex advertises model-specific effort values through `model/list` and may
 * add values in newer CLI releases. Keep this forward-compatible instead of
 * freezing the Runtime protocol to today's enum.
 */
export const reasoningEffortSchema = z.string().trim().min(1).max(64);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export interface AgentAdapterInfo {
  id: RunAdapter;
  name: string;
  available: boolean;
  version?: string;
  executable?: string;
  detail?: string;
}

export interface AgentListParams {
  /** Re-run executable discovery after an explicit user detection action. */
  refresh?: boolean;
}

export interface CodexReasoningEffortOption {
  reasoningEffort: ReasoningEffort;
  description: string;
}

export interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  defaultReasoningEffort: ReasoningEffort;
  isDefault: boolean;
}

export interface AgentModelListParams {
  adapter: "codex";
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
}

export interface AgentModelListResult {
  adapter: "codex";
  source: "engine-catalog";
  fetchedAt: string;
  models: CodexModelInfo[];
  nextCursor?: string | null;
}

export const agentBackends = ["claude-code", "codex", "rux-native"] as const;
export type AgentBackend = (typeof agentBackends)[number];

export const providerConnectionKinds = ["official-cli", "rux-native", "legacy"] as const;
export type ProviderConnectionKind = (typeof providerConnectionKinds)[number];

/**
 * A stable, non-secret reference to authentication/configuration owned by an
 * Engine. It never contains tokens, API keys, Base URLs, or credential paths.
 */
export interface ProviderConnectionRef {
  id: string;
  kind: ProviderConnectionKind;
  engine: RunAdapter;
  label: string;
}

export const nativeProviderTypes = ["openai-responses"] as const;
export type NativeProviderType = (typeof nativeProviderTypes)[number];

/** Renderer-safe native Provider metadata. The API key never crosses this contract. */
export interface NativeProviderConnection {
  id: string;
  label: string;
  providerType: NativeProviderType;
  baseUrl: string;
  defaultModel: string;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
  lastTestedAt?: string;
  lastTestStatus?: "connected" | "error";
  lastTestDetail?: string;
}

export interface NativeProviderConnectionInput {
  id?: string;
  label: string;
  providerType: NativeProviderType;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
}

export interface NativeProviderConnectionDeleteParams { id: string; confirmed: true; }
export interface NativeProviderConnectionTestParams { id: string; }
export interface NativeProviderConnectionTestResult {
  id: string;
  ok: boolean;
  testedAt: string;
  detail: string;
}

/** Main-to-Runtime only. This object may contain a secret and must never be exposed to Renderer IPC. */
export interface NativeProviderRuntimeCredential {
  id: string;
  label: string;
  providerType: NativeProviderType;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
}

export const modelSources = [
  "engine-default",
  "engine-catalog",
  "verified-history",
  "manual",
  "legacy",
] as const;
export type ModelSource = (typeof modelSources)[number];

export const modelVerificationStatuses = [
  "not-required",
  "unverified",
  "verified",
  "unavailable",
  "legacy",
] as const;
export type ModelVerificationStatus = (typeof modelVerificationStatuses)[number];

export const agentRevisionOrigins = ["profile-store", "legacy-task"] as const;
export type AgentRevisionOrigin = (typeof agentRevisionOrigins)[number];

export function officialCliProviderConnection(engine: AgentBackend): ProviderConnectionRef {
  return {
    id: `cli:${engine}:default`,
    kind: "official-cli",
    engine,
    label: engine === "codex" ? "Codex CLI default" : "Claude Code CLI default",
  };
}

export function defaultProviderConnectionForAdapter(adapter: RunAdapter): ProviderConnectionRef {
  return adapter === "rux-native"
    ? { id: "native:rux-native:unconfigured", kind: "rux-native", engine: "rux-native", label: "Rux Native（未配置）" }
    : adapter === "mock"
    ? { id: "legacy:mock:local-demo", kind: "legacy", engine: "mock", label: "Legacy local demo" }
    : officialCliProviderConnection(adapter);
}

export function legacyProviderConnectionForAdapter(adapter: RunAdapter): ProviderConnectionRef {
  return {
    id: `legacy:${adapter}:migrated`,
    kind: "legacy",
    engine: adapter,
    label: `Legacy ${adapter} connection (source unknown)`,
  };
}

export function defaultModelState(model?: string): {
  modelSource: ModelSource;
  modelVerificationStatus: ModelVerificationStatus;
} {
  if (!model || /\bdefault\b/i.test(model)) {
    return { modelSource: "engine-default", modelVerificationStatus: "not-required" };
  }
  return { modelSource: "manual", modelVerificationStatus: "unverified" };
}

export function agentRevisionIdFor(profileId: string, revisionNumber: number): string {
  return `agent-revision:${profileId}@${revisionNumber}`;
}

export function builtInAgentRevisionId(adapter: RunAdapter): string {
  return `builtin:${adapter}@1`;
}

export function builtInAgentRevisionAdapter(revisionId: string): RunAdapter | undefined {
  const match = /^builtin:(claude-code|codex|rux-native|mock)@1$/.exec(revisionId);
  return match?.[1] as RunAdapter | undefined;
}

export interface AgentProfileInput {
  name: string;
  description?: string;
  backend: AgentBackend;
  providerConnection?: ProviderConnectionRef;
  model?: string;
  modelSource?: ModelSource;
  modelVerificationStatus?: ModelVerificationStatus;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  permissionMode?: PermissionMode;
  skillIds?: string[];
  toolIds?: string[];
  enabled?: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  backend: AgentBackend;
  providerConnection: ProviderConnectionRef;
  model?: string;
  modelSource: ModelSource;
  modelVerificationStatus: ModelVerificationStatus;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  permissionMode: PermissionMode;
  skillIds: string[];
  toolIds: string[];
  enabled: boolean;
  latestRevisionId: string;
  revisionNumber: number;
  createdAt: string;
  updatedAt: string;
}

/** Immutable execution configuration captured on every Agent save. */
export interface AgentRevision {
  id: string;
  profileId: string;
  revisionNumber: number;
  origin: AgentRevisionOrigin;
  name: string;
  description: string;
  backend: AgentBackend;
  providerConnection: ProviderConnectionRef;
  model?: string;
  modelSource: ModelSource;
  modelVerificationStatus: ModelVerificationStatus;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  permissionMode: PermissionMode;
  skillIds: string[];
  toolIds: string[];
  enabled: boolean;
  createdAt: string;
}

export interface AgentProfileUpdateParams {
  id: string;
  patch: Partial<AgentProfileInput>;
}

export interface AgentProfileDeleteParams {
  id: string;
}

export interface RunStartParams {
  runId: string;
  adapter: RunAdapter;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: PermissionMode;
  sessionId?: string;
  profileId?: string;
  agentRevisionId: string;
  providerConnectionId?: string;
  contextFiles?: string[];
}

export const nativeSessionKinds = ["codex-thread", "claude-session", "rux-response", "mock-session"] as const;
export type NativeSessionKind = (typeof nativeSessionKinds)[number];

/** A non-secret, immutable reference used to decide whether a Task may resume a provider-native session. */
export interface NativeSessionLink {
  kind: NativeSessionKind;
  engine: RunAdapter;
  providerConnectionId: string;
  agentRevisionId: string;
  workspaceId: string;
  nativeSessionId: string;
}

export const sessionEngines = ["codex", "claude-code"] as const;
export type SessionEngine = (typeof sessionEngines)[number];
export const sessionResumeStatuses = ["available", "unavailable", "unknown"] as const;
export type SessionResumeStatus = (typeof sessionResumeStatuses)[number];
export const sessionMessageRoles = ["user", "assistant", "tool", "system"] as const;
export type SessionMessageRole = (typeof sessionMessageRoles)[number];

/** Provider-native identity discovered through a supported Engine API. */
export interface SessionIdentity {
  engine: SessionEngine;
  providerConnectionId: string;
  nativeSessionId: string;
}

export interface SessionMetadata extends SessionIdentity {
  title?: string;
  summary?: string;
  cwd?: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  resumeStatus: SessionResumeStatus;
}

export type SessionContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; name: string; callId?: string; input?: string }
  | { type: "tool-result"; callId?: string; output?: string; isError?: boolean }
  | { type: "unsupported"; providerType: string };

export interface SessionMessage {
  id: string;
  role: SessionMessageRole;
  createdAt?: string;
  content: SessionContentPart[];
}

export interface SessionLink {
  source: SessionIdentity;
  taskId: string;
  workspaceId: string;
  linkedAt: string;
}

export interface SessionProjection {
  id: string;
  source: SessionIdentity;
  taskId: string;
  workspaceId: string;
  mode: SessionImportMode;
  status: ImportedSessionStatus;
  latestRevisionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionProjectionRevision {
  id: string;
  projectionId: string;
  ordinal: number;
  sourceUpdatedAt?: string;
  messageIds: string[];
  metadata: SessionMetadata;
  messages: SessionMessage[];
  contentHash: string;
  createdAt: string;
}

export interface SessionListParams {
  operationId: string;
  engine: SessionEngine;
  providerConnection: ProviderConnectionRef;
  cursor?: string | null;
  limit?: number;
}

export interface SessionListResult {
  engine: SessionEngine;
  sessions: SessionMetadata[];
  nextCursor?: string | null;
}

export const sessionAttributionStatuses = [
  "current-workspace",
  "unassigned",
  "authorization-required",
  "migration-suggested",
] as const;
export type SessionAttributionStatus = (typeof sessionAttributionStatuses)[number];

export interface SessionAttribution {
  status: SessionAttributionStatus;
  workspaceId?: string;
  workspaceName?: string;
  previousWorkspaceId?: string;
  previousWorkspaceName?: string;
  reason?: string;
}

export interface DiscoveredSession {
  identityKey: string;
  metadata: SessionMetadata;
  attribution: SessionAttribution;
}

export interface SessionDiscoverParams extends SessionListParams {
  activeWorkspaceId: string;
}

export interface SessionDiscoverResult {
  engine: SessionEngine;
  current: DiscoveredSession[];
  unassigned: DiscoveredSession[];
  authorizationRequired: DiscoveredSession[];
  migrationSuggestions: DiscoveredSession[];
  nextCursor?: string | null;
}

export const sessionImportModes = ["view", "continue"] as const;
export type SessionImportMode = (typeof sessionImportModes)[number];
export const importedSessionStatuses = ["linked", "read-only", "native-unavailable", "unlinked"] as const;
export type ImportedSessionStatus = (typeof importedSessionStatuses)[number];

export interface SessionPreviewParams extends SessionReadParams {
  activeWorkspaceId: string;
}

export interface SessionPreviewResult extends SessionReadResult {
  identityKey: string;
  resume: SessionResumeCheckResult;
}

export interface SessionImportParams extends SessionPreviewParams {
  mode: SessionImportMode;
}

export interface ImportedSessionBinding {
  identityKey: string;
  source: "codex-import" | "claude-code-import";
  mode: SessionImportMode;
  status: ImportedSessionStatus;
  projectionId: string;
  currentRevisionId: string;
  sessionLink: NativeSessionLink;
  importedAt: string;
  lastReadAt: string;
}

export interface SessionImportResult {
  task: PersistedTask;
  binding: ImportedSessionBinding;
  projection: SessionProjection;
  revision: SessionProjectionRevision;
  created: boolean;
}

export const sessionProjectionChangeKinds = ["added", "modified", "deleted", "moved", "uncertain"] as const;
export type SessionProjectionChangeKind = (typeof sessionProjectionChangeKinds)[number];

export interface SessionProjectionChange {
  kind: SessionProjectionChangeKind;
  messageId?: string;
  previousIndex?: number;
  nextIndex?: number;
  role?: SessionMessageRole;
  preview: string;
}

export const sessionProjectionDiffStatuses = ["unchanged", "append-only", "external-differences"] as const;
export type SessionProjectionDiffStatus = (typeof sessionProjectionDiffStatuses)[number];

export interface SessionProjectionDiff {
  status: SessionProjectionDiffStatus;
  additions: number;
  modifications: number;
  deletions: number;
  moves: number;
  uncertainMatches: number;
  changes: SessionProjectionChange[];
}

export interface SessionProjectionAudit {
  id: string;
  projectionId: string;
  action: "refresh" | "rebuild" | "restore";
  result: "unchanged" | "appended" | "differences" | "rebuilt" | "restored" | "failed";
  engine: SessionEngine;
  nativeSessionId: string;
  fromRevisionId: string;
  toRevisionId?: string;
  occurredAt: string;
}

export interface SessionRefreshParams {
  taskId: string;
  operationId: string;
}

export interface SessionRefreshResult {
  task: PersistedTask;
  diff: SessionProjectionDiff;
  currentRevisionId: string;
  candidateRevisionId?: string;
  audit: SessionProjectionAudit;
}

export interface SessionRebuildParams {
  taskId: string;
  candidateRevisionId: string;
  confirmed: boolean;
}

export interface SessionRevisionListParams { taskId: string; }
export interface SessionRevisionSummary {
  id: string;
  ordinal: number;
  messageCount: number;
  createdAt: string;
  sourceUpdatedAt?: string;
  current: boolean;
}
export interface SessionRevisionListResult {
  currentRevisionId: string;
  revisions: SessionRevisionSummary[];
  audits: SessionProjectionAudit[];
}

export interface SessionRevisionRestoreParams {
  taskId: string;
  revisionId: string;
  confirmed: boolean;
}

export const localDataScopes = ["task", "workspace"] as const;
export type LocalDataScope = (typeof localDataScopes)[number];
export const localDataActions = ["unlink", "remove-imported", "delete-task"] as const;
export type LocalDataAction = (typeof localDataActions)[number];
export const localDataExportFormats = ["markdown", "json"] as const;
export type LocalDataExportFormat = (typeof localDataExportFormats)[number];
export const localDataRevisionScopes = ["current", "all"] as const;
export type LocalDataRevisionScope = (typeof localDataRevisionScopes)[number];

export interface LocalDataSummary {
  workspaceId: string;
  estimatedBytes: number;
  taskCount: number;
  importedTaskCount: number;
  projectionRevisionCount: number;
  handoffCount: number;
}

export interface LocalDataPreviewParams {
  scope: LocalDataScope;
  taskId?: string;
  action: LocalDataAction;
}

export interface LocalDataNativeSessionImpact {
  engine: SessionEngine;
  nativeSessionId: string;
}

export interface LocalDataImpactPreview extends LocalDataSummary {
  scope: LocalDataScope;
  action: LocalDataAction;
  affectedTaskCount: number;
  affectedProjectionRevisionCount: number;
  importedMessageCount: number;
  runCount: number;
  affectedHandoffCount: number;
  estimatedReclaimableBytes: number;
  nativeSessions: LocalDataNativeSessionImpact[];
  fingerprint: string;
}

export interface LocalDataExecuteParams extends LocalDataPreviewParams {
  fingerprint: string;
  confirmed: true;
}

export interface LocalDataExecuteResult {
  workspaceId: string;
  action: LocalDataAction;
  affectedTaskCount: number;
  savedAt: string;
}

export interface LocalDataExportParams {
  scope: LocalDataScope;
  taskId?: string;
  format: LocalDataExportFormat;
  revisions: LocalDataRevisionScope;
  confirmedSensitiveContent: true;
}

export interface LocalDataExportResult {
  saved: boolean;
  canceled: boolean;
  filePath?: string;
  bytes?: number;
}

export interface SessionReadParams extends SessionListParams {
  nativeSessionId: string;
}

export interface SessionReadResult {
  metadata: SessionMetadata;
  messages: SessionMessage[];
  nextCursor?: string | null;
  truncated: boolean;
}

export interface SessionResumeCheckParams {
  operationId: string;
  engine: SessionEngine;
  providerConnection: ProviderConnectionRef;
  nativeSessionId: string;
}

export interface SessionResumeCheckResult extends SessionIdentity {
  status: SessionResumeStatus;
  reason?: string;
}

export interface SessionCancelParams {
  operationId: string;
}

export interface RunCancelParams {
  runId: string;
}

export const permissionActions = [
  "workspace.write",
  "command.execute",
  "file.write",
  "network.access",
  "tool.execute",
] as const;
export type PermissionAction = (typeof permissionActions)[number];

export const permissionRequestStatuses = ["pending", "approved", "denied", "cancelled"] as const;
export type PermissionRequestStatus = (typeof permissionRequestStatuses)[number];

export const permissionDecisionValues = ["approved", "denied", "cancelled"] as const;
export type PermissionDecisionValue = (typeof permissionDecisionValues)[number];

export interface PermissionScope {
  kind: "workspace" | "tool";
  path: string;
  appliesTo: "this-run" | "single-action";
}

export interface PermissionRequest {
  id: string;
  runId: string;
  action: PermissionAction;
  scope: PermissionScope;
  impact: string;
  provider?: RunAdapter;
  providerRequestId?: string;
  toolName?: string;
  requestedAt: string;
  status: PermissionRequestStatus;
}

export interface PermissionDecision {
  id: string;
  requestId: string;
  runId: string;
  decision: PermissionDecisionValue;
  source: "user" | "runtime";
  decidedAt: string;
}

export interface PermissionDecideParams {
  runId: string;
  requestId: string;
  decision: Exclude<PermissionDecisionValue, "cancelled">;
}

export interface RunActivity {
  id: string;
  kind: "read" | "edit" | "command" | "tool" | "retry";
  title: string;
  detail: string;
  state: "active" | "done" | "error";
}

export type GitChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

export type GitDiffLayer = "staged" | "unstaged" | "untracked";

export interface GitDiffStat {
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface GitFileChange {
  path: string;
  originalPath?: string;
  kind: GitChangeKind;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  additions: number;
  deletions: number;
  isBinary: boolean;
  layers: Partial<Record<GitDiffLayer, GitDiffStat>>;
}

export interface GitChangesSnapshot {
  workspaceRoot: string;
  snapshotId: string;
  files: GitFileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
}

export interface GitDiffSection extends GitDiffStat {
  layer: GitDiffLayer;
  patch: string | null;
}

export interface GitFileDiff {
  snapshotId: string;
  path: string;
  originalPath?: string;
  kind: GitChangeKind;
  isBinary: boolean;
  sections: GitDiffSection[];
}

export interface GitLocalBranch {
  name: string;
  headId: string;
  current: boolean;
  upstream?: string;
}

export interface GitRemoteBranch {
  name: string;
  headId: string;
  remote: string;
  branch: string;
}

export interface GitComparableBranch {
  name: string;
  kind: "local" | "remote";
  headId: string;
}

export interface GitBranchesListResult {
  workspaceRoot: string;
  currentBranch: string | null;
  headId: string | null;
  detached: boolean;
  local: GitLocalBranch[];
  remote: GitRemoteBranch[];
  comparable: GitComparableBranch[];
}

export interface GitBranchSwitchParams {
  branch: string;
}

export interface GitCommitParams {
  message: string;
}

export interface GitCommitResult {
  commitId: string;
  branch: string;
  message: string;
  files: number;
}

export interface GitPushParams {
  confirmed: true;
}

export interface GitPushResult {
  branch: string;
  upstream: string;
  commitId: string;
  pushed: true;
}

export interface GitCompareParams {
  base: string;
}

export interface GitCompareFile {
  path: string;
  kind: Exclude<GitChangeKind, "renamed" | "copied" | "unmerged">;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface GitCompareResult {
  base: string;
  head: string;
  mergeBase: string;
  files: GitCompareFile[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
  summary: string;
  patch: string;
  truncated: boolean;
}

export type GitChangeSelection =
  | { scope: "all"; expectedSnapshotId: string }
  | { scope: "file"; path: string; expectedSnapshotId: string };

export interface GitRestorePreview {
  snapshotId: string;
  selectedPaths: string[];
  restoreFromHeadPaths: string[];
  deletePaths: string[];
  warning?: string;
}

export type GitRestoreRequest = GitChangeSelection & { confirmed: boolean };

export interface GitRestoreResult {
  attemptedPaths: string[];
  restoredPaths: string[];
  deletedPaths: string[];
  unresolvedPaths: string[];
  remaining: GitChangesSnapshot;
}

export interface GitReviewAcceptance {
  id: string;
  semantics: "review-only";
  snapshotId: string;
  /** Present for Run-owned reviews; omitted by legacy workspace acceptances. */
  runId?: string;
  /** Immutable Run patch snapshot reviewed by this acceptance. */
  runPatchSnapshotId?: string;
  acceptedAt: string;
  scope: GitChangeSelection["scope"];
  paths: string[];
  additions: number;
  deletions: number;
}

export interface GitRunReviewAcceptance extends GitReviewAcceptance {
  runId: string;
  runPatchSnapshotId: string;
}

export interface GitRunBaseline {
  id: string;
  runId: string;
  workspaceRoot: string;
  createdAt: string;
  treeId: string;
  indexSnapshotId: string;
  headId?: string;
  ignoredFilesExcluded: true;
}

export interface GitRunFileChange {
  path: string;
  kind: Exclude<GitChangeKind, "renamed" | "copied" | "unmerged">;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface GitRunPatch {
  id: string;
  runId: string;
  baselineId: string;
  workspaceRoot: string;
  generatedAt: string;
  beforeTreeId: string;
  afterTreeId: string;
  beforeIndexSnapshotId: string;
  afterIndexSnapshotId: string;
  snapshotId: string;
  files: GitRunFileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
}

export interface GitRunChangeSelection {
  baseline: GitRunBaseline;
  patch: GitRunPatch;
  expectedSnapshotId: string;
  /** Omit paths to select every path attributed to the Run. */
  paths?: string[];
}

export interface GitRunDiffParams {
  baseline: GitRunBaseline;
  patch: GitRunPatch;
  expectedSnapshotId: string;
  path: string;
}

export interface GitRunFileDiff {
  /** Legacy-compatible snapshot alias. */
  snapshotId: string;
  runId: string;
  runPatchSnapshotId: string;
  beforeTreeId: string;
  afterTreeId: string;
  path: string;
  kind: GitRunFileChange["kind"];
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
}

export const gitRunRestoreConflictReasons = [
  "WORKTREE_CHANGED_AFTER_RUN",
  "INDEX_CHANGED_DURING_RUN",
  "INDEX_CHANGED_AFTER_RUN",
  "INCOMPLETE_PATH_GROUP",
] as const;
export type GitRunRestoreConflictReason = (typeof gitRunRestoreConflictReasons)[number];

export interface GitRunRestoreConflict {
  path?: string;
  reason: GitRunRestoreConflictReason;
  message: string;
}

export type GitRunRestoreSelection = GitRunChangeSelection;

export interface GitRunRestorePreview {
  snapshotId: string;
  currentTreeId: string;
  currentIndexSnapshotId: string;
  selectedPaths: string[];
  restorePaths: string[];
  deletePaths: string[];
  conflicts: GitRunRestoreConflict[];
  warning?: string;
}

export type GitRunRestoreRequest = GitRunRestoreSelection & { confirmed: boolean };

export interface GitRunRestoreResult {
  snapshotId: string;
  attemptedPaths: string[];
  restoredPaths: string[];
  deletedPaths: string[];
  unresolvedPaths: string[];
  beforeTreeId: string;
  afterTreeId: string;
  indexSnapshotId: string;
}

export interface GitRunRestoreRecord {
  id: string;
  runId: string;
  restoredAt: string;
  selectedPaths: string[];
  result: GitRunRestoreResult;
}

export interface ContextSource {
  path: string;
  kind: "instructions" | "selected-file";
  bytes: number;
  exists: boolean;
  sha256: string;
  content?: string;
  truncated: boolean;
  binary: boolean;
}

export interface ContextSnapshot {
  workspaceRoot: string;
  generatedAt: string;
  instructions: ContextSource[];
  selectedFiles: ContextSource[];
  capabilities: string[];
}

export interface ContextSnapshotParams {
  selectedFiles?: string[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  branch: string;
  lastOpenedAt: string;
  placeholder?: boolean;
}

export interface WorkspaceState {
  active: WorkspaceSummary;
  recent: WorkspaceSummary[];
}

export const persistedTaskStatuses = ["waiting", "blocked", "running", "completed", "failed", "interrupted", "stopped"] as const;
export type PersistedTaskStatus = (typeof persistedTaskStatuses)[number];

export const persistedRunStatuses = [
  "waiting-permission",
  "running",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
] as const;
export type PersistedRunStatus = (typeof persistedRunStatuses)[number];

export const persistedPlanStates = ["pending", "active", "done"] as const;
export type PersistedPlanState = (typeof persistedPlanStates)[number];

export interface PersistedTaskMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  createdAt?: string;
  runId?: string;
  agent?: string;
  adapter?: RunAdapter;
  profileId?: string;
  agentRevisionId?: string;
}

export interface PersistedPlanStep {
  label: string;
  state: PersistedPlanState;
}

export interface HandoffTarget {
  agentId: string;
  agentName: string;
  adapter: RunAdapter;
  agentProfileId?: string;
  agentRevisionId: string;
  providerConnection: ProviderConnectionRef;
  model: string;
  modelSource: ModelSource;
  modelVerificationStatus: ModelVerificationStatus;
  reasoningEffort?: ReasoningEffort;
  permissionMode: PermissionMode;
}

export interface ContextHandoffFactBundle {
  sourceTask: { id: string; title: string; workspaceId: string; agentRevisionId: string };
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt?: string }>;
  latestRun?: { id: string; status: PersistedRunStatus; prompt: string; result?: string; finishedAt?: string };
  files: Array<{ path: string; status: Exclude<GitChangeKind, "renamed" | "copied" | "unmerged">; additions: number; deletions: number; runId: string; snapshotId: string }>;
  incomplete: string[];
}

export interface ContextHandoffSnapshot {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  workspaceId: string;
  target: HandoffTarget;
  facts: ContextHandoffFactBundle;
  agentSummary?: string;
  agentSummaryProvenance?: HandoffSummaryProvenance;
  constraints?: string;
  createdAt: string;
}

export interface HandoffRelation {
  snapshotId: string;
  taskId: string;
}

export interface PersistedRunEvent {
  id: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export const verificationKinds = ["test", "lint", "typecheck", "build", "command"] as const;
export type VerificationKind = (typeof verificationKinds)[number];

export const verificationStatuses = ["passed", "failed", "unknown"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export interface VerificationEvidence {
  id: string;
  runId: string;
  kind: VerificationKind;
  command: string;
  cwd?: string;
  startedAt?: string;
  finishedAt: string;
  exitCode?: number;
  status: VerificationStatus;
  log: string;
  redacted: boolean;
  truncated: boolean;
}

export interface PersistedRun {
  id: string;
  taskId: string;
  adapter: RunAdapter;
  status: PersistedRunStatus;
  prompt: string;
  permissionMode: PermissionMode;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessionId?: string;
  sessionLink?: NativeSessionLink;
  resumeFrom?: NativeSessionLink;
  resumeFailure?: string;
  profileId?: string;
  agentRevisionId: string;
  providerConnection: ProviderConnectionRef;
  modelSource: ModelSource;
  modelVerificationStatus: ModelVerificationStatus;
  agentSnapshot?: AgentRevision;
  contextFiles: string[];
  contextSnapshot?: ContextSnapshot;
  gitBaseline?: GitRunBaseline;
  gitPatch?: GitRunPatch;
  gitRestores: GitRunRestoreRecord[];
  cwd?: string;
  version?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  durationMs?: number;
  costUsd?: number;
  turns?: number;
  error?: string;
  permissionRequests: PermissionRequest[];
  permissionDecisions: PermissionDecision[];
  verifications: VerificationEvidence[];
  events: PersistedRunEvent[];
}

export interface PersistedTask {
  id: string;
  workspaceId: string;
  title: string;
  preview: string;
  status: PersistedTaskStatus;
  updatedAt: string;
  updatedAtIso?: string;
  createdAt?: string;
  pinned?: boolean;
  archived?: boolean;
  agent: string;
  adapter: RunAdapter;
  agentProfileId?: string;
  agentRevisionId: string;
  agentRevisionSnapshot?: AgentRevision;
  providerConnection: ProviderConnectionRef;
  permissionMode?: PermissionMode;
  model: string;
  modelSource: ModelSource;
  modelVerificationStatus: ModelVerificationStatus;
  reasoningEffort?: ReasoningEffort;
  contextFiles?: string[];
  branch: string;
  elapsed: string;
  tokens: string;
  messages: PersistedTaskMessage[];
  plan: PersistedPlanStep[];
  activity: RunActivity[];
  runs: PersistedRun[];
  reviewAcceptances?: GitReviewAcceptance[];
  importedSession?: ImportedSessionBinding;
  handoffSource?: HandoffRelation;
  handoffTargets?: HandoffRelation[];
}

export interface HandoffPreviewParams {
  sourceTaskId: string;
  targetAgentId: string;
  messageIds: string[];
  filePaths: string[];
}

export interface HandoffPreviewResult {
  target: HandoffTarget;
  facts: ContextHandoffFactBundle;
  sourceAgentAvailable: boolean;
  fingerprint: string;
}

export interface HandoffSummaryGenerateParams extends HandoffPreviewParams {
  fingerprint: string;
}

export interface HandoffSummaryProvenance {
  sourceAgentRevisionId: string;
  sourceAdapter: Exclude<RunAdapter, "mock">;
  generatedAt: string;
  isolated: true;
  nativeSessionPersisted: false;
}

export interface HandoffSummaryGenerateResult {
  generationId: string;
  summary: string;
  provenance: HandoffSummaryProvenance;
}

export interface HandoffSummaryRuntimeParams {
  operationId: string;
  adapter: Exclude<RunAdapter, "mock">;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  profileId?: string;
  agentRevisionId: string;
  providerConnection: ProviderConnectionRef;
}

export interface HandoffCommitParams extends HandoffPreviewParams {
  fingerprint: string;
  agentSummary?: string;
  agentSummaryGenerationId?: string;
  constraints?: string;
  confirmed: true;
}

export interface HandoffCommitResult {
  sourceTask: PersistedTask;
  targetTask: PersistedTask;
  snapshot: ContextHandoffSnapshot;
}

export interface WorkspaceTaskState {
  version: 2;
  workspaceId: string;
  tasks: PersistedTask[];
  updatedAt: string;
}

export interface TaskStateLoadParams {
  workspaceId?: string;
}

export interface TaskStateSaveResult {
  workspaceId: string;
  savedAt: string;
}

export interface RuntimeRequestMap {
  "runtime.ping": {
    params: Record<string, never>;
    result: RuntimeStatus;
  };
  "runtime.shutdown": {
    params: RuntimeShutdownParams;
    result: { ok: true };
  };
  "auth.status": {
    params: Record<string, never>;
    result: AuthState;
  };
  "auth.login": {
    params: AuthLoginParams;
    result: AuthState;
  };
  "auth.cancel": {
    params: AuthCancelParams;
    result: { ok: true };
  };
  "terminal.create": {
    params: TerminalCreateParams;
    result: TerminalSession;
  };
  "terminal.write": {
    params: TerminalWriteParams;
    result: { ok: true };
  };
  "terminal.resize": {
    params: TerminalResizeParams;
    result: { ok: true };
  };
  "terminal.dispose": {
    params: TerminalDisposeParams;
    result: { ok: true };
  };
  "agent.list": {
    params: AgentListParams;
    result: { adapters: AgentAdapterInfo[] };
  };
  "agent.model.list": {
    params: AgentModelListParams;
    result: AgentModelListResult;
  };
  "session.list": {
    params: SessionListParams;
    result: SessionListResult;
  };
  "session.discover": {
    params: SessionDiscoverParams;
    result: SessionDiscoverResult;
  };
  "session.preview": {
    params: SessionPreviewParams;
    result: SessionPreviewResult;
  };
  "session.read": {
    params: SessionReadParams;
    result: SessionReadResult;
  };
  "session.resume.check": {
    params: SessionResumeCheckParams;
    result: SessionResumeCheckResult;
  };
  "session.cancel": {
    params: SessionCancelParams;
    result: { ok: true };
  };
  "agent.profile.list": {
    params: Record<string, never>;
    result: { profiles: AgentProfile[] };
  };
  "agent.profile.create": {
    params: AgentProfileInput;
    result: AgentProfile;
  };
  "agent.profile.update": {
    params: AgentProfileUpdateParams;
    result: AgentProfile;
  };
  "agent.profile.delete": {
    params: AgentProfileDeleteParams;
    result: { ok: true };
  };
  "provider.connection.sync": {
    params: { connections: NativeProviderRuntimeCredential[] };
    result: { ok: true; count: number };
  };
  "provider.connection.test": {
    params: { id: string };
    result: NativeProviderConnectionTestResult;
  };
  "handoff.summary.generate": {
    params: HandoffSummaryRuntimeParams;
    result: HandoffSummaryGenerateResult;
  };
  "run.start": {
    params: RunStartParams;
    result: { runId: string; adapter: RunAdapter; state: "running" | "waiting-permission" };
  };
  "run.cancel": {
    params: RunCancelParams;
    result: { ok: true };
  };
  "permission.decide": {
    params: PermissionDecideParams;
    result: { ok: true; state: "running" | "cancelled" | "failed" };
  };
  "run.changes.diff": {
    params: GitRunDiffParams;
    result: GitRunFileDiff;
  };
  "run.changes.accept": {
    params: GitRunChangeSelection;
    result: GitRunReviewAcceptance;
  };
  "run.changes.previewRestore": {
    params: GitRunRestoreSelection;
    result: GitRunRestorePreview;
  };
  "run.changes.restore": {
    params: GitRunRestoreRequest;
    result: GitRunRestoreRecord;
  };
  "changes.list": {
    params: Record<string, never>;
    result: GitChangesSnapshot;
  };
  "changes.diff": {
    params: { path: string; expectedSnapshotId: string };
    result: GitFileDiff;
  };
  "changes.previewRestore": {
    params: GitChangeSelection;
    result: GitRestorePreview;
  };
  "changes.restore": {
    params: GitRestoreRequest;
    result: GitRestoreResult;
  };
  "changes.accept": {
    params: GitChangeSelection;
    result: GitReviewAcceptance;
  };
  "git.branches.list": {
    params: Record<string, never>;
    result: GitBranchesListResult;
  };
  "git.branch.switch": {
    params: GitBranchSwitchParams;
    result: GitBranchesListResult;
  };
  "git.commit": {
    params: GitCommitParams;
    result: GitCommitResult;
  };
  "git.push": {
    params: GitPushParams;
    result: GitPushResult;
  };
  "git.compare": {
    params: GitCompareParams;
    result: GitCompareResult;
  };
  "context.snapshot": {
    params: ContextSnapshotParams;
    result: ContextSnapshot;
  };
  "task.state.load": {
    params: TaskStateLoadParams;
    result: WorkspaceTaskState;
  };
  "task.state.save": {
    params: WorkspaceTaskState;
    result: WorkspaceTaskState;
  };
}

export type RuntimeRequest<M extends RuntimeMethod = RuntimeMethod> = M extends RuntimeMethod
  ? {
      kind: "request";
      id: string;
      method: M;
      params: RuntimeRequestMap[M]["params"];
    }
  : never;

export type RuntimeResponse =
  | {
      kind: "response";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      kind: "response";
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export type RuntimeEvent =
  | {
      type: "runtime.ready";
      status: RuntimeStatus;
    }
  | {
      type: "runtime.stopped";
      exitCode: number;
    }
  | {
      type: "terminal.data";
      terminalId: string;
      data: string;
    }
  | {
      type: "terminal.exit";
      terminalId: string;
      exitCode: number;
      signal?: number;
    }
  | {
      type: "run.started";
      runId: string;
      adapter: RunAdapter;
      prompt: string;
      permissionMode?: PermissionMode;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      profileId?: string;
      agentRevisionId?: string;
      resumeSessionId?: string;
      providerConnection?: ProviderConnectionRef;
      modelSource?: ModelSource;
      modelVerificationStatus?: ModelVerificationStatus;
    }
  | {
      type: "run.metadata";
      runId: string;
      sessionId?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      permissionMode?: string;
      cwd?: string;
      version?: string;
    }
  | {
      type: "run.agent-snapshot";
      runId: string;
      profile: AgentRevision;
    }
  | {
      type: "run.context-snapshot";
      runId: string;
      snapshot: ContextSnapshot;
    }
  | {
      type: "run.git-baseline";
      runId: string;
      baseline: GitRunBaseline;
    }
  | {
      type: "run.git-patch";
      runId: string;
      patch: GitRunPatch;
    }
  | {
      type: "permission.requested";
      runId: string;
      adapter?: RunAdapter;
      prompt?: string;
      permissionMode?: "acceptEdits";
      model?: string;
      reasoningEffort?: ReasoningEffort;
      profileId?: string;
      agentRevisionId?: string;
      providerConnection?: ProviderConnectionRef;
      modelSource?: ModelSource;
      modelVerificationStatus?: ModelVerificationStatus;
      contextFiles?: string[];
      request: PermissionRequest;
    }
  | {
      type: "permission.decided";
      runId: string;
      decision: PermissionDecision;
    }
  | {
      type: "activity.started" | "activity.completed";
      runId: string;
      activity: RunActivity;
    }
  | {
      type: "assistant.message";
      runId: string;
      text: string;
      itemId?: string;
    }
  | {
      /** Transient assistant text. Clients must not persist individual chunks. */
      type: "assistant.message.delta";
      runId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      text: string;
    }
  | {
      type: "assistant.reasoning-summary";
      runId: string;
      text: string;
    }
  | {
      type: "plan.updated";
      runId: string;
      items: Array<{ text: string; completed: boolean }>;
    }
  | {
      type: "run.usage";
      runId: string;
      usage: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      };
    }
  | {
      type: "run.log";
      runId: string;
      level: "info" | "warning" | "error";
      message: string;
    }
  | {
      type: "verification.recorded";
      runId: string;
      verification: VerificationEvidence;
    }
  | {
      type: "run.completed";
      runId: string;
      durationMs?: number;
      costUsd?: number;
      turns?: number;
    }
  | {
      type: "run.cancelled";
      runId: string;
    }
  | {
      type: "run.failed";
      runId: string;
      error: string;
      resumeSessionId?: string;
    };

export type RuntimeWireMessage =
  | RuntimeResponse
  | {
      kind: "event";
      event: RuntimeEvent;
    };

export interface DesktopInfo {
  platform: NodeJS.Platform;
  version: string;
  isPackaged: boolean;
}

export const workspaceOpenTargets = ["vscode", "finder"] as const;
export type WorkspaceOpenTarget = (typeof workspaceOpenTargets)[number];

export interface WorkspaceOpenParams {
  target?: WorkspaceOpenTarget;
}

export interface WorkspaceOpenResult {
  opened: boolean;
  target: WorkspaceOpenTarget;
  detail?: string;
}

export interface RuxDesktopApi {
  getDesktopInfo(): Promise<DesktopInfo>;
  getWorkspaceState(): Promise<WorkspaceState>;
  chooseWorkspace(): Promise<WorkspaceState | null>;
  activateWorkspace(path: string): Promise<WorkspaceState>;
  openWorkspaceLocation(target?: WorkspaceOpenTarget): Promise<WorkspaceOpenResult>;
  loadTaskState(workspaceId?: string): Promise<WorkspaceTaskState>;
  saveTaskState(state: WorkspaceTaskState): Promise<TaskStateSaveResult>;
  importSession(params: SessionImportParams): Promise<SessionImportResult>;
  refreshSession(params: SessionRefreshParams): Promise<SessionRefreshResult>;
  rebuildSession(params: SessionRebuildParams): Promise<SessionRefreshResult>;
  listSessionRevisions(params: SessionRevisionListParams): Promise<SessionRevisionListResult>;
  restoreSessionRevision(params: SessionRevisionRestoreParams): Promise<SessionRefreshResult>;
  previewHandoff(params: HandoffPreviewParams): Promise<HandoffPreviewResult>;
  generateHandoffSummary(params: HandoffSummaryGenerateParams): Promise<HandoffSummaryGenerateResult>;
  commitHandoff(params: HandoffCommitParams): Promise<HandoffCommitResult>;
  getLocalDataSummary(): Promise<LocalDataSummary>;
  previewLocalData(params: LocalDataPreviewParams): Promise<LocalDataImpactPreview>;
  executeLocalData(params: LocalDataExecuteParams): Promise<LocalDataExecuteResult>;
  exportLocalData(params: LocalDataExportParams): Promise<LocalDataExportResult>;
  listProviderConnections(): Promise<NativeProviderConnection[]>;
  saveProviderConnection(input: NativeProviderConnectionInput): Promise<NativeProviderConnection>;
  deleteProviderConnection(params: NativeProviderConnectionDeleteParams): Promise<{ ok: true }>;
  testProviderConnection(params: NativeProviderConnectionTestParams): Promise<NativeProviderConnectionTestResult>;
  request<M extends RendererRuntimeMethod>(
    method: M,
    params: RuntimeRequestMap[M]["params"],
  ): Promise<RuntimeRequestMap[M]["result"]>;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
}

export const runtimeRequestSchema = z.object({
  kind: z.literal("request"),
  id: z.string().min(1).max(120),
  method: z.enum(runtimeMethods),
  params: z.unknown(),
});

export const runtimeShutdownParamsSchema = z.object({
  reason: z.string().trim().min(1).max(160),
}).strict();

export const terminalCreateParamsSchema = z.object({
  cwd: z.string().min(1).optional(),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
});

export const terminalWriteParamsSchema = z.object({
  terminalId: z.string().min(1),
  data: z.string().max(1_000_000),
});

export const terminalResizeParamsSchema = z.object({
  terminalId: z.string().min(1),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
});

export const terminalDisposeParamsSchema = z.object({
  terminalId: z.string().min(1),
});

export const authLoginParamsSchema = z.object({
  provider: z.enum(authProviderIds),
});

export const agentListParamsSchema = z.object({
  refresh: z.boolean().optional(),
}).strict();

export const agentModelListParamsSchema = z.object({
  adapter: z.literal("codex"),
  cursor: z.string().min(1).max(4_096).nullable().optional(),
  limit: z.number().int().min(1).max(500).nullable().optional(),
  includeHidden: z.boolean().nullable().optional(),
}).strict();

export const codexReasoningEffortOptionSchema = z.object({
  reasoningEffort: reasoningEffortSchema,
  description: z.string().max(2_000),
}).strict();

export const codexModelInfoSchema = z.object({
  id: z.string().trim().min(1).max(240),
  model: z.string().trim().min(1).max(240),
  displayName: z.string().trim().min(1).max(240),
  description: z.string().max(4_000),
  isDefault: z.boolean(),
  defaultReasoningEffort: reasoningEffortSchema,
  supportedReasoningEfforts: z.array(codexReasoningEffortOptionSchema).max(64),
}).strict();

export const agentModelListResultSchema = z.object({
  adapter: z.literal("codex"),
  source: z.literal("engine-catalog"),
  fetchedAt: z.iso.datetime(),
  models: z.array(codexModelInfoSchema).max(500),
  nextCursor: z.string().min(1).max(4_096).nullable().optional(),
}).strict();

export const runStartParamsSchema = z.object({
  runId: z.string().min(1).max(120),
  adapter: z.enum(runAdapters),
  prompt: z.string().min(1).max(100_000),
  model: z.string().min(1).max(120).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  permissionMode: z.enum(permissionModes),
  sessionId: z.string().min(1).max(500).optional(),
  profileId: z.string().min(1).max(120).optional(),
  agentRevisionId: z.string().min(1).max(240),
  providerConnectionId: z.string().min(1).max(240).optional(),
  contextFiles: z.array(z.string().min(1).max(4_096)).max(500).default([]),
}).strict().superRefine((params, context) => {
  if (!params.profileId) {
    const builtInAdapter = builtInAgentRevisionAdapter(params.agentRevisionId);
    if (builtInAdapter !== params.adapter) {
      context.addIssue({
        code: "custom",
        path: ["agentRevisionId"],
        message: "Built-in Agent Revision must match the requested adapter",
      });
    }
  }
});

export const runCancelParamsSchema = z.object({
  runId: z.string().min(1).max(120),
}).strict();

export const permissionDecideParamsSchema = z.object({
  runId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(160),
  decision: z.enum(["approved", "denied"]),
}).strict();

const agentIdentifierSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9._/-]*$/i);
const agentProfileNameSchema = z.string().trim().min(1).max(80);
const agentProfileDescriptionSchema = z.string().trim().max(400);
const agentProfileModelSchema = z.string().trim().min(1).max(120);
const agentProfileInstructionsSchema = z.string().trim().min(1).max(20_000);
const agentProfileSkillIdsSchema = z.array(agentIdentifierSchema).max(64);
const agentProfileToolIdsSchema = z.array(agentIdentifierSchema).max(64);
const agentRevisionIdentifierSchema = z.string().trim().min(1).max(240);

export const nativeSessionLinkSchema = z.object({
  kind: z.enum(nativeSessionKinds),
  engine: z.enum(runAdapters),
  providerConnectionId: z.string().trim().min(1).max(240),
  agentRevisionId: agentRevisionIdentifierSchema,
  workspaceId: z.string().trim().min(1).max(240),
  nativeSessionId: z.string().trim().min(1).max(500),
}).strict();

export const providerConnectionRefSchema = z.object({
  id: z.string().trim().min(1).max(240).regex(/^(?:cli|native|legacy):[a-z0-9._/-]+(?::[a-z0-9._/-]+)*$/i),
  kind: z.enum(providerConnectionKinds),
  engine: z.enum(runAdapters),
  label: z.string().trim().min(1).max(160),
}).strict().superRefine((connection, context) => {
  if (connection.kind === "official-cli" && !connection.id.startsWith(`cli:${connection.engine}:`)) {
    context.addIssue({
      code: "custom",
      path: ["id"],
      message: "Official CLI Connection id must be scoped to its Engine",
    });
  }
  if (connection.kind === "legacy" && !connection.id.startsWith(`legacy:${connection.engine}:`)) {
    context.addIssue({
      code: "custom",
      path: ["id"],
      message: "Legacy Connection id must be scoped to its Engine",
    });
  }
  if (connection.kind === "rux-native" && (connection.engine !== "rux-native" || !connection.id.startsWith("native:rux-native:"))) {
    context.addIssue({
      code: "custom",
      path: ["id"],
      message: "Rux Native Connection id must be scoped to the rux-native Engine",
    });
  }
});

const nativeProviderConnectionIdSchema = z.string().trim().regex(/^native:rux-native:[a-f0-9-]{36}$/);
const nativeProviderBaseUrlSchema = z.url().max(2_048).superRefine((value, context) => {
  const url = new URL(value);
  if (url.username || url.password) context.addIssue({ code: "custom", message: "Base URL must not contain credentials" });
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    context.addIssue({ code: "custom", message: "Base URL must use HTTPS, except for localhost" });
  }
});

export const nativeProviderConnectionInputSchema = z.object({
  id: nativeProviderConnectionIdSchema.optional(),
  label: z.string().trim().min(1).max(80),
  providerType: z.enum(nativeProviderTypes),
  baseUrl: nativeProviderBaseUrlSchema,
  defaultModel: z.string().trim().min(1).max(160),
  apiKey: z.string().min(1).max(16_384).optional(),
}).strict();

export const nativeProviderConnectionDeleteParamsSchema = z.object({
  id: nativeProviderConnectionIdSchema,
  confirmed: z.literal(true),
}).strict();

export const nativeProviderConnectionTestParamsSchema = z.object({ id: nativeProviderConnectionIdSchema }).strict();

export const nativeProviderRuntimeSyncSchema = z.object({
  connections: z.array(z.object({
    id: nativeProviderConnectionIdSchema,
    label: z.string().min(1).max(80),
    providerType: z.enum(nativeProviderTypes),
    baseUrl: nativeProviderBaseUrlSchema,
    defaultModel: z.string().min(1).max(160),
    apiKey: z.string().min(1).max(16_384),
  }).strict()).max(100),
}).strict();

const sessionOperationIdSchema = z.string().trim().min(1).max(120);
const sessionNativeIdSchema = z.string().trim().min(1).max(500);
const sessionCursorSchema = z.string().min(1).max(4_096).nullable().optional();

export const sessionIdentitySchema = z.object({
  engine: z.enum(sessionEngines),
  providerConnectionId: z.string().trim().min(1).max(240),
  nativeSessionId: sessionNativeIdSchema,
}).strict();

export const sessionMetadataSchema = sessionIdentitySchema.extend({
  title: z.string().max(500).optional(),
  summary: z.string().max(4_000).optional(),
  cwd: z.string().max(4_096).optional(),
  model: z.string().max(240).optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  messageCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  resumeStatus: z.enum(sessionResumeStatuses),
}).strict();

export const sessionContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(262_144) }).strict(),
  z.object({
    type: z.literal("tool-call"),
    name: z.string().trim().min(1).max(240),
    callId: z.string().max(500).optional(),
    input: z.string().max(262_144).optional(),
  }).strict(),
  z.object({
    type: z.literal("tool-result"),
    callId: z.string().max(500).optional(),
    output: z.string().max(262_144).optional(),
    isError: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal("unsupported"),
    providerType: z.string().trim().min(1).max(240),
  }).strict(),
]);

export const sessionMessageSchema = z.object({
  id: z.string().trim().min(1).max(500),
  role: z.enum(sessionMessageRoles),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  content: z.array(sessionContentPartSchema).max(1_000),
}).strict();

const sessionConnectorBaseParamsSchema = z.object({
  operationId: sessionOperationIdSchema,
  engine: z.enum(sessionEngines),
  providerConnection: providerConnectionRefSchema,
}).strict().superRefine((params, context) => {
  if (params.providerConnection.kind !== "official-cli" || params.providerConnection.engine !== params.engine) {
    context.addIssue({
      code: "custom",
      path: ["providerConnection"],
      message: "Session discovery requires the matching official CLI Connection",
    });
  }
});

export const sessionListParamsSchema = sessionConnectorBaseParamsSchema.safeExtend({
  cursor: sessionCursorSchema,
  limit: z.number().int().min(1).max(100).default(50),
});

export const sessionDiscoverParamsSchema = sessionListParamsSchema.safeExtend({
  activeWorkspaceId: z.string().trim().min(1).max(240),
});

export const sessionReadParamsSchema = sessionListParamsSchema.safeExtend({
  nativeSessionId: sessionNativeIdSchema,
});

export const sessionPreviewParamsSchema = sessionReadParamsSchema.safeExtend({
  activeWorkspaceId: z.string().trim().min(1).max(240),
});

export const sessionImportParamsSchema = sessionPreviewParamsSchema.safeExtend({
  mode: z.enum(sessionImportModes),
});

export const sessionResumeCheckParamsSchema = sessionConnectorBaseParamsSchema.safeExtend({
  nativeSessionId: sessionNativeIdSchema,
});

export const sessionCancelParamsSchema = z.object({
  operationId: sessionOperationIdSchema,
}).strict();

export const sessionListResultSchema = z.object({
  engine: z.enum(sessionEngines),
  sessions: z.array(sessionMetadataSchema).max(100),
  nextCursor: sessionCursorSchema,
}).strict();

export const sessionAttributionSchema = z.object({
  status: z.enum(sessionAttributionStatuses),
  workspaceId: z.string().trim().min(1).max(240).optional(),
  workspaceName: z.string().trim().min(1).max(240).optional(),
  previousWorkspaceId: z.string().trim().min(1).max(240).optional(),
  previousWorkspaceName: z.string().trim().min(1).max(240).optional(),
  reason: z.string().max(2_000).optional(),
}).strict();

export const discoveredSessionSchema = z.object({
  identityKey: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: sessionMetadataSchema,
  attribution: sessionAttributionSchema,
}).strict();

export const sessionDiscoverResultSchema = z.object({
  engine: z.enum(sessionEngines),
  current: z.array(discoveredSessionSchema).max(100),
  unassigned: z.array(discoveredSessionSchema).max(100),
  authorizationRequired: z.array(discoveredSessionSchema).max(100),
  migrationSuggestions: z.array(discoveredSessionSchema).max(100),
  nextCursor: sessionCursorSchema,
}).strict();

export const sessionReadResultSchema = z.object({
  metadata: sessionMetadataSchema,
  messages: z.array(sessionMessageSchema).max(200),
  nextCursor: sessionCursorSchema,
  truncated: z.boolean(),
}).strict();

export const sessionResumeCheckResultSchema = sessionIdentitySchema.extend({
  status: z.enum(sessionResumeStatuses),
  reason: z.string().max(2_000).optional(),
}).strict();

export const sessionPreviewResultSchema = sessionReadResultSchema.extend({
  messages: z.array(sessionMessageSchema).max(20_000),
  identityKey: z.string().regex(/^[a-f0-9]{64}$/),
  resume: sessionResumeCheckResultSchema,
}).strict();

export const sessionLinkSchema = z.object({
  source: sessionIdentitySchema,
  taskId: z.string().trim().min(1).max(240),
  workspaceId: z.string().trim().min(1).max(240),
  linkedAt: z.iso.datetime({ offset: true }),
}).strict();

export const sessionProjectionSchema = z.object({
  id: z.string().trim().min(1).max(240),
  source: sessionIdentitySchema,
  taskId: z.string().trim().min(1).max(240),
  workspaceId: z.string().trim().min(1).max(240),
  mode: z.enum(sessionImportModes),
  status: z.enum(importedSessionStatuses),
  latestRevisionId: z.string().trim().min(1).max(240),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const sessionProjectionRevisionSchema = z.object({
  id: z.string().trim().min(1).max(240),
  projectionId: z.string().trim().min(1).max(240),
  ordinal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  messageIds: z.array(z.string().trim().min(1).max(500)).max(100_000),
  metadata: sessionMetadataSchema,
  messages: z.array(sessionMessageSchema).max(20_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

export const importedSessionBindingSchema = z.object({
  identityKey: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(["codex-import", "claude-code-import"]),
  mode: z.enum(sessionImportModes),
  status: z.enum(importedSessionStatuses),
  projectionId: z.string().trim().min(1).max(240),
  currentRevisionId: z.string().trim().min(1).max(240),
  sessionLink: nativeSessionLinkSchema,
  importedAt: z.iso.datetime({ offset: true }),
  lastReadAt: z.iso.datetime({ offset: true }),
}).strict();

export const sessionProjectionChangeSchema = z.object({
  kind: z.enum(sessionProjectionChangeKinds),
  messageId: z.string().trim().min(1).max(500).optional(),
  previousIndex: z.number().int().nonnegative().max(20_000).optional(),
  nextIndex: z.number().int().nonnegative().max(20_000).optional(),
  role: z.enum(sessionMessageRoles).optional(),
  preview: z.string().max(1_000),
}).strict();

export const sessionProjectionDiffSchema = z.object({
  status: z.enum(sessionProjectionDiffStatuses),
  additions: z.number().int().nonnegative(),
  modifications: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  moves: z.number().int().nonnegative(),
  uncertainMatches: z.number().int().nonnegative(),
  changes: z.array(sessionProjectionChangeSchema).max(200),
}).strict();

export const sessionProjectionAuditSchema = z.object({
  id: z.string().trim().min(1).max(240),
  projectionId: z.string().trim().min(1).max(240),
  action: z.enum(["refresh", "rebuild", "restore"]),
  result: z.enum(["unchanged", "appended", "differences", "rebuilt", "restored", "failed"]),
  engine: z.enum(sessionEngines),
  nativeSessionId: sessionNativeIdSchema,
  fromRevisionId: z.string().trim().min(1).max(240),
  toRevisionId: z.string().trim().min(1).max(240).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();

export const sessionRefreshParamsSchema = z.object({
  taskId: z.string().trim().min(1).max(240),
  operationId: sessionOperationIdSchema,
}).strict();

export const sessionRebuildParamsSchema = z.object({
  taskId: z.string().trim().min(1).max(240),
  candidateRevisionId: z.string().trim().min(1).max(240),
  confirmed: z.literal(true),
}).strict();

export const sessionRevisionListParamsSchema = z.object({ taskId: z.string().trim().min(1).max(240) }).strict();
export const sessionRevisionRestoreParamsSchema = z.object({
  taskId: z.string().trim().min(1).max(240),
  revisionId: z.string().trim().min(1).max(240),
  confirmed: z.literal(true),
}).strict();

export const modelSourceSchema = z.enum(modelSources);
export const modelVerificationStatusSchema = z.enum(modelVerificationStatuses);

export const agentProfileInputSchema = z.object({
  name: agentProfileNameSchema,
  description: agentProfileDescriptionSchema.default(""),
  backend: z.enum(agentBackends),
  providerConnection: providerConnectionRefSchema.optional(),
  model: agentProfileModelSchema.optional(),
  modelSource: modelSourceSchema.optional(),
  modelVerificationStatus: modelVerificationStatusSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  instructions: agentProfileInstructionsSchema,
  permissionMode: z.enum(permissionModes).default("acceptEdits"),
  skillIds: agentProfileSkillIdsSchema.default([]),
  toolIds: agentProfileToolIdsSchema.default([]),
  enabled: z.boolean().default(true),
}).strict();

export const agentProfileSchema = agentProfileInputSchema.extend({
  id: z.string().regex(/^custom-[a-f0-9-]{36}$/),
  providerConnection: providerConnectionRefSchema,
  modelSource: modelSourceSchema,
  modelVerificationStatus: modelVerificationStatusSchema,
  latestRevisionId: agentRevisionIdentifierSchema,
  revisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((profile, context) => {
  if (profile.providerConnection.engine !== profile.backend) {
    context.addIssue({ code: "custom", path: ["providerConnection", "engine"], message: "Agent Connection Engine must match its backend" });
  }
  if (profile.latestRevisionId !== agentRevisionIdFor(profile.id, profile.revisionNumber)) {
    context.addIssue({ code: "custom", path: ["latestRevisionId"], message: "Agent latestRevisionId must match its revision number" });
  }
});

export const agentRevisionSchema = z.object({
  id: agentRevisionIdentifierSchema,
  profileId: z.string().trim().min(1).max(240),
  revisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  origin: z.enum(agentRevisionOrigins),
  name: agentProfileNameSchema,
  description: agentProfileDescriptionSchema,
  backend: z.enum(agentBackends),
  providerConnection: providerConnectionRefSchema,
  model: agentProfileModelSchema.optional(),
  modelSource: modelSourceSchema,
  modelVerificationStatus: modelVerificationStatusSchema,
  reasoningEffort: reasoningEffortSchema.optional(),
  instructions: agentProfileInstructionsSchema,
  permissionMode: z.enum(permissionModes),
  skillIds: agentProfileSkillIdsSchema,
  toolIds: agentProfileToolIdsSchema,
  enabled: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((revision, context) => {
  if (revision.providerConnection.engine !== revision.backend) {
    context.addIssue({ code: "custom", path: ["providerConnection", "engine"], message: "Agent Revision Connection Engine must match its backend" });
  }
  if (revision.origin === "profile-store") {
    if (!/^custom-[a-f0-9-]{36}$/.test(revision.profileId)) {
      context.addIssue({ code: "custom", path: ["profileId"], message: "Stored Agent Revision must reference a custom Agent profile" });
    }
    if (revision.id !== agentRevisionIdFor(revision.profileId, revision.revisionNumber)) {
      context.addIssue({ code: "custom", path: ["id"], message: "Agent Revision id must match its profile and revision number" });
    }
  } else if (!/^legacy-agent-revision:[a-f0-9]{64}$/.test(revision.id)) {
    context.addIssue({ code: "custom", path: ["id"], message: "Legacy Agent Revision id must be deterministic" });
  }
});

export const agentProfilePatchSchema = z.object({
  name: agentProfileNameSchema.optional(),
  description: agentProfileDescriptionSchema.optional(),
  backend: z.enum(agentBackends).optional(),
  providerConnection: providerConnectionRefSchema.optional(),
  model: agentProfileModelSchema.optional(),
  modelSource: modelSourceSchema.optional(),
  modelVerificationStatus: modelVerificationStatusSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  instructions: agentProfileInstructionsSchema.optional(),
  permissionMode: z.enum(permissionModes).optional(),
  skillIds: agentProfileSkillIdsSchema.optional(),
  toolIds: agentProfileToolIdsSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();

export const agentProfileUpdateParamsSchema = z.object({
  id: z.string().min(1).max(120),
  patch: agentProfilePatchSchema,
}).strict();

export const agentProfileDeleteParamsSchema = z.object({
  id: z.string().min(1).max(120),
}).strict();

export const gitChangeSelectionSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("all"),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({
    scope: z.literal("file"),
    path: z.string().min(1).max(4096),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
]);

export const gitDiffParamsSchema = z.object({
  path: z.string().min(1).max(4096),
  expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const gitObjectIdSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const gitBranchNameSchema = z.string().trim().min(1).max(1_024).refine(
  (value) => !value.includes("\0") && !value.includes("\n") && !value.includes("\r"),
  "Git branch name contains unsupported control characters",
);

export const gitEmptyParamsSchema = z.object({}).strict();

export const gitBranchSwitchParamsSchema = z.object({
  branch: gitBranchNameSchema,
}).strict();

export const gitCommitParamsSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
}).strict();

export const gitPushParamsSchema = z.object({
  confirmed: z.literal(true),
}).strict();

export const gitCompareParamsSchema = z.object({
  base: gitBranchNameSchema,
}).strict();

export const gitBranchesListResultSchema = z.object({
  workspaceRoot: z.string().min(1).max(4_096),
  currentBranch: gitBranchNameSchema.nullable(),
  headId: gitObjectIdSchema.nullable(),
  detached: z.boolean(),
  local: z.array(z.object({
    name: gitBranchNameSchema,
    headId: gitObjectIdSchema,
    current: z.boolean(),
    upstream: gitBranchNameSchema.optional(),
  }).strict()).max(20_000),
  remote: z.array(z.object({
    name: gitBranchNameSchema,
    headId: gitObjectIdSchema,
    remote: gitBranchNameSchema,
    branch: gitBranchNameSchema,
  }).strict()).max(20_000),
  comparable: z.array(z.object({
    name: gitBranchNameSchema,
    kind: z.enum(["local", "remote"]),
    headId: gitObjectIdSchema,
  }).strict()).max(40_000),
}).strict();

export const gitCommitResultSchema = z.object({
  commitId: gitObjectIdSchema,
  branch: gitBranchNameSchema,
  message: z.string().min(1).max(10_000),
  files: z.number().int().min(1).max(1_000_000),
}).strict();

export const gitPushResultSchema = z.object({
  branch: gitBranchNameSchema,
  upstream: gitBranchNameSchema,
  commitId: gitObjectIdSchema,
  pushed: z.literal(true),
}).strict();

const gitCompareFileSchema = z.object({
  path: z.string().min(1).max(4_096),
  kind: z.enum(["added", "modified", "deleted", "type-changed", "unknown"]),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  isBinary: z.boolean(),
}).strict();

export const gitCompareResultSchema = z.object({
  base: gitBranchNameSchema,
  head: gitObjectIdSchema,
  mergeBase: gitObjectIdSchema,
  files: z.array(gitCompareFileSchema).max(1_000_000),
  totals: z.object({
    files: z.number().int().min(0),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    binaryFiles: z.number().int().min(0),
  }).strict(),
  summary: z.string().max(4_096),
  patch: z.string().max(1_100_000),
  truncated: z.boolean(),
}).strict();

export const gitRestoreRequestSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("all"),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.boolean(),
  }).strict(),
  z.object({
    scope: z.literal("file"),
    path: z.string().min(1).max(4096),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.boolean(),
  }).strict(),
]);

export const contextSnapshotParamsSchema = z.object({
  selectedFiles: z.array(z.string().min(1).max(4096)).max(200).optional(),
}).strict();

export const workspaceActivateParamsSchema = z.object({
  path: z.string().min(1).max(4096),
});

export const workspaceOpenParamsSchema = z.object({
  target: z.enum(workspaceOpenTargets).default("vscode"),
}).strict();

const persistedIsoDateSchema = z.iso.datetime({ offset: true });
export const persistedWorkspaceIdSchema = z.string().min(1).max(120);

export const permissionScopeSchema = z.object({
  kind: z.enum(["workspace", "tool"]),
  path: z.string().min(1).max(4_096),
  appliesTo: z.enum(["this-run", "single-action"]),
}).strict();

export const permissionRequestSchema = z.object({
  id: z.string().min(1).max(160),
  runId: z.string().min(1).max(120),
  action: z.enum(permissionActions),
  scope: permissionScopeSchema,
  impact: z.string().min(1).max(2_000),
  provider: z.enum(runAdapters).optional(),
  providerRequestId: z.string().min(1).max(240).optional(),
  toolName: z.string().min(1).max(240).optional(),
  requestedAt: persistedIsoDateSchema,
  status: z.enum(permissionRequestStatuses),
}).strict();

export const permissionDecisionSchema = z.object({
  id: z.string().min(1).max(160),
  requestId: z.string().min(1).max(160),
  runId: z.string().min(1).max(120),
  decision: z.enum(permissionDecisionValues),
  source: z.enum(["user", "runtime"]),
  decidedAt: persistedIsoDateSchema,
}).strict();

export const contextSourceSchema = z.object({
  path: z.string().min(1).max(4_096),
  kind: z.enum(["instructions", "selected-file"]),
  bytes: z.number().int().nonnegative(),
  exists: z.boolean(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().max(100_000).optional(),
  truncated: z.boolean(),
  binary: z.boolean(),
}).strict();

export const contextSnapshotSchema = z.object({
  workspaceRoot: z.string().min(1).max(4_096),
  generatedAt: persistedIsoDateSchema,
  instructions: z.array(contextSourceSchema).max(32),
  selectedFiles: z.array(contextSourceSchema).max(200),
  capabilities: z.array(z.string().min(1).max(240)).max(500),
}).strict();

const gitTreeIdSchema = z.string().regex(/^[a-f0-9]{40,64}$/);

export const gitRunBaselineSchema = z.object({
  id: z.string().min(1).max(120),
  runId: z.string().min(1).max(120),
  workspaceRoot: z.string().min(1).max(4_096),
  createdAt: persistedIsoDateSchema,
  treeId: gitTreeIdSchema,
  indexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  headId: gitTreeIdSchema.optional(),
  ignoredFilesExcluded: z.literal(true),
}).strict();

export const gitRunPatchSchema = z.object({
  id: z.string().min(1).max(120),
  runId: z.string().min(1).max(120),
  baselineId: z.string().min(1).max(120),
  workspaceRoot: z.string().min(1).max(4_096),
  generatedAt: persistedIsoDateSchema,
  beforeTreeId: gitTreeIdSchema,
  afterTreeId: gitTreeIdSchema,
  beforeIndexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  afterIndexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(z.object({
    path: z.string().min(1).max(4_096),
    kind: z.enum(["added", "modified", "deleted", "type-changed", "unknown"]),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    isBinary: z.boolean(),
  }).strict()).max(20_000),
  totals: z.object({
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binaryFiles: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const gitRunSelectionShape = {
  baseline: gitRunBaselineSchema,
  patch: gitRunPatchSchema,
  expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
} as const;

export const gitRunChangeSelectionSchema = z.object({
  ...gitRunSelectionShape,
  paths: z.array(z.string().min(1).max(4_096)).max(20_000).optional(),
}).strict();

export const gitRunDiffParamsSchema = z.object({
  ...gitRunSelectionShape,
  path: z.string().min(1).max(4_096),
}).strict();

export const gitRunRestoreSelectionSchema = gitRunChangeSelectionSchema;

export const gitRunRestoreRequestSchema = gitRunRestoreSelectionSchema.extend({
  confirmed: z.boolean(),
}).strict();

const gitReviewAcceptanceShape = {
  id: z.string().min(1).max(120),
  semantics: z.literal("review-only"),
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedAt: persistedIsoDateSchema,
  scope: z.enum(["all", "file"]),
  paths: z.array(z.string().min(1).max(4_096)).max(20_000),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
} as const;

/** Accepts historical workspace-only records and new Run-bound records. */
export const gitReviewAcceptanceSchema = z.object({
  ...gitReviewAcceptanceShape,
  runId: z.string().min(1).max(120).optional(),
  runPatchSnapshotId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((acceptance, context) => {
  if (Boolean(acceptance.runId) !== Boolean(acceptance.runPatchSnapshotId)) {
    context.addIssue({
      code: "custom",
      path: acceptance.runId ? ["runPatchSnapshotId"] : ["runId"],
      message: "Run review acceptance must include both Run binding fields",
    });
  }
});

/** Runtime-generated Run acceptances must always carry immutable Run binding. */
export const gitRunReviewAcceptanceSchema = z.object({
  ...gitReviewAcceptanceShape,
  runId: z.string().min(1).max(120),
  runPatchSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const gitRunRestoreResultSchema = z.object({
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  attemptedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  restoredPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  deletedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  unresolvedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  beforeTreeId: gitTreeIdSchema,
  afterTreeId: gitTreeIdSchema,
  indexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const gitRunRestoreRecordSchema = z.object({
  id: z.string().min(1).max(160),
  runId: z.string().min(1).max(120),
  restoredAt: persistedIsoDateSchema,
  selectedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  result: gitRunRestoreResultSchema,
}).strict();

export const persistedTaskMessageSchema = z.object({
  id: z.string().min(1).max(240),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(1_000_000),
  time: z.string().max(120),
  createdAt: persistedIsoDateSchema.optional(),
  runId: z.string().min(1).max(120).optional(),
  agent: z.string().min(1).max(240).optional(),
  adapter: z.enum(runAdapters).optional(),
  profileId: z.string().min(1).max(120).optional(),
  agentRevisionId: z.string().min(1).max(240).optional(),
}).strict();

export const persistedPlanStepSchema = z.object({
  label: z.string().min(1).max(2_000),
  state: z.enum(persistedPlanStates),
}).strict();

export const persistedRunActivitySchema = z.object({
  id: z.string().min(1).max(240),
  kind: z.enum(["read", "edit", "command", "tool", "retry"]),
  title: z.string().max(10_000),
  detail: z.string().max(100_000),
  state: z.enum(["active", "done", "error"]),
}).strict();

export const persistedRunEventSchema = z.object({
  id: z.string().min(1).max(300),
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(120),
  occurredAt: persistedIsoDateSchema,
  payload: z.record(z.string(), z.unknown()),
}).strict();

export const verificationEvidenceSchema = z.object({
  id: z.string().min(1).max(240),
  runId: z.string().min(1).max(120),
  kind: z.enum(verificationKinds),
  command: z.string().min(1).max(20_000),
  cwd: z.string().min(1).max(4_096).optional(),
  startedAt: persistedIsoDateSchema.optional(),
  finishedAt: persistedIsoDateSchema,
  exitCode: z.number().int().optional(),
  status: z.enum(verificationStatuses),
  log: z.string().max(100_000),
  redacted: z.boolean(),
  truncated: z.boolean(),
}).strict().superRefine((evidence, context) => {
  if (evidence.exitCode === 0 && evidence.status !== "passed") {
    context.addIssue({ code: "custom", path: ["status"], message: "Exit code 0 must be passed" });
  }
  if (evidence.exitCode !== undefined && evidence.exitCode !== 0 && evidence.status !== "failed") {
    context.addIssue({ code: "custom", path: ["status"], message: "Non-zero exit code must be failed" });
  }
});

export const persistedRunSchema = z.object({
  id: z.string().min(1).max(120),
  taskId: z.string().min(1).max(240),
  adapter: z.enum(runAdapters),
  status: z.enum(persistedRunStatuses),
  prompt: z.string().max(100_000),
  permissionMode: z.enum(permissionModes),
  model: z.string().max(120).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  sessionId: z.string().max(500).optional(),
  sessionLink: nativeSessionLinkSchema.optional(),
  resumeFrom: nativeSessionLinkSchema.optional(),
  resumeFailure: z.string().max(16_000).optional(),
  profileId: z.string().max(120).optional(),
  agentRevisionId: agentRevisionIdentifierSchema,
  providerConnection: providerConnectionRefSchema,
  modelSource: modelSourceSchema,
  modelVerificationStatus: modelVerificationStatusSchema,
  agentSnapshot: agentRevisionSchema.optional(),
  contextFiles: z.array(z.string().min(1).max(4_096)).max(500).default([]),
  contextSnapshot: contextSnapshotSchema.optional(),
  gitBaseline: gitRunBaselineSchema.optional(),
  gitPatch: gitRunPatchSchema.optional(),
  gitRestores: z.array(gitRunRestoreRecordSchema).max(2_000).default([]),
  cwd: z.string().max(4096).optional(),
  version: z.string().max(120).optional(),
  startedAt: persistedIsoDateSchema,
  updatedAt: persistedIsoDateSchema,
  finishedAt: persistedIsoDateSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
  error: z.string().max(100_000).optional(),
  permissionRequests: z.array(permissionRequestSchema).max(10_000).default([]),
  permissionDecisions: z.array(permissionDecisionSchema).max(10_000).default([]),
  verifications: z.array(verificationEvidenceSchema).max(20_000).default([]),
  events: z.array(persistedRunEventSchema).max(50_000),
}).strict().superRefine((run, context) => {
  if (run.providerConnection.engine !== run.adapter) {
    context.addIssue({ code: "custom", path: ["providerConnection", "engine"], message: "Run Connection Engine must match its adapter" });
  }
  const builtInAdapter = builtInAgentRevisionAdapter(run.agentRevisionId);
  if (builtInAdapter && builtInAdapter !== run.adapter) {
    context.addIssue({ code: "custom", path: ["agentRevisionId"], message: "Run built-in Revision must match its adapter" });
  }
  for (const [field, link] of [["sessionLink", run.sessionLink], ["resumeFrom", run.resumeFrom]] as const) {
    if (!link) continue;
    if (link.engine !== run.adapter) {
      context.addIssue({ code: "custom", path: [field, "engine"], message: "Native Session Engine must match its Run" });
    }
    if (link.providerConnectionId !== run.providerConnection.id) {
      context.addIssue({ code: "custom", path: [field, "providerConnectionId"], message: "Native Session Connection must match its Run" });
    }
    if (link.agentRevisionId !== run.agentRevisionId) {
      context.addIssue({ code: "custom", path: [field, "agentRevisionId"], message: "Native Session Revision must match its Run" });
    }
    const expectedKind = run.adapter === "codex" ? "codex-thread"
      : run.adapter === "claude-code" ? "claude-session"
        : run.adapter === "rux-native" ? "rux-response" : "mock-session";
    if (link.kind !== expectedKind) {
      context.addIssue({ code: "custom", path: [field, "kind"], message: "Native Session kind must match its Run Engine" });
    }
  }
  if (run.resumeFailure && !run.resumeFrom) {
    context.addIssue({ code: "custom", path: ["resumeFailure"], message: "Resume failure requires an attempted Native Session" });
  }
  if (run.agentSnapshot) {
    if (run.agentSnapshot.id !== run.agentRevisionId) {
      context.addIssue({ code: "custom", path: ["agentSnapshot", "id"], message: "Run snapshot must match its Agent Revision reference" });
    }
    if (run.agentSnapshot.backend !== run.adapter) {
      context.addIssue({ code: "custom", path: ["agentSnapshot", "backend"], message: "Run snapshot Engine must match its adapter" });
    }
    if (run.profileId && run.agentSnapshot.profileId !== run.profileId) {
      context.addIssue({ code: "custom", path: ["agentSnapshot", "profileId"], message: "Run snapshot must match its Agent profile" });
    }
  }
  if (run.gitBaseline && run.gitBaseline.runId !== run.id) {
    context.addIssue({ code: "custom", path: ["gitBaseline", "runId"], message: "Git baseline runId must match its parent Run" });
  }
  if (run.gitPatch && run.gitPatch.runId !== run.id) {
    context.addIssue({ code: "custom", path: ["gitPatch", "runId"], message: "Git patch runId must match its parent Run" });
  }
  if (run.gitPatch && run.gitBaseline && run.gitPatch.baselineId !== run.gitBaseline.id) {
    context.addIssue({ code: "custom", path: ["gitPatch", "baselineId"], message: "Git patch must reference the persisted Run baseline" });
  }
  run.gitRestores.forEach((restore, index) => {
    if (restore.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["gitRestores", index, "runId"],
        message: "Run restore runId must match its parent Run",
      });
    }
  });
  run.permissionRequests.forEach((request, index) => {
    if (request.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["permissionRequests", index, "runId"],
        message: "Permission request runId must match its parent Run",
      });
    }
  });
  run.permissionDecisions.forEach((decision, index) => {
    if (decision.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["permissionDecisions", index, "runId"],
        message: "Permission decision runId must match its parent Run",
      });
    }
    if (!run.permissionRequests.some((request) => request.id === decision.requestId)) {
      context.addIssue({
        code: "custom",
        path: ["permissionDecisions", index, "requestId"],
        message: "Permission decision must reference a request in the same Run",
      });
    }
  });
  run.verifications.forEach((verification, index) => {
    if (verification.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["verifications", index, "runId"],
        message: "Verification runId must match its parent Run",
      });
    }
  });
});

export const handoffTargetSchema = z.object({
  agentId: z.string().min(1).max(120),
  agentName: z.string().min(1).max(240),
  adapter: z.enum(runAdapters),
  agentProfileId: z.string().min(1).max(120).optional(),
  agentRevisionId: agentRevisionIdentifierSchema,
  providerConnection: providerConnectionRefSchema,
  model: z.string().min(1).max(240),
  modelSource: modelSourceSchema,
  modelVerificationStatus: modelVerificationStatusSchema,
  reasoningEffort: reasoningEffortSchema.optional(),
  permissionMode: z.enum(permissionModes),
}).strict();

export const contextHandoffFactBundleSchema = z.object({
  sourceTask: z.object({
    id: z.string().min(1).max(240),
    title: z.string().min(1).max(10_000),
    workspaceId: persistedWorkspaceIdSchema,
    agentRevisionId: agentRevisionIdentifierSchema,
  }).strict(),
  messages: z.array(z.object({
    id: z.string().min(1).max(300),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(100_000),
    createdAt: persistedIsoDateSchema.optional(),
  }).strict()).max(500),
  latestRun: z.object({
    id: z.string().min(1).max(120),
    status: z.enum(persistedRunStatuses),
    prompt: z.string().max(100_000),
    result: z.string().max(100_000).optional(),
    finishedAt: persistedIsoDateSchema.optional(),
  }).strict().optional(),
  files: z.array(z.object({
    path: z.string().min(1).max(4_096),
    status: z.enum(["added", "modified", "deleted", "type-changed", "unknown"]),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    runId: z.string().min(1).max(120),
    snapshotId: z.string().min(1).max(240),
  }).strict()).max(500),
  incomplete: z.array(z.string().min(1).max(10_000)).max(1_000),
}).strict();

export const contextHandoffSnapshotSchema = z.object({
  id: z.string().min(1).max(240),
  sourceTaskId: z.string().min(1).max(240),
  targetTaskId: z.string().min(1).max(240),
  workspaceId: persistedWorkspaceIdSchema,
  target: handoffTargetSchema,
  facts: contextHandoffFactBundleSchema,
  agentSummary: z.string().max(100_000).optional(),
  agentSummaryProvenance: z.object({
    sourceAgentRevisionId: agentRevisionIdentifierSchema,
    sourceAdapter: z.enum(["codex", "claude-code"]),
    generatedAt: persistedIsoDateSchema,
    isolated: z.literal(true),
    nativeSessionPersisted: z.literal(false),
  }).strict().optional(),
  constraints: z.string().max(100_000).optional(),
  createdAt: persistedIsoDateSchema,
}).strict();

export const handoffRelationSchema = z.object({
  snapshotId: z.string().min(1).max(240),
  taskId: z.string().min(1).max(240),
}).strict();

export const persistedTaskSchema = z.object({
  id: z.string().min(1).max(240),
  workspaceId: persistedWorkspaceIdSchema,
  title: z.string().min(1).max(10_000),
  preview: z.string().max(100_000),
  status: z.enum(persistedTaskStatuses),
  updatedAt: z.string().max(120),
  updatedAtIso: persistedIsoDateSchema.optional(),
  createdAt: persistedIsoDateSchema.optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  agent: z.string().min(1).max(240),
  adapter: z.enum(runAdapters),
  agentProfileId: z.string().min(1).max(120).optional(),
  agentRevisionId: agentRevisionIdentifierSchema,
  agentRevisionSnapshot: agentRevisionSchema.optional(),
  providerConnection: providerConnectionRefSchema,
  permissionMode: z.enum(permissionModes).optional(),
  model: z.string().min(1).max(240),
  modelSource: modelSourceSchema,
  modelVerificationStatus: modelVerificationStatusSchema,
  reasoningEffort: reasoningEffortSchema.optional(),
  contextFiles: z.array(z.string().min(1).max(4_096)).max(200).default([]),
  branch: z.string().max(1_000),
  elapsed: z.string().max(120),
  tokens: z.string().max(120),
  messages: z.array(persistedTaskMessageSchema).max(20_000),
  plan: z.array(persistedPlanStepSchema).max(1_000),
  activity: z.array(persistedRunActivitySchema).max(20_000),
  runs: z.array(persistedRunSchema).max(2_000).default([]),
  reviewAcceptances: z.array(gitReviewAcceptanceSchema).max(2_000).default([]),
  importedSession: importedSessionBindingSchema.optional(),
  handoffSource: handoffRelationSchema.optional(),
  handoffTargets: z.array(handoffRelationSchema).max(2_000).default([]),
}).strict().superRefine((task, context) => {
  if (task.providerConnection.engine !== task.adapter) {
    context.addIssue({ code: "custom", path: ["providerConnection", "engine"], message: "Task Connection Engine must match its adapter" });
  }
  const builtInAdapter = builtInAgentRevisionAdapter(task.agentRevisionId);
  if (builtInAdapter && builtInAdapter !== task.adapter) {
    context.addIssue({ code: "custom", path: ["agentRevisionId"], message: "Task built-in Revision must match its adapter" });
  }
  if (task.agentRevisionSnapshot) {
    if (task.agentRevisionSnapshot.id !== task.agentRevisionId) {
      context.addIssue({ code: "custom", path: ["agentRevisionSnapshot", "id"], message: "Task snapshot must match its Agent Revision reference" });
    }
    if (task.agentRevisionSnapshot.backend !== task.adapter) {
      context.addIssue({ code: "custom", path: ["agentRevisionSnapshot", "backend"], message: "Task snapshot Engine must match its adapter" });
    }
  }
  task.runs.forEach((run, index) => {
    for (const [field, link] of [["sessionLink", run.sessionLink], ["resumeFrom", run.resumeFrom]] as const) {
      if (link && link.workspaceId !== task.workspaceId) {
        context.addIssue({ code: "custom", path: ["runs", index, field, "workspaceId"], message: "Native Session Workspace must match its Task" });
      }
    }
  });
  if (task.importedSession) {
    const link = task.importedSession.sessionLink;
    if (link.workspaceId !== task.workspaceId || link.engine !== task.adapter) {
      context.addIssue({ code: "custom", path: ["importedSession", "sessionLink"], message: "Imported Native Session must match its Task Engine and Workspace" });
    }
    if (link.providerConnectionId !== task.providerConnection.id || link.agentRevisionId !== task.agentRevisionId) {
      context.addIssue({ code: "custom", path: ["importedSession", "sessionLink"], message: "Imported Native Session must match its Task Connection and Agent Revision" });
    }
  }
  task.reviewAcceptances.forEach((acceptance, index) => {
    if (!acceptance.runId || !acceptance.runPatchSnapshotId) return;
    const run = task.runs.find((candidate) => candidate.id === acceptance.runId);
    if (!run?.gitPatch) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index, "runId"],
        message: "Run review acceptance must reference a Run patch in the same Task",
      });
      return;
    }
    if (
      acceptance.snapshotId !== acceptance.runPatchSnapshotId
      || run.gitPatch.snapshotId !== acceptance.runPatchSnapshotId
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index, "runPatchSnapshotId"],
        message: "Run review acceptance snapshot must match its persisted Run patch",
      });
      return;
    }
    const patchFiles = new Map(run.gitPatch.files.map((file) => [file.path, file]));
    const reviewedFiles = acceptance.paths.map((path) => patchFiles.get(path));
    if (reviewedFiles.some((file) => !file)) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index, "paths"],
        message: "Run review acceptance paths must belong to its persisted Run patch",
      });
      return;
    }
    const additions = reviewedFiles.reduce((sum, file) => sum + (file?.additions ?? 0), 0);
    const deletions = reviewedFiles.reduce((sum, file) => sum + (file?.deletions ?? 0), 0);
    if (acceptance.additions !== additions || acceptance.deletions !== deletions) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index],
        message: "Run review acceptance stats must match its reviewed Run patch paths",
      });
    }
  });
});

export const sessionImportResultSchema = z.object({
  task: persistedTaskSchema,
  binding: importedSessionBindingSchema,
  projection: sessionProjectionSchema,
  revision: sessionProjectionRevisionSchema,
  created: z.boolean(),
}).strict();

export const sessionRefreshResultSchema = z.object({
  task: persistedTaskSchema,
  diff: sessionProjectionDiffSchema,
  currentRevisionId: z.string().trim().min(1).max(240),
  candidateRevisionId: z.string().trim().min(1).max(240).optional(),
  audit: sessionProjectionAuditSchema,
}).strict();

export const sessionRevisionSummarySchema = z.object({
  id: z.string().trim().min(1).max(240),
  ordinal: z.number().int().positive(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  sourceUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  current: z.boolean(),
}).strict();

export const sessionRevisionListResultSchema = z.object({
  currentRevisionId: z.string().trim().min(1).max(240),
  revisions: z.array(sessionRevisionSummarySchema).max(10_000),
  audits: z.array(sessionProjectionAuditSchema).max(10_000),
}).strict();

export const localDataSummarySchema = z.object({
  workspaceId: persistedWorkspaceIdSchema,
  estimatedBytes: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  importedTaskCount: z.number().int().nonnegative(),
  projectionRevisionCount: z.number().int().nonnegative(),
  handoffCount: z.number().int().nonnegative(),
}).strict();

export const localDataPreviewParamsSchema = z.object({
  scope: z.enum(localDataScopes),
  taskId: z.string().min(1).max(240).optional(),
  action: z.enum(localDataActions),
}).strict().superRefine((value, context) => {
  if (value.scope === "task" && !value.taskId) {
    context.addIssue({ code: "custom", path: ["taskId"], message: "Task scope requires a Task id" });
  }
});

export const localDataImpactPreviewSchema = localDataSummarySchema.safeExtend({
  scope: z.enum(localDataScopes),
  action: z.enum(localDataActions),
  affectedTaskCount: z.number().int().nonnegative(),
  affectedProjectionRevisionCount: z.number().int().nonnegative(),
  importedMessageCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  affectedHandoffCount: z.number().int().nonnegative(),
  estimatedReclaimableBytes: z.number().int().nonnegative(),
  nativeSessions: z.array(z.object({
    engine: z.enum(sessionEngines),
    nativeSessionId: sessionNativeIdSchema,
  }).strict()).max(20_000),
  fingerprint: z.string().length(64),
});

export const localDataExecuteParamsSchema = localDataPreviewParamsSchema.safeExtend({
  fingerprint: z.string().length(64),
  confirmed: z.literal(true),
});

export const localDataExecuteResultSchema = z.object({
  workspaceId: persistedWorkspaceIdSchema,
  action: z.enum(localDataActions),
  affectedTaskCount: z.number().int().nonnegative(),
  savedAt: persistedIsoDateSchema,
}).strict();

export const localDataExportParamsSchema = z.object({
  scope: z.enum(localDataScopes),
  taskId: z.string().min(1).max(240).optional(),
  format: z.enum(localDataExportFormats),
  revisions: z.enum(localDataRevisionScopes),
  confirmedSensitiveContent: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.scope === "task" && !value.taskId) {
    context.addIssue({ code: "custom", path: ["taskId"], message: "Task scope requires a Task id" });
  }
});

export const localDataExportResultSchema = z.object({
  saved: z.boolean(),
  canceled: z.boolean(),
  filePath: z.string().min(1).max(4_096).optional(),
  bytes: z.number().int().nonnegative().optional(),
}).strict();

export const handoffPreviewParamsSchema = z.object({
  sourceTaskId: z.string().min(1).max(240),
  targetAgentId: z.string().min(1).max(120),
  messageIds: z.array(z.string().min(1).max(300)).max(500),
  filePaths: z.array(z.string().min(1).max(4_096)).max(500),
}).strict();

export const handoffPreviewResultSchema = z.object({
  target: handoffTargetSchema,
  facts: contextHandoffFactBundleSchema,
  sourceAgentAvailable: z.boolean(),
  fingerprint: z.string().length(64),
}).strict();

export const handoffSummaryGenerateParamsSchema = handoffPreviewParamsSchema.safeExtend({
  fingerprint: z.string().length(64),
});

export const handoffSummaryProvenanceSchema = z.object({
  sourceAgentRevisionId: agentRevisionIdentifierSchema,
  sourceAdapter: z.enum(["codex", "claude-code"]),
  generatedAt: persistedIsoDateSchema,
  isolated: z.literal(true),
  nativeSessionPersisted: z.literal(false),
}).strict();

export const handoffSummaryGenerateResultSchema = z.object({
  generationId: z.string().min(1).max(240),
  summary: z.string().trim().min(1).max(100_000),
  provenance: handoffSummaryProvenanceSchema,
}).strict();

export const handoffSummaryRuntimeParamsSchema = z.object({
  operationId: z.string().min(1).max(240),
  adapter: z.enum(["codex", "claude-code"]),
  prompt: z.string().min(1).max(100_000),
  model: z.string().min(1).max(240).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  profileId: z.string().min(1).max(120).optional(),
  agentRevisionId: agentRevisionIdentifierSchema,
  providerConnection: providerConnectionRefSchema,
}).strict();

export const handoffCommitParamsSchema = handoffPreviewParamsSchema.safeExtend({
  fingerprint: z.string().length(64),
  agentSummary: z.string().max(100_000).optional(),
  agentSummaryGenerationId: z.string().min(1).max(240).optional(),
  constraints: z.string().max(100_000).optional(),
  confirmed: z.literal(true),
});

export const handoffCommitResultSchema = z.object({
  sourceTask: persistedTaskSchema,
  targetTask: persistedTaskSchema,
  snapshot: contextHandoffSnapshotSchema,
}).strict();

export const workspaceTaskStateSchema = z.object({
  version: z.literal(2),
  workspaceId: persistedWorkspaceIdSchema,
  tasks: z.array(persistedTaskSchema).max(20_000),
  updatedAt: persistedIsoDateSchema,
}).strict().superRefine((state, context) => {
  state.tasks.forEach((task, taskIndex) => {
    if (task.workspaceId !== state.workspaceId) {
      context.addIssue({
        code: "custom",
        path: ["tasks", taskIndex, "workspaceId"],
        message: "Task workspaceId must match its workspace snapshot",
      });
    }
    task.runs.forEach((run, runIndex) => {
      if (run.taskId !== task.id) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "runs", runIndex, "taskId"],
          message: "Run taskId must match its parent task",
        });
      }
      const legacyHistory = task.agentRevisionSnapshot?.origin === "legacy-task"
        || run.agentSnapshot?.origin === "legacy-task";
      if (!legacyHistory && run.agentRevisionId !== task.agentRevisionId) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "runs", runIndex, "agentRevisionId"],
          message: "Run Agent Revision must match its parent Task",
        });
      }
      if (!legacyHistory && run.providerConnection.id !== task.providerConnection.id) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "runs", runIndex, "providerConnection", "id"],
          message: "Run Connection must match its parent Task",
        });
      }
    });
  });
});

export const taskStateLoadParamsSchema = z.object({
  workspaceId: persistedWorkspaceIdSchema.optional(),
}).strict();
