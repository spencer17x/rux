import { z } from "zod";

export const RUX_PROTOCOL_VERSION = 25 as const;

export const IPC_CHANNELS = {
  request: "rux:runtime:request",
  event: "rux:runtime:event",
  desktopInfo: "rux:desktop:info",
  workspaceState: "rux:workspace:state",
  workspaceChoose: "rux:workspace:choose",
  workspaceChooseFiles: "rux:workspace:choose-files",
  clipboardImageSave: "rux:clipboard-image:save",
  workspaceActivate: "rux:workspace:activate",
  workspaceOpen: "rux:workspace:open",
  preventSleepSet: "rux:power:prevent-sleep-set",
  taskStateLoad: "rux:task-state:load",
  taskStateSave: "rux:task-state:save",
  boardLoad: "rux:board:load",
  boardMutate: "rux:board:mutate",
  projectWorkingCopiesList: "rux:project:working-copies-list",
  projectWorkingCopyAuthorize: "rux:project:working-copy-authorize",
  projectWorkingCopyCreate: "rux:project:working-copy-create",
  improvementSummary: "rux:improvement:summary",
  improvementAnalyze: "rux:improvement:analyze",
  improvementDecide: "rux:improvement:decide",
  improvementSettingsUpdate: "rux:improvement:settings-update",
  improvementPropose: "rux:improvement:propose",
  improvementExportPreview: "rux:improvement:export-preview",
  improvementExportCommit: "rux:improvement:export-commit",
  improvementEvaluate: "rux:improvement:evaluate",
  sessionImport: "rux:session:import",
  sessionAttributionMigrate: "rux:session:attribution-migrate",
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
  providerConnectionImpactPreview: "rux:provider-connection:impact-preview",
  providerConnectionSave: "rux:provider-connection:save",
  providerConnectionDelete: "rux:provider-connection:delete",
  providerConnectionTest: "rux:provider-connection:test",
  providerCredentialDiagnostics: "rux:provider-credential:diagnostics",
  providerCredentialMigrate: "rux:provider-credential:migrate",
  localProductEventSummary: "rux:local-product-events:summary",
  updateState: "rux:update:state",
  updateCheck: "rux:update:check",
  updateDownload: "rux:update:download",
  updateInstall: "rux:update:install",
  updateConfirmHealthy: "rux:update:confirm-healthy",
} as const;

export const runtimeMethods = [
  "runtime.ping",
  "runtime.shutdown",
  "auth.status",
  "auth.chatgpt.sync",
  "auth.login",
  "auth.logout",
  "auth.cancel",
  "terminal.create",
  "terminal.write",
  "terminal.resize",
  "terminal.dispose",
  "agent.list",
  "agent.model.list",
  "plugin.list",
  "plugin.install",
  "plugin.remove",
  "pullRequest.list",
  "externalConfig.detect",
  "externalConfig.import",
  "externalConfig.history",
  "session.list",
  "session.discover",
  "session.attribution.migrate",
  "session.preview",
  "session.import",
  "session.refresh",
  "session.rebuild",
  "session.revision.list",
  "session.revision.restore",
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
  "improvement.evaluation.run",
  "handoff.preview",
  "handoff.commit",
  "local.data.summary",
  "local.data.preview",
  "local.data.execute",
  "local.data.export",
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
  "git.worktree.create",
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
  "runtime.shutdown" | "session.list" | "session.import" | "session.refresh" | "session.rebuild" | "session.revision.list" | "session.revision.restore" | "session.attribution.migrate" | "session.read" | "session.resume.check" | "handoff.preview" | "handoff.commit" | "handoff.summary.generate" | "improvement.evaluation.run" | "local.data.summary" | "local.data.preview" | "local.data.execute" | "local.data.export" | "provider.connection.sync" | "provider.connection.test" | "git.worktree.create"
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

export const chatGptAccountSyncStatuses = ["connected", "signed-out", "unsupported"] as const;
export type ChatGptAccountSyncStatus = (typeof chatGptAccountSyncStatuses)[number];

export interface ChatGptAccountSyncResult {
  status: ChatGptAccountSyncStatus;
  accountType?: string;
  email?: string;
  planType?: string;
  usedPercent?: number;
  remainingPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
  syncedAt: string;
}

export const chatGptAccountSyncResultSchema = z.object({
  status: z.enum(chatGptAccountSyncStatuses),
  accountType: z.string().min(1).max(64).optional(),
  email: z.string().min(3).max(320).optional(),
  planType: z.string().min(1).max(64).optional(),
  usedPercent: z.number().min(0).max(100).optional(),
  remainingPercent: z.number().min(0).max(100).optional(),
  windowDurationMins: z.number().nonnegative().max(525_600).optional(),
  resetsAt: z.number().int().nonnegative().optional(),
  syncedAt: z.string().datetime(),
});

export interface AuthLoginParams {
  provider: AuthProviderId;
}

export type AuthCancelParams = AuthLoginParams;
export type AuthLogoutParams = AuthLoginParams;

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

export interface CodexServiceTierInfo {
  id: string;
  name: string;
  description: string;
}

export interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  defaultReasoningEffort: ReasoningEffort;
  serviceTiers: CodexServiceTierInfo[];
  defaultServiceTier?: string;
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

export interface CodexPluginInfo {
  pluginId: string;
  name: string;
  marketplaceName: string;
  version: string;
  installed: boolean;
  enabled: boolean;
  installPolicy?: string;
  authPolicy?: string;
}

export interface CodexPluginListResult {
  source: "codex-cli" | "web-unavailable";
  fetchedAt: string;
  installed: CodexPluginInfo[];
  available: CodexPluginInfo[];
  unavailableReason?: string;
}

export interface CodexPluginMutationParams {
  pluginId: string;
  confirmed: true;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  author?: string;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  reviewDecision?: string;
}

export interface PullRequestListResult {
  source: "github-cli" | "unavailable" | "web-unavailable";
  fetchedAt: string;
  repository?: string;
  repositoryUrl?: string;
  items: PullRequestInfo[];
  unavailableReason?: string;
}

export const externalConfigSources = ["claude-code", "claude-cowork", "cursor"] as const;
export type ExternalConfigSource = (typeof externalConfigSources)[number];
export const externalConfigItemTypes = ["AGENTS_MD", "CONFIG", "SKILLS", "PLUGINS", "MCP_SERVER_CONFIG", "SUBAGENTS", "HOOKS", "COMMANDS", "MEMORY", "SESSIONS"] as const;
export type ExternalConfigItemType = (typeof externalConfigItemTypes)[number];

export interface ExternalConfigDetectParams { source: ExternalConfigSource; }
export interface ExternalConfigDetectedItem {
  id: string;
  itemType: ExternalConfigItemType;
  description: string;
  scope: "user" | "workspace";
  cwd?: string;
  itemCount: number;
}
export interface ExternalConfigConnectorCandidate { name: string; sessionCount: number; source: string; }
export interface ExternalConfigDetectResult {
  source: ExternalConfigSource;
  availability: "available" | "unavailable" | "web-unavailable";
  detectionId?: string;
  detectedAt: string;
  items: ExternalConfigDetectedItem[];
  connectors: ExternalConfigConnectorCandidate[];
  unavailableReason?: string;
}
export interface ExternalConfigImportParams {
  source: ExternalConfigSource;
  detectionId: string;
  itemIds: string[];
  confirmed: true;
}
export interface ExternalConfigImportSuccess { itemType: ExternalConfigItemType; cwd?: string; target?: string; title?: string; }
export interface ExternalConfigImportFailure { itemType: ExternalConfigItemType; stage: string; message: string; cwd?: string; }
export interface ExternalConfigImportResult {
  importId: string;
  source: ExternalConfigSource;
  completedAt: string;
  successes: ExternalConfigImportSuccess[];
  failures: ExternalConfigImportFailure[];
}
export interface ExternalConfigImportHistoryRecord {
  importId: string;
  source?: ExternalConfigSource;
  completedAt: string;
  successes: ExternalConfigImportSuccess[];
  failures: ExternalConfigImportFailure[];
  providerId?: string;
}
export interface ExternalConfigHistoryResult {
  fetchedAt: string;
  records: ExternalConfigImportHistoryRecord[];
  connectors: ExternalConfigConnectorCandidate[];
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

export const nativeProviderTypes = ["openai-responses", "openai-chat-completions", "anthropic-messages"] as const;
export type NativeProviderType = (typeof nativeProviderTypes)[number];

/** Renderer-safe native Provider metadata. The API key never crosses this contract. */
export interface NativeProviderConnection {
  id: string;
  label: string;
  providerType: NativeProviderType;
  baseUrl: string;
  defaultModel: string;
  hasCredential: boolean;
  /** Header names are safe to display; secret values remain Main/Runtime-only. */
  customHeaderNames: string[];
  createdAt: string;
  updatedAt: string;
  lastTestedAt?: string;
  lastTestStatus?: "connected" | "error";
  lastTestDetail?: string;
  modelCatalog?: {
    source: "provider-models";
    refreshedAt: string;
    models: Array<{ id: string; name?: string }>;
  };
  capabilities?: {
    source: "provider-report";
    refreshedAt: string;
    perRunModelSelection?: boolean;
    reported: string[];
  };
}

export interface NativeProviderConnectionInput {
  id?: string;
  label: string;
  providerType: NativeProviderType;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
  /** Supplying this replaces all encrypted custom headers; omitting it preserves them. */
  customHeaders?: Array<{ name: string; value: string }>;
  impactFingerprint?: string;
  confirmed?: true;
}

export const nativeProviderConnectionImpactActions = ["update", "replace-credential", "delete"] as const;
export type NativeProviderConnectionImpactAction = (typeof nativeProviderConnectionImpactActions)[number];
export interface NativeProviderConnectionImpactPreviewParams {
  id: string;
  action: NativeProviderConnectionImpactAction;
  next?: Pick<NativeProviderConnectionInput, "label" | "providerType" | "baseUrl" | "defaultModel"> & { customHeaderNames?: string[] };
}
export interface NativeProviderConnectionAgentImpact { id: string; name: string; revisionNumber: number; }
export interface NativeProviderConnectionTaskImpact { workspaceId: string; taskId: string; title: string; }
export interface NativeProviderConnectionImpactPreview {
  connectionId: string;
  connectionLabel: string;
  action: NativeProviderConnectionImpactAction;
  agents: NativeProviderConnectionAgentImpact[];
  tasks: NativeProviderConnectionTaskImpact[];
  deletesCredential: boolean;
  fingerprint: string;
}
export interface NativeProviderConnectionDeleteParams { id: string; impactFingerprint: string; confirmed: true; }
export interface NativeProviderConnectionTestParams { id: string; }
export interface NativeProviderConnectionTestResult {
  id: string;
  ok: boolean;
  testedAt: string;
  detail: string;
  modelCatalog?: NativeProviderConnection["modelCatalog"];
  capabilities?: NativeProviderConnection["capabilities"];
}

export type NativeProviderCredentialStatus = "healthy" | "empty" | "encryption-unavailable" | "store-unreadable" | "credential-error";
export interface NativeProviderCredentialDiagnostics {
  status: NativeProviderCredentialStatus;
  storageBackend: string;
  encryptionAvailable: boolean;
  connectionCount: number;
  decryptableCount: number;
  failedConnectionLabels: string[];
  checkedAt: string;
  migrationAvailable: boolean;
  detail: string;
}
export interface NativeProviderCredentialMigrationParams { confirmed: true; }
export interface NativeProviderCredentialMigrationResult {
  migratedConnections: number;
  backupFileName?: string;
  completedAt: string;
  diagnostics: NativeProviderCredentialDiagnostics;
}
export interface LocalProductEventSummary {
  storage: "main-local-only";
  totalEvents: number;
  firstEventAt?: string;
  lastEventAt?: string;
  firstSuccessfulRunAt?: string;
  counts: Record<"cli-detection" | "run-succeeded" | "run-failed" | "restart-recovery" | "session-imported" | "session-import-deduplicated" | "session-continued" | "task-branched" | "error-recovery-attempted" | "error-recovered", number>;
}

/** Main-to-Runtime only. This object may contain a secret and must never be exposed to Renderer IPC. */
export interface NativeProviderRuntimeCredential {
  id: string;
  label: string;
  providerType: NativeProviderType;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
  customHeaders: Array<{ name: string; value: string }>;
  modelCatalog?: NativeProviderConnection["modelCatalog"];
  capabilities?: NativeProviderConnection["capabilities"];
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

export const autoModelStrategies = ["conservative", "balanced", "quality"] as const;
export type AutoModelStrategy = (typeof autoModelStrategies)[number];
export const autoModelCandidateSources = ["engine-catalog", "verified-history"] as const;
export type AutoModelCandidateSource = (typeof autoModelCandidateSources)[number];
export const runModelClassifications = ["fixed", "simple", "complex"] as const;
export type RunModelClassification = (typeof runModelClassifications)[number];
export const tokenUsageSources = ["engine", "provider", "estimate"] as const;
export type TokenUsageSource = (typeof tokenUsageSources)[number];

export interface AutoModelCandidate {
  model: string;
  source: AutoModelCandidateSource;
}

/** Immutable Auto configuration stored inside one Agent Revision. */
export interface AutoModelPolicy {
  simpleModel: AutoModelCandidate;
  complexModel: AutoModelCandidate;
  strategy: AutoModelStrategy;
  fallbackEnabled: boolean;
  allowlist: AutoModelCandidate[];
}

export interface RunModelFallback {
  fromModel: string;
  toModel: string;
  reason: string;
}

/** One pre-execution model resolution. It is immutable for the lifetime of a Run. */
export interface RunModelDecision {
  id: string;
  runId: string;
  mode: "fixed" | "auto";
  classification: RunModelClassification;
  actualModel: string;
  modelSource: ModelSource;
  strategy?: AutoModelStrategy;
  score?: number;
  threshold?: number;
  reasonCodes: string[];
  rationale: string;
  allowlist: string[];
  engine: RunAdapter;
  providerConnectionId: string;
  agentRevisionId: string;
  fallback?: RunModelFallback;
  decidedAt: string;
}

/** Engine/Provider reported usage. Missing usage is represented by an absent value, never invented zeros. */
export interface TokenUsage {
  source: TokenUsageSource;
  scope: "task" | "router";
  aggregation: "cumulative" | "incremental";
  isEstimate: boolean;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  reportedAt: string;
}

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
  autoModelPolicy?: AutoModelPolicy;
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
  autoModelPolicy?: AutoModelPolicy;
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
  autoModelPolicy?: AutoModelPolicy;
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
  patch: Partial<AgentProfileInput> & { autoModelPolicy?: AutoModelPolicy | null };
}

export interface AgentProfileDeleteParams {
  id: string;
}

export interface RunStartParams {
  runId: string;
  adapter: RunAdapter;
  prompt: string;
  model?: string;
  modelMode?: "fixed" | "auto";
  modelSource?: ModelSource;
  modelVerificationStatus?: ModelVerificationStatus;
  reasoningEffort?: ReasoningEffort;
  serviceTier?: string;
  permissionMode: PermissionMode;
  sessionId?: string;
  profileId?: string;
  agentRevisionId: string;
  providerConnectionId?: string;
  contextFiles?: string[];
  imagePaths?: string[];
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  reviewTarget?: CodexReviewTarget;
}

export type CodexReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string };

export const clipboardImageMimeTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ClipboardImageMimeType = (typeof clipboardImageMimeTypes)[number];

export interface ClipboardImageSaveParams {
  dataBase64: string;
  mimeType: ClipboardImageMimeType;
  name?: string;
}

export interface LocalImageAttachment {
  id: string;
  name: string;
  mimeType: ClipboardImageMimeType;
  path: string;
}

export const clipboardImageSaveParamsSchema = z.object({
  dataBase64: z.string().min(1).max(28_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.enum(clipboardImageMimeTypes),
  name: z.string().trim().min(1).max(240).optional(),
}).strict();

export const localImageAttachmentSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  mimeType: z.enum(clipboardImageMimeTypes),
  path: z.string().min(1).max(4_096),
}).strict();

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

export interface SessionAttributionMigrateParams {
  identityKey: string;
  expectedPreviousWorkspaceId: string;
  targetWorkspaceId: string;
  confirmed: true;
}

export interface SessionAttributionMigrateResult {
  identityKey: string;
  previousWorkspaceId: string;
  workspaceId: string;
  workspaceName: string;
  migratedAt: string;
  movedTaskId?: string;
}

export const sessionImportModes = ["copy", "view", "continue"] as const;
export type SessionImportMode = (typeof sessionImportModes)[number];
export const importedSessionStatuses = ["copied", "linked", "read-only", "native-unavailable", "unlinked"] as const;
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

export interface LocalDataRuntimeExportParams extends LocalDataExportParams { destination: string }
export interface LocalDataRuntimeExportResult { saved: true; filePath: string; bytes: number }

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

export interface GitWorktreeCreateParams {
  path: string;
  branch: string;
  confirmed: true;
}

export interface GitWorktreeCreateResult {
  path: string;
  branch: string;
  headId: string;
  createdBranch: boolean;
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
  projectId?: string;
  projectName?: string;
  workingCopyId?: string;
  workingCopyName?: string;
  workingCopyKind?: "main" | "worktree" | "directory";
  repositoryRoot?: string;
  gitCommonDir?: string;
}

export interface WorkspaceState {
  active: WorkspaceSummary;
  recent: WorkspaceSummary[];
}

export const boardSemanticRoles = ["todo", "in-progress", "review", "done", "custom"] as const;
export type BoardSemanticRole = (typeof boardSemanticRoles)[number];
export const boardItemTypes = ["requirement", "task"] as const;
export type BoardItemType = (typeof boardItemTypes)[number];
export const boardPriorities = ["low", "medium", "high", "urgent"] as const;
export type BoardPriority = (typeof boardPriorities)[number];

export interface BoardStateColumn {
  id: string;
  name: string;
  order: number;
  semanticRole: BoardSemanticRole;
}

export interface BoardWorkItem {
  id: string;
  projectId: string;
  workspaceId?: string;
  type: BoardItemType;
  title: string;
  description: string;
  stateId: string;
  priority: BoardPriority;
  labels: string[];
  acceptanceCriteria: string[];
  linkedTaskId?: string;
  linkedTaskIds: string[];
  automationMode: "automatic" | "manual";
  agent?: string;
  model?: string;
  branch?: string;
  taskStatus?: PersistedTaskStatus;
  latestRunStatus?: PersistedRunStatus;
  pendingApprovals?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardTransition {
  id: string;
  workItemId: string;
  fromStateId?: string;
  toStateId: string;
  source: "user" | "run-rule";
  runId?: string;
  createdAt: string;
}

export interface BoardSnapshot {
  version: 1;
  projectId: string;
  revision: number;
  enabled: boolean;
  states: BoardStateColumn[];
  items: BoardWorkItem[];
  transitions: BoardTransition[];
  updatedAt: string;
}

export type BoardMutation =
  | { action: "set-enabled"; enabled: boolean }
  | { action: "create-requirement"; title: string; description?: string; priority?: BoardPriority; labels?: string[]; acceptanceCriteria?: string[]; linkedTaskIds?: string[] }
  | { action: "update-requirement"; itemId: string; title?: string; description?: string; priority?: BoardPriority; labels?: string[]; acceptanceCriteria?: string[]; linkedTaskIds?: string[] }
  | { action: "move-item"; itemId: string; stateId: string }
  | { action: "delete-requirement"; itemId: string }
  | { action: "create-state"; name: string }
  | { action: "rename-state"; stateId: string; name: string }
  | { action: "reorder-states"; stateIds: string[] };

export interface BoardLoadParams { projectId: string }
export interface BoardMutationParams { projectId: string; expectedRevision: number; mutation: BoardMutation }

export interface ProjectWorkingCopy {
  id: string;
  projectId: string;
  path: string;
  name: string;
  kind: "main" | "worktree";
  branch?: string;
  headOid?: string;
  availability: "available" | "missing" | "invalid";
  authorizationState: "authorized" | "pending";
}
export interface ProjectWorkingCopiesParams { projectId: string }
export interface ProjectWorkingCopyAuthorizeParams { projectId: string; path: string; confirmed: true }
export interface ProjectWorkingCopyCreateParams { projectId: string; path: string; branch: string; confirmed: true }

export const improvementCandidateTypes = ["project-rule", "skill", "workflow", "agent-instruction"] as const;
export const improvementCandidateStatuses = ["pending", "snoozed", "rejected", "published", "rolled-back"] as const;
export type ImprovementCandidateType = (typeof improvementCandidateTypes)[number];
export type ImprovementCandidateStatus = (typeof improvementCandidateStatuses)[number];
export interface ImprovementEvidence {
  id: string;
  kind: "explicit-feedback" | "recovery-pattern" | "repeated-pattern";
  projectId: string;
  taskId: string;
  runId?: string;
  preview: string;
  fingerprint: string;
  occurredAt: string;
}
export interface ImprovementCandidate {
  id: string;
  revision: number;
  type: ImprovementCandidateType;
  status: ImprovementCandidateStatus;
  scope: "project" | "user" | "agent";
  projectId?: string;
  agentRevisionId?: string;
  agentProfileId?: string;
  name: string;
  content: string;
  rationale: string;
  expectedBenefit: string;
  risk: string;
  proposer: { kind: "deterministic" | "user" | "model"; source: string; model?: string; tokenUsage?: number };
  evidenceIds: string[];
  createdAt: string;
  decidedAt?: string;
  rejectionReason?: string;
  publishedAssetId?: string;
  publishedAgentRevisionId?: string;
  rollbackAgentRevisionId?: string;
  evaluation?: { status: "passed" | "failed" | "unknown"; checks: string[]; evidenceCount: number; evaluatedAt: string };
}
export interface ImprovementAsset {
  id: string;
  candidateId: string;
  type: ImprovementCandidateType;
  scope: "project" | "user" | "agent";
  projectId?: string;
  agentRevisionId?: string;
  agentProfileId?: string;
  version: number;
  name: string;
  content: string;
  status: "active" | "rolled-back" | "superseded";
  createdAt: string;
  rolledBackAt?: string;
  supersededAt?: string;
  formatVersion: 1;
  storage: "rux-managed";
  evaluation: { status: "passed" | "unknown"; checks: string[]; evidenceCount: number; evaluatedAt: string };
}
export interface ImprovementAdoption { assetId: string; taskId: string; projectId: string; adoptedAt: string; completedRunCount: number; failedRunCount: number; stoppedRunCount: number; lastObservedAt: string }
export interface ImprovementSettings {
  evidenceCollection: boolean;
  candidateGeneration: boolean;
  controlledEvolution: boolean;
  backgroundModelReview: boolean;
  paused: boolean;
  dailyTokenLimit: number;
  perProjectTokenLimit: number;
  evaluationTokenReservation: number;
  evaluationCostReservationUsd: number;
  dailyCostUsdLimit?: number;
  onlyWhenIdle: boolean;
  onlyOnAcPower: boolean;
  evaluatorAgentId?: string;
}
export interface ImprovementEvaluationCase { id: string; name: string; input: string; expectedIncludes: string; holdout: boolean }
export interface ImprovementEvaluationOutcome { caseId: string; variant: "baseline" | "candidate"; passed: boolean; outputPreview: string; durationMs: number; tokens?: number }
export interface ImprovementEvaluationRecord { id: string; candidateId: string; projectId: string; status: "passed" | "failed" | "unknown"; evaluatorAgentId: string; evaluatorAgentRevisionId: string; evaluatorAdapter: "codex" | "claude-code"; model?: string; cases: ImprovementEvaluationCase[]; outcomes: ImprovementEvaluationOutcome[]; baselinePassed: number; candidatePassed: number; holdoutPassed: boolean; totalTokens?: number; tokenSource: "engine" | "unreported"; costUsd?: number; costSource: "engine" | "unreported"; createdAt: string }
export interface ImprovementBudgetUsage { date: string; projectId: string; reservedTokens: number; reportedTokens: number; reservedCostUsd: number; evaluations: number; reportedCostUsd?: number }
export interface ImprovementSummary {
  settings: ImprovementSettings;
  evidence: ImprovementEvidence[];
  candidates: ImprovementCandidate[];
  assets: ImprovementAsset[];
  adoptions: ImprovementAdoption[];
  evaluations: ImprovementEvaluationRecord[];
  budgetUsage: ImprovementBudgetUsage[];
  pendingCount: number;
  updatedAt: string;
}
export interface ImprovementSummaryParams { projectId?: string }
export interface ImprovementAnalyzeParams { projectId: string }
export interface ImprovementDecideParams { candidateId: string; action: "publish" | "reject" | "snooze" | "rollback"; confirmed: true; editedContent?: string; reason?: string }
export interface ImprovementSettingsUpdateParams { patch: Partial<Omit<ImprovementSettings, "evaluatorAgentId" | "dailyCostUsdLimit">> & { evaluatorAgentId?: string | null; dailyCostUsdLimit?: number | null } }
export interface ImprovementProposeParams { projectId: string; type: "project-rule" | "skill" | "workflow" | "agent-instruction"; scope: "project" | "user" | "agent"; agentProfileId?: string; name: string; content: string; expectedBenefit?: string; risk?: string }
export const improvementExportTargets = ["project-codex", "user-codex", "custom-rux"] as const;
export type ImprovementExportTarget = (typeof improvementExportTargets)[number];
export interface ImprovementExportPreviewParams { assetId: string; target: ImprovementExportTarget; projectId?: string }
export interface ImprovementExportPreview {
  id: string;
  assetId: string;
  target: ImprovementExportTarget;
  engine: "codex" | "rux";
  filePath: string;
  exists: boolean;
  beforeHash?: string;
  afterHash: string;
  diff: string;
  expiresAt: string;
}
export interface ImprovementExportCommitParams { previewId: string; confirmed: true }
export interface ImprovementExportResult { assetId: string; target: ImprovementExportTarget; filePath: string; bytes: number; exportedAt: string }
export interface ImprovementEvaluateParams { candidateId: string; evaluatorAgentId: string; cases: ImprovementEvaluationCase[] }
export interface ImprovementEvaluationRuntimeParams { operationId: string; candidateId: string; projectId: string; candidateContent: string; adapter: "codex" | "claude-code"; evaluatorAgentId: string; evaluatorAgentRevisionId: string; profileId?: string; model?: string; reasoningEffort?: string; evaluatorInstructions?: string; cases: ImprovementEvaluationCase[] }

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
  images?: LocalImageAttachment[];
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
  serviceTier?: string;
  sessionId?: string;
  sessionLink?: NativeSessionLink;
  resumeFrom?: NativeSessionLink;
  resumeFailure?: string;
  profileId?: string;
  agentRevisionId: string;
  providerConnection: ProviderConnectionRef;
  modelSource: ModelSource;
  modelVerificationStatus: ModelVerificationStatus;
  modelDecision?: RunModelDecision;
  tokenUsage?: TokenUsage;
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
  serviceTier?: string;
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
  boardSource?: { projectId: string; requirementItemId: string; createdAt: string };
  improvementAssets?: Array<{ id: string; type: ImprovementCandidateType; name: string; content: string; version: number }>;
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
  persisted: boolean;
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
  "auth.chatgpt.sync": {
    params: Record<string, never>;
    result: ChatGptAccountSyncResult;
  };
  "auth.login": {
    params: AuthLoginParams;
    result: AuthState;
  };
  "auth.logout": {
    params: AuthLogoutParams;
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
  "plugin.list": {
    params: Record<string, never>;
    result: CodexPluginListResult;
  };
  "plugin.install": {
    params: CodexPluginMutationParams;
    result: CodexPluginListResult;
  };
  "plugin.remove": {
    params: CodexPluginMutationParams;
    result: CodexPluginListResult;
  };
  "pullRequest.list": {
    params: Record<string, never>;
    result: PullRequestListResult;
  };
  "externalConfig.detect": {
    params: ExternalConfigDetectParams;
    result: ExternalConfigDetectResult;
  };
  "externalConfig.import": {
    params: ExternalConfigImportParams;
    result: ExternalConfigImportResult;
  };
  "externalConfig.history": {
    params: Record<string, never>;
    result: ExternalConfigHistoryResult;
  };
  "session.list": {
    params: SessionListParams;
    result: SessionListResult;
  };
  "session.discover": {
    params: SessionDiscoverParams;
    result: SessionDiscoverResult;
  };
  "session.attribution.migrate": {
    params: SessionAttributionMigrateParams;
    result: SessionAttributionMigrateResult;
  };
  "session.preview": {
    params: SessionPreviewParams;
    result: SessionPreviewResult;
  };
  "session.import": {
    params: SessionImportParams;
    result: SessionImportResult;
  };
  "session.refresh": { params: SessionRefreshParams; result: SessionRefreshResult };
  "session.rebuild": { params: SessionRebuildParams; result: SessionRefreshResult };
  "session.revision.list": { params: SessionRevisionListParams; result: SessionRevisionListResult };
  "session.revision.restore": { params: SessionRevisionRestoreParams; result: SessionRefreshResult };
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
  "improvement.evaluation.run": { params: ImprovementEvaluationRuntimeParams; result: ImprovementEvaluationRecord };
  "handoff.preview": { params: HandoffPreviewParams; result: HandoffPreviewResult };
  "handoff.commit": { params: HandoffCommitParams; result: HandoffCommitResult };
  "local.data.summary": { params: Record<string, never>; result: LocalDataSummary };
  "local.data.preview": { params: LocalDataPreviewParams; result: LocalDataImpactPreview };
  "local.data.execute": { params: LocalDataExecuteParams; result: LocalDataExecuteResult };
  "local.data.export": { params: LocalDataRuntimeExportParams; result: LocalDataRuntimeExportResult };
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
  "git.worktree.create": {
    params: GitWorktreeCreateParams;
    result: GitWorktreeCreateResult;
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
      type: "run.model-decision";
      runId: string;
      decision: RunModelDecision;
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
      /** Transient invalidation signal; clients re-read authoritative Git/Context state. */
      type: "run.workspace-changed";
      runId: string;
      source: "file-tool" | "command-tool";
      paths: string[];
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
      usage: TokenUsage;
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

export const updatePhases = ["disabled", "idle", "checking", "available", "downloading", "downloaded", "installing", "error"] as const;
export type UpdatePhase = (typeof updatePhases)[number];
export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  channel: string;
  configured: boolean;
  updateVersion?: string;
  progressPercent?: number;
  detail?: string;
  rollbackPending?: boolean;
}

export interface RuxDesktopApi {
  getDesktopInfo(): Promise<DesktopInfo>;
  getWorkspaceState(): Promise<WorkspaceState>;
  chooseWorkspace(): Promise<WorkspaceState | null>;
  chooseContextFiles(): Promise<string[]>;
  saveClipboardImage(params: ClipboardImageSaveParams): Promise<LocalImageAttachment>;
  activateWorkspace(path: string): Promise<WorkspaceState>;
  openWorkspaceLocation(target?: WorkspaceOpenTarget): Promise<WorkspaceOpenResult>;
  setPreventSleep(enabled: boolean): Promise<PreventSleepResult>;
  loadTaskState(workspaceId?: string): Promise<WorkspaceTaskState>;
  saveTaskState(state: WorkspaceTaskState): Promise<TaskStateSaveResult>;
  request<M extends RendererRuntimeMethod>(
    method: M,
    params: RuntimeRequestMap[M]["params"],
  ): Promise<RuntimeRequestMap[M]["result"]>;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
}

export interface PreventSleepResult {
  requested: boolean;
  active: boolean;
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

export const codexServiceTierInfoSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
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
  serviceTiers: z.array(codexServiceTierInfoSchema).max(16).default([]),
  defaultServiceTier: z.string().trim().min(1).max(64).optional(),
}).strict();

export const agentModelListResultSchema = z.object({
  adapter: z.literal("codex"),
  source: z.literal("engine-catalog"),
  fetchedAt: z.iso.datetime(),
  models: z.array(codexModelInfoSchema).max(500),
  nextCursor: z.string().min(1).max(4_096).nullable().optional(),
}).strict();

export const codexPluginIdSchema = z.string().trim().min(3).max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const codexPluginInfoSchema = z.object({
  pluginId: codexPluginIdSchema,
  name: z.string().trim().min(1).max(160),
  marketplaceName: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(120),
  installed: z.boolean(),
  enabled: z.boolean(),
  installPolicy: z.string().trim().min(1).max(80).optional(),
  authPolicy: z.string().trim().min(1).max(80).optional(),
}).strict();

export const codexPluginListResultSchema = z.object({
  source: z.enum(["codex-cli", "web-unavailable"]),
  fetchedAt: z.iso.datetime(),
  installed: z.array(codexPluginInfoSchema).max(1_000),
  available: z.array(codexPluginInfoSchema).max(2_000),
  unavailableReason: z.string().trim().min(1).max(500).optional(),
}).strict();

export const codexPluginMutationParamsSchema = z.object({
  pluginId: codexPluginIdSchema,
  confirmed: z.literal(true),
}).strict();

export const pullRequestInfoSchema = z.object({
  number: z.number().int().positive().max(2_147_483_647),
  title: z.string().trim().min(1).max(500),
  url: z.url().refine((value) => value.startsWith("https://")),
  state: z.enum(["open", "closed", "merged"]),
  isDraft: z.boolean(),
  author: z.string().trim().min(1).max(120).optional(),
  headRefName: z.string().trim().min(1).max(500),
  baseRefName: z.string().trim().min(1).max(500),
  updatedAt: z.iso.datetime(),
  reviewDecision: z.string().trim().min(1).max(120).optional(),
}).strict();

export const pullRequestListResultSchema = z.object({
  source: z.enum(["github-cli", "unavailable", "web-unavailable"]),
  fetchedAt: z.iso.datetime(),
  repository: z.string().trim().min(1).max(300).optional(),
  repositoryUrl: z.url().refine((value) => value.startsWith("https://")).optional(),
  items: z.array(pullRequestInfoSchema).max(100),
  unavailableReason: z.string().trim().min(1).max(500).optional(),
}).strict();

export const externalConfigSourceSchema = z.enum(externalConfigSources);
export const externalConfigItemTypeSchema = z.enum(externalConfigItemTypes);
export const externalConfigDetectParamsSchema = z.object({ source: externalConfigSourceSchema }).strict();
export const externalConfigDetectedItemSchema = z.object({
  id: z.string().min(12).max(160),
  itemType: externalConfigItemTypeSchema,
  description: z.string().trim().min(1).max(1_000),
  scope: z.enum(["user", "workspace"]),
  cwd: z.string().trim().min(1).max(4_096).optional(),
  itemCount: z.number().int().nonnegative().max(10_000),
}).strict();
export const externalConfigConnectorCandidateSchema = z.object({ name: z.string().trim().min(1).max(240), sessionCount: z.number().int().nonnegative().max(100_000), source: z.string().trim().min(1).max(120) }).strict();
export const externalConfigDetectResultSchema = z.object({
  source: externalConfigSourceSchema,
  availability: z.enum(["available", "unavailable", "web-unavailable"]),
  detectionId: z.string().min(12).max(160).optional(),
  detectedAt: z.iso.datetime(),
  items: z.array(externalConfigDetectedItemSchema).max(2_000),
  connectors: z.array(externalConfigConnectorCandidateSchema).max(500),
  unavailableReason: z.string().trim().min(1).max(1_000).optional(),
}).strict();
export const externalConfigImportParamsSchema = z.object({
  source: externalConfigSourceSchema,
  detectionId: z.string().min(12).max(160),
  itemIds: z.array(z.string().min(12).max(160)).min(1).max(2_000),
  confirmed: z.literal(true),
}).strict();
export const externalConfigImportSuccessSchema = z.object({ itemType: externalConfigItemTypeSchema, cwd: z.string().trim().min(1).max(4_096).optional(), target: z.string().trim().min(1).max(4_096).optional(), title: z.string().trim().min(1).max(500).optional() }).strict();
export const externalConfigImportFailureSchema = z.object({ itemType: externalConfigItemTypeSchema, stage: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(2_000), cwd: z.string().trim().min(1).max(4_096).optional() }).strict();
export const externalConfigImportResultSchema = z.object({ importId: z.string().min(1).max(240), source: externalConfigSourceSchema, completedAt: z.iso.datetime(), successes: z.array(externalConfigImportSuccessSchema).max(5_000), failures: z.array(externalConfigImportFailureSchema).max(5_000) }).strict();
export const externalConfigImportHistoryRecordSchema = z.object({ importId: z.string().min(1).max(240), source: externalConfigSourceSchema.optional(), completedAt: z.iso.datetime(), successes: z.array(externalConfigImportSuccessSchema).max(5_000), failures: z.array(externalConfigImportFailureSchema).max(5_000), providerId: z.string().trim().min(1).max(240).optional() }).strict();
export const externalConfigHistoryResultSchema = z.object({ fetchedAt: z.iso.datetime(), records: z.array(externalConfigImportHistoryRecordSchema).max(500), connectors: z.array(externalConfigConnectorCandidateSchema).max(500) }).strict();

export const codexReviewTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommittedChanges") }).strict(),
  z.object({ type: z.literal("baseBranch"), branch: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("commit"), sha: z.string().trim().min(4).max(128).regex(/^[0-9a-f]+$/i), title: z.string().trim().min(1).max(500).optional() }).strict(),
  z.object({ type: z.literal("custom"), instructions: z.string().trim().min(1).max(20_000) }).strict(),
]);

export const runStartParamsSchema = z.object({
  runId: z.string().min(1).max(120),
  adapter: z.enum(runAdapters),
  prompt: z.string().min(1).max(100_000),
  model: z.string().min(1).max(240).optional(),
  modelMode: z.enum(["fixed", "auto"]).default("fixed"),
  modelSource: z.enum(modelSources).optional(),
  modelVerificationStatus: z.enum(modelVerificationStatuses).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  permissionMode: z.enum(permissionModes),
  sessionId: z.string().min(1).max(500).optional(),
  profileId: z.string().min(1).max(120).optional(),
  agentRevisionId: z.string().min(1).max(240),
  providerConnectionId: z.string().min(1).max(240).optional(),
  contextFiles: z.array(z.string().min(1).max(4_096)).max(500).default([]),
  imagePaths: z.array(z.string().min(1).max(4_096)).max(10).default([]),
  conversationHistory: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(100_000),
  }).strict()).max(200).optional(),
  reviewTarget: codexReviewTargetSchema.optional(),
}).strict().superRefine((params, context) => {
  if (params.imagePaths.length && params.adapter !== "codex") {
    context.addIssue({ code: "custom", path: ["imagePaths"], message: "Image attachments require the Codex adapter" });
  }
  if (params.reviewTarget && params.adapter !== "codex") {
    context.addIssue({ code: "custom", path: ["reviewTarget"], message: "Code review requires the Codex adapter" });
  }
  if (params.reviewTarget && params.imagePaths.length) {
    context.addIssue({ code: "custom", path: ["imagePaths"], message: "Code review does not accept image attachments" });
  }
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
const agentProfileModelSchema = z.string().trim().min(1).max(240);
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
const nativeProviderHeaderNameSchema = z.string().trim().min(1).max(120).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/);
const nativeProviderReservedHeaders = new Set(["authorization", "x-api-key", "anthropic-version", "accept", "content-type", "content-length", "host", "connection"]);
const nativeProviderCustomHeadersSchema = z.array(z.object({
  name: nativeProviderHeaderNameSchema,
  value: z.string().min(1).max(16_384).refine((value) => !/[\r\n]/.test(value), "Header value must not contain line breaks"),
}).strict()).max(64).superRefine((headers, context) => {
  const names = new Set<string>();
  headers.forEach((header, index) => {
    const normalized = header.name.toLowerCase();
    if (nativeProviderReservedHeaders.has(normalized)) context.addIssue({ code: "custom", path: [index, "name"], message: `${header.name} is managed by Rux and cannot be overridden` });
    if (names.has(normalized)) context.addIssue({ code: "custom", path: [index, "name"], message: "Custom header names must be unique" });
    names.add(normalized);
  });
});
const nativeProviderBaseUrlSchema = z.url().max(2_048).superRefine((value, context) => {
  const url = new URL(value);
  if (url.username || url.password) context.addIssue({ code: "custom", message: "Base URL must not contain credentials" });
  if (url.search || url.hash) context.addIssue({ code: "custom", message: "Base URL must not contain a query or fragment" });
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
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
  customHeaders: nativeProviderCustomHeadersSchema.optional(),
  impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  confirmed: z.literal(true).optional(),
}).strict();

const nativeProviderConnectionImpactNextSchema = z.object({
  label: z.string().trim().min(1).max(80),
  providerType: z.enum(nativeProviderTypes),
  baseUrl: nativeProviderBaseUrlSchema,
  defaultModel: z.string().trim().min(1).max(160),
  customHeaderNames: z.array(nativeProviderHeaderNameSchema).max(64).optional(),
}).strict();

export const nativeProviderConnectionImpactPreviewParamsSchema = z.object({
  id: nativeProviderConnectionIdSchema,
  action: z.enum(nativeProviderConnectionImpactActions),
  next: nativeProviderConnectionImpactNextSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.action !== "delete" && !value.next) context.addIssue({ code: "custom", path: ["next"], message: "Updated metadata is required" });
  if (value.action === "delete" && value.next) context.addIssue({ code: "custom", path: ["next"], message: "Delete preview must not include replacement metadata" });
});

const nativeProviderCapabilitiesSchema = z.object({
  source: z.literal("provider-report"),
  refreshedAt: z.iso.datetime(),
  perRunModelSelection: z.boolean().optional(),
  reported: z.array(z.string().trim().min(1).max(120)).max(100),
}).strict();

export const nativeProviderConnectionDeleteParamsSchema = z.object({
  id: nativeProviderConnectionIdSchema,
  impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
}).strict();

export const nativeProviderConnectionTestParamsSchema = z.object({ id: nativeProviderConnectionIdSchema }).strict();
export const nativeProviderCredentialMigrationParamsSchema = z.object({ confirmed: z.literal(true) }).strict();

export const nativeProviderRuntimeSyncSchema = z.object({
  connections: z.array(z.object({
    id: nativeProviderConnectionIdSchema,
    label: z.string().min(1).max(80),
    providerType: z.enum(nativeProviderTypes),
    baseUrl: nativeProviderBaseUrlSchema,
    defaultModel: z.string().min(1).max(160),
    apiKey: z.string().min(1).max(16_384),
    customHeaders: nativeProviderCustomHeadersSchema,
    modelCatalog: z.object({
      source: z.literal("provider-models"),
      refreshedAt: z.iso.datetime(),
      models: z.array(z.object({ id: z.string().trim().min(1).max(160), name: z.string().trim().min(1).max(160).optional() }).strict()).max(500),
    }).strict().optional(),
    capabilities: nativeProviderCapabilitiesSchema.optional(),
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

export const sessionAttributionMigrateParamsSchema = z.object({
  identityKey: z.string().regex(/^[a-f0-9]{64}$/),
  expectedPreviousWorkspaceId: z.string().trim().min(1).max(240),
  targetWorkspaceId: z.string().trim().min(1).max(240),
  confirmed: z.literal(true),
}).strict();

export const sessionAttributionMigrateResultSchema = z.object({
  identityKey: z.string().regex(/^[a-f0-9]{64}$/),
  previousWorkspaceId: z.string().trim().min(1).max(240),
  workspaceId: z.string().trim().min(1).max(240),
  workspaceName: z.string().trim().min(1).max(240),
  migratedAt: z.iso.datetime(),
  movedTaskId: z.string().trim().min(1).max(240).optional(),
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
export const autoModelStrategySchema = z.enum(autoModelStrategies);
export const autoModelCandidateSchema = z.object({
  model: z.string().trim().min(1).max(240),
  source: z.enum(autoModelCandidateSources),
}).strict();
export const autoModelPolicySchema = z.object({
  simpleModel: autoModelCandidateSchema,
  complexModel: autoModelCandidateSchema,
  strategy: autoModelStrategySchema,
  fallbackEnabled: z.boolean(),
  allowlist: z.array(autoModelCandidateSchema).min(1).max(100),
}).strict().superRefine((policy, context) => {
  const allowed = new Set(policy.allowlist.map((candidate) => candidate.model));
  if (!allowed.has(policy.simpleModel.model)) {
    context.addIssue({ code: "custom", path: ["simpleModel"], message: "Simple model must be in the Auto allowlist" });
  }
  if (!allowed.has(policy.complexModel.model)) {
    context.addIssue({ code: "custom", path: ["complexModel"], message: "Complex model must be in the Auto allowlist" });
  }
  if (allowed.size !== policy.allowlist.length) {
    context.addIssue({ code: "custom", path: ["allowlist"], message: "Auto allowlist models must be unique" });
  }
});

export const runModelDecisionSchema = z.object({
  id: z.string().trim().min(1).max(240),
  runId: z.string().trim().min(1).max(120),
  mode: z.enum(["fixed", "auto"]),
  classification: z.enum(runModelClassifications),
  actualModel: z.string().trim().min(1).max(240),
  modelSource: modelSourceSchema,
  strategy: autoModelStrategySchema.optional(),
  score: z.number().int().optional(),
  threshold: z.number().int().nonnegative().optional(),
  reasonCodes: z.array(z.string().trim().min(1).max(120)).max(100),
  rationale: z.string().trim().min(1).max(4_000),
  allowlist: z.array(z.string().trim().min(1).max(240)).max(100),
  engine: z.enum(runAdapters),
  providerConnectionId: z.string().trim().min(1).max(240),
  agentRevisionId: agentRevisionIdentifierSchema,
  fallback: z.object({
    fromModel: z.string().trim().min(1).max(240),
    toModel: z.string().trim().min(1).max(240),
    reason: z.string().trim().min(1).max(4_000),
  }).strict().optional(),
  decidedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((decision, context) => {
  if (decision.mode === "fixed" && decision.classification !== "fixed") {
    context.addIssue({ code: "custom", path: ["classification"], message: "Fixed decisions must use the fixed classification" });
  }
  if (decision.mode === "auto" && decision.classification === "fixed") {
    context.addIssue({ code: "custom", path: ["classification"], message: "Auto decisions must classify the Run" });
  }
  if (decision.mode === "auto" && !decision.allowlist.includes(decision.actualModel)) {
    context.addIssue({ code: "custom", path: ["actualModel"], message: "Auto decision must stay inside its allowlist" });
  }
  if (decision.fallback && (decision.fallback.toModel !== decision.actualModel
    || !decision.allowlist.includes(decision.fallback.fromModel)
    || !decision.allowlist.includes(decision.fallback.toModel))) {
    context.addIssue({ code: "custom", path: ["fallback"], message: "Fallback must resolve inside the allowlist to the actual model" });
  }
});

const tokenCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const tokenUsageSchema = z.object({
  source: z.enum(tokenUsageSources),
  scope: z.enum(["task", "router"]),
  aggregation: z.enum(["cumulative", "incremental"]),
  isEstimate: z.boolean(),
  inputTokens: tokenCountSchema.optional(),
  cachedInputTokens: tokenCountSchema.optional(),
  outputTokens: tokenCountSchema.optional(),
  reasoningOutputTokens: tokenCountSchema.optional(),
  totalTokens: tokenCountSchema.optional(),
  reportedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((usage, context) => {
  if (usage.source === "estimate" && !usage.isEstimate) {
    context.addIssue({ code: "custom", path: ["isEstimate"], message: "Estimated usage must be labeled" });
  }
  if (usage.source !== "estimate" && usage.isEstimate) {
    context.addIssue({ code: "custom", path: ["source"], message: "Exact usage cannot use an estimated label" });
  }
  if ([usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.reasoningOutputTokens, usage.totalTokens].every((value) => value === undefined)) {
    context.addIssue({ code: "custom", message: "Token usage must contain at least one reported value" });
  }
});

export const agentProfileInputSchema = z.object({
  name: agentProfileNameSchema,
  description: agentProfileDescriptionSchema.default(""),
  backend: z.enum(agentBackends),
  providerConnection: providerConnectionRefSchema.optional(),
  model: agentProfileModelSchema.optional(),
  modelSource: modelSourceSchema.optional(),
  modelVerificationStatus: modelVerificationStatusSchema.optional(),
  autoModelPolicy: autoModelPolicySchema.optional(),
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
  autoModelPolicy: autoModelPolicySchema.optional(),
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
  autoModelPolicy: autoModelPolicySchema.optional(),
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
  autoModelPolicy: autoModelPolicySchema.nullable().optional(),
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

export const gitWorktreeCreateParamsSchema = z.object({
  path: z.string().trim().min(1).max(4_096),
  branch: gitBranchNameSchema,
  confirmed: z.literal(true),
}).strict();

export const gitWorktreeCreateResultSchema = z.object({
  path: z.string().min(1).max(4_096),
  branch: gitBranchNameSchema,
  headId: gitObjectIdSchema,
  createdBranch: z.boolean(),
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

export const preventSleepParamsSchema = z.object({
  enabled: z.boolean(),
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
  images: z.array(localImageAttachmentSchema).max(10).optional(),
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
  model: z.string().max(240).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  serviceTier: z.string().trim().min(1).max(64).optional(),
  sessionId: z.string().max(500).optional(),
  sessionLink: nativeSessionLinkSchema.optional(),
  resumeFrom: nativeSessionLinkSchema.optional(),
  resumeFailure: z.string().max(16_000).optional(),
  profileId: z.string().max(120).optional(),
  agentRevisionId: agentRevisionIdentifierSchema,
  providerConnection: providerConnectionRefSchema,
  modelSource: modelSourceSchema,
  modelVerificationStatus: modelVerificationStatusSchema,
  modelDecision: runModelDecisionSchema.optional(),
  tokenUsage: tokenUsageSchema.optional(),
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
  if (run.modelDecision) {
    if (run.modelDecision.runId !== run.id) {
      context.addIssue({ code: "custom", path: ["modelDecision", "runId"], message: "Model Decision must match its Run" });
    }
    if (run.modelDecision.engine !== run.adapter
      || run.modelDecision.providerConnectionId !== run.providerConnection.id
      || run.modelDecision.agentRevisionId !== run.agentRevisionId) {
      context.addIssue({ code: "custom", path: ["modelDecision"], message: "Model Decision must stay inside Run Agent, Engine, and Connection boundaries" });
    }
    if (run.model && run.modelDecision.actualModel !== run.model) {
      context.addIssue({ code: "custom", path: ["modelDecision", "actualModel"], message: "Model Decision must match the Run model" });
    }
  }
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
  serviceTier: z.string().trim().min(1).max(64).optional(),
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
  boardSource: z.object({ projectId: persistedWorkspaceIdSchema, requirementItemId: z.string().min(1).max(240), createdAt: persistedIsoDateSchema }).strict().optional(),
  improvementAssets: z.array(z.object({ id: z.string().min(1).max(240), type: z.enum(improvementCandidateTypes), name: z.string().min(1).max(120), content: z.string().min(1).max(100_000), version: z.number().int().min(1) }).strict()).max(64).default([]),
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

export const localDataRuntimeExportParamsSchema = localDataExportParamsSchema.safeExtend({
  destination: z.string().trim().min(1).max(4_096),
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

export const boardStateColumnSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(80),
  order: z.number().int().min(0).max(1_000),
  semanticRole: z.enum(boardSemanticRoles),
}).strict();

export const boardWorkItemSchema = z.object({
  id: z.string().min(1).max(240),
  projectId: persistedWorkspaceIdSchema,
  workspaceId: persistedWorkspaceIdSchema.optional(),
  type: z.enum(boardItemTypes),
  title: z.string().trim().min(1).max(10_000),
  description: z.string().max(100_000),
  stateId: z.string().min(1).max(120),
  priority: z.enum(boardPriorities),
  labels: z.array(z.string().trim().min(1).max(80)).max(64),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(4_000)).max(200),
  linkedTaskId: z.string().min(1).max(240).optional(),
  linkedTaskIds: z.array(z.string().min(1).max(240)).max(2_000),
  automationMode: z.enum(["automatic", "manual"]),
  agent: z.string().min(1).max(240).optional(),
  model: z.string().min(1).max(240).optional(),
  branch: z.string().max(1_000).optional(),
  taskStatus: z.enum(persistedTaskStatuses).optional(),
  latestRunStatus: z.enum(persistedRunStatuses).optional(),
  pendingApprovals: z.number().int().min(0).max(10_000).optional(),
  createdAt: persistedIsoDateSchema,
  updatedAt: persistedIsoDateSchema,
}).strict().superRefine((item, context) => {
  if (item.type === "task" && (!item.linkedTaskId || item.linkedTaskIds.length !== 1 || item.linkedTaskIds[0] !== item.linkedTaskId)) {
    context.addIssue({ code: "custom", path: ["linkedTaskId"], message: "Task board items must bind exactly one matching Task" });
  }
  if (item.type === "task" && !item.workspaceId) {
    context.addIssue({ code: "custom", path: ["workspaceId"], message: "Task board items must retain their WorkingCopy Workspace" });
  }
  if (item.type === "requirement" && item.linkedTaskId) {
    context.addIssue({ code: "custom", path: ["linkedTaskId"], message: "Requirement items use linkedTaskIds only" });
  }
});

export const boardTransitionSchema = z.object({
  id: z.string().min(1).max(240),
  workItemId: z.string().min(1).max(240),
  fromStateId: z.string().min(1).max(120).optional(),
  toStateId: z.string().min(1).max(120),
  source: z.enum(["user", "run-rule"]),
  runId: z.string().min(1).max(240).optional(),
  createdAt: persistedIsoDateSchema,
}).strict();

export const boardSnapshotSchema = z.object({
  version: z.literal(1),
  projectId: persistedWorkspaceIdSchema,
  revision: z.number().int().min(0),
  enabled: z.boolean(),
  states: z.array(boardStateColumnSchema).min(4).max(64),
  items: z.array(boardWorkItemSchema).max(20_000),
  transitions: z.array(boardTransitionSchema).max(100_000),
  updatedAt: persistedIsoDateSchema,
}).strict().superRefine((board, context) => {
  const stateIds = new Set(board.states.map((state) => state.id));
  const itemIds = new Set<string>();
  const taskIds = new Set<string>();
  board.items.forEach((item, index) => {
    if (item.projectId !== board.projectId) context.addIssue({ code: "custom", path: ["items", index, "projectId"], message: "Board item Project must match Board" });
    if (!stateIds.has(item.stateId)) context.addIssue({ code: "custom", path: ["items", index, "stateId"], message: "Board item state is missing" });
    if (itemIds.has(item.id)) context.addIssue({ code: "custom", path: ["items", index, "id"], message: "Board item id must be unique" });
    itemIds.add(item.id);
    if (item.linkedTaskId) {
      if (taskIds.has(item.linkedTaskId)) context.addIssue({ code: "custom", path: ["items", index, "linkedTaskId"], message: "A Task may have only one Task card" });
      taskIds.add(item.linkedTaskId);
    }
  });
});

const boardLabelListSchema = z.array(z.string().trim().min(1).max(80)).max(64);
const boardCriteriaListSchema = z.array(z.string().trim().min(1).max(4_000)).max(200);
const boardTaskIdListSchema = z.array(z.string().min(1).max(240)).max(2_000);
export const boardMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-enabled"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("create-requirement"), title: z.string().trim().min(1).max(10_000), description: z.string().max(100_000).optional(), priority: z.enum(boardPriorities).optional(), labels: boardLabelListSchema.optional(), acceptanceCriteria: boardCriteriaListSchema.optional(), linkedTaskIds: boardTaskIdListSchema.optional() }).strict(),
  z.object({ action: z.literal("update-requirement"), itemId: z.string().min(1).max(240), title: z.string().trim().min(1).max(10_000).optional(), description: z.string().max(100_000).optional(), priority: z.enum(boardPriorities).optional(), labels: boardLabelListSchema.optional(), acceptanceCriteria: boardCriteriaListSchema.optional(), linkedTaskIds: boardTaskIdListSchema.optional() }).strict(),
  z.object({ action: z.literal("move-item"), itemId: z.string().min(1).max(240), stateId: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal("delete-requirement"), itemId: z.string().min(1).max(240) }).strict(),
  z.object({ action: z.literal("create-state"), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ action: z.literal("rename-state"), stateId: z.string().min(1).max(120), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ action: z.literal("reorder-states"), stateIds: z.array(z.string().min(1).max(120)).min(4).max(64) }).strict(),
]);
export const boardLoadParamsSchema = z.object({ projectId: persistedWorkspaceIdSchema }).strict();
export const boardMutationParamsSchema = z.object({ projectId: persistedWorkspaceIdSchema, expectedRevision: z.number().int().min(0), mutation: boardMutationSchema }).strict();
export const projectWorkingCopiesParamsSchema = z.object({ projectId: persistedWorkspaceIdSchema }).strict();
export const projectWorkingCopyAuthorizeParamsSchema = z.object({ projectId: persistedWorkspaceIdSchema, path: z.string().min(1).max(4_096), confirmed: z.literal(true) }).strict();
export const projectWorkingCopyCreateParamsSchema = gitWorktreeCreateParamsSchema.extend({ projectId: persistedWorkspaceIdSchema }).strict();
export const improvementSummaryParamsSchema = z.object({ projectId: persistedWorkspaceIdSchema.optional() }).strict();
export const improvementAnalyzeParamsSchema = z.object({ projectId: persistedWorkspaceIdSchema }).strict();
export const improvementDecideParamsSchema = z.object({ candidateId: z.string().min(1).max(240), action: z.enum(["publish", "reject", "snooze", "rollback"]), confirmed: z.literal(true), editedContent: z.string().max(100_000).optional(), reason: z.string().max(4_000).optional() }).strict();
export const improvementSettingsUpdateParamsSchema = z.object({ patch: z.object({ evidenceCollection: z.boolean().optional(), candidateGeneration: z.boolean().optional(), controlledEvolution: z.boolean().optional(), backgroundModelReview: z.boolean().optional(), paused: z.boolean().optional(), dailyTokenLimit: z.number().int().min(0).max(100_000_000).optional(), perProjectTokenLimit: z.number().int().min(0).max(100_000_000).optional(), evaluationTokenReservation: z.number().int().min(1_000).max(1_000_000).optional(), evaluationCostReservationUsd: z.number().min(0).max(1_000_000).optional(), dailyCostUsdLimit: z.number().min(0).max(1_000_000).nullable().optional(), onlyWhenIdle: z.boolean().optional(), onlyOnAcPower: z.boolean().optional(), evaluatorAgentId: z.string().min(1).max(120).nullable().optional() }).strict() }).strict();
export const improvementProposeParamsSchema = z.object({ projectId: persistedWorkspaceIdSchema, type: z.enum(improvementCandidateTypes), scope: z.enum(["project", "user", "agent"]), agentProfileId: z.string().min(1).max(120).optional(), name: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(100_000), expectedBenefit: z.string().max(4_000).optional(), risk: z.string().max(4_000).optional() }).strict().superRefine((value, context) => {
  if (value.type === "agent-instruction" && (value.scope !== "agent" || !value.agentProfileId)) context.addIssue({ code: "custom", path: ["agentProfileId"], message: "Agent instruction candidates require an Agent scope and Profile" });
  if (value.type !== "agent-instruction" && value.scope === "agent") context.addIssue({ code: "custom", path: ["scope"], message: "Only Agent instruction candidates use Agent scope" });
});
export const improvementExportPreviewParamsSchema = z.object({ assetId: z.string().min(1).max(240), target: z.enum(improvementExportTargets), projectId: persistedWorkspaceIdSchema.optional() }).strict();
export const improvementExportCommitParamsSchema = z.object({ previewId: z.string().min(1).max(240), confirmed: z.literal(true) }).strict();
export const improvementEvaluationCaseSchema = z.object({ id: z.string().min(1).max(120), name: z.string().trim().min(1).max(120), input: z.string().min(1).max(20_000), expectedIncludes: z.string().min(1).max(2_000), holdout: z.boolean() }).strict();
export const improvementEvaluateParamsSchema = z.object({ candidateId: z.string().min(1).max(240), evaluatorAgentId: z.string().min(1).max(120), cases: z.array(improvementEvaluationCaseSchema).min(1).max(10) }).strict().superRefine((value, context) => { if (!value.cases.some((item) => item.holdout)) context.addIssue({ code: "custom", path: ["cases"], message: "At least one holdout case is required" }); });
export const improvementEvaluationRuntimeParamsSchema = z.object({ operationId: z.string().min(1).max(240), candidateId: z.string().min(1).max(240), projectId: persistedWorkspaceIdSchema, candidateContent: z.string().min(1).max(100_000), adapter: z.enum(["codex", "claude-code"]), evaluatorAgentId: z.string().min(1).max(120), evaluatorAgentRevisionId: z.string().min(1).max(240), profileId: z.string().min(1).max(120).optional(), model: z.string().min(1).max(240).optional(), reasoningEffort: reasoningEffortSchema.optional(), evaluatorInstructions: z.string().max(20_000).optional(), cases: z.array(improvementEvaluationCaseSchema).min(1).max(10) }).strict();
export const improvementEvaluationOutcomeSchema = z.object({ caseId: z.string().min(1).max(120), variant: z.enum(["baseline", "candidate"]), passed: z.boolean(), outputPreview: z.string().max(2_000), durationMs: z.number().int().nonnegative(), tokens: z.number().int().nonnegative().optional() }).strict();
export const improvementEvaluationRecordSchema = z.object({ id: z.string().min(1).max(240), candidateId: z.string().min(1).max(240), projectId: persistedWorkspaceIdSchema, status: z.enum(["passed", "failed", "unknown"]), evaluatorAgentId: z.string().min(1).max(120), evaluatorAgentRevisionId: z.string().min(1).max(240), evaluatorAdapter: z.enum(["codex", "claude-code"]), model: z.string().max(240).optional(), cases: z.array(improvementEvaluationCaseSchema).min(1).max(10), outcomes: z.array(improvementEvaluationOutcomeSchema).min(2).max(20), baselinePassed: z.number().int().nonnegative(), candidatePassed: z.number().int().nonnegative(), holdoutPassed: z.boolean(), totalTokens: z.number().int().nonnegative().optional(), tokenSource: z.enum(["engine", "unreported"]), costUsd: z.number().nonnegative().optional(), costSource: z.enum(["engine", "unreported"]), createdAt: z.iso.datetime({ offset: true }) }).strict();

export const taskStateLoadParamsSchema = z.object({
  workspaceId: persistedWorkspaceIdSchema.optional(),
}).strict();
