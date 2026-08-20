import { changedFiles } from "./data.js";
import { builtInAgentRevisionId } from "./shared/protocol.ts";

const delay = (fn, duration) => window.setTimeout(fn, duration);
const webSnapshotId = "f".repeat(64);
const showcasePreview = new URLSearchParams(window.location.search).get("showcase") === "codex";

const webAuthState = () => ({
  checkedAt: new Date().toISOString(),
  providers: [
    {
      id: "claude-code",
      name: "Claude Code",
      cliName: "claude",
      status: "not-installed",
      installed: false,
      canLogin: false,
      detail: "仅 Rux 桌面应用可使用本机 CLI",
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      cliName: "codex",
      status: "not-installed",
      installed: false,
      canLogin: false,
      detail: "仅 Rux 桌面应用可使用本机 CLI",
    },
  ],
});

function normalizeRunArguments(options, emit) {
  if (typeof options === "function") {
    return {
      options: {
        adapter: "mock",
        permissionMode: "acceptEdits",
        agentRevisionId: builtInAgentRevisionId("mock"),
      },
      emit: options,
    };
  }
  const adapter = options?.adapter || "mock";
  return {
    options: {
      adapter,
      permissionMode: options?.permissionMode || "acceptEdits",
      model: options?.model,
      modelMode: options?.modelMode || "fixed",
      modelSource: options?.modelSource,
      modelVerificationStatus: options?.modelVerificationStatus,
      reasoningEffort: options?.reasoningEffort,
      sessionId: options?.sessionId,
      profileId: options?.profileId,
      agentRevisionId: options?.agentRevisionId || builtInAgentRevisionId(adapter),
      providerConnectionId: options?.providerConnectionId,
      contextFiles: options?.contextFiles,
      imagePaths: options?.imagePaths,
      conversationHistory: options?.conversationHistory,
    },
    emit,
  };
}

export function createMockRuntime() {
  const activeRuns = new Map();

  const startMockRun = (record) => {
    const { runId, prompt, options, emit, timers } = record;
    emit({
      type: "run.started",
      runId,
      adapter: "mock",
      prompt,
      permissionMode: options.permissionMode,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      profileId: options.profileId,
      agentRevisionId: options.agentRevisionId,
    });
    timers.push(delay(() => emit({
      type: "activity.started",
      runId,
      activity: {
        id: `${runId}-inspect`,
        kind: "read",
        title: "理解新的任务要求",
        detail: "正在检查 Workspace context 与相关文件",
        state: "active",
      },
    }), 450));
    timers.push(delay(() => emit({
      type: "activity.completed",
      runId,
      activity: {
        id: `${runId}-inspect`,
        kind: "read",
        title: "理解新的任务要求",
        detail: "已完成 Web Preview 演示",
        state: "done",
      },
    }), 1_100));
    timers.push(delay(() => {
      emit({
        type: "assistant.message",
        runId,
        text: "当前是浏览器预览。请运行桌面版 Rux 以使用真实 Rux。",
      });
      emit({ type: "run.completed", runId, durationMs: 1_800, turns: 1 });
      activeRuns.delete(runId);
    }, 1_800));
  };

  const cancelMockRun = (runId) => {
    const record = activeRuns.get(runId);
    if (!record) return;
    record.timers.forEach(window.clearTimeout);
    activeRuns.delete(runId);
    if (record.request) {
      record.emit({
        type: "permission.decided",
        runId,
        decision: {
          id: `permission-decision-${Date.now()}`,
          requestId: record.request.id,
          runId,
          decision: "cancelled",
          source: "user",
          decidedAt: new Date().toISOString(),
        },
      });
    }
    record.emit({ type: "run.cancelled", runId });
  };

  return {
    async listAgents() {
      return {
        adapters: [
          { id: "mock", name: "Rux Demo", available: true, version: "web-preview" },
          { id: "claude-code", name: "Claude Code", available: false, detail: "仅桌面应用可用" },
          { id: "codex", name: "Codex", available: new URLSearchParams(window.location.search).get("showcase") === "codex", detail: "仅桌面应用可真实运行" },
        ],
      };
    },

    async authStatus() {
      return webAuthState();
    },

    async syncChatGptAccount() {
      return {
        status: showcasePreview ? "connected" : "unsupported",
        ...(showcasePreview ? { accountType: "chatgpt", planType: "plus", usedPercent: 71, remainingPercent: 29 } : {}),
        syncedAt: new Date().toISOString(),
      };
    },

    async listAgentModels() {
      const models = showcasePreview ? [
        { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "Highest capability", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }, { reasoningEffort: "high", description: "Deeper" }] },
        { id: "gpt-5.6-terra", model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", description: "Balanced", isDefault: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }] },
        { id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", description: "Fast", isDefault: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }] },
      ] : [];
      return { adapter: "codex", source: "engine-catalog", fetchedAt: new Date().toISOString(), models, nextCursor: null };
    },

    async discoverSessions() {
      throw new Error("会话发现仅在 Rux 桌面应用中可用");
    },

    async previewSession() {
      throw new Error("会话预览仅在 Rux 桌面应用中可用");
    },

    async importSession() {
      throw new Error("会话导入仅在 Rux 桌面应用中可用");
    },

    async migrateSessionAttribution() {
      throw new Error("会话归属迁移仅在 Rux 桌面应用中可用");
    },

    async refreshSession() { throw new Error("会话刷新仅在 Rux 桌面应用中可用"); },
    async rebuildSession() { throw new Error("会话重建仅在 Rux 桌面应用中可用"); },
    async listSessionRevisions() { throw new Error("会话版本仅在 Rux 桌面应用中可用"); },
    async restoreSessionRevision() { throw new Error("会话版本恢复仅在 Rux 桌面应用中可用"); },
    async previewHandoff() { throw new Error("Context Handoff 仅在 Rux 桌面应用中可用"); },
    async generateHandoffSummary() { throw new Error("Context Handoff 摘要生成仅在 Rux 桌面应用中可用"); },
    async commitHandoff() { throw new Error("Context Handoff 仅在 Rux 桌面应用中可用"); },
    async getLocalDataSummary() { throw new Error("本地数据管理仅在 Rux 桌面应用中可用"); },
    async previewLocalData() { throw new Error("本地数据管理仅在 Rux 桌面应用中可用"); },
    async executeLocalData() { throw new Error("本地数据管理仅在 Rux 桌面应用中可用"); },
    async exportLocalData() { throw new Error("本地数据导出仅在 Rux 桌面应用中可用"); },

    async cancelSessionDiscovery() {
      return { ok: true };
    },

    async login() {
      throw new Error("Rux 登录仅在 Rux 桌面应用中可用");
    },

    async logout() {
      throw new Error("退出 Agent 登录仅在 Rux 桌面应用中可用");
    },

    async listAgentProfiles() {
      return { profiles: [] };
    },

    async createAgentProfile() {
      throw new Error("自定义 Agent 仅在 Rux 桌面应用中可用");
    },

    async updateAgentProfile() {
      throw new Error("自定义 Agent 仅在 Rux 桌面应用中可用");
    },

    async deleteAgentProfile() {
      throw new Error("自定义 Agent 仅在 Rux 桌面应用中可用");
    },

    async listProviderConnections() { return []; },
    async previewProviderConnectionImpact() { throw new Error("原生 Provider 仅在 Rux 桌面应用中可用"); },
    async saveProviderConnection() { throw new Error("原生 Provider 仅在 Rux 桌面应用中可用"); },
    async deleteProviderConnection() { throw new Error("原生 Provider 仅在 Rux 桌面应用中可用"); },
    async testProviderConnection() { throw new Error("原生 Provider 仅在 Rux 桌面应用中可用"); },
    async getProviderCredentialDiagnostics() { return { status: "empty", storageBackend: "web-unavailable", encryptionAvailable: false, connectionCount: 0, decryptableCount: 0, failedConnectionLabels: [], checkedAt: new Date().toISOString(), migrationAvailable: false, detail: "浏览器预览不提供操作系统安全存储" }; },
    async migrateProviderCredentials() { throw new Error("凭据迁移仅在 Rux 桌面应用中可用"); },
    async getLocalProductEventSummary() { return { storage: "main-local-only", totalEvents: 0, counts: { "cli-detection": 0, "run-succeeded": 0, "run-failed": 0, "restart-recovery": 0, "session-imported": 0, "session-import-deduplicated": 0, "session-continued": 0, "task-branched": 0, "error-recovery-attempted": 0, "error-recovered": 0 } }; },
    async getUpdateState() { return { phase: "disabled", currentVersion: "web", channel: "stable", configured: false, detail: "应用更新仅在已签名桌面包中可用" }; },
    async checkForUpdates() { return this.getUpdateState(); },
    async downloadUpdate() { throw new Error("应用更新仅在已签名桌面包中可用"); },
    async installUpdate() { throw new Error("应用更新仅在已签名桌面包中可用"); },
    async confirmUpdateHealthy() { return this.getUpdateState(); },

    async listChanges() {
      const previewFiles = showcasePreview ? changedFiles : [];
      const totals = previewFiles.reduce((result, file) => ({
        files: result.files + 1,
        additions: result.additions + file.additions,
        deletions: result.deletions + file.deletions,
        binaryFiles: result.binaryFiles,
      }), { files: 0, additions: 0, deletions: 0, binaryFiles: 0 });
      return {
        workspaceRoot: "Web Preview",
        snapshotId: webSnapshotId,
        files: previewFiles,
        totals,
      };
    },

    async getFileDiff(path) {
      const file = (showcasePreview ? changedFiles : []).find((item) => item.path === path);
      if (!file) throw new Error("找不到这个演示文件");
      return {
        workspaceRoot: "Web Preview",
        snapshotId: webSnapshotId,
        path,
        sections: [{
          layer: "unstaged",
          patch: `@@ -1,3 +1,4 @@\n export function AdminApp() {\n+  syncTabWithUrl();\n   return <main />;\n }`,
        }],
      };
    },

    async previewRestore() {
      throw new Error("Restore 仅在 Rux 桌面应用中可用");
    },

    async restoreChanges() {
      throw new Error("Restore 仅在 Rux 桌面应用中可用");
    },

    async acceptChanges() {
      throw new Error("变更审查仅在 Rux 桌面应用中可用");
    },

    async listGitBranches() {
      return {
        workspaceRoot: "Web Preview",
        currentBranch: null,
        headId: null,
        detached: false,
        local: [],
        remote: [],
        comparable: [],
      };
    },

    async switchGitBranch() {
      throw new Error("分支切换仅在 Rux 桌面应用中可用");
    },

    async commitGit() {
      throw new Error("Git commit 仅在 Rux 桌面应用中可用");
    },

    async pushGit() {
      throw new Error("Git push 仅在 Rux 桌面应用中可用");
    },

    async compareGit() {
      throw new Error("分支比较仅在 Rux 桌面应用中可用");
    },

    async getRunFileDiff() {
      throw new Error("Run-owned Diff 仅在 Rux 桌面应用中可用");
    },

    async acceptRunChanges() {
      throw new Error("Run-owned 变更审查仅在 Rux 桌面应用中可用");
    },

    async previewRunRestore() {
      throw new Error("Run-owned Restore 仅在 Rux 桌面应用中可用");
    },

    async restoreRunChanges() {
      throw new Error("Run-owned Restore 仅在 Rux 桌面应用中可用");
    },

    async contextSnapshot(selectedFiles = []) {
      return {
        workspaceRoot: "Web Preview",
        generatedAt: new Date().toISOString(),
        instructions: [],
        selectedFiles: selectedFiles.map((path) => ({ path, kind: "selected-file", bytes: 0, exists: false })),
        capabilities: ["Web Preview"],
      };
    },

    run(prompt, options, emitArgument) {
      const normalized = normalizeRunArguments(options, emitArgument);
      const emit = normalized.emit;
      const runId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timers = [];
      const record = { runId, prompt, options: normalized.options, emit, timers, request: null };
      activeRuns.set(runId, record);
      if (normalized.options.permissionMode === "acceptEdits") {
        const requestedAt = new Date().toISOString();
        record.request = {
          id: `permission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          runId,
          action: "workspace.write",
          scope: { kind: "workspace", path: "Web Preview", appliesTo: "this-run" },
          impact: "允许此演示 Run 修改预览 Workspace；真实权限仅在桌面 Runtime 生效。",
          requestedAt,
          status: "pending",
        };
        emit({
          type: "permission.requested",
          runId,
          adapter: "mock",
          prompt,
          permissionMode: "acceptEdits",
          model: normalized.options.model,
          modelMode: normalized.options.modelMode,
          reasoningEffort: normalized.options.reasoningEffort,
          profileId: normalized.options.profileId,
          agentRevisionId: normalized.options.agentRevisionId,
          contextFiles: normalized.options.contextFiles || [],
          request: record.request,
        });
      } else {
        startMockRun(record);
      }
      return { runId, cancel: () => cancelMockRun(runId) };
    },

    async decidePermission(runId, requestId, decision, emit) {
      const record = activeRuns.get(runId);
      if (!record || !record.request || record.request.id !== requestId) {
        throw new Error("Permission request is no longer pending");
      }
      if (emit) record.emit = emit;
      record.emit({
        type: "permission.decided",
        runId,
        decision: {
          id: `permission-decision-${Date.now()}`,
          requestId,
          runId,
          decision,
          source: "user",
          decidedAt: new Date().toISOString(),
        },
      });
      record.request = null;
      if (decision === "denied") {
        activeRuns.delete(runId);
        record.emit({ type: "run.cancelled", runId });
        return { ok: true, state: "cancelled" };
      }
      startMockRun(record);
      return { ok: true, state: "running" };
    },

    async cancelRun(runId, emit) {
      if (emit && activeRuns.has(runId)) activeRuns.get(runId).emit = emit;
      cancelMockRun(runId);
      return { ok: true };
    },

    dispose() {
      for (const record of activeRuns.values()) record.timers.forEach(window.clearTimeout);
      activeRuns.clear();
    },
  };
}

function createDesktopRuntime(api) {
  const activeRuns = new Map();

  const unsubscribe = api.onRuntimeEvent((event) => {
    if (event.type === "runtime.stopped") {
      for (const [runId, emit] of activeRuns) {
        emit({ type: "run.failed", runId, error: "Rux Runtime 已停止" });
      }
      activeRuns.clear();
      return;
    }

    if (!("runId" in event)) return;
    const emit = activeRuns.get(event.runId);
    if (!emit) return;
    emit(event);
    if (["run.completed", "run.cancelled", "run.failed"].includes(event.type)) {
      activeRuns.delete(event.runId);
    }
  });

  return {
    listAgents(params = {}) {
      return api.request("agent.list", params);
    },

    listAgentModels(params = { adapter: "codex" }) {
      return api.request("agent.model.list", params);
    },

    discoverSessions(params) {
      return api.request("session.discover", params);
    },

    previewSession(params) {
      return api.request("session.preview", params);
    },

    importSession(params) {
      return api.importSession(params);
    },

    migrateSessionAttribution(params) {
      return api.migrateSessionAttribution(params);
    },

    refreshSession(params) { return api.refreshSession(params); },
    rebuildSession(params) { return api.rebuildSession(params); },
    listSessionRevisions(params) { return api.listSessionRevisions(params); },
    restoreSessionRevision(params) { return api.restoreSessionRevision(params); },
    previewHandoff(params) { return api.previewHandoff(params); },
    generateHandoffSummary(params) { return api.generateHandoffSummary(params); },
    commitHandoff(params) { return api.commitHandoff(params); },
    getLocalDataSummary() { return api.getLocalDataSummary(); },
    previewLocalData(params) { return api.previewLocalData(params); },
    executeLocalData(params) { return api.executeLocalData(params); },
    exportLocalData(params) { return api.exportLocalData(params); },

    cancelSessionDiscovery(operationId) {
      return api.request("session.cancel", { operationId });
    },

    authStatus() {
      return api.request("auth.status", {});
    },

    syncChatGptAccount() {
      return api.request("auth.chatgpt.sync", {});
    },

    login(provider) {
      return api.request("auth.login", { provider });
    },

    logout(provider) {
      return api.request("auth.logout", { provider });
    },

    cancelLogin(provider) {
      return api.request("auth.cancel", { provider });
    },

    listAgentProfiles() {
      return api.request("agent.profile.list", {});
    },

    createAgentProfile(profile) {
      return api.request("agent.profile.create", profile);
    },

    updateAgentProfile(id, patch) {
      return api.request("agent.profile.update", { id, patch });
    },

    deleteAgentProfile(id) {
      return api.request("agent.profile.delete", { id });
    },

    listProviderConnections() { return api.listProviderConnections(); },
    previewProviderConnectionImpact(params) { return api.previewProviderConnectionImpact(params); },
    saveProviderConnection(input) { return api.saveProviderConnection(input); },
    deleteProviderConnection(params) { return api.deleteProviderConnection(params); },
    testProviderConnection(id) { return api.testProviderConnection({ id }); },
    getProviderCredentialDiagnostics() { return api.getProviderCredentialDiagnostics(); },
    migrateProviderCredentials() { return api.migrateProviderCredentials({ confirmed: true }); },
    getLocalProductEventSummary() { return api.getLocalProductEventSummary(); },
    getUpdateState() { return api.getUpdateState(); },
    checkForUpdates() { return api.checkForUpdates(); },
    downloadUpdate() { return api.downloadUpdate(); },
    installUpdate() { return api.installUpdate(); },
    confirmUpdateHealthy() { return api.confirmUpdateHealthy(); },

    listChanges() {
      return api.request("changes.list", {});
    },

    getFileDiff(path, expectedSnapshotId) {
      return api.request("changes.diff", { path, expectedSnapshotId });
    },

    previewRestore(selection) {
      return api.request("changes.previewRestore", selection);
    },

    restoreChanges(request) {
      return api.request("changes.restore", request);
    },

    acceptChanges(selection) {
      return api.request("changes.accept", selection);
    },

    listGitBranches() {
      return api.request("git.branches.list", {});
    },

    switchGitBranch(request) {
      return api.request("git.branch.switch", request);
    },

    commitGit(request) {
      return api.request("git.commit", request);
    },

    pushGit(request) {
      return api.request("git.push", request);
    },

    compareGit(request) {
      return api.request("git.compare", request);
    },

    getRunFileDiff(request) {
      return api.request("run.changes.diff", request);
    },

    acceptRunChanges(selection) {
      return api.request("run.changes.accept", selection);
    },

    previewRunRestore(selection) {
      return api.request("run.changes.previewRestore", selection);
    },

    restoreRunChanges(request) {
      return api.request("run.changes.restore", request);
    },

    contextSnapshot(selectedFiles = []) {
      return api.request("context.snapshot", { selectedFiles });
    },

    decidePermission(runId, requestId, decision, emit) {
      if (emit) activeRuns.set(runId, emit);
      return api.request("permission.decide", { runId, requestId, decision }).catch((error) => {
        const listener = activeRuns.get(runId);
        if (listener) {
          listener({ type: "run.failed", runId, error: error instanceof Error ? error.message : String(error) });
          activeRuns.delete(runId);
        }
        throw error;
      });
    },

    cancelRun(runId, emit) {
      if (emit) activeRuns.set(runId, emit);
      return api.request("run.cancel", { runId });
    },

    run(prompt, options, emitArgument) {
      const normalized = normalizeRunArguments(options, emitArgument);
      const runId = globalThis.crypto?.randomUUID?.()
        ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      activeRuns.set(runId, normalized.emit);

      void api.request("run.start", {
        runId,
        adapter: normalized.options.adapter,
        prompt,
        permissionMode: normalized.options.permissionMode,
        ...(normalized.options.model ? { model: normalized.options.model } : {}),
        modelMode: normalized.options.modelMode,
        ...(normalized.options.modelSource ? { modelSource: normalized.options.modelSource } : {}),
        ...(normalized.options.modelVerificationStatus ? { modelVerificationStatus: normalized.options.modelVerificationStatus } : {}),
        ...(normalized.options.reasoningEffort ? { reasoningEffort: normalized.options.reasoningEffort } : {}),
        ...(normalized.options.sessionId ? { sessionId: normalized.options.sessionId } : {}),
        ...(normalized.options.profileId ? { profileId: normalized.options.profileId } : {}),
        agentRevisionId: normalized.options.agentRevisionId,
        providerConnectionId: normalized.options.providerConnectionId,
        ...(normalized.options.contextFiles?.length ? { contextFiles: normalized.options.contextFiles } : {}),
        ...(normalized.options.imagePaths?.length ? { imagePaths: normalized.options.imagePaths } : {}),
        ...(normalized.options.conversationHistory?.length ? { conversationHistory: normalized.options.conversationHistory } : {}),
      }).catch((error) => {
        const emit = activeRuns.get(runId);
        if (!emit) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isSessionModelSwitchRestriction = /Native Session .*按 Run 切换模型/.test(errorMessage);
        emit({
          type: "run.failed",
          runId,
          error: errorMessage,
          ...(normalized.options.sessionId && !isSessionModelSwitchRestriction
            ? { resumeSessionId: normalized.options.sessionId }
            : {}),
        });
        activeRuns.delete(runId);
      });

      const cancel = () => {
        if (!activeRuns.has(runId)) return;
        void api.request("run.cancel", { runId }).catch((error) => {
          const emit = activeRuns.get(runId);
          if (!emit) return;
          emit({ type: "run.failed", runId, error: error instanceof Error ? error.message : String(error) });
          activeRuns.delete(runId);
        });
      };
      return { runId, cancel };
    },

    dispose() {
      for (const runId of activeRuns.keys()) {
        void api.request("run.cancel", { runId }).catch(() => undefined);
      }
      activeRuns.clear();
      unsubscribe();
    },
  };
}

export function createRuntimeClient() {
  return window.rux ? createDesktopRuntime(window.rux) : createMockRuntime();
}
