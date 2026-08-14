import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  AtSign,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  Box,
  Braces,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleHelp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  Folder,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitPullRequest,
  Globe2,
  History,
  LayoutList,
  Laptop,
  Link2,
  ListFilter,
  LoaderCircle,
  LogIn,
  Menu,
  MessageSquare,
  Maximize2,
  Mic,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelsTopLeft,
  PencilLine,
  PictureInPicture2,
  Pin,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  Search,
  Share2,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Square,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRound,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  initialTasks,
  workspaces,
} from "./data.js";
import { createRuntimeClient } from "./runtime.js";
import { TerminalView } from "./TerminalView.jsx";
import {
  catalogModelMissing,
  modelSelectionState,
  modelStateAfterRun,
  verifiedModelHistory,
} from "./model-state.js";
import {
  createNativeSessionLink,
  latestCompatibleSessionLink,
  resumeFailureForTask,
} from "./session-link.js";
import { mergeTokenUsage, tokenUsageTotal } from "./token-usage-state.js";
import {
  agentRevisionIdFor,
  builtInAgentRevisionId,
  defaultModelState,
  defaultProviderConnectionForAdapter,
} from "./shared/protocol.ts";

const showcaseMode = !window.rux
  && new URLSearchParams(window.location.search).get("showcase") === "codex";

const statusLabel = {
  running: "运行中",
  blocked: "等待权限",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  waiting: "待开始",
  stopped: "已停止",
};

function sessionDiscoveryErrorMessage(error, engine) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SESSION_CAPABILITY_UNAVAILABLE")) {
    return engine === "claude-code"
      ? "本机 Claude Agent SDK 尚未提供会话浏览能力。Rux 不会改读 Claude Code 内部 Transcript；安装受支持 SDK 后可重试。"
      : "当前 Rux CLI 不支持会话浏览接口，请更新官方 CLI 后重试。";
  }
  if (message.includes("SESSION_CANCELLED")) return "会话查找已取消。";
  if (message.includes("SESSION_TIMEOUT")) return "会话查找超时，请稍后重试。";
  if (message.includes("SESSION_WORKSPACE_UNAUTHORIZED")) return "当前项目不在 Runtime 的授权 Workspace 集合中，请重新打开项目。";
  const normalized = message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
  return normalized.replace(/^SESSION_[A-Z_]+:\s*/, "") || "无法查找 Agent 会话。";
}

const welcomeWorkspace = {
  id: "welcome",
  name: "选择项目",
  path: "",
  branch: "—",
  tone: "ink",
  placeholder: true,
  lastOpenedAt: new Date().toISOString(),
};

const fallbackWorkspaceState = showcaseMode
  ? {
      active: {
        ...workspaces[0],
        lastOpenedAt: new Date().toISOString(),
      },
      recent: workspaces.map((workspace) => ({
        ...workspace,
        lastOpenedAt: new Date().toISOString(),
      })),
    }
  : {
      active: welcomeWorkspace,
      recent: [welcomeWorkspace],
    };

const fallbackAdapters = [
  { id: "codex", name: "Rux", available: false, detail: "尚未检测本机 Rux" },
  { id: "claude-code", name: "Claude Code", available: false, detail: "尚未检测本机 Claude Code" },
  { id: "rux-native", name: "Rux Native", available: false, detail: "添加原生 Provider 后即可使用，无需安装 Agent CLI" },
];

const providerSurfaces = [
  {
    id: "chatgpt",
    adapter: "codex",
    engineName: "Rux",
    connectionName: "ChatGPT、API Key 或自定义 Provider",
    cliLabel: "codex CLI",
    installUrl: "https://developers.openai.com/codex/cli/",
  },
  {
    id: "claude-code",
    adapter: "claude-code",
    engineName: "Claude Code",
    connectionName: "Claude OAuth、API Key 或云 Provider",
    cliLabel: "claude CLI",
    installUrl: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
  },
];

function authProviderForAdapter(state, adapter) {
  const providerId = adapter === "codex" ? "chatgpt" : adapter === "claude-code" ? "claude-code" : "";
  return state?.providers?.find((provider) => provider.id === providerId);
}

function authMethodLabel(method) {
  return {
    chatgpt: "ChatGPT OAuth",
    oauth: "OAuth",
    "api-key": "CLI API Key",
    cloud: "云 Provider",
    unknown: "CLI 配置",
  }[method] || "CLI 配置";
}

function mergeAuthState(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  const providers = new Map(current.providers.map((provider) => [provider.id, provider]));
  for (const provider of incoming.providers || []) {
    providers.set(provider.id, { ...(providers.get(provider.id) || {}), ...provider });
  }
  return { providers: [...providers.values()], checkedAt: incoming.checkedAt || current.checkedAt };
}

const permissionOptions = [
  { id: "plan", label: "只读规划", short: "Read only" },
  { id: "acceptEdits", label: "工作区写入，按需确认", short: "Workspace write" },
  { id: "dontAsk", label: "工作区写入，不询问", short: "Workspace write · no prompts" },
];

function permissionLabel(mode) {
  return permissionOptions.find((item) => item.id === mode)?.short || "Workspace write";
}

function ruxVisibleText(value) {
  return typeof value === "string" ? value.replace(/codex/gi, "Rux") : value;
}

function ruxAgentLabel(value) {
  if (typeof value !== "string" || !value) return "Rux";
  return ruxVisibleText(value).replace(/\bRUX\b/g, "Rux").replace(/\brux Agent\b/gi, "Rux");
}

function ruxAdapterLabel(value) {
  if (value === "codex") return "Rux";
  if (value === "rux-native") return "Rux Native";
  if (value === "mock") return "Rux Demo";
  return ruxVisibleText(value) || "Rux";
}

function ruxModelLabel(value) {
  if (!value || /^(codex|rux) default$/i.test(String(value))) return "Rux 默认";
  if (/^claude default$/i.test(String(value))) return "Claude 默认";
  return ruxVisibleText(String(value));
}

function codexCatalogModel(models, selection) {
  if (!Array.isArray(models) || !models.length) return undefined;
  if (!selection || String(selection).toLowerCase() === "codex default") {
    return models.find((model) => model.isDefault) || models[0];
  }
  return models.find((model) => model.model === selection || model.id === selection);
}

function codexReasoningOptions(models, selection) {
  return codexCatalogModel(models, selection)?.supportedReasoningEfforts || [];
}

function reasoningEffortLabel(value) {
  const labels = {
    minimal: "最低",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高",
    ultra: "Ultra",
  };
  return labels[value] || value || "模型默认";
}

function modelStateLabel(source, status) {
  if (status === "unavailable") return "模型不可用";
  if (source === "engine-default") return "由 Engine 选择 · 无需验证";
  if (source === "engine-catalog") return "官方模型目录 · 无需验证";
  if (source === "verified-history") return "此连接已验证";
  if (status === "verified") return "此连接已验证";
  if (status === "unverified") return "手动模型 ID · 首次运行后验证";
  return "模型来源未知";
}

const uiPreferencesKey = "rux.ui-preferences.v1";
const legacyShowcaseTaskIds = new Set(["desktop-workbench", "prd", "market", "adapter"]);
const defaultCodexSettings = {
  model: "Rux default",
  reasoningEffort: "",
  permissionMode: "acceptEdits",
};

function isLegacyShowcaseTask(task) {
  return legacyShowcaseTaskIds.has(task.id) && !(task.runs || []).length;
}

function readUiPreferences() {
  try {
    return JSON.parse(window.localStorage.getItem(uiPreferencesKey) || "{}");
  } catch {
    return {};
  }
}

function createWorkspaceStarterTask(workspace, codexSettings = defaultCodexSettings) {
  const needsProject = workspace.placeholder;
  return {
    id: `workspace-${workspace.id}`,
    workspaceId: workspace.id,
    title: needsProject ? "打开一个项目开始" : `在 ${workspace.name} 中开始新任务`,
    preview: needsProject ? "请选择本机项目目录" : "工作区已就绪",
    status: "waiting",
    updatedAt: "现在",
    agent: "Rux",
    adapter: "codex",
    agentRevisionId: builtInAgentRevisionId("codex"),
    providerConnection: defaultProviderConnectionForAdapter("codex"),
    permissionMode: codexSettings.permissionMode || "acceptEdits",
    model: codexSettings.model || "Rux default",
    ...defaultModelState(codexSettings.model || "Rux default"),
    ...(codexSettings.reasoningEffort ? { reasoningEffort: codexSettings.reasoningEffort } : {}),
    branch: workspace.branch,
    elapsed: "—",
    tokens: "—",
    messages: [],
    plan: [],
    activity: [],
    runs: [],
  };
}

function taskTitleFromPrompt(prompt) {
  const title = String(prompt || "").trim().replace(/\s+/g, " ");
  return title.length > 24 ? `${title.slice(0, 24)}…` : title;
}

function withoutSupersededWorkspaceStarter(tasks, workspaceId) {
  const starterId = `workspace-${workspaceId}`;
  return tasks.some((task) => task.id !== starterId)
    ? tasks.filter((task) => task.id !== starterId)
    : tasks;
}

function modelAlias(model) {
  const value = model?.toLowerCase() || "";
  if (value.includes("opus")) return "opus";
  if (value.includes("sonnet")) return "sonnet";
  if (value.includes("haiku")) return "haiku";
  return undefined;
}

function formatDuration(durationMs) {
  if (!durationMs) return undefined;
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function isoNow() {
  return new Date().toISOString();
}

function agentRevisionNumber(revisionId) {
  const match = typeof revisionId === "string" ? revisionId.match(/@(\d+)$/) : null;
  return match ? Number(match[1]) : undefined;
}

function agentRevisionUpdateForTask(task, profiles) {
  if (!task?.agentProfileId || !task.agentRevisionId) return null;
  const profile = profiles.find((item) => item.id === task.agentProfileId);
  if (!profile || profile.latestRevisionId === task.agentRevisionId) return null;
  return {
    profile,
    currentRevisionNumber: task.agentRevisionSnapshot?.revisionNumber
      || agentRevisionNumber(task.agentRevisionId),
    latestRevisionNumber: profile.revisionNumber
      || agentRevisionNumber(profile.latestRevisionId),
  };
}

function normalizePersistedTask(task, workspaceId = task.workspaceId) {
  const now = isoNow();
  const adapter = task.adapter
    || (task.agent === "Claude Code" ? "claude-code" : ["Codex", "Rux"].includes(task.agent) ? "codex" : "mock");
  const migrateEmptyWorkspaceStarter = task.id === `workspace-${workspaceId}`
    && !(task.messages || []).length
    && !(task.runs || []).length
    && !task.agentProfileId
    && adapter === "codex"
    && (!task.agentRevisionId || task.agentRevisionId === builtInAgentRevisionId("codex"));
  const agentRevisionId = task.agentRevisionId
    || (task.agentProfileId ? agentRevisionIdFor(task.agentProfileId, 1) : builtInAgentRevisionId(adapter));
  const providerConnection = task.providerConnection || defaultProviderConnectionForAdapter(adapter);
  const taskModelState = task.modelSource && task.modelVerificationStatus
    ? { modelSource: task.modelSource, modelVerificationStatus: task.modelVerificationStatus }
    : defaultModelState(task.model);
  const runs = Array.isArray(task.runs) ? task.runs.map((run) => {
    const verifications = Array.isArray(run.verifications) ? run.verifications : [];
    const runAdapter = run.adapter || adapter;
    const runModelState = run.modelSource && run.modelVerificationStatus
      ? { modelSource: run.modelSource, modelVerificationStatus: run.modelVerificationStatus }
      : defaultModelState(run.model || task.model);
    const sessionLink = run.sessionLink || createNativeSessionLink({
      adapter: runAdapter,
      providerConnection: run.providerConnection || defaultProviderConnectionForAdapter(runAdapter),
      agentRevisionId: run.agentRevisionId || agentRevisionId,
      workspaceId,
      sessionId: run.sessionId,
    });
    return {
      ...run,
      agentRevisionId: run.agentRevisionId || agentRevisionId,
      providerConnection: run.providerConnection || defaultProviderConnectionForAdapter(runAdapter),
      ...runModelState,
      ...(sessionLink ? { sessionLink } : {}),
      status: run.status === "completed" && verifications.some((verification) => verification.status === "failed")
        ? "failed"
        : run.status,
      contextFiles: Array.isArray(run.contextFiles) ? run.contextFiles : [],
      gitRestores: Array.isArray(run.gitRestores) ? run.gitRestores : [],
      permissionRequests: Array.isArray(run.permissionRequests) ? run.permissionRequests : [],
      permissionDecisions: Array.isArray(run.permissionDecisions) ? run.permissionDecisions : [],
      verifications,
    };
  }) : [];
  const hasPlanEvidence = runs.some((run) => (run.events || []).some((event) => event.type === "plan.updated"));
  return {
    ...task,
    workspaceId,
    adapter: migrateEmptyWorkspaceStarter ? "codex" : adapter,
    agentRevisionId: migrateEmptyWorkspaceStarter ? builtInAgentRevisionId("codex") : agentRevisionId,
    providerConnection: migrateEmptyWorkspaceStarter
      ? defaultProviderConnectionForAdapter("codex")
      : providerConnection,
    ...(migrateEmptyWorkspaceStarter ? defaultModelState("Rux default") : taskModelState),
    ...(adapter === "codex" ? { agent: ruxAgentLabel(task.agent || "Rux") } : {}),
    ...(migrateEmptyWorkspaceStarter ? { agent: "Rux", model: "Rux default" } : {}),
    permissionMode: task.permissionMode || "acceptEdits",
    contextFiles: Array.isArray(task.contextFiles) ? task.contextFiles : [],
    createdAt: task.createdAt || now,
    updatedAtIso: task.updatedAtIso || now,
    messages: task.messages.map((message) => ({
      ...message,
      ...(message.agent ? { agent: ruxAgentLabel(message.agent) } : {}),
      createdAt: message.createdAt || now,
    })),
    plan: hasPlanEvidence ? task.plan : [],
    runs,
    reviewAcceptances: Array.isArray(task.reviewAcceptances) ? task.reviewAcceptances : [],
  };
}

function workspaceTaskSnapshot(workspaceId, tasks) {
  return {
    version: 2,
    workspaceId,
    tasks: tasks
      .filter((task) => task.workspaceId === workspaceId)
      .map((task) => normalizePersistedTask(task, workspaceId)),
    updatedAt: isoNow(),
  };
}

function seedShowcaseTasks(workspace) {
  return initialTasks.map((task) => normalizePersistedTask({
    ...task,
    workspaceId: workspace.id,
    branch: task.branch === "main" ? workspace.branch : task.branch,
  }, workspace.id));
}

function runtimeAdapterForTask(task) {
  return task.adapter
    || (task.agent === "Claude Code" ? "claude-code" : ["Codex", "Rux"].includes(task.agent) ? "codex" : "mock");
}

const maxStreamingAssistantText = 1_000_000;

function appendStreamingAssistantDelta(state, taskId, event) {
  const chunk = typeof event.text === "string" ? event.text : "";
  if (!chunk) return state;
  const current = state[taskId] || [];
  const index = current.findIndex((message) =>
    message.runId === event.runId && message.itemId === event.itemId);
  if (index < 0) {
    return {
      ...state,
      [taskId]: [...current, {
        id: `assistant-stream-${event.runId}-${event.itemId}`,
        role: "assistant",
        runId: event.runId,
        itemId: event.itemId,
        text: chunk.slice(0, maxStreamingAssistantText),
        time: "生成中…",
        streaming: true,
      }],
    };
  }
  const existing = current[index];
  if (existing.text.length >= maxStreamingAssistantText) return state;
  const next = [...current];
  next[index] = {
    ...existing,
    text: `${existing.text}${chunk}`.slice(0, maxStreamingAssistantText),
  };
  return { ...state, [taskId]: next };
}

function clearStreamingAssistantMessages(state, taskId, event = {}) {
  const current = state[taskId];
  if (!current?.length) return state;
  const remaining = current.filter((message) => {
    if (event.runId && message.runId !== event.runId) return true;
    if (event.itemId && message.itemId !== event.itemId) return true;
    return false;
  });
  if (remaining.length === current.length) return state;
  const next = { ...state };
  if (remaining.length) next[taskId] = remaining;
  else delete next[taskId];
  return next;
}

function recordRuntimeEvent(task, event) {
  if (!("runId" in event)) return task;

  const now = isoNow();
  const runs = Array.isArray(task.runs) ? task.runs : [];
  const existing = runs.find((run) => run.id === event.runId);
  const taskAdapter = runtimeAdapterForTask(task);
  const taskRevisionId = task.agentRevisionId || builtInAgentRevisionId(taskAdapter);
  const taskConnection = task.providerConnection || defaultProviderConnectionForAdapter(taskAdapter);
  const taskModelState = task.modelSource && task.modelVerificationStatus
    ? { modelSource: task.modelSource, modelVerificationStatus: task.modelVerificationStatus }
    : defaultModelState(task.model);
  const base = existing || {
    id: event.runId,
    taskId: task.id,
    adapter: event.type === "run.started" ? event.adapter : taskAdapter,
    status: "running",
    prompt: event.type === "run.started" ? event.prompt : "",
    permissionMode: "acceptEdits",
    model: task.model,
    agentRevisionId: taskRevisionId,
    ...(task.agentProfileId ? { profileId: task.agentProfileId } : {}),
    providerConnection: taskConnection,
    ...taskModelState,
    ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
    contextFiles: [],
    gitRestores: [],
    startedAt: now,
    updatedAt: now,
    permissionRequests: [],
    permissionDecisions: [],
    verifications: [],
    events: [],
  };
  const sequence = base.events.length + 1;
  let nextRun = {
    ...base,
    updatedAt: now,
    events: [...base.events, {
      id: `${event.runId}:${sequence}`,
      sequence,
      type: event.type,
      occurredAt: now,
      payload: { ...event },
    }],
  };

  if (event.type === "run.started") {
    const resumeFrom = createNativeSessionLink({
      adapter: event.adapter,
      providerConnection: event.providerConnection || taskConnection,
      agentRevisionId: event.agentRevisionId || taskRevisionId,
      workspaceId: task.workspaceId,
      sessionId: event.resumeSessionId,
    });
    nextRun = {
      ...nextRun,
      adapter: event.adapter,
      prompt: event.prompt,
      status: "running",
      permissionMode: event.permissionMode || task.permissionMode || "acceptEdits",
      ...(event.model ? { model: event.model } : {}),
      ...(event.reasoningEffort ? { reasoningEffort: event.reasoningEffort } : {}),
      ...(event.profileId ? { profileId: event.profileId } : {}),
      agentRevisionId: event.agentRevisionId || taskRevisionId,
      providerConnection: event.providerConnection || taskConnection,
      modelSource: nextRun.modelDecision?.modelSource || event.modelSource || taskModelState.modelSource,
      modelVerificationStatus: nextRun.modelDecision?.modelSource === "verified-history"
        ? "verified"
        : nextRun.modelDecision?.modelSource === "engine-catalog"
          ? "not-required"
          : event.modelVerificationStatus || taskModelState.modelVerificationStatus,
      ...(resumeFrom ? { resumeFrom, sessionLink: resumeFrom } : {}),
    };
  } else if (event.type === "permission.requested") {
    const permissionRequests = Array.isArray(nextRun.permissionRequests) ? nextRun.permissionRequests : [];
    nextRun = {
      ...nextRun,
      ...(event.adapter ? { adapter: event.adapter } : {}),
      ...(event.prompt ? { prompt: event.prompt } : {}),
      status: "waiting-permission",
      ...(event.permissionMode ? { permissionMode: event.permissionMode } : {}),
      ...(event.contextFiles ? { contextFiles: event.contextFiles } : {}),
      permissionRequests: permissionRequests.some((item) => item.id === event.request.id)
        ? permissionRequests.map((item) => item.id === event.request.id ? event.request : item)
        : [...permissionRequests, event.request],
      ...(event.model ? { model: event.model } : {}),
      ...(event.reasoningEffort ? { reasoningEffort: event.reasoningEffort } : {}),
      ...(event.profileId ? { profileId: event.profileId } : {}),
      agentRevisionId: event.agentRevisionId || taskRevisionId,
      providerConnection: event.providerConnection || taskConnection,
      modelSource: nextRun.modelDecision?.modelSource || event.modelSource || taskModelState.modelSource,
      modelVerificationStatus: nextRun.modelDecision?.modelSource === "verified-history"
        ? "verified"
        : nextRun.modelDecision?.modelSource === "engine-catalog"
          ? "not-required"
          : event.modelVerificationStatus || taskModelState.modelVerificationStatus,
    };
  } else if (event.type === "permission.decided") {
    const permissionRequests = Array.isArray(nextRun.permissionRequests) ? nextRun.permissionRequests : [];
    const permissionDecisions = Array.isArray(nextRun.permissionDecisions) ? nextRun.permissionDecisions : [];
    const decidedRequest = permissionRequests.find((item) => item.id === event.decision.requestId);
    const continuesRun = decidedRequest?.scope?.appliesTo === "single-action";
    nextRun = {
      ...nextRun,
      status: (continuesRun && event.decision.decision !== "cancelled") || event.decision.decision === "approved"
        ? "running"
        : nextRun.status,
      permissionRequests: permissionRequests.map((item) => item.id === event.decision.requestId
        ? { ...item, status: event.decision.decision }
        : item),
      permissionDecisions: permissionDecisions.some((item) => item.id === event.decision.id)
        ? permissionDecisions
        : [...permissionDecisions, event.decision],
    };
  } else if (event.type === "run.metadata") {
    const sessionLink = createNativeSessionLink({
      adapter: nextRun.adapter,
      providerConnection: nextRun.providerConnection,
      agentRevisionId: nextRun.agentRevisionId,
      workspaceId: task.workspaceId,
      sessionId: event.sessionId,
    });
    nextRun = {
      ...nextRun,
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(sessionLink ? { sessionLink, resumeFailure: undefined } : {}),
      ...(event.model ? { model: event.model } : {}),
      ...(event.reasoningEffort ? { reasoningEffort: event.reasoningEffort } : {}),
      ...(event.cwd ? { cwd: event.cwd } : {}),
      ...(event.version ? { version: event.version } : {}),
      ...(["plan", "acceptEdits", "dontAsk"].includes(event.permissionMode)
        ? { permissionMode: event.permissionMode }
        : {}),
    };
  } else if (event.type === "run.agent-snapshot") {
    nextRun = {
      ...nextRun,
      profileId: event.profile.profileId,
      agentRevisionId: event.profile.id,
      providerConnection: event.profile.providerConnection,
      modelSource: nextRun.modelDecision?.modelSource || event.profile.modelSource,
      modelVerificationStatus: nextRun.modelDecision?.modelSource === "verified-history"
        ? "verified"
        : nextRun.modelDecision?.modelSource === "engine-catalog"
          ? "not-required"
          : event.profile.modelVerificationStatus,
      agentSnapshot: event.profile,
    };
  } else if (event.type === "run.model-decision") {
    if (!nextRun.modelDecision) {
      nextRun = {
        ...nextRun,
        model: event.decision.actualModel,
        modelSource: event.decision.modelSource,
        modelVerificationStatus: event.decision.modelSource === "verified-history" ? "verified" : event.decision.modelSource === "engine-catalog" ? "not-required" : nextRun.modelVerificationStatus,
        modelDecision: event.decision,
      };
    }
  } else if (event.type === "run.usage") {
    nextRun = {
      ...nextRun,
      tokenUsage: mergeTokenUsage(nextRun.tokenUsage, event.usage),
    };
  } else if (event.type === "run.context-snapshot") {
    nextRun = {
      ...nextRun,
      contextSnapshot: event.snapshot,
    };
  } else if (event.type === "run.git-baseline") {
    nextRun = {
      ...nextRun,
      gitBaseline: event.baseline,
    };
  } else if (event.type === "run.git-patch") {
    nextRun = {
      ...nextRun,
      gitPatch: event.patch,
    };
  } else if (event.type === "verification.recorded") {
    const verifications = Array.isArray(nextRun.verifications) ? nextRun.verifications : [];
    nextRun = {
      ...nextRun,
      verifications: verifications.some((item) => item.id === event.verification.id)
        ? verifications.map((item) => item.id === event.verification.id ? event.verification : item)
        : [...verifications, event.verification],
    };
  } else if (event.type === "run.completed") {
    const hasFailedVerification = nextRun.verifications.some((verification) => verification.status === "failed");
    const hasFailedActivity = nextRun.events.some((record) => (
      record.type === "activity.completed" && record.payload?.activity?.state === "error"
    ));
    nextRun = {
      ...nextRun,
      status: hasFailedVerification || hasFailedActivity ? "failed" : "completed",
      finishedAt: now,
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      ...(event.costUsd === undefined ? {} : { costUsd: event.costUsd }),
      ...(event.turns === undefined ? {} : { turns: event.turns }),
    };
  } else if (event.type === "run.cancelled") {
    nextRun = { ...nextRun, status: "cancelled", finishedAt: now };
  } else if (event.type === "run.failed") {
    const resumeFrom = nextRun.resumeFrom || createNativeSessionLink({
      adapter: nextRun.adapter,
      providerConnection: nextRun.providerConnection,
      agentRevisionId: nextRun.agentRevisionId,
      workspaceId: task.workspaceId,
      sessionId: event.resumeSessionId,
    });
    nextRun = {
      ...nextRun,
      status: "failed",
      finishedAt: now,
      error: event.error,
      ...(resumeFrom ? { resumeFrom, sessionLink: resumeFrom, resumeFailure: event.error } : {}),
    };
  }

  nextRun = { ...nextRun, ...modelStateAfterRun(nextRun, event) };
  const importedResumeUnavailable = event.type === "run.failed"
    && Boolean(task.importedSession)
    && Boolean(nextRun.resumeFailure)
    && !nextRun.events.some((record) => record.type === "run.metadata");

  return {
    ...task,
    ...(importedResumeUnavailable
      ? { importedSession: { ...task.importedSession, status: "native-unavailable" } }
      : {}),
    ...(event.type === "run.agent-snapshot" && event.profile.id === taskRevisionId
      ? { agentRevisionSnapshot: event.profile }
      : {}),
    updatedAtIso: now,
    ...(tokenUsageTotal(nextRun.tokenUsage) === undefined ? {} : { tokens: tokenUsageTotal(nextRun.tokenUsage).toLocaleString("en-US") }),
    runs: existing
      ? runs.map((run) => run.id === event.runId ? nextRun : run)
      : [...runs, nextRun],
  };
}

function StatusIcon({ status, size = 14 }) {
  if (status === "running") {
    return <LoaderCircle size={size} className="status-running" aria-label="运行中" />;
  }
  if (status === "blocked") {
    return <ShieldCheck size={size} className="status-blocked" aria-label="等待权限" />;
  }
  if (status === "completed") {
    return <CheckCircle2 size={size} className="status-complete" aria-label="已完成" />;
  }
  if (status === "stopped") {
    return <Square size={size} className="status-stopped" aria-label="已停止" />;
  }
  if (status === "failed") {
    return <CircleAlert size={size} className="status-failed" aria-label="失败" />;
  }
  if (status === "interrupted") {
    return <CircleAlert size={size} className="status-interrupted" aria-label="已中断" />;
  }
  return <Circle size={size} className="status-waiting" aria-label="待开始" />;
}

function TaskItem({ task, active, onSelect, onRename, onTogglePin, onArchive, canArchive = true, disabled = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(task.title);
  const shellRef = useRef(null);

  useEffect(() => setTitle(task.title), [task.title]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!shellRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menuOpen]);

  const submitRename = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    onRename(nextTitle);
    setRenaming(false);
    setMenuOpen(false);
  };

  if (renaming) {
    return (
      <form className="task-rename-form" onSubmit={(event) => { event.preventDefault(); submitRename(); }}>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setTitle(task.title);
              setRenaming(false);
            }
          }}
          maxLength={240}
          aria-label={`重命名任务 ${task.title}`}
        />
        <button type="submit" className="icon-button" disabled={!title.trim()} aria-label="保存任务名称"><Check size={13} /></button>
        <button type="button" className="icon-button" onClick={() => { setTitle(task.title); setRenaming(false); }} aria-label="取消重命名"><X size={13} /></button>
      </form>
    );
  }

  return (
    <div ref={shellRef} className={`task-item-shell ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className={`task-item ${active ? "is-active" : ""}`}
        onClick={() => { setMenuOpen(false); onSelect(); }}
        disabled={disabled}
        aria-current={active ? "page" : undefined}
        title={`${task.title} · ${task.preview} · ${task.updatedAt}`}
      >
        <span className="task-copy">
          <span className="task-title-row">
            <span className="task-title">{task.title}</span>
            {["running", "blocked", "failed", "interrupted"].includes(task.status) ? <StatusIcon status={task.status} size={12} /> : null}
          </span>
          <span className="task-meta">
            <span>{task.preview}</span>
            <span>{task.updatedAt}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="task-more-button"
        aria-label={`任务操作 ${task.title}`}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        disabled={disabled}
      ><MoreHorizontal size={14} /></button>
      {menuOpen ? (
        <div className="task-action-menu" role="menu">
          {!task.archived ? <button type="button" role="menuitem" onClick={() => { onTogglePin(); setMenuOpen(false); }}><Pin size={13} />{task.pinned ? "取消置顶" : "置顶任务"}</button> : null}
          <button type="button" role="menuitem" onClick={() => { setRenaming(true); setMenuOpen(false); }}><PencilLine size={13} />重命名</button>
          <button type="button" role="menuitem" disabled={["running", "blocked"].includes(task.status) || (!task.archived && !canArchive)} title={!task.archived && !canArchive ? "每个项目至少保留一个未归档任务" : undefined} onClick={() => { onArchive(); setMenuOpen(false); }}><Archive size={13} />{task.archived ? "重新打开" : "归档任务"}</button>
        </div>
      ) : null}
    </div>
  );
}

function Sidebar({
  tasks,
  selectedTaskId,
  onSelectTask,
  onNewTask,
  searchQuery,
  onSearch,
  sidebarOpen,
  onClose,
  workspaceState,
  workspaceBusy,
  onChooseWorkspace,
  expandedProjectIds,
  onToggleProject,
  onCreateTaskInWorkspace,
  onCollapse,
  onOpenAccounts,
  onOpenSettings,
  onOpenAgents,
  onOpenSessionDiscovery,
  onOpenEnvironment,
  onOpenChanges,
  onRenameTask,
  onTogglePinTask,
  onArchiveTask,
  taskActionError,
  onDismissTaskActionError,
  accountLabel,
  accountConnected,
  collapsed,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const productMenuRef = useRef(null);
  const productTriggerRef = useRef(null);
  const matchingTasks = tasks.filter((task) =>
    `${task.title} ${task.agent}`.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const visibleTasks = matchingTasks.filter((task) => !task.archived);
  const archivedTasks = matchingTasks.filter((task) => task.archived);
  const activeWorkspace = workspaceState.active;
  const pinnedTasks = visibleTasks.filter((task) => task.pinned);

  useEffect(() => {
    if (!accountMenuOpen && !notificationsOpen) return undefined;
    const closePopovers = (event) => {
      if (accountMenuOpen && !accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
      if (notificationsOpen && !event.target.closest?.(".sidebar-notification-shell")) setNotificationsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
        setNotificationsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closePopovers, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closePopovers, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [accountMenuOpen, notificationsOpen]);

  useEffect(() => {
    if (!productMenuOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!productMenuRef.current?.contains(event.target)) setProductMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setProductMenuOpen(false);
      window.requestAnimationFrame(() => productTriggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [productMenuOpen]);

  return (
    <aside
      className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
      aria-hidden={collapsed && !sidebarOpen ? true : undefined}
      inert={collapsed && !sidebarOpen}
    >
      <div className="sidebar-window-row">
        <div className="sidebar-window-actions">
          <button className="icon-button" type="button" onClick={onCollapse} aria-label="收起侧栏" title="收起侧栏">
            <PanelLeftClose size={17} />
          </button>
          <button className="icon-button" type="button" aria-label="后退" title="后退" disabled>
            <ArrowLeft size={17} />
          </button>
          <button className="icon-button" type="button" aria-label="前进" title="前进" disabled>
            <ArrowRight size={17} />
          </button>
        </div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="关闭侧栏">
          <X size={17} />
        </button>
      </div>

      <div className="product-row">
        <div className="product-switcher-shell" ref={productMenuRef}>
          <button
            ref={productTriggerRef}
            className={`product-switcher ${productMenuOpen ? "is-open" : ""}`}
            type="button"
            aria-label="切换 Rux 工作台"
            aria-haspopup="menu"
            aria-expanded={productMenuOpen}
            aria-controls={productMenuOpen ? "product-switcher-menu" : undefined}
            title="Rux 工作台"
            onClick={() => setProductMenuOpen((open) => !open)}
          >
            <span className="product-name">Rux</span>
            <ChevronDown size={15} />
          </button>
          {productMenuOpen ? (
            <div id="product-switcher-menu" className="product-switcher-menu" role="menu" aria-label="工作台">
              <button
                autoFocus
                type="button"
                role="menuitemradio"
                aria-checked="true"
                className="is-current"
                onClick={() => {
                  setProductMenuOpen(false);
                  window.requestAnimationFrame(() => productTriggerRef.current?.focus());
                }}
              >
                <Check size={15} aria-hidden="true" />
                <span><strong>Rux 工作台</strong><small>当前工作台</small></span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="product-row-actions">
          <button
            className={`icon-button ${searchOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => setSearchOpen((value) => {
              if (value) onSearch("");
              return !value;
            })}
            aria-label="搜索任务"
            aria-pressed={searchOpen}
          ><Search size={18} /></button>
          <div className="sidebar-notification-shell">
            <button className={`icon-button ${notificationsOpen ? "is-active" : ""}`} type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="通知" aria-expanded={notificationsOpen}><Bell size={18} /></button>
            {notificationsOpen ? <div className="sidebar-notification-popover" role="status"><strong>通知</strong><span>暂时没有新通知</span></div> : null}
          </div>
        </div>
      </div>

      <div className="sidebar-nav" aria-label="主要导航">
        <button type="button" onClick={onNewTask}>
          <SquarePen size={18} />
          <span>新对话</span>
        </button>
        <button type="button" onClick={onOpenChanges} disabled={activeWorkspace.placeholder} title={activeWorkspace.placeholder ? "请先打开项目" : undefined}>
          <GitPullRequest size={18} />
          <span>变更</span>
        </button>
        <button type="button" onClick={onOpenEnvironment} disabled={activeWorkspace.placeholder} title={activeWorkspace.placeholder ? "请先打开项目" : undefined}>
          <PanelsTopLeft size={18} />
          <span>环境</span>
        </button>
        <button type="button" disabled title="计划任务尚未开放">
          <Clock3 size={18} />
          <span>已安排</span>
        </button>
        <button type="button" onClick={onOpenAgents}>
          <AtSign size={18} />
          <span>Agents</span>
        </button>
        <button type="button" onClick={onOpenSessionDiscovery} disabled={activeWorkspace.placeholder} title={activeWorkspace.placeholder ? "请先打开项目" : undefined}>
          <History size={18} />
          <span>导入 Agent 会话</span>
        </button>
      </div>

      {searchOpen ? (
        <div className="sidebar-search-wrap">
          <label className="sidebar-search">
            <Search size={14} aria-hidden="true" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜索任务"
              aria-label="搜索任务"
            />
            {searchQuery ? (
              <button type="button" onClick={() => onSearch("")} aria-label="清除搜索">
                <X size={13} />
              </button>
            ) : null}
          </label>
          {searchQuery ? <small aria-live="polite">找到 {matchingTasks.length} 个任务</small> : null}
        </div>
      ) : null}

      {taskActionError ? (
        <div className="sidebar-inline-error" role="alert">
          <CircleAlert size={14} />
          <span>{taskActionError}</span>
          <button type="button" onClick={onDismissTaskActionError} aria-label="关闭任务错误"><X size={13} /></button>
        </div>
      ) : null}

      <nav className="sidebar-scroll" aria-label="项目与任务">
        <section className="sidebar-thread-section">
          {pinnedTasks.length ? <div className="sidebar-section-label">置顶</div> : null}
          {pinnedTasks.map((task) => {
            const workspace = workspaceState.recent.find((item) => item.id === task.workspaceId);
            return (
              <TaskItem
                key={task.id}
                task={task}
                active={task.id === selectedTaskId}
                onSelect={() => onSelectTask(task.id, workspace?.path)}
                onRename={(title) => onRenameTask(task.id, title)}
                onTogglePin={() => onTogglePinTask(task.id)}
                onArchive={() => onArchiveTask(task.id, true)}
                canArchive={tasks.filter((item) => item.workspaceId === task.workspaceId && !item.archived).length > 1}
                disabled={workspaceBusy && workspace?.id !== activeWorkspace.id}
              />
            );
          })}
          {searchQuery && !matchingTasks.length ? <p className="no-results">没有匹配的任务</p> : null}
        </section>

        <section className="project-section">
          <div className="sidebar-section-label">项目</div>
          <div className="workspace-list">
            {workspaceState.recent.filter((workspace) => !workspace.placeholder).map((workspace) => {
              const projectTasks = visibleTasks.filter((task) => task.workspaceId === workspace.id && !task.pinned);
              const projectOpen = Boolean(searchQuery) || expandedProjectIds.includes(workspace.id);
              const hasUnpinnedTasks = tasks.some((task) => task.workspaceId === workspace.id && !task.pinned && !task.archived);
              const isCurrent = workspace.id === activeWorkspace.id;
              if (searchQuery && !projectTasks.length) return null;

              return (
                <div className={`workspace-project ${isCurrent ? "is-current" : ""}`} key={workspace.id}>
                  <button
                    className="project-heading"
                    type="button"
                    onClick={() => onToggleProject(workspace.id)}
                    title={workspace.path}
                    aria-expanded={projectOpen}
                    aria-label={`${projectOpen ? "收起" : "展开"}项目 ${workspace.name}`}
                  >
                    <Folder size={16} />
                    <span className="project-name">{workspace.name}</span>
                    {isCurrent ? <span className="project-current-dot" aria-label="当前项目" title="当前项目" /> : null}
                    <span className="project-branch">{workspace.branch}</span>
                    {projectOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>

                  {projectOpen ? (
                    <div className="task-list project-task-list">
                      {projectTasks.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          active={task.id === selectedTaskId}
                          onSelect={() => onSelectTask(task.id, workspace.path)}
                          onRename={(title) => onRenameTask(task.id, title)}
                          onTogglePin={() => onTogglePinTask(task.id)}
                          onArchive={() => onArchiveTask(task.id, true)}
                          canArchive={tasks.filter((item) => item.workspaceId === task.workspaceId && !item.archived).length > 1}
                          disabled={workspaceBusy && !isCurrent}
                        />
                      ))}
                      {!searchQuery && !hasUnpinnedTasks ? (
                        <button
                          type="button"
                          className="project-empty-action"
                          onClick={() => onCreateTaskInWorkspace(workspace.path)}
                          disabled={workspaceBusy}
                        >
                          <Plus size={14} />
                          <span>在此项目中新建任务</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            <button
              className="workspace-row open-workspace-row"
              type="button"
              onClick={onChooseWorkspace}
              disabled={workspaceBusy}
              aria-label="打开项目"
            >
              <FolderPlus size={15} />
              <span>{workspaceBusy ? "正在打开…" : "打开项目…"}</span>
            </button>
          </div>
        </section>

        {archivedTasks.length ? (
          <section className="archived-task-section">
            <button type="button" className="archived-task-toggle" onClick={() => setArchiveOpen((open) => !open)} aria-expanded={archiveOpen || Boolean(searchQuery)}>
              <Archive size={14} /><span>已归档</span><small>{archivedTasks.length}</small>{archiveOpen || searchQuery ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {archiveOpen || searchQuery ? (
              <div className="task-list archived-task-list">
                {archivedTasks.map((task) => {
                  const workspace = workspaceState.recent.find((item) => item.id === task.workspaceId);
                  return <TaskItem key={task.id} task={task} active={false} onSelect={() => onArchiveTask(task.id, false)} onRename={(title) => onRenameTask(task.id, title)} onTogglePin={() => undefined} onArchive={() => onArchiveTask(task.id, false)} disabled={workspaceBusy && workspace?.id !== activeWorkspace.id} />;
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </nav>

      <div className="sidebar-footer" ref={accountMenuRef}>
        <button type="button" className="workspace-switcher" onClick={onChooseWorkspace} disabled={workspaceBusy}>
          <span className="workspace-avatar">{activeWorkspace.placeholder ? <FolderPlus size={15} /> : <FolderGit2 size={15} />}</span>
          <span className="workspace-copy">
            <strong>{workspaceBusy ? "正在切换…" : activeWorkspace.placeholder ? "未打开项目" : activeWorkspace.name}</strong>
            <small>{activeWorkspace.placeholder ? "点击选择本机目录" : `当前项目 · ${activeWorkspace.branch}`}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <button
          type="button"
          className="account-switcher"
          aria-label="账户与登录"
          title="账户与登录"
          aria-expanded={accountMenuOpen}
          onClick={() => setAccountMenuOpen((open) => !open)}
        >
          <span className="account-avatar"><UserRound size={15} /></span>
          <span className="workspace-copy">
            <strong>{accountLabel}</strong>
          </span>
          <CircleHelp size={17} />
        </button>
        {accountMenuOpen ? (
          <div className="account-popover" role="menu" aria-label="账户菜单">
            <button type="button" className="account-popover-profile" role="menuitem" onClick={() => { setAccountMenuOpen(false); onOpenAccounts(); }}>
              <span className="account-avatar"><UserRound size={15} /></span><strong>{accountLabel}</strong>
            </button>
            <div className="account-popover-separator" />
            <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onOpenAccounts(); }}><LogIn size={17} /><span>{accountConnected ? "管理 Agent 与 Provider" : "检测 Agent 与 Provider"}</span><ChevronRight size={15} /></button>
            <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onOpenSettings(); }}><Settings size={17} /><span>Rux 设置</span><kbd>⌘,</kbd></button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function PlanStep({ step }) {
  return (
    <li className={`plan-step is-${step.state}`}>
      <span className="plan-step-icon">
        {step.state === "done" ? <Check size={13} /> : step.state === "active" ? <LoaderCircle size={13} /> : <Circle size={11} />}
      </span>
      <span>{step.label}</span>
    </li>
  );
}

function ActivityIcon({ kind }) {
  if (kind === "command") return <SquareTerminal size={15} />;
  if (kind === "edit") return <FileCode2 size={15} />;
  return <Search size={15} />;
}

function ActivityRow({ item }) {
  return (
    <div className={`activity-row ${item.state === "active" ? "is-active" : item.state === "error" ? "is-error" : ""}`}>
      <span className="activity-icon"><ActivityIcon kind={item.kind} /></span>
      <span className="activity-copy">
        <strong>{ruxVisibleText(item.title)}</strong>
        <small>{item.detail}</small>
      </span>
      <span className="activity-state">
        {item.state === "active"
          ? <LoaderCircle size={14} className="status-running" />
          : item.state === "error" ? <CircleAlert size={14} /> : <Check size={14} />}
      </span>
    </div>
  );
}

function InlineMessageText({ text }) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
  ));
}

const unsupportedContentPattern = /^\[暂不支持的内容类型:\s*([^\]]+)\]$/;

function unsupportedContentTypes(text) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const types = [];
  for (const line of lines) {
    const match = line.match(unsupportedContentPattern);
    if (!match) return null;
    types.push(match[1]);
  }
  return types;
}

function collapseUnsupportedMessages(messages) {
  return messages.reduce((items, message) => {
    const types = unsupportedContentTypes(message.text);
    if (!types) {
      items.push(message);
      return items;
    }
    const previous = items.at(-1);
    if (previous?.unsupportedContent && previous.runId === message.runId) {
      types.forEach((type) => {
        previous.unsupportedContent.counts[type] = (previous.unsupportedContent.counts[type] || 0) + 1;
        previous.unsupportedContent.total += 1;
      });
      return items;
    }
    const counts = {};
    types.forEach((type) => { counts[type] = (counts[type] || 0) + 1; });
    items.push({
      ...message,
      id: `unsupported-${message.id}`,
      role: "assistant",
      text: "",
      unsupportedContent: { counts, total: types.length },
    });
    return items;
  }, []);
}

function UnsupportedContentMessage({ message }) {
  const labels = {
    mcpToolCall: "工具调用",
    fileChange: "文件变更",
    contextCompaction: "上下文压缩",
  };
  const entries = Object.entries(message.unsupportedContent.counts)
    .sort(([, left], [, right]) => right - left);
  return (
    <details className="unsupported-content-summary">
      <summary>
        <span className="unsupported-content-icon"><Braces size={15} /></span>
        <span>
          <strong>已折叠 {message.unsupportedContent.total} 个导入事件</strong>
          <small>{entries.map(([type, count]) => `${labels[type] || type} ${count}`).join(" · ")}</small>
        </span>
        <ChevronRight size={15} className="disclosure-chevron" />
      </summary>
      <div>
        {entries.map(([type, count]) => <span key={type}><b>{labels[type] || type}</b><small>{count} 项</small></span>)}
      </div>
    </details>
  );
}

function MessageBody({ text }) {
  const blocks = String(text).split(/```([^\n`]*)\n([\s\S]*?)```/g);
  return (
    <div className="message-body">
      {blocks.map((block, index) => {
        if (index % 3 === 1) return null;
        if (index % 3 === 2) {
          const language = blocks[index - 1]?.trim();
          return (
            <div className="message-code-block" key={`code-${index}`}>
              <header>
                <span>{language === "text" || language === "txt" ? "纯文本" : language || "代码"}</span>
                <div>
                  <button type="button" aria-label="应用代码片段" title="应用代码片段"><Sparkles size={13} /></button>
                  <button type="button" aria-label="复制代码片段" title="复制" onClick={() => void navigator.clipboard?.writeText(block)}><Copy size={13} /></button>
                </div>
              </header>
              <pre><code>{block.replace(/\n$/, "")}</code></pre>
            </div>
          );
        }
        return block.split(/\n{2,}/).filter(Boolean).map((paragraph, paragraphIndex) => {
          const lines = paragraph.split("\n");
          if (lines.every((line) => /^[-*] /.test(line.trim()))) {
            return <ul key={`list-${index}-${paragraphIndex}`}>{lines.map((line) => <li key={line}><InlineMessageText text={line.trim().slice(2)} /></li>)}</ul>;
          }
          return <p key={`text-${index}-${paragraphIndex}`}><InlineMessageText text={paragraph} /></p>;
        });
      })}
    </div>
  );
}

function Message({ message, agent, run }) {
  if (message.unsupportedContent) return <UnsupportedContentMessage message={message} />;
  if (message.role === "assistant") {
    return (
      <article
        className={`assistant-message ${message.streaming ? "is-streaming" : ""}`}
        aria-live={message.streaming ? "polite" : undefined}
      >
        <div className="message-author">
          {ruxAgentLabel(message.agent || agent)}
          <span>{message.adapter ? `${ruxAdapterLabel(message.adapter)} · ` : ""}{message.time || "现在"}</span>
        </div>
        {run ? <div className="message-run-evidence" aria-label="本回合模型与 Token 证据">
          <span><Bot size={11} />{ruxModelLabel(run.model || run.modelDecision?.actualModel || "未报告")}</span>
          {run.modelDecision?.mode === "auto" ? <span>Auto · {run.modelDecision.classification === "complex" ? "复杂任务" : "简单任务"}</span> : null}
          <span>{tokenUsageTotal(run.tokenUsage) === undefined ? "Token 未报告" : `${tokenUsageTotal(run.tokenUsage).toLocaleString("en-US")} tokens`}</span>
        </div> : null}
        <MessageBody text={message.text} />
      </article>
    );
  }

  return (
    <article className="user-message">
      <MessageBody text={message.text} />
      <div className="message-author">You <span>{message.time}</span></div>
    </article>
  );
}

function PermissionCard({ request, busy, error, onDecision }) {
  const actionLabels = {
    "workspace.write": "创建、修改或删除 Workspace 文件",
    "command.execute": "执行命令",
    "file.write": "写入文件",
    "network.access": "访问网络",
    "tool.execute": "调用工具",
  };
  const singleAction = request.scope.appliesTo === "single-action";
  const workspacePreflight = request.action === "workspace.write" && !request.provider;
  const providerLabel = request.provider === "claude-code"
    ? "Claude Code 原生审批"
    : request.provider === "codex" ? "Rux 原生审批" : "Rux preflight";
  return (
    <section
      className="permission-request-card"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`permission-title-${request.id}`}
      aria-describedby={`permission-impact-${request.id}`}
    >
      <header>
        <span><ShieldCheck size={18} /></span>
        <div>
          <strong id={`permission-title-${request.id}`}>{singleAction ? "允许 Agent 执行这项操作？" : workspacePreflight ? "允许此 Run 修改工作区？" : "允许 Agent 在本次 Run 使用这些权限？"}</strong>
          <small>{providerLabel} · Agent 已暂停，等待你的决定</small>
        </div>
      </header>
      <dl>
        <div><dt>Action</dt><dd>{actionLabels[request.action] || request.action}</dd></div>
        <div><dt>Scope</dt><dd><code title={request.scope.path}>{request.scope.path}</code><small>{singleAction ? "仅这一项操作" : "仅本次 Run"}</small></dd></div>
      </dl>
      <p id={`permission-impact-${request.id}`}>{request.impact}</p>
      {error ? <div className="permission-error" role="alert"><CircleAlert size={14} />{error}</div> : null}
      <div className="permission-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => onDecision(request, "denied")}>拒绝</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => onDecision(request, "approved")}>{busy ? "正在处理…" : singleAction ? "允许这项操作" : "允许本次 Run"}</button>
      </div>
    </section>
  );
}

function ChangedFilesCard({ state, onOpenChanges, onRestoreChanges }) {
  const snapshot = state?.snapshot;
  const files = snapshot?.files || [];
  const totals = snapshot?.totals || { files: 0, additions: 0, deletions: 0 };
  if (!files.length) return null;

  return (
    <section className="transcript-change-card" aria-label={`${files.length} 个文件已编辑`}>
      <header>
        <span className="transcript-change-icon"><FilePlus2 size={18} /></span>
        <span className="transcript-change-summary">
          <strong>已编辑 {files.length} 个文件</strong>
          <small><b>+{totals.additions}</b> <em>−{totals.deletions}</em></small>
        </span>
        <span className="transcript-change-actions">
          <button type="button" onClick={() => onRestoreChanges(files[0].path)}><span>撤销</span><RotateCcw size={15} /></button>
          <button type="button" className="review-button" onClick={() => onOpenChanges(files[0].path)}>审查</button>
        </span>
      </header>
      <div className="transcript-change-files">
        {files.slice(0, 3).map((file) => {
          const segments = file.path.split("/");
          const name = segments.pop();
          const directory = segments.length ? `${segments.join("/")}/` : "";
          return (
            <button type="button" key={file.path} onClick={() => onOpenChanges(file.path)}>
              <span className="transcript-file-path"><span>{directory}</span><strong>{name}</strong></span>
              <span className="transcript-file-stat"><b>+{file.additions}</b><em>−{file.deletions}</em></span>
            </button>
          );
        })}
        {files.length > 3 ? <button type="button" className="transcript-more-files" onClick={() => onOpenChanges(files[3].path)}>另有 {files.length - 3} 个文件</button> : null}
      </div>
    </section>
  );
}

function TaskTimeline({ task, streamingMessages = [], changes, onOpenChanges, onRestoreChanges, onOpenRun, onWaitingAction, onPermissionDecision, permissionBusy, permissionError, taskActionError, onDismissTaskActionError, agentRevisionUpdate, onCreateTaskWithLatestAgent, onRetrySession, onCreateFreshTask, onRefreshSession, onOpenSessionVersions, onOpenHandoff, onOpenLocalData, sessionSyncBusy = false, workspacePlaceholder = false }) {
  const isWaiting = task.status === "waiting";
  const isCompleted = task.status === "completed";
  const hasOutcome = task.status === "completed" || task.status === "failed";
  const doneCount = task.plan.filter((item) => item.state === "done").length;
  const latestRun = task.runs?.[task.runs.length - 1];
  const sessionRecovery = resumeFailureForTask(task);
  const pendingPermission = [...(latestRun?.permissionRequests || [])]
    .reverse()
    .find((request) => request.status === "pending");
  const runPatch = latestRun?.gitPatch;
  const verifications = latestRun?.verifications || [];
  const displayMessages = [
    ...task.messages,
    ...streamingMessages.map((message) => ({
      ...message,
      agent: latestRun?.agentSnapshot?.name || task.agent,
      adapter: latestRun?.adapter || runtimeAdapterForTask(task),
    })),
  ];
  const renderedMessages = collapseUnsupportedMessages(displayMessages);
  const verificationCounts = verifications.reduce((counts, verification) => ({
    ...counts,
    [verification.status]: counts[verification.status] + 1,
  }), { passed: 0, failed: 0, unknown: 0 });
  const reasoning = [...(latestRun?.events || [])]
    .reverse()
    .find((event) => event.type === "assistant.reasoning-summary")?.payload?.text;
  const totals = changes?.snapshot?.totals;
  const hasAssistantMessage = displayMessages.some((message) => message.role === "assistant");
  const elapsed = latestRun?.durationMs ? formatDuration(latestRun.durationMs) : task.elapsed;
  const permissionTargetRef = useRef(null);
  const timelineEndRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const previousFollowKeyRef = useRef("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const streamingLength = streamingMessages.reduce((total, message) => total + message.text.length, 0);
  const followKey = `${task.id}:${task.messages.length}:${streamingMessages.length}:${streamingLength}:${latestRun?.events?.length || 0}:${pendingPermission?.id || ""}:${task.status}`;
  const responseLead = task.status === "running"
    ? `${ruxAgentLabel(task.agent)} 正在执行这个 Run。下面的活动和消息来自真实 Runtime 事件。`
    : task.status === "blocked"
      ? pendingPermission?.provider
        ? `${ruxAgentLabel(task.agent)} 已暂停在一项 provider-native 权限请求前；请审查下面的具体范围与持续时间。`
        : `${ruxAgentLabel(task.agent)} 尚未启动写入操作；请先审查下面的权限范围。`
    : task.status === "stopped"
      ? latestRun?.error || "Run 已停止；已经收到的消息和事件仍然保留。"
      : task.status === "failed"
        ? latestRun?.error || "Run 已结束，但 Runtime 或验证证据报告失败。"
        : task.status === "interrupted"
          ? latestRun?.error || "Rux 退出时 Agent 进程已终止；该 Run 不能直接恢复。"
      : "Run 已结束。请以 Agent 消息、事件记录和 Workspace Changes 为准审查结果。";

  useEffect(() => {
    if (!previousFollowKeyRef.current) {
      previousFollowKeyRef.current = followKey;
      return undefined;
    }
    if (previousFollowKeyRef.current === followKey) return undefined;
    previousFollowKeyRef.current = followKey;
    const frame = window.requestAnimationFrame(() => {
      const target = pendingPermission ? permissionTargetRef.current : timelineEndRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setShowJumpToLatest(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [followKey, pendingPermission]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = timelineScrollRef.current;
      if (!node) return;
      setShowJumpToLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 180);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [task.id, renderedMessages.length]);

  return (
    <div className="timeline-region">
      <div ref={timelineScrollRef} className="timeline-scroll" onScroll={(event) => {
        const node = event.currentTarget;
        setShowJumpToLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 180);
      }}>
        <div className="timeline-content">
        {!workspacePlaceholder && !task.importedSession && task.messages.length ? <div className="task-context-actions"><button type="button" onClick={onOpenHandoff}><GitCompareArrows size={13} />复制为新任务</button></div> : null}
        {taskActionError ? (
          <div className="account-error" role="alert">
            <CircleAlert size={15} />
            <span>{taskActionError}</span>
            <button type="button" className="icon-button" onClick={onDismissTaskActionError} aria-label="关闭任务错误"><X size={14} /></button>
          </div>
        ) : null}
        {task.importedSession ? (
          <section className="agent-revision-notice session-imported-notice" aria-label="导入的 Agent 会话">
            <span className="agent-revision-notice-icon"><History size={15} /></span>
            <span><strong>{task.importedSession.status === "unlinked" ? "已解除关联，本地内容仍保留" : task.importedSession.status === "native-unavailable" ? "原会话不可用，本地投影仍可查看" : task.importedSession.mode === "continue" ? "已关联原生会话" : "本地只读投影"}</strong><small>{task.importedSession.source === "codex-import" ? "Codex 导入" : "Claude Code 导入"} · 内容保存在 Rux，本地删除不会影响 Provider 原会话。</small></span>
            <div className="session-imported-actions">
              <button type="button" onClick={onOpenHandoff}><GitCompareArrows size={13} />复制为新任务</button>
              <button type="button" onClick={onRefreshSession} disabled={sessionSyncBusy || task.importedSession.status === "unlinked"}>{sessionSyncBusy ? <LoaderCircle size={13} className="status-running" /> : <RefreshCw size={13} />}刷新原生会话</button>
              <button type="button" onClick={onOpenSessionVersions} disabled={sessionSyncBusy}><History size={13} />版本</button>
              <button type="button" onClick={onOpenLocalData}><Database size={13} />管理本地数据</button>
            </div>
          </section>
        ) : null}
        {sessionRecovery ? (
          <section className="session-recovery-card" role="alert" aria-label="Native Session 恢复失败">
            <span className="session-recovery-icon"><CircleAlert size={17} /></span>
            <div>
              <strong>未能恢复原 Native Session</strong>
              <p>{sessionRecovery.error}</p>
              <small>{sessionRecovery.link.kind === "codex-thread" ? "Codex Thread" : "Claude Session"} · {sessionRecovery.link.nativeSessionId}</small>
            </div>
            <div className="session-recovery-actions">
              <button type="button" className="secondary-button" onClick={onRetrySession}>重试原 Session</button>
              <button type="button" className="primary-button" onClick={onCreateFreshTask}>创建新任务</button>
            </div>
          </section>
        ) : null}
        {agentRevisionUpdate ? (
          <section className="agent-revision-notice" aria-label="Agent 有新 Revision">
            <span className="agent-revision-notice-icon"><Copy size={15} /></span>
            <span>
              <strong>{agentRevisionUpdate.profile.name} 已有 Revision {agentRevisionUpdate.latestRevisionNumber}</strong>
              <small>此任务继续固定使用 Revision {agentRevisionUpdate.currentRevisionNumber || "旧版本"}；消息、Run 和 Native Session 不会自动迁移。</small>
            </span>
            <button type="button" onClick={onCreateTaskWithLatestAgent} disabled={!agentRevisionUpdate.available} title={agentRevisionUpdate.available ? "基于最新版 Agent 创建空白任务" : agentRevisionUpdate.unavailableReason}>
              使用新版创建新任务
            </button>
          </section>
        ) : null}
        {hasOutcome && elapsed && elapsed !== "—" ? (
          <button type="button" className="run-duration-row" onClick={onOpenRun}>
            <span>耗时 {elapsed}</span><ChevronRight size={17} />
          </button>
        ) : null}
        {renderedMessages.map((message, index) => {
          const priorRunId = renderedMessages[index - 1]?.runId;
          const runIndex = message.runId ? task.runs?.findIndex((run) => run.id === message.runId) : -1;
          const showRunDivider = Boolean(message.runId && message.runId !== priorRunId);
          return (
            <React.Fragment key={message.id}>
              {showRunDivider ? (
                <div className="transcript-run-divider">
                  <span>Run #{runIndex >= 0 ? runIndex + 1 : "?"}</span>
                  <small>{ruxAgentLabel(message.agent || task.agent)}{message.adapter ? ` · ${ruxAdapterLabel(message.adapter)}` : ""}</small>
                </div>
              ) : null}
              <Message message={message} agent={task.agent} run={message.runId ? task.runs?.find((run) => run.id === message.runId) : undefined} />
            </React.Fragment>
          );
        })}

        {isWaiting ? (
          <section className="waiting-card">
            <span className="waiting-icon"><Play size={18} /></span>
            <div>
              <h3>这个 Run 还未开始</h3>
              <p>{workspacePlaceholder ? "先打开一个项目，然后描述你想完成的任务。" : "在下方输入框描述任务，确认 Agent、模型和 Permission 后发送。"}</p>
            </div>
            <button type="button" className="primary-button" onClick={onWaitingAction}>{workspacePlaceholder ? "打开项目" : "描述任务"}</button>
          </section>
        ) : (
          <section className="agent-response">
            {!hasAssistantMessage || !isCompleted ? <p className="agent-response-lead">{responseLead}</p> : null}

            {pendingPermission ? (
              <div ref={permissionTargetRef}>
                <PermissionCard
                  request={pendingPermission}
                  busy={permissionBusy === pendingPermission.id}
                  error={permissionError}
                  onDecision={onPermissionDecision}
                />
              </div>
            ) : null}

            {reasoning ? (
              <details className="process-disclosure">
                <summary>
                  <Sparkles size={15} />
                  <span>Reasoning summary</span>
                  <ChevronRight size={15} className="disclosure-chevron" />
                </summary>
                <p>{String(reasoning)}</p>
              </details>
            ) : null}

            {task.activity.length ? <details className="process-disclosure">
              <summary>
                <Search size={15} />
                <span>{task.activity.length} 个 Runtime 活动</span>
                <ChevronRight size={15} className="disclosure-chevron" />
              </summary>
              <div className="compact-activity-list">
                {task.activity.map((item) => <ActivityRow key={item.id} item={item} />)}
              </div>
            </details> : null}

            {!isCompleted && task.plan.length ? (
              <details className="process-disclosure plan-disclosure">
                <summary>
                  <LayoutList size={15} />
                  <span>Plan {doneCount} of {task.plan.length}</span>
                  <ChevronRight size={15} className="disclosure-chevron" />
                </summary>
                <ol>
                  {task.plan.map((step) => <PlanStep key={step.label} step={step} />)}
                </ol>
              </details>
            ) : null}

            {!isCompleted ? (
              <div className={`agent-run-status is-${task.status}`}>
                <StatusIcon status={task.status} size={15} />
                <span>{task.status === "stopped" ? "运行已停止" : task.status === "failed" ? "运行失败" : task.status === "interrupted" ? "运行已中断" : task.status === "blocked" ? "等待权限决定" : "正在执行任务"}</span>
                <small>{ruxAgentLabel(task.agent)} · {ruxModelLabel(task.model)}</small>
              </div>
            ) : null}

            {hasOutcome && latestRun ? (
              <>
                {!hasAssistantMessage ? <p className="agent-result-copy">
                  {task.status === "failed" ? "Run 已结束并包含失败证据" : "Runtime 已报告完成"}
                  {latestRun.durationMs ? ` · ${formatDuration(latestRun.durationMs)}` : ""}
                  {latestRun.turns ? ` · ${latestRun.turns} turn` : ""}。
                  {!verifications.length ? "未收到结构化验证证据，不会显示测试或构建通过。" : "验证结论只来自下方结构化证据。"}
                </p> : null}
                {verifications.length ? (
                  <button type="button" className={`verification-callout ${verificationCounts.failed ? "has-failure" : ""}`} onClick={onOpenRun}>
                    <span>{verificationCounts.failed ? <CircleAlert size={16} /> : <ShieldCheck size={16} />}</span>
                    <strong>{verifications.length} 项验证证据</strong>
                    <small>{verificationCounts.passed} 通过 · {verificationCounts.failed} 失败 · {verificationCounts.unknown} 未知</small>
                    <ChevronRight size={15} />
                  </button>
                ) : null}
              </>
            ) : null}

            {runPatch?.totals.files ? (
              <button type="button" className="run-change-callout" onClick={onOpenRun}>
                <span className="change-callout-icon"><GitCompareArrows size={18} /></span>
                <span className="change-callout-copy">
                  <strong>Run changed {runPatch.totals.files} files</strong>
                  <span><b>+{runPatch.totals.additions}</b> <em>−{runPatch.totals.deletions}</em> · baseline-owned</span>
                </span>
                <span className="change-review-label">Evidence <ChevronRight size={17} /></span>
              </button>
            ) : null}

            {totals?.files ? <ChangedFilesCard state={changes} onOpenChanges={onOpenChanges} onRestoreChanges={onRestoreChanges} /> : null}
            {hasOutcome && (hasAssistantMessage || totals?.files) ? (
              <div className="transcript-feedback" aria-label="回复操作">
                <button type="button" onClick={() => void navigator.clipboard?.writeText(task.messages.filter((message) => message.role === "assistant").at(-1)?.text || "")} aria-label="复制回复"><Copy size={15} /></button>
                <button type="button" aria-label="赞"><ThumbsUp size={15} /></button>
                <button type="button" aria-label="踩"><ThumbsDown size={15} /></button>
                <button type="button" aria-label="展开回复"><Maximize2 size={15} /></button>
              </div>
            ) : null}
          </section>
        )}
          <div ref={timelineEndRef} aria-hidden="true" />
        </div>
      </div>
      {showJumpToLatest ? <button type="button" className="timeline-jump-button" onClick={() => {
        timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        setShowJumpToLatest(false);
      }}><ChevronDown size={14} />回到最新</button> : null}
    </div>
  );
}

function Composer({ task, draft, onDraft, onSend, onAgentChange, onModelChange, onReasoningEffortChange, onPermissionChange, onOpenAccounts, focusRef, agentChoices, codexModels, codexCatalog, canRun = true }) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [manualModel, setManualModel] = useState(task.model || "");
  const composerRef = useRef(null);
  const textareaRef = useRef(null);
  const isActive = task.status === "running" || task.status === "blocked";
  const selectedAgentId = task.agentProfileId || runtimeAdapterForTask(task);
  const selectedAgentChoice = agentChoices.find((choice) => choice.id === selectedAgentId);
  const taskAutoModelPolicy = task.agentRevisionSnapshot?.autoModelPolicy
    || (selectedAgentChoice?.agentRevisionId === task.agentRevisionId ? selectedAgentChoice.autoModelPolicy : undefined);
  const selectedAgentAvailable = Boolean(selectedAgentChoice?.available);
  const submit = () => {
    if (!isActive && selectedAgentAvailable && draft.trim()) onSend();
  };
  const modelOptions = Array.from(new Set([
    task.model,
    ...(taskAutoModelPolicy ? ["Auto"] : []),
    ...(selectedAgentChoice?.verifiedModels || []).map((item) => item.model),
    ...(runtimeAdapterForTask(task) === "codex"
      ? ["Rux default", ...(codexModels || []).map((model) => model.model)]
      : runtimeAdapterForTask(task) === "claude-code" ? ["Claude default"] : ["Rux prototype"]),
  ].filter(Boolean)));
  const reasoningOptions = runtimeAdapterForTask(task) === "codex"
    ? codexReasoningOptions(codexModels, task.model)
    : [];
  const permissionVisualLabel = (!window.rux && task.id === "devspace-intro") ? "完全访问" : (task.permissionMode === "dontAsk"
    ? "工作区访问"
    : task.permissionMode === "plan" ? "只读访问" : "工作区访问");
  const modelVisualLabel = (model) => {
    const value = String(model || "");
    if (/5\.6/i.test(value)) return "5.6 Sol 中";
    if (/^(codex|rux) default$/i.test(value)) return "Rux 中";
    if (/sonnet/i.test(value)) return "Sonnet 中";
    if (/opus/i.test(value)) return "Opus 中";
    return ruxModelLabel(value.replace(/^GPT-/i, "")) || "默认模型";
  };

  useEffect(() => {
    if (!optionsOpen) return undefined;
    const close = (event) => {
      if (!composerRef.current?.contains(event.target)) setOptionsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOptionsOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [optionsOpen]);

  useEffect(() => {
    if (optionsOpen) setManualModel(task.model || "");
  }, [optionsOpen, task.id, task.model]);

  const missingFromCatalog = runtimeAdapterForTask(task) === "codex" && catalogModelMissing(task, codexCatalog);

  return (
    <div className="composer-dock">
      <div className="composer-shell" ref={composerRef}>
        <textarea
          ref={(node) => {
            textareaRef.current = node;
            if (focusRef) focusRef.current = node;
          }}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="随心输入"
          aria-label="给 Agent 发送消息"
          rows={2}
          disabled={!canRun}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button type="button" className={`composer-icon-button ${optionsOpen ? "is-active" : ""}`} aria-label="添加内容与运行设置" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}><Plus size={19} /></button>
            <select className="composer-agent-select" aria-label="选择 Agent" value={selectedAgentId} onChange={(event) => onAgentChange(event.target.value)} disabled={!canRun || isActive}>
              {!selectedAgentChoice ? <option value={selectedAgentId} disabled>{ruxAgentLabel(task.agent)}（Definition 已删除）</option> : null}
              {agentChoices.map((agent) => <option value={agent.id} key={agent.id} disabled={!agent.available}>{ruxAgentLabel(agent.name)}{agent.available ? "" : "（不可用）"}</option>)}
            </select>
            {!selectedAgentAvailable ? <button type="button" className="composer-connect-button" onClick={onOpenAccounts}><CircleAlert size={13} />配置连接</button> : null}
            <button type="button" className={`permission-chip ${permissionVisualLabel === "完全访问" ? "is-full-access" : ""}`} onClick={() => setOptionsOpen((open) => !open)} aria-label={`权限：${permissionVisualLabel}`}><ShieldCheck size={16} /><span>{permissionVisualLabel}</span></button>
          </div>
          <div className="composer-submit-area">
            <CircleDashed size={18} className={isActive ? "status-running" : "composer-context-status"} aria-label={isActive ? "运行中" : "上下文就绪"} />
            <select
              className="composer-model-select"
              aria-label="选择模型"
              value={task.model}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={!canRun || isActive}
            >
              {modelOptions.map((model) => <option value={model} key={model}>{modelVisualLabel(model)}</option>)}
            </select>
            <button type="button" className={`composer-mic-button ${dictating ? "is-active" : ""}`} aria-label="语音输入" aria-pressed={dictating} onClick={() => { setDictating((active) => !active); textareaRef.current?.focus(); }}><Mic size={19} /></button>
            <button
              type="button"
              className="send-button"
              disabled={!canRun || !selectedAgentAvailable || isActive || !draft.trim()}
              onClick={submit}
              aria-label="发送"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
        {optionsOpen ? (
          <div className="composer-options-popover" role="group" aria-label="运行设置">
            <label><span>访问权限</span><select aria-label="Permission" value={task.permissionMode || "acceptEdits"} onChange={(event) => onPermissionChange(event.target.value)} disabled={!canRun || isActive}>
              {permissionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select></label>
            {runtimeAdapterForTask(task) === "codex" ? (
              <label><span>推理强度</span><select aria-label="Rux 推理强度" value={task.reasoningEffort || ""} onChange={(event) => onReasoningEffortChange(event.target.value)} disabled={!canRun || isActive}>
                <option value="">模型默认</option>
                {reasoningOptions.map((option) => <option key={option.reasoningEffort} value={option.reasoningEffort}>{reasoningEffortLabel(option.reasoningEffort)}</option>)}
              </select></label>
            ) : null}
            <div className="composer-manual-model">
              <span>高级模型 ID</span>
              <div><input value={manualModel} onChange={(event) => setManualModel(event.target.value)} placeholder="由 Engine 支持的模型 ID" disabled={!canRun || isActive} /><button type="button" className="secondary-button" disabled={!manualModel.trim() || manualModel.trim() === task.model || !canRun || isActive} onClick={() => onModelChange(manualModel.trim())}>应用</button></div>
              <small>{modelStateLabel(task.modelSource, task.modelVerificationStatus)}</small>
            </div>
            <p><CircleDot size={11} /> 本地 · <GitBranch size={11} /> {task.branch} · {permissionLabel(task.permissionMode)}</p>
          </div>
        ) : null}
      </div>
      {missingFromCatalog ? (
        <div className="composer-context-row" role="status">
          <span className="composer-agent-warning"><CircleAlert size={11} /> {ruxModelLabel(task.model)} 已不在最新官方目录中，不会自动替换</span>
        </div>
      ) : null}
    </div>
  );
}

function TaskHeader({
  task,
  workspace,
  onMenu,
  onExpandSidebar,
  sidebarCollapsed,
  onToggleTerminal,
  terminalOpen,
  onToggleRun,
  onToggleInspector,
  onOpenWorkspace,
  onRenameTask,
  onTogglePinTask,
  onArchiveTask,
  inspectorOpen,
  changesCount,
  canRun = true,
  canArchive = true,
}) {
  const needsProject = Boolean(workspace?.placeholder);
  const taskIsRunning = ["running", "blocked"].includes(task.status);
  const archiveDisabled = needsProject || (!task.archived && (taskIsRunning || !canArchive));
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(task.title);
  const taskMenuRef = useRef(null);
  const taskMenuTriggerRef = useRef(null);
  const locationMenuRef = useRef(null);
  const locationMenuTriggerRef = useRef(null);

  useEffect(() => {
    setRenameTitle(task.title);
    setRenaming(false);
    setTaskMenuOpen(false);
    setLocationMenuOpen(false);
  }, [task.id, task.title, needsProject]);

  useEffect(() => {
    if (!taskMenuOpen && !locationMenuOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (taskMenuOpen && !taskMenuRef.current?.contains(event.target)) {
        setTaskMenuOpen(false);
        setRenaming(false);
        setRenameTitle(task.title);
      }
      if (locationMenuOpen && !locationMenuRef.current?.contains(event.target)) {
        setLocationMenuOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (taskMenuOpen) {
        setTaskMenuOpen(false);
        setRenaming(false);
        setRenameTitle(task.title);
        window.requestAnimationFrame(() => taskMenuTriggerRef.current?.focus());
      } else if (locationMenuOpen) {
        setLocationMenuOpen(false);
        window.requestAnimationFrame(() => locationMenuTriggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [locationMenuOpen, task.title, taskMenuOpen]);

  const closeTaskMenu = () => {
    setTaskMenuOpen(false);
    setRenaming(false);
    setRenameTitle(task.title);
    window.requestAnimationFrame(() => taskMenuTriggerRef.current?.focus());
  };

  const submitRename = (event) => {
    event.preventDefault();
    const nextTitle = renameTitle.trim();
    if (!nextTitle || needsProject) return;
    onRenameTask(nextTitle);
    setTaskMenuOpen(false);
    setRenaming(false);
    window.requestAnimationFrame(() => taskMenuTriggerRef.current?.focus());
  };

  const chooseOpenTarget = (target) => {
    setLocationMenuOpen(false);
    onOpenWorkspace(target);
    window.requestAnimationFrame(() => locationMenuTriggerRef.current?.focus());
  };

  return (
    <header className="task-header">
      <div className="task-header-left">
        <button className="icon-button menu-button" type="button" onClick={onMenu} aria-label="打开侧栏"><Menu size={18} /></button>
        {sidebarCollapsed ? (
          <button className="icon-button collapsed-sidebar-button" type="button" onClick={onExpandSidebar} aria-label="展开侧栏" title="展开侧栏">
            <PanelLeftOpen size={18} />
          </button>
        ) : null}
        <Folder size={17} className="task-title-folder" />
        <div className="task-header-titles"><div className="task-header-title-row"><h1>{task.id === "devspace-intro" ? "介绍项目" : task.title}</h1></div></div>
        <div className="task-title-action-shell" ref={taskMenuRef}>
          <button
            ref={taskMenuTriggerRef}
            type="button"
            className={`task-title-more ${taskMenuOpen ? "is-active" : ""}`}
            aria-label={`任务操作：${task.title}`}
            aria-haspopup="menu"
            aria-expanded={taskMenuOpen}
            aria-controls={taskMenuOpen ? "task-header-action-menu" : undefined}
            disabled={needsProject}
            title={needsProject ? "请先打开项目" : "任务操作"}
            onClick={() => {
              setLocationMenuOpen(false);
              setRenaming(false);
              setRenameTitle(task.title);
              setTaskMenuOpen((open) => !open);
            }}
          ><MoreHorizontal size={18} /></button>
          {taskMenuOpen ? (
            <div id="task-header-action-menu" className="task-header-action-menu" role={renaming ? "dialog" : "menu"} aria-label={renaming ? "重命名任务" : "任务操作"}>
              {renaming ? (
                <form className="task-header-rename-form" onSubmit={submitRename}>
                  <label htmlFor="task-header-rename-input">任务名称</label>
                  <input
                    id="task-header-rename-input"
                    autoFocus
                    value={renameTitle}
                    onChange={(event) => setRenameTitle(event.target.value)}
                    maxLength={240}
                  />
                  <div>
                    <button type="button" onClick={closeTaskMenu}><X size={14} />取消</button>
                    <button type="submit" className="is-primary" disabled={!renameTitle.trim()}><Check size={14} />保存</button>
                  </div>
                </form>
              ) : (
                <>
                  <button autoFocus type="button" role="menuitem" onClick={() => setRenaming(true)}><PencilLine size={15} />重命名</button>
                  {!task.archived ? (
                    <button type="button" role="menuitem" onClick={() => { onTogglePinTask(); closeTaskMenu(); }}><Pin size={15} />{task.pinned ? "取消置顶" : "置顶任务"}</button>
                  ) : null}
                  <span className="task-header-menu-separator" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    disabled={archiveDisabled}
                    title={taskIsRunning && !task.archived
                      ? "运行中的任务不能归档"
                      : !canArchive && !task.archived
                        ? "每个项目至少保留一个未归档任务"
                        : undefined}
                    onClick={() => { onArchiveTask(!task.archived); closeTaskMenu(); }}
                  ><Archive size={15} />{task.archived ? "重新打开任务" : "归档任务"}</button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="task-header-actions">
        <div className="open-location-shell" ref={locationMenuRef}>
          <button
            ref={locationMenuTriggerRef}
            type="button"
            className={`open-location-button ${locationMenuOpen ? "is-active" : ""}`}
            onClick={() => {
              if (needsProject) {
                onOpenWorkspace();
                return;
              }
              setTaskMenuOpen(false);
              setRenaming(false);
              setLocationMenuOpen((open) => !open);
            }}
            aria-label={needsProject ? "打开项目" : "打开位置"}
            aria-haspopup={needsProject ? undefined : "menu"}
            aria-expanded={needsProject ? undefined : locationMenuOpen}
            aria-controls={locationMenuOpen ? "open-location-menu" : undefined}
          >
            {needsProject ? <FolderPlus size={17} /> : <Code2 size={17} className="vscode-symbol" />}
            <span>{needsProject ? "打开项目" : "打开位置"}</span>
            {!needsProject ? <ChevronDown size={16} /> : null}
          </button>
          {locationMenuOpen ? (
            <div id="open-location-menu" className="open-location-menu" role="menu" aria-label="选择打开位置">
              <button autoFocus type="button" role="menuitem" onClick={() => chooseOpenTarget("vscode")}><Code2 size={15} className="vscode-symbol" /><span><strong>在 VS Code 中打开</strong><small>使用 vscode://file</small></span></button>
              <button type="button" role="menuitem" onClick={() => chooseOpenTarget("finder")}><Folder size={15} /><span><strong>在 Finder 中显示</strong><small>显示当前项目文件夹</small></span></button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={`icon-button environment-trigger ${inspectorOpen ? "is-active" : ""}`}
          onClick={onToggleInspector}
          aria-pressed={inspectorOpen}
          aria-label="环境信息"
          title={needsProject ? "请先打开项目" : "环境信息"}
          disabled={needsProject}
        >
          <ListFilter size={18} />
        </button>
        <button
          type="button"
          className={`icon-button terminal-trigger ${terminalOpen ? "is-active" : ""}`}
          onClick={onToggleTerminal}
          aria-pressed={terminalOpen}
          aria-label="终端"
          title={needsProject ? "请先打开项目" : "终端"}
          disabled={needsProject}
        >
          <SquareTerminal size={17} />
        </button>
        <button type="button" className={`icon-button panel-trigger ${inspectorOpen ? "is-active" : ""}`} onClick={onToggleInspector} aria-label={inspectorOpen ? "关闭环境面板" : "打开环境面板"} title={needsProject ? "请先打开项目" : undefined} disabled={needsProject}><PanelRight size={17} /></button>
        {["running", "blocked", "stopped", "failed", "interrupted"].includes(task.status) ? (
          <button type="button" className="icon-button run-control" onClick={onToggleRun} disabled={!canRun} aria-label={["running", "blocked"].includes(task.status) ? "停止运行" : "开始新的 Run"} title={["running", "blocked"].includes(task.status) ? "停止运行" : "开始新的 Run"}>
            {["running", "blocked"].includes(task.status) ? <Square size={14} /> : <Play size={15} />}
          </button>
        ) : null}
      </div>
    </header>
  );
}

function ChangesPane({ state, selectedFile, onSelectFile, onRefresh, onRestore, onAccept }) {
  const snapshot = state.snapshot;
  const files = snapshot?.files || [];
  const totals = snapshot?.totals || { files: 0, additions: 0, deletions: 0, binaryFiles: 0 };
  const selected = files.find((file) => file.path === selectedFile);
  return (
    <div className="inspector-scroll">
      <div className="changes-summary">
        <div>
          <strong>{state.loading ? "正在读取 Git…" : `${totals.files} 个 Workspace 文件已更改`}</strong>
          <span>+{totals.additions} <em>−{totals.deletions}</em>{totals.binaryFiles ? ` · ${totals.binaryFiles} binary` : ""}</span>
        </div>
        <button type="button" className="review-filter" onClick={onRefresh} disabled={state.loading}><RotateCcw size={14} /> Workspace</button>
      </div>

      {state.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{state.error}</span></div> : null}
      {state.acceptance && state.acceptance.snapshotId === snapshot?.snapshotId ? (
        <div className="review-notice"><CheckCircle2 size={14} /> 已记录本次审查；Git index 和工作区未被修改。</div>
      ) : null}

      <div className="file-list" aria-label="变更文件">
        {files.map((file) => (
          <button
            type="button"
            key={file.path}
            className={selectedFile === file.path ? "is-selected" : ""}
            onClick={() => onSelectFile(file.path)}
          >
            <FileCode2 size={15} />
            <span className="file-name"><strong>{file.path.split("/").pop()}</strong><small>{file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</small></span>
            <span className="file-stat"><b>+{file.additions}</b><em>−{file.deletions}</em></span>
          </button>
        ))}
        {!state.loading && !files.length ? <p className="empty-inspector-copy">当前 Workspace 没有未提交变更。</p> : null}
      </div>

      {selected ? <div className="diff-panel">
        <div className="diff-header">
          <span><FileCode2 size={14} /> {selectedFile}</span>
        </div>
        <div className="diff-code" role="region" aria-label={`${selectedFile} 差异`}>
          {state.diffLoading ? <p className="empty-inspector-copy">正在读取 Diff…</p> : null}
          {state.diff?.sections?.map((section) => (
            <section className="real-diff-section" key={section.layer}>
              <div className="real-diff-layer">{section.layer}</div>
              {section.patch === null
                ? <p className="empty-inspector-copy">Binary diff · 无文本补丁</p>
                : <pre>{section.patch || "No textual changes"}</pre>}
            </section>
          ))}
        </div>
      </div> : null}

      <div className="review-actions">
        <button type="button" className="secondary-button" onClick={onRestore} disabled={!selected || state.loading}><RotateCcw size={14} /> Restore selected</button>
        <button type="button" className="primary-button" onClick={onAccept} disabled={!files.length || state.loading}><Check size={14} /> Accept review</button>
      </div>
      <p className="review-semantics">Accept 只记录审查，不会 stage、commit 或 push。Restore 会先显示准确预览并要求二次确认。</p>
    </div>
  );
}

function ContextPane({ state, changes, selectedPaths, onRefresh, onToggleFile }) {
  const snapshot = state.snapshot;
  const candidates = changes.snapshot?.files || [];
  const selectedSources = selectedPaths.map((path) => snapshot?.selectedFiles?.find((source) => source.path === path) || {
    kind: "selected-file",
    path,
    bytes: 0,
  });
  return (
    <div className="inspector-scroll context-pane">
      <div className="context-heading-row">
        <div><strong>Runtime Context</strong><small>{snapshot ? `更新于 ${new Date(snapshot.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "尚未读取"}</small></div>
        <button type="button" className="review-filter" onClick={() => onRefresh()} disabled={state.loading}><RotateCcw size={14} /> 刷新</button>
      </div>
      {state.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{state.error}</span></div> : null}
      <p className="context-truth-copy">文件 Context 默认不发送。只有你在下面明确勾选、并通过敏感信息检查的文件，才会进入下一次 Run；自定义 Agent 指令会在 Run 启动时注入。</p>
      <section className="context-group context-picker-group">
        <div className="context-group-heading is-static"><Plus size={15} /><span><strong>Include changed files</strong><small>{selectedPaths.length} selected · opt-in</small></span></div>
        <div className="context-file-picker">
          {candidates.map((file) => (
            <label key={file.path}>
              <input type="checkbox" checked={selectedPaths.includes(file.path)} onChange={() => void onToggleFile(file.path)} disabled={state.loading} />
              <span><strong>{file.path}</strong><small>{file.kind} · +{file.additions} −{file.deletions}</small></span>
            </label>
          ))}
          {!candidates.length ? <p>当前没有可选择的 Git 变更文件。</p> : null}
        </div>
        <p className="context-privacy-note"><ShieldCheck size={13} /> .env、私钥、凭据路径和明显的 token 内容会在 Runtime 边界阻断，不会进入 provider prompt。</p>
      </section>
      <ContextGroup title="Project instructions" items={snapshot?.instructions || []} empty="未检测到 Workspace 指令文件" />
      <ContextGroup title="Selected files" items={selectedSources} empty="未选择文件；下一次 Run 不会附带文件内容" onRemove={(path) => void onToggleFile(path)} disabled={state.loading} />
      <section className="context-group">
        <div className="context-group-heading is-static"><Braces size={15} /><span><strong>Capabilities</strong><small>当前 Runtime 可用能力</small></span></div>
        <div className="context-items">{(snapshot?.capabilities || []).map((item) => <span key={item}>{item}</span>)}</div>
      </section>
    </div>
  );
}

function ContextGroup({ title, items, empty, onRemove, disabled = false }) {
  return (
    <section className="context-group">
      <div className="context-group-heading is-static"><FileCode2 size={15} /><span><strong>{title}</strong><small>{items.length} sources</small></span></div>
      <div className="context-items">
        {items.map((item) => onRemove ? (
          <div className="context-selected-source" key={`${item.kind}-${item.path}`}>
            <span>{item.path} · {item.bytes} bytes{item.exists === false ? " · missing" : ""}</span>
            <button type="button" onClick={() => onRemove(item.path)} disabled={disabled} aria-label={`从下一次 Run Context 移除 ${item.path}`} title="从下一次 Run Context 移除"><X size={12} /></button>
          </div>
        ) : <span key={`${item.kind}-${item.path}`}>{item.path} · {item.bytes} bytes</span>)}
        {!items.length ? <span>{empty}</span> : null}
      </div>
    </section>
  );
}

function RunPane({ task, onToggleRun, runReviewState, onOpenRunDiff, onAcceptRunReview, runRestorePreview, runRestoreBusy, runRestoreError, onPreviewRunRestore, onConfirmRunRestore, onCancelRunRestore }) {
  const runs = task.runs || [];
  const latestRun = runs[runs.length - 1];
  const [selectedRunId, setSelectedRunId] = useState(latestRun?.id || "");

  useEffect(() => {
    setSelectedRunId(latestRun?.id || "");
  }, [latestRun?.id]);

  const inspectedRun = runs.find((run) => run.id === selectedRunId) || latestRun;
  const inspectedIndex = inspectedRun ? runs.findIndex((run) => run.id === inspectedRun.id) : -1;
  const isLatest = Boolean(inspectedRun && latestRun?.id === inspectedRun.id);
  const inspectedTaskStatus = inspectedRun?.status === "waiting-permission"
    ? "blocked"
    : inspectedRun?.status === "running"
      ? "running"
      : inspectedRun?.status === "completed"
        ? "completed"
        : inspectedRun?.status === "failed"
          ? "failed"
          : inspectedRun?.status === "interrupted"
            ? "interrupted"
            : inspectedRun ? "stopped" : "waiting";
  const events = inspectedRun?.events?.slice(-12) || [];
  const verifications = inspectedRun?.verifications || [];
  const permissionDecisions = inspectedRun?.permissionDecisions || [];
  const permissionRequests = [...(inspectedRun?.permissionRequests || [])].sort((left, right) => {
    const leftDecision = permissionDecisions.find((item) => item.requestId === left.id);
    const rightDecision = permissionDecisions.find((item) => item.requestId === right.id);
    return (leftDecision?.decidedAt || left.requestedAt).localeCompare(rightDecision?.decidedAt || right.requestedAt)
      || left.id.localeCompare(right.id);
  });
  const visibleRestorePreview = runRestorePreview?.runId === inspectedRun?.id ? runRestorePreview : null;
  const visibleRunReview = runReviewState?.runId === inspectedRun?.id ? runReviewState : null;
  const runAcceptance = inspectedRun?.gitPatch
    ? [...(task.reviewAcceptances || [])].reverse().find((item) => (
        item.runId === inspectedRun.id
        && item.runPatchSnapshotId === inspectedRun.gitPatch.snapshotId
      ))
    : null;

  return (
    <div className="inspector-scroll run-pane">
      {runs.length > 1 ? (
        <div className="run-history-picker">
          <label htmlFor="run-history-select">Run history</label>
          <select id="run-history-select" aria-label="选择 Run 历史" value={inspectedRun?.id || ""} onChange={(event) => { setSelectedRunId(event.target.value); onCancelRunRestore(); }}>
            {runs.map((run, index) => <option key={run.id} value={run.id}>Run #{index + 1} · {ruxAdapterLabel(run.adapter)} · {run.status}</option>)}
          </select>
        </div>
      ) : null}

      <section className="run-status-card">
        <div className="run-status-heading">
          <span className={`large-status is-${inspectedTaskStatus}`}><StatusIcon status={inspectedTaskStatus} size={18} /></span>
          <div><strong>{statusLabel[inspectedTaskStatus]}</strong><small>{inspectedRun ? `Run #${inspectedIndex + 1} · ${inspectedRun.status}${isLatest ? " · latest" : " · historical"}` : "尚无 Run"}</small></div>
        </div>
        <dl>
          <div><dt>Agent</dt><dd><Bot size={13} /> {ruxAgentLabel(inspectedRun?.agentSnapshot?.name || task.agent)}</dd></div>
          <div><dt>Engine</dt><dd>{ruxAdapterLabel(inspectedRun?.adapter || runtimeAdapterForTask(task))}</dd></div>
          <div><dt>Revision</dt><dd title={inspectedRun?.agentRevisionId || task.agentRevisionId}>{inspectedRun?.agentRevisionId || task.agentRevisionId}</dd></div>
          <div><dt>Connection</dt><dd title={inspectedRun?.providerConnection?.label || task.providerConnection?.label}>{inspectedRun?.providerConnection?.label || task.providerConnection?.label || "—"}</dd></div>
          <div><dt>Model</dt><dd>{ruxModelLabel(inspectedRun?.model || task.model)}</dd></div>
          <div><dt>Model state</dt><dd>{modelStateLabel(inspectedRun?.modelSource || task.modelSource, inspectedRun?.modelVerificationStatus || task.modelVerificationStatus)}</dd></div>
          <div><dt>Reasoning</dt><dd>{reasoningEffortLabel(inspectedRun?.reasoningEffort || task.reasoningEffort)}</dd></div>
          <div><dt>Elapsed</dt><dd>{formatDuration(inspectedRun?.durationMs) || (isLatest ? task.elapsed : "—")}</dd></div>
          <div><dt>Tokens</dt><dd>{tokenUsageTotal(inspectedRun?.tokenUsage) === undefined ? "未报告" : tokenUsageTotal(inspectedRun.tokenUsage).toLocaleString("en-US")}</dd></div>
          {inspectedRun?.costUsd === undefined ? null : <div><dt>Cost</dt><dd>${inspectedRun.costUsd.toFixed(4)}</dd></div>}
          <div><dt>Permission</dt><dd><ShieldCheck size={13} /> {permissionLabel(inspectedRun?.permissionMode || task.permissionMode)}</dd></div>
          <div><dt>Session</dt><dd title={inspectedRun?.sessionLink?.nativeSessionId || inspectedRun?.sessionId || ""}>{inspectedRun?.sessionLink?.kind === "codex-thread" ? "Codex Thread" : inspectedRun?.sessionLink?.kind === "claude-session" ? "Claude Session" : inspectedRun?.sessionId ? "Native Session" : "尚未建立"}{inspectedRun?.sessionLink?.nativeSessionId || inspectedRun?.sessionId ? ` · ${inspectedRun?.sessionLink?.nativeSessionId || inspectedRun?.sessionId}` : ""}</dd></div>
        </dl>
      </section>

      {inspectedRun?.modelDecision ? <section className="run-section run-model-decision" aria-label="模型路由决定">
        <h3>Model decision</h3>
        <dl>
          <div><dt>Mode</dt><dd>{inspectedRun.modelDecision.mode === "auto" ? `Auto · ${inspectedRun.modelDecision.classification === "complex" ? "复杂任务" : "简单任务"}` : "固定模型"}</dd></div>
          <div><dt>Actual model</dt><dd>{ruxModelLabel(inspectedRun.modelDecision.actualModel)}</dd></div>
          {inspectedRun.modelDecision.strategy ? <div><dt>Strategy</dt><dd>{inspectedRun.modelDecision.strategy} · score {inspectedRun.modelDecision.score} / {inspectedRun.modelDecision.threshold}</dd></div> : null}
          <div><dt>Reason</dt><dd>{inspectedRun.modelDecision.rationale}</dd></div>
          {inspectedRun.modelDecision.fallback ? <div><dt>Fallback</dt><dd>{ruxModelLabel(inspectedRun.modelDecision.fallback.fromModel)} → {ruxModelLabel(inspectedRun.modelDecision.fallback.toModel)} · {inspectedRun.modelDecision.fallback.reason}</dd></div> : null}
        </dl>
      </section> : null}

      <section className="run-section run-token-usage" aria-label="Token 用量明细">
        <h3>Token usage</h3>
        {inspectedRun?.tokenUsage ? <dl>
          <div><dt>Input</dt><dd>{inspectedRun.tokenUsage.inputTokens?.toLocaleString("en-US") ?? "未报告"}</dd></div>
          <div><dt>Cached input</dt><dd>{inspectedRun.tokenUsage.cachedInputTokens?.toLocaleString("en-US") ?? "未报告"}</dd></div>
          <div><dt>Output</dt><dd>{inspectedRun.tokenUsage.outputTokens?.toLocaleString("en-US") ?? "未报告"}</dd></div>
          <div><dt>Reasoning</dt><dd>{inspectedRun.tokenUsage.reasoningOutputTokens?.toLocaleString("en-US") ?? "未报告"}</dd></div>
          <div><dt>Total</dt><dd>{tokenUsageTotal(inspectedRun.tokenUsage)?.toLocaleString("en-US") ?? "未报告"}{inspectedRun.tokenUsage.isEstimate ? " · 估算" : ""}</dd></div>
          <div><dt>Source</dt><dd>{inspectedRun.tokenUsage.source === "engine" ? "Engine 报告" : inspectedRun.tokenUsage.source === "provider" ? "Provider 报告" : "Rux 估算"}</dd></div>
        </dl> : <p>Engine / Provider 未报告本次 Run 的 Token 用量；Rux 不会把估算值冒充为计费事实。</p>}
      </section>

      {permissionRequests.length ? (
        <section className="run-section">
          <h3>Permission history</h3>
          <div className="permission-history">
            {permissionRequests.map((request) => {
              const decision = permissionDecisions.find((item) => item.requestId === request.id);
              return (
                <article key={request.id} className={`permission-history-row is-${decision?.decision || request.status}`}>
                  <header><ShieldCheck size={14} /><strong>{request.action}</strong><small>{decision?.decision || request.status}</small></header>
                  <p>{request.scope.path} · {request.scope.appliesTo === "single-action" ? "仅这一项操作" : "仅本次 Run"}{request.provider ? ` · ${ruxAdapterLabel(request.provider)}` : ""}</p>
                  <small>{decision ? new Date(decision.decidedAt).toLocaleString("zh-CN") : `请求于 ${new Date(request.requestedAt).toLocaleString("zh-CN")}`}</small>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {inspectedRun?.agentSnapshot ? (
        <section className="run-section">
          <h3>Agent snapshot</h3>
          <div className="run-agent-snapshot">
            <header><Bot size={15} /><span><strong>{ruxAgentLabel(inspectedRun.agentSnapshot.name)}</strong><small>{ruxAdapterLabel(inspectedRun.agentSnapshot.backend)} · immutable Run history</small></span></header>
            <p>{inspectedRun.agentSnapshot.instructions}</p>
            <dl>
              <div><dt>Model</dt><dd>{inspectedRun.agentSnapshot.model ? ruxModelLabel(inspectedRun.agentSnapshot.model) : "底座默认"}</dd></div>
              <div><dt>Permission</dt><dd>{permissionLabel(inspectedRun.agentSnapshot.permissionMode)}</dd></div>
              <div><dt>Skills</dt><dd>{inspectedRun.agentSnapshot.skillIds.length ? inspectedRun.agentSnapshot.skillIds.join(", ") : "未配置"}</dd></div>
              <div><dt>Tools</dt><dd>{inspectedRun.agentSnapshot.toolIds.length ? inspectedRun.agentSnapshot.toolIds.join(", ") : "未配置"}</dd></div>
            </dl>
          </div>
        </section>
      ) : null}

      {inspectedRun?.contextSnapshot ? (
        <section className="run-section">
          <h3>Context snapshot</h3>
          <div className="run-context-snapshot">
            <header><Braces size={15} /><span><strong>Immutable Run input</strong><small>{new Date(inspectedRun.contextSnapshot.generatedAt).toLocaleString("zh-CN")}</small></span></header>
            <p title={inspectedRun.contextSnapshot.workspaceRoot}>{inspectedRun.contextSnapshot.workspaceRoot}</p>
            {[...inspectedRun.contextSnapshot.instructions, ...inspectedRun.contextSnapshot.selectedFiles].map((source) => (
              <details key={`${source.kind}-${source.path}`}>
                <summary><span>{source.path}</span><small>{source.kind} · {source.sha256.slice(0, 10)}{source.truncated ? " · truncated" : ""}{source.binary ? " · binary" : ""}{!source.exists ? " · missing" : ""}</small></summary>
                {source.content ? <pre>{source.content}</pre> : <p>没有注入文本内容。</p>}
              </details>
            ))}
            {!inspectedRun.contextSnapshot.instructions.length && !inspectedRun.contextSnapshot.selectedFiles.length ? <p>此 Run 没有文件 Context；只注入 Workspace 与能力信息。</p> : null}
          </div>
        </section>
      ) : null}

      {inspectedRun?.gitPatch ? (
        <section className="run-section">
          <h3>Run-owned changes</h3>
          <div className="run-owned-patch">
            <header>
              <GitCompareArrows size={15} />
              <span><strong>{inspectedRun.gitPatch.totals.files} files</strong><small>+{inspectedRun.gitPatch.totals.additions} −{inspectedRun.gitPatch.totals.deletions} · ignored files excluded</small></span>
            </header>
            <dl>
              <div><dt>Before</dt><dd>{inspectedRun.gitPatch.beforeTreeId.slice(0, 12)}</dd></div>
              <div><dt>After</dt><dd>{inspectedRun.gitPatch.afterTreeId.slice(0, 12)}</dd></div>
              <div><dt>Snapshot</dt><dd>{inspectedRun.gitPatch.snapshotId.slice(0, 12)}</dd></div>
            </dl>
            <div className="run-owned-files">
              {inspectedRun.gitPatch.files.map((file) => (
                <button
                  type="button"
                  className={visibleRunReview?.path === file.path ? "is-active" : ""}
                  key={file.path}
                  aria-pressed={visibleRunReview?.path === file.path}
                  onClick={() => onOpenRunDiff(inspectedRun, file.path)}
                  disabled={visibleRunReview?.loading}
                >
                  <span>{file.path}</span>
                  <small>{file.kind} · +{file.additions} −{file.deletions}{file.isBinary ? " · binary" : ""}</small>
                </button>
              ))}
              {!inspectedRun.gitPatch.files.length ? <p>此 Run 没有改变 Git 可追踪的 Workspace 文件。</p> : null}
            </div>
            {visibleRunReview?.error ? <div className="permission-error run-review-error" role="alert"><CircleAlert size={14} />{visibleRunReview.error}</div> : null}
            {visibleRunReview?.path ? (
              <div className="run-owned-diff" role="region" aria-label={`${visibleRunReview.path} 的 Run-owned 差异`}>
                <header><FileCode2 size={13} /><span>{visibleRunReview.path}</span><small>immutable trees</small></header>
                {visibleRunReview.loading ? <p>正在读取 Run 快照…</p> : visibleRunReview.diff?.patch === null
                  ? <p>Binary diff · 无文本补丁</p>
                  : <pre>{visibleRunReview.diff?.patch || "No textual changes"}</pre>}
              </div>
            ) : null}
            {runAcceptance ? (
              <div className="run-review-complete"><CheckCircle2 size={14} /> 已于 {new Date(runAcceptance.acceptedAt).toLocaleString("zh-CN")} 审查此 Run 快照；未修改 index、commit 或 push。</div>
            ) : (
              <button type="button" className="wide-control run-accept-trigger" onClick={() => onAcceptRunReview(inspectedRun)} disabled={Boolean(visibleRunReview?.accepting) || !inspectedRun.gitPatch.files.length}>
                {visibleRunReview?.accepting ? <LoaderCircle size={14} className="status-running" /> : <Check size={14} />}
                {visibleRunReview?.accepting ? "正在记录…" : "Accept Run review"}
              </button>
            )}
            {(inspectedRun.gitRestores || []).length ? (
              <div className="run-restore-complete"><CheckCircle2 size={14} /> 已安全恢复 {inspectedRun.gitRestores.at(-1).result.restoredPaths.length + inspectedRun.gitRestores.at(-1).result.deletedPaths.length} 个文件；Git index 未修改。</div>
            ) : (
              <button type="button" className="wide-control run-restore-trigger" onClick={() => onPreviewRunRestore(inspectedRun)} disabled={runRestoreBusy || !inspectedRun.gitPatch.files.length}>
                <RotateCcw size={14} /> Preview Run restore
              </button>
            )}
            {runRestoreError ? <div className="permission-error" role="alert"><CircleAlert size={14} />{runRestoreError}</div> : null}
            {visibleRestorePreview ? (
              <div className="run-restore-preview" role="alertdialog" aria-modal="false" aria-label="确认恢复此 Run 的变更">
                <strong>只恢复归属于此 Run 的工作区改动</strong>
                <p>{visibleRestorePreview.warning || "恢复只修改 worktree；不会修改 Git index。当前树和 Run 结束快照必须完全匹配。"}</p>
                <dl>
                  <div><dt>Restore</dt><dd>{visibleRestorePreview.restorePaths.length} files</dd></div>
                  <div><dt>Delete</dt><dd>{visibleRestorePreview.deletePaths.length} files</dd></div>
                  <div><dt>Conflicts</dt><dd>{visibleRestorePreview.conflicts.length}</dd></div>
                </dl>
                {visibleRestorePreview.conflicts.map((conflict) => <div className="run-restore-conflict" key={`${conflict.reason}-${conflict.path || "all"}`}><CircleAlert size={13} />{conflict.path ? `${conflict.path}: ` : ""}{conflict.message}</div>)}
                <div className="permission-actions">
                  <button type="button" className="secondary-button" onClick={onCancelRunRestore} disabled={runRestoreBusy}>取消</button>
                  <button type="button" className="danger-button" onClick={onConfirmRunRestore} disabled={runRestoreBusy || Boolean(visibleRestorePreview.conflicts.length)}>{runRestoreBusy ? "正在恢复…" : "确认恢复"}</button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : inspectedRun?.gitBaseline ? (
        <section className="run-section"><h3>Run-owned changes</h3><p className="empty-inspector-copy">Baseline 已记录；Run 终态后才会生成归属 Patch。</p></section>
      ) : null}

      <section className="run-section">
        <h3>Verification evidence</h3>
        <div className="verification-list">
          {verifications.map((verification) => (
            <article className={`verification-card is-${verification.status}`} key={verification.id}>
              <header>
                <span>{verification.status === "passed" ? <CheckCircle2 size={14} /> : verification.status === "failed" ? <CircleAlert size={14} /> : <CircleDot size={14} />}</span>
                <strong>{verification.kind}</strong>
                <small>{verification.status === "passed" ? "通过" : verification.status === "failed" ? "失败" : "结果未知"}</small>
              </header>
              <code>{verification.command}</code>
              <dl>
                <div><dt>CWD</dt><dd>{verification.cwd || "未知"}</dd></div>
                <div><dt>Exit</dt><dd>{verification.exitCode ?? "未知"}</dd></div>
                <div><dt>Time</dt><dd>{new Date(verification.finishedAt).toLocaleString("zh-CN")}</dd></div>
              </dl>
              {verification.redacted || verification.truncated ? <p className="verification-note">{verification.redacted ? "已脱敏" : ""}{verification.redacted && verification.truncated ? " · " : ""}{verification.truncated ? "日志已截断" : ""}</p> : null}
              {verification.log ? <details><summary>查看日志</summary><pre>{verification.log}</pre></details> : null}
            </article>
          ))}
          {!verifications.length ? <p className="empty-inspector-copy">此 Run 尚无带 command、cwd 和 exit code 的验证证据；不会显示“测试通过”。</p> : null}
        </div>
      </section>

      <section className="run-section">
        <h3>Event log</h3>
        {events.map((event) => (
          <div className="run-event-row" key={event.id}>
            <span className="run-event-copy">
              <code>{event.type}</code>
              {event.type === "run.log" && typeof event.payload?.message === "string"
                ? <span title={event.payload.message}>{event.payload.message}</span>
                : null}
            </span>
            <small>{new Date(event.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
          </div>
        ))}
        {!events.length ? <p className="empty-inspector-copy">Run 启动后，标准化事件会显示在这里。</p> : null}
      </section>

      <section className="run-section">
        <h3>Run controls</h3>
        {isLatest ? (
          <button type="button" className="wide-control" onClick={onToggleRun} disabled={task.status === "waiting"}>
            {["running", "blocked"].includes(task.status) ? <Square size={14} /> : <Play size={15} />}
            {["running", "blocked"].includes(task.status) ? "Stop run" : "Start new Run"}
          </button>
        ) : <p className="empty-inspector-copy">Historical Run 为只读快照；切回 latest Run 后才能继续或停止。</p>}
      </section>
    </div>
  );
}

function EnvironmentGitFeedback({ tone = "info", message }) {
  if (!message) return null;
  return (
    <div className={`environment-git-feedback is-${tone}`} role={tone === "error" ? "alert" : "status"} aria-live="polite">
      {tone === "loading" ? <LoaderCircle size={13} className="status-running" /> : tone === "success" ? <CheckCircle2 size={13} /> : tone === "error" ? <CircleAlert size={13} /> : <CircleHelp size={13} />}
      <span>{message}</span>
    </div>
  );
}

function EnvironmentPane({ workspace, task, changesState, onOpenChanges, onOpenContext, onRefreshChanges, onAddContextSource, gitClient, onBranchChanged }) {
  const [localOpen, setLocalOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [sourceComposerOpen, setSourceComposerOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceState, setSourceState] = useState({ loading: false, error: "", success: "" });
  const [branchesState, setBranchesState] = useState({ loading: false, switching: false, data: null, error: "", success: "" });
  const [selectedBranch, setSelectedBranch] = useState("");
  const [gitSurface, setGitSurface] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [syncState, setSyncState] = useState({ busy: "", error: "", success: "", commit: null, push: null });
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);
  const [compareBase, setCompareBase] = useState("");
  const [compareState, setCompareState] = useState({ loading: false, error: "", success: "", result: null });
  const gitSurfaceRef = useRef(null);
  const syncTriggerRef = useRef(null);
  const compareTriggerRef = useRef(null);
  const totals = changesState.snapshot?.totals || { files: 0, additions: 0, deletions: 0 };
  const runOwnsWorkspace = ["running", "blocked"].includes(task.status);
  const gitMutationDisabled = workspace.placeholder || runOwnsWorkspace;
  const currentBranch = branchesState.data?.currentBranch || workspace.branch || task.branch || "—";
  const currentLocalBranch = branchesState.data?.local?.find((branch) => branch.current || branch.name === branchesState.data?.currentBranch);
  const latestContextSnapshot = [...(task.runs || [])].reverse().find((run) => run.contextSnapshot)?.contextSnapshot;
  const persistedSources = [
    ...(task.contextFiles || []).map((path) => ({ kind: "file", label: path, path })),
    ...(latestContextSnapshot?.instructions || []).map((source) => ({ kind: source.kind || "instruction", label: source.path, path: source.path })),
    ...(latestContextSnapshot?.selectedFiles || []).map((source) => ({ kind: source.kind || "file", label: source.path, path: source.path })),
  ].filter((source, index, items) => source.label && items.findIndex((candidate) => candidate.label === source.label) === index);
  const sources = workspace.placeholder
    ? []
    : showcaseMode && task.id === "devspace-intro" ? [
        { kind: "local", label: "localhost:3000/admin" },
        { kind: "link", label: "github.com/orbitrelaylabs/skills", url: "https://github.com/orbitrelaylabs/skills" },
        { kind: "search", label: "网页搜索" },
      ]
      : persistedSources;

  useEffect(() => {
    setLocalOpen(false);
    setBranchOpen(false);
    setSourceComposerOpen(false);
    setSourceDraft("");
    setSourceState({ loading: false, error: "", success: "" });
    setBranchesState({ loading: false, switching: false, data: null, error: "", success: "" });
    setSelectedBranch("");
    setGitSurface("");
    setCommitMessage("");
    setSyncState({ busy: "", error: "", success: "", commit: null, push: null });
    setPushConfirmOpen(false);
    setCompareBase("");
    setCompareState({ loading: false, error: "", success: "", result: null });
  }, [workspace.id]);

  useEffect(() => {
    if (!gitSurface) return undefined;
    const frame = window.requestAnimationFrame(() => {
      gitSurfaceRef.current?.querySelector("[data-environment-dialog-focus]")?.focus();
    });
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      const closingSurface = gitSurface;
      setGitSurface("");
      setPushConfirmOpen(false);
      window.requestAnimationFrame(() => {
        (closingSurface === "sync" ? syncTriggerRef : compareTriggerRef).current?.focus();
      });
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [gitSurface]);

  const requireGitMethod = (method) => {
    if (!gitClient || typeof gitClient[method] !== "function") {
      throw new Error("Git 操作尚未就绪；请在桌面应用中打开项目后重试。");
    }
    return gitClient[method].bind(gitClient);
  };

  const loadBranches = async () => {
    setCompareState({ loading: false, error: "", success: "", result: null });
    setBranchesState((state) => ({ ...state, loading: true, error: "", success: "" }));
    try {
      const result = await requireGitMethod("listGitBranches")();
      setBranchesState({ loading: false, switching: false, data: result, error: "", success: "" });
      setSelectedBranch((branch) => result.local.some((candidate) => candidate.name === branch)
        ? branch
        : result.currentBranch || "");
      setCompareBase((base) => result.comparable.some((candidate) => candidate.name === base)
        ? base
        : result.comparable.find((candidate) => candidate.name !== result.currentBranch)?.name || "");
      return result;
    } catch (error) {
      setBranchesState((state) => ({ ...state, loading: false, switching: false, error: error instanceof Error ? error.message : String(error), success: "" }));
      return null;
    }
  };

  const toggleBranches = () => {
    const nextOpen = !branchOpen;
    setBranchOpen(nextOpen);
    if (nextOpen) {
      setGitSurface("");
      if (!branchesState.data && !branchesState.loading) void loadBranches();
    }
  };

  const switchBranch = async () => {
    if (!selectedBranch || selectedBranch === branchesState.data?.currentBranch || gitMutationDisabled) return;
    setBranchesState((state) => ({ ...state, switching: true, error: "", success: "" }));
    try {
      const result = await requireGitMethod("switchGitBranch")({ branch: selectedBranch });
      const nextBranch = result.currentBranch || selectedBranch;
      setBranchesState({ loading: false, switching: false, data: result, error: "", success: `已切换到 ${nextBranch}` });
      setSelectedBranch(nextBranch);
      setCompareState({ loading: false, error: "", success: "", result: null });
      onBranchChanged?.(nextBranch);
      await onRefreshChanges?.();
    } catch (error) {
      setBranchesState((state) => ({ ...state, switching: false, error: error instanceof Error ? error.message : String(error), success: "" }));
    }
  };

  const closeGitSurface = () => {
    const closingSurface = gitSurface;
    setGitSurface("");
    setPushConfirmOpen(false);
    window.requestAnimationFrame(() => {
      (closingSurface === "sync" ? syncTriggerRef : compareTriggerRef).current?.focus();
    });
  };

  const openGitSurface = (surface) => {
    setBranchOpen(false);
    setGitSurface(surface);
    setPushConfirmOpen(false);
    if (!branchesState.data && !branchesState.loading) void loadBranches();
  };

  const commitStagedChanges = async () => {
    const message = commitMessage.trim();
    if (!message || gitMutationDisabled || syncState.busy) return;
    setSyncState((state) => ({ ...state, busy: "commit", error: "", success: "", commit: null }));
    try {
      const result = await requireGitMethod("commitGit")({ message });
      setSyncState((state) => ({ ...state, busy: "", error: "", success: `已提交 ${result.files} 个 staged 文件`, commit: result }));
      setCommitMessage("");
      setCompareState({ loading: false, error: "", success: "", result: null });
      await onRefreshChanges?.();
    } catch (error) {
      setSyncState((state) => ({ ...state, busy: "", error: error instanceof Error ? error.message : String(error), success: "", commit: null }));
    }
  };

  const pushCurrentBranch = async () => {
    if (gitMutationDisabled || syncState.busy || !pushConfirmOpen) return;
    setSyncState((state) => ({ ...state, busy: "push", error: "", success: "", push: null }));
    try {
      const result = await requireGitMethod("pushGit")({ confirmed: true });
      setSyncState((state) => ({ ...state, busy: "", error: "", success: `已推送 ${result.branch} 到 ${result.upstream}`, push: result }));
      setPushConfirmOpen(false);
    } catch (error) {
      setSyncState((state) => ({ ...state, busy: "", error: error instanceof Error ? error.message : String(error), success: "", push: null }));
    }
  };

  const compareBranches = async () => {
    if (!compareBase || compareState.loading) return;
    setCompareState({ loading: true, error: "", success: "", result: null });
    try {
      const result = await requireGitMethod("compareGit")({ base: compareBase });
      setCompareState({ loading: false, error: "", success: `已比较 ${result.base} 与 HEAD（${result.head.slice(0, 8)}）`, result });
    } catch (error) {
      setCompareState({ loading: false, error: error instanceof Error ? error.message : String(error), success: "", result: null });
    }
  };

  const addContextSource = async (event) => {
    event.preventDefault();
    const path = sourceDraft.trim();
    if (!path || sourceState.loading || workspace.placeholder) return;
    setSourceState({ loading: true, error: "", success: "" });
    try {
      const result = await onAddContextSource(path);
      setSourceDraft("");
      const validatedPath = result?.path || path;
      setSourceState({ loading: false, error: "", success: result?.alreadyIncluded ? `${validatedPath} 已在 Run Context 中` : `已将 ${validatedPath} 加入 Run Context` });
    } catch (error) {
      setSourceState({ loading: false, error: error instanceof Error ? error.message : String(error), success: "" });
    }
  };

  return (
    <div className="environment-pane">
      <header className="environment-pane-header">
        <h2>环境信息</h2>
        <button type="button" onClick={() => setSourceComposerOpen((open) => !open)} aria-label="添加来源" aria-expanded={sourceComposerOpen} aria-controls="environment-source-composer" disabled={workspace.placeholder}><Plus size={21} /></button>
      </header>

      <div className="environment-actions">
        <button type="button" className="environment-row is-strong" onClick={() => onOpenChanges()}>
          <FilePlus2 size={18} />
          <span>变更</span>
          <small><b>+{totals.additions}</b> <em>−{totals.deletions}</em></small>
        </button>
        <button type="button" className="environment-row is-strong" onClick={() => setLocalOpen((open) => !open)} aria-expanded={localOpen}>
          <Laptop size={18} /><span>本地</span><ChevronDown size={17} className={localOpen ? "is-open" : ""} />
        </button>
        {localOpen ? <p className="environment-row-detail">{workspace.path}</p> : null}
        <button type="button" className={`environment-row ${branchOpen ? "is-active" : ""}`} onClick={toggleBranches} aria-expanded={branchOpen} aria-controls="environment-branch-disclosure">
          <GitBranch size={18} /><span>{currentBranch}</span><ChevronDown size={17} className={branchOpen ? "is-open" : ""} />
        </button>
        {branchOpen ? (
          <section className="environment-git-disclosure" id="environment-branch-disclosure" aria-label="本地 Git 分支">
            <header>
              <span>本地分支</span>
              <button type="button" onClick={() => void loadBranches()} disabled={branchesState.loading || branchesState.switching} aria-label="刷新分支"><RefreshCw size={13} className={branchesState.loading ? "status-running" : ""} /></button>
            </header>
            {branchesState.loading ? <EnvironmentGitFeedback tone="loading" message="正在读取本地分支…" /> : null}
            {branchesState.error ? <EnvironmentGitFeedback tone="error" message={branchesState.error} /> : null}
            {branchesState.success ? <EnvironmentGitFeedback tone="success" message={branchesState.success} /> : null}
            {branchesState.data?.detached ? <EnvironmentGitFeedback message={`当前为 detached HEAD${branchesState.data.headId ? ` · ${branchesState.data.headId.slice(0, 8)}` : ""}`} /> : null}
            {branchesState.data?.local?.length ? (
              <div className="environment-branch-list" role="group" aria-label="选择要切换的本地分支">
                {branchesState.data.local.map((branch) => (
                  <button
                    type="button"
                    aria-pressed={selectedBranch === branch.name}
                    className={selectedBranch === branch.name ? "is-selected" : ""}
                    key={branch.name}
                    onClick={() => setSelectedBranch(branch.name)}
                    disabled={branchesState.switching}
                    title={branch.upstream ? `${branch.name} · ${branch.upstream}` : branch.name}
                  >
                    <span>{selectedBranch === branch.name ? <CircleDot size={13} /> : <Circle size={11} />}</span>
                    <strong>{branch.name}</strong>
                    {branch.current ? <small>当前</small> : null}
                  </button>
                ))}
              </div>
            ) : !branchesState.loading && !branchesState.error ? <p className="environment-git-empty">没有可切换的本地分支。</p> : null}
            {runOwnsWorkspace ? <EnvironmentGitFeedback message="Run 正在占用工作区；停止 Run 后才能切换分支。" /> : null}
            <button
              type="button"
              className="environment-primary-action"
              onClick={() => void switchBranch()}
              disabled={!selectedBranch || selectedBranch === branchesState.data?.currentBranch || branchesState.switching || gitMutationDisabled}
            >
              {branchesState.switching ? <LoaderCircle size={13} className="status-running" /> : <GitBranch size={13} />}
              {branchesState.switching ? "正在切换…" : selectedBranch === branchesState.data?.currentBranch ? "当前分支" : `切换到 ${selectedBranch || "所选分支"}`}
            </button>
          </section>
        ) : null}
        <button ref={syncTriggerRef} type="button" className={`environment-row ${gitSurface === "sync" ? "is-active" : ""}`} onClick={() => openGitSurface("sync")} aria-haspopup="dialog" aria-expanded={gitSurface === "sync"} aria-controls="environment-sync-popover">
          <GitCommitHorizontal size={19} /><span>提交或推送</span><ChevronDown size={17} className={gitSurface === "sync" ? "is-open" : ""} />
        </button>
        <button ref={compareTriggerRef} type="button" className={`environment-row ${gitSurface === "compare" ? "is-active" : ""}`} onClick={() => openGitSurface("compare")} aria-haspopup="dialog" aria-expanded={gitSurface === "compare"} aria-controls="environment-compare-popover">
          <GitCompareArrows size={18} /><span>比较分支</span><ChevronDown size={17} className={gitSurface === "compare" ? "is-open" : ""} />
        </button>
        {gitSurface === "sync" ? (
          <section ref={gitSurfaceRef} className="environment-git-popover" id="environment-sync-popover" role="dialog" aria-modal="false" aria-labelledby="environment-sync-title">
            <header className="environment-git-popover-header">
              <span><strong id="environment-sync-title">提交或推送</strong><small>{currentBranch}</small></span>
              <button type="button" data-environment-dialog-focus onClick={closeGitSurface} aria-label="关闭提交或推送"><X size={15} /></button>
            </header>
            <section className="environment-git-section">
              <h3>提交 staged 变更</h3>
              <p>只提交 Git index 中已经 staged 的内容；Rux 不会自动 stage 文件。</p>
              <label className="environment-git-field">
                <span>Commit message</span>
                <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} rows={2} maxLength={500} placeholder="说明这次 staged 变更" disabled={Boolean(syncState.busy) || gitMutationDisabled} />
              </label>
              <button type="button" className="environment-primary-action" onClick={() => void commitStagedChanges()} disabled={!commitMessage.trim() || Boolean(syncState.busy) || gitMutationDisabled}>
                {syncState.busy === "commit" ? <LoaderCircle size={13} className="status-running" /> : <GitCommitHorizontal size={13} />}
                {syncState.busy === "commit" ? "正在提交…" : "提交 staged 变更"}
              </button>
            </section>
            <section className="environment-git-section">
              <h3>推送当前分支</h3>
              <p>{currentLocalBranch?.upstream ? `仅推送到现有 upstream：${currentLocalBranch.upstream}` : "当前分支没有现有 upstream；Rux 不会自动创建远端跟踪关系。"}</p>
              {!pushConfirmOpen ? (
                <button type="button" className="environment-secondary-action" onClick={() => setPushConfirmOpen(true)} disabled={!currentLocalBranch?.upstream || Boolean(syncState.busy) || gitMutationDisabled}><ArrowUp size={13} />准备推送</button>
              ) : (
                <div className="environment-push-confirm" role="alert">
                  <strong>确认推送 {currentBranch}？</strong>
                  <p>这会把当前分支提交发送到 {currentLocalBranch?.upstream}，不会 force push。</p>
                  <div>
                    <button type="button" className="environment-secondary-action" onClick={() => setPushConfirmOpen(false)} disabled={Boolean(syncState.busy)}>取消</button>
                    <button type="button" className="environment-danger-action" onClick={() => void pushCurrentBranch()} disabled={Boolean(syncState.busy)}>{syncState.busy === "push" ? <LoaderCircle size={13} className="status-running" /> : <ArrowUp size={13} />}{syncState.busy === "push" ? "正在推送…" : "确认推送"}</button>
                  </div>
                </div>
              )}
            </section>
            {runOwnsWorkspace ? <EnvironmentGitFeedback message="Run 正在占用工作区；停止 Run 后才能 commit 或 push。" /> : null}
            {branchesState.loading ? <EnvironmentGitFeedback tone="loading" message="正在读取分支与 upstream…" /> : null}
            {branchesState.error ? <EnvironmentGitFeedback tone="error" message={branchesState.error} /> : null}
            {syncState.busy ? <EnvironmentGitFeedback tone="loading" message={syncState.busy === "commit" ? "Git 正在创建 commit…" : "Git 正在推送当前分支…"} /> : null}
            {syncState.error ? <EnvironmentGitFeedback tone="error" message={syncState.error} /> : null}
            {syncState.success ? <EnvironmentGitFeedback tone="success" message={syncState.success} /> : null}
            {syncState.commit ? <p className="environment-git-result"><code>{syncState.commit.commitId.slice(0, 10)}</code><span>{syncState.commit.message}</span></p> : null}
          </section>
        ) : null}
        {gitSurface === "compare" ? (
          <section ref={gitSurfaceRef} className="environment-git-popover" id="environment-compare-popover" role="dialog" aria-modal="false" aria-labelledby="environment-compare-title">
            <header className="environment-git-popover-header">
              <span><strong id="environment-compare-title">比较分支</strong><small>HEAD：{currentBranch}</small></span>
              <button type="button" data-environment-dialog-focus onClick={closeGitSurface} aria-label="关闭分支比较"><X size={15} /></button>
            </header>
            <label className="environment-git-field">
              <span>Base branch</span>
              <select value={compareBase} onChange={(event) => {
                setCompareBase(event.target.value);
                setCompareState({ loading: false, error: "", success: "", result: null });
              }} disabled={branchesState.loading || compareState.loading}>
                {!compareBase ? <option value="">选择 base</option> : null}
                {(branchesState.data?.comparable || []).filter((branch) => branch.name !== branchesState.data?.currentBranch).map((branch) => <option value={branch.name} key={`${branch.kind}-${branch.name}`}>{branch.name}{branch.kind === "remote" ? " · remote" : ""}</option>)}
              </select>
            </label>
            <div className="environment-git-inline-actions">
              <button type="button" className="environment-secondary-action" onClick={() => void loadBranches()} disabled={branchesState.loading || compareState.loading}><RefreshCw size={13} className={branchesState.loading ? "status-running" : ""} />刷新分支</button>
              <button type="button" className="environment-primary-action" onClick={() => void compareBranches()} disabled={!compareBase || branchesState.loading || compareState.loading}><GitCompareArrows size={13} />{compareState.loading ? "正在比较…" : "比较"}</button>
            </div>
            {branchesState.loading ? <EnvironmentGitFeedback tone="loading" message="正在读取可比较分支…" /> : null}
            {branchesState.error ? <EnvironmentGitFeedback tone="error" message={branchesState.error} /> : null}
            {compareState.loading ? <EnvironmentGitFeedback tone="loading" message={`正在比较 ${compareBase} 与 HEAD…`} /> : null}
            {compareState.error ? <EnvironmentGitFeedback tone="error" message={compareState.error} /> : null}
            {compareState.success ? <EnvironmentGitFeedback tone="success" message={compareState.success} /> : null}
            {compareState.result ? (
              <div className="environment-compare-result">
                <header><strong>{compareState.result.totals.files} 个文件</strong><span><b>+{compareState.result.totals.additions}</b><em>−{compareState.result.totals.deletions}</em></span></header>
                <p>{compareState.result.summary}</p>
                <div className="environment-compare-files">
                  {compareState.result.files.slice(0, 100).map((file) => <div key={file.path}><span>{file.path}</span><small>{file.isBinary ? <i>binary</i> : null}<b>+{file.additions}</b><em>−{file.deletions}</em></small></div>)}
                  {compareState.result.files.length > 100 ? <p>另有 {compareState.result.files.length - 100} 个文件；总计仍以上方完整统计为准。</p> : null}
                  {!compareState.result.files.length ? <p>两个引用之间没有文件差异。</p> : null}
                </div>
                {compareState.result.patch ? <pre tabIndex={0} aria-label={`${compareState.result.base} 与 HEAD 的比较 patch`}>{compareState.result.patch}</pre> : null}
                {compareState.result.truncated ? <EnvironmentGitFeedback message="Patch 已截断；文件统计仍来自完整比较结果。" /> : null}
                <p className="environment-compare-note">上方是 base compare；Changes 面板显示当前工作区的未提交变更。</p>
                <button type="button" className="environment-secondary-action environment-open-changes" onClick={() => onOpenChanges()}><FilePlus2 size={13} />打开工作区 Changes（未提交变更）</button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="environment-divider" />
      <section className="environment-section">
        <h3>电脑使用</h3>
        <button type="button" className="environment-row" disabled title="尚未连接可用的电脑使用画面">
          <PictureInPicture2 size={19} /><span>画中画</span><small>未连接</small>
        </button>
      </section>

      <div className="environment-divider" />
      <section className="environment-section source-section">
        <header className="source-section-header">
          <h3>来源</h3>
          <button type="button" onClick={() => setSourceComposerOpen((open) => !open)} aria-label="添加来源到环境" aria-expanded={sourceComposerOpen} aria-controls="environment-source-composer" disabled={workspace.placeholder}><Plus size={19} /></button>
        </header>
        {sourceComposerOpen ? (
          <form className="source-composer-form" id="environment-source-composer" onSubmit={(event) => void addContextSource(event)}>
            <label className="source-composer"><FileCode2 size={15} /><input autoFocus aria-label="工作区相对文件路径" value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} placeholder="例如 src/App.jsx" autoComplete="off" disabled={sourceState.loading} /></label>
            <button type="submit" className="source-composer-submit" disabled={!sourceDraft.trim() || sourceState.loading}>{sourceState.loading ? <LoaderCircle size={13} className="status-running" /> : <Plus size={13} />}添加</button>
            <small>仅接受当前工作区内的相对文件路径；Runtime 会检查路径边界和敏感文件。</small>
            {sourceState.loading ? <EnvironmentGitFeedback tone="loading" message="正在验证文件…" /> : null}
            {sourceState.error ? <EnvironmentGitFeedback tone="error" message={sourceState.error} /> : null}
            {sourceState.success ? <EnvironmentGitFeedback tone="success" message={sourceState.success} /> : null}
          </form>
        ) : null}
        <div className="source-list">
          {!sources.length ? <p className="empty-inspector-copy">添加工作区相对文件后，它会进入下一次 Run 的 Context。</p> : null}
          {sources.slice(0, 3).map((source) => (
            <button
              type="button"
              key={`${source.kind}-${source.label}`}
              title={source.url ? `${source.label} · 在浏览器中打开` : `${source.label} · 在 Context 中查看`}
              onClick={() => source.url
                ? window.open(source.url, "_blank", "noopener,noreferrer")
                : onOpenContext()}
            >
              {source.kind === "search" ? <Globe2 size={18} /> : source.kind === "link" || source.kind === "local" ? <Link2 size={18} /> : <FileCode2 size={18} />}
              <span>{source.label}</span>
            </button>
          ))}
          {sources.length ? <button type="button" className="source-view-all" onClick={() => onOpenContext()}><Share2 size={18} /><span>在 Context 中查看全部</span></button> : null}
        </div>
      </section>
    </div>
  );
}

function Inspector({ open, onClose, tab, onTab, selectedFile, onSelectFile, workspace, task, onToggleRun, changesState, contextState, onRefreshChanges, onRefreshContext, onToggleContextFile, onAddContextSource, onRestoreChanges, onAcceptChanges, runReviewState, onOpenRunDiff, onAcceptRunReview, runRestorePreview, runRestoreBusy, runRestoreError, onPreviewRunRestore, onConfirmRunRestore, onCancelRunRestore, gitClient, onBranchChanged }) {
  return (
    <aside className={`inspector inspector-${tab} ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
      {tab === "environment" ? (
        <EnvironmentPane
          workspace={workspace}
          task={task}
          changesState={changesState}
          gitClient={gitClient}
          onBranchChanged={onBranchChanged}
          onRefreshChanges={onRefreshChanges}
          onAddContextSource={onAddContextSource}
          onOpenContext={() => {
            onTab("context");
            void onRefreshContext();
          }}
          onOpenChanges={(path) => {
            if (path) onSelectFile(path);
            onTab("changes");
            void onRefreshChanges();
          }}
        />
      ) : <>
      <div className="inspector-tabs" role="tablist" aria-label="任务检查器">
        <button type="button" className="inspector-back" onClick={() => onTab("environment")} aria-label="返回环境信息"><ChevronLeft size={16} /></button>
        <button type="button" id="inspector-tab-changes" aria-controls="inspector-panel-changes" aria-selected={tab === "changes"} className={tab === "changes" ? "is-active" : ""} onClick={() => onTab("changes")} role="tab">
          Changes {changesState.snapshot?.totals.files ? <span>{changesState.snapshot.totals.files}</span> : null}
        </button>
        <button type="button" id="inspector-tab-context" aria-controls="inspector-panel-context" aria-selected={tab === "context"} className={tab === "context" ? "is-active" : ""} onClick={() => onTab("context")} role="tab">Context</button>
        <button type="button" id="inspector-tab-run" aria-controls="inspector-panel-run" aria-selected={tab === "run"} className={tab === "run" ? "is-active" : ""} onClick={() => onTab("run")} role="tab">Run</button>
        <button
          type="button"
          className="inspector-more"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label="关闭检查器"
          title="关闭检查器"
        >
          <X size={17} />
        </button>
      </div>
      <div className="inspector-panel" id={`inspector-panel-${tab}`} role="tabpanel" aria-labelledby={`inspector-tab-${tab}`}>
        {tab === "changes" ? <ChangesPane state={changesState} selectedFile={selectedFile} onSelectFile={onSelectFile} onRefresh={onRefreshChanges} onRestore={onRestoreChanges} onAccept={onAcceptChanges} /> : null}
        {tab === "context" ? <ContextPane state={contextState} changes={changesState} selectedPaths={task.contextFiles || []} onRefresh={onRefreshContext} onToggleFile={onToggleContextFile} /> : null}
        {tab === "run" ? <RunPane task={task} onToggleRun={onToggleRun} runReviewState={runReviewState} onOpenRunDiff={onOpenRunDiff} onAcceptRunReview={onAcceptRunReview} runRestorePreview={runRestorePreview} runRestoreBusy={runRestoreBusy} runRestoreError={runRestoreError} onPreviewRunRestore={onPreviewRunRestore} onConfirmRunRestore={onConfirmRunRestore} onCancelRunRestore={onCancelRunRestore} /> : null}
      </div>
      </>}
    </aside>
  );
}

function TerminalPanel({ open, onClose }) {
  const [shellName, setShellName] = useState("connecting");

  if (!open) return null;
  return (
    <section className="terminal-panel" aria-label="集成终端">
      <div className="terminal-header">
        <div className="terminal-tabs">
          <button type="button" className="is-active"><SquareTerminal size={14} /> Terminal <span>{shellName}</span></button>
        </div>
        <div className="terminal-actions">
          <button type="button" aria-label="关闭终端" onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      <div className="terminal-body terminal-body-xterm">
        <TerminalView onSessionChange={setShellName} onEscape={onClose} />
      </div>
    </section>
  );
}

function useDialogFocus(open, onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusable = () => [...dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    const frame = window.requestAnimationFrame(() => (dialog.querySelector("[data-dialog-initial-focus]") || focusable()[0] || dialog).focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      dialog.removeEventListener("keydown", handleKeyDown);
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [open]);

  return dialogRef;
}

function NewTaskDialog({ open, onClose, onCreate, onOpenAccounts, agentChoices, initialAgentId, codexSettings, codexModels, workspace, contextCandidates, onValidateContext }) {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("codex");
  const [permissionMode, setPermissionMode] = useState(codexSettings.permissionMode || "acceptEdits");
  const [model, setModel] = useState(codexSettings.model || "Rux default");
  const [reasoningEffort, setReasoningEffort] = useState(codexSettings.reasoningEffort || "");
  const [contextOpen, setContextOpen] = useState(false);
  const [contextFiles, setContextFiles] = useState([]);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState("");
  const dialogRef = useDialogFocus(open, onClose);
  const selectedChoice = agentChoices.find((item) => item.id === agentId && item.available);
  const unavailableChoice = agentChoices.find((item) => item.id === agentId) || agentChoices[0];
  const unavailableReason = unavailableChoice?.unavailableReason
    || unavailableChoice?.detail
    || "尚未检测到可运行的 Agent";
  const selectedModel = model || selectedChoice?.model || "";
  const modelOptions = Array.from(new Set([
    selectedModel,
    ...(selectedChoice?.autoModelPolicy ? ["Auto"] : []),
    ...(selectedChoice?.verifiedModels || []).map((item) => item.model),
    ...(selectedChoice?.adapter === "codex"
      ? ["Rux default", ...(codexModels || []).map((item) => item.model)]
      : []),
  ].filter(Boolean)));
  const reasoningOptions = selectedChoice?.adapter === "codex"
    ? codexReasoningOptions(codexModels, selectedModel)
    : [];

  useEffect(() => {
    if (!open) return;
    const choice = agentChoices.find((item) => item.id === initialAgentId && item.available)
      || agentChoices.find((item) => item.available)
      || agentChoices.find((item) => item.id === "codex")
      || agentChoices[0];
    setAgentId(choice?.id || "codex");
    setPermissionMode(choice?.permissionMode || codexSettings.permissionMode || "acceptEdits");
    setModel(choice?.model || codexSettings.model || "Rux default");
    setReasoningEffort(choice?.reasoningEffort || "");
  }, [open, initialAgentId]);

  useEffect(() => {
    if (open) return;
    setPrompt("");
    setContextFiles([]);
    setContextOpen(false);
    setContextBusy(false);
    setContextError("");
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!prompt.trim() || !selectedChoice) return;
    setContextBusy(true);
    setContextError("");
    try {
      await onValidateContext(contextFiles);
      const modelState = modelSelectionState(selectedChoice.adapter, selectedModel, codexModels, selectedChoice.verifiedModels);
      onCreate(prompt, { ...selectedChoice, model: selectedModel, reasoningEffort, ...modelState }, permissionMode, contextFiles);
      setPrompt("");
      setContextFiles([]);
      setContextOpen(false);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : String(error));
    } finally {
      setContextBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="new-task-dialog" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
        <div className="dialog-header">
          <div className="dialog-hero">
            <h2 id="new-task-title">Let's build</h2>
            <div className="dialog-project" title={workspace?.path || "当前项目"}>
              <span>{workspace?.name || "Current project"}</span>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </div>
        <div className="dialog-composer-shell">
          <label className="dialog-field">
            <span className="sr-only">你想完成什么？</span>
            <textarea
              autoFocus
              data-dialog-initial-focus
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="描述你想构建、修复或探索的内容…"
              rows={4}
            />
          </label>
          <div className="dialog-composer-toolbar">
            <button type="button" className={`dialog-attach ${contextOpen ? "is-active" : ""}`} aria-label="选择文件 Context" title="选择文件 Context" aria-expanded={contextOpen} onClick={() => setContextOpen((value) => !value)}>
              <Plus size={20} />
              {contextFiles.length ? <b>{contextFiles.length}</b> : null}
            </button>
            <div className="agent-options" aria-label="选择 Agent">
              <select value={agentId} onChange={(event) => {
                const choice = agentChoices.find((item) => item.id === event.target.value);
                setAgentId(event.target.value);
                if (choice?.permissionMode) setPermissionMode(choice.permissionMode);
                setModel(choice?.model || "");
                setReasoningEffort(choice?.reasoningEffort || "");
              }} aria-label="选择 Agent">
                {agentChoices.map((choice) => <option key={choice.id} value={choice.id} disabled={!choice.available}>{ruxAgentLabel(choice.name)}{choice.available ? "" : "（不可用）"}</option>)}
              </select>
            </div>
            <button
              type="button"
              className="dialog-submit"
              disabled={!prompt.trim() || !selectedChoice || contextBusy}
              onClick={() => void submit()}
              aria-label="创建并运行任务"
              title="创建并运行（⌘ Enter）"
            >
              <ArrowRight size={19} />
            </button>
          </div>
        </div>
        {!selectedChoice ? (
          <div className="account-error" role="alert">
            <CircleAlert size={15} />
            <span>{ruxVisibleText(unavailableReason)}</span>
            <button type="button" className="secondary-button" onClick={onOpenAccounts}>账户与登录</button>
          </div>
        ) : null}
        {contextOpen ? (
          <section className="dialog-context-picker" aria-label="选择下一次 Run 的文件 Context">
            <header><span><ShieldCheck size={14} /><strong>明确选择要发送的文件</strong></span><small>默认不发送 · Runtime 会阻断凭据</small></header>
            <div>
              {contextCandidates.map((file) => (
                <label key={file.path}>
                  <input type="checkbox" checked={contextFiles.includes(file.path)} onChange={() => {
                    setContextError("");
                    setContextFiles((items) => items.includes(file.path) ? items.filter((item) => item !== file.path) : [...items, file.path]);
                  }} />
                  <span><strong>{file.path}</strong><small>{file.kind} · +{file.additions} −{file.deletions}</small></span>
                </label>
              ))}
              {!contextCandidates.length ? <p>当前 Workspace 没有可选择的 Git 变更。</p> : null}
            </div>
            {contextError ? <p className="dialog-context-error" role="alert"><CircleAlert size={13} />{contextError}</p> : null}
          </section>
        ) : contextError ? <p className="dialog-context-error is-inline" role="alert"><CircleAlert size={13} />{contextError}</p> : null}
        <div className="dialog-context-line">
          <label><ShieldCheck size={13} /><select aria-label="新任务 Permission" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
            {permissionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select></label>
          <label><Bot size={13} /><input list="new-task-model-options" aria-label="新任务模型或高级模型 ID" value={selectedModel} onChange={(event) => { setModel(event.target.value); setReasoningEffort(""); }} /></label>
          <datalist id="new-task-model-options">{modelOptions.map((option) => <option key={option} value={option}>{ruxModelLabel(option)}</option>)}</datalist>
          {selectedChoice?.adapter === "codex" ? <label><SlidersHorizontal size={13} /><select aria-label="新任务推理强度" value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)}>
            <option value="">模型默认</option>
            {reasoningOptions.map((option) => <option key={option.reasoningEffort} value={option.reasoningEffort}>{reasoningEffortLabel(option.reasoningEffort)}</option>)}
          </select></label> : null}
          <span>{workspace?.branch || "main"}</span>
          <span>⌘ Enter 运行</span>
        </div>
      </section>
    </div>
  );
}

function AccountsDialog({ open, state, adapters, agentChoices, selectedAgentId, canCreateTask, nativeConnections, nativeBusy, checking, loginProvider, error, notice, onClose, onDetect, onLogin, onCancelLogin, onSaveNative, onTestNative, onDeleteNative, onUseAgent, onOpenSettings }) {
  const dialogRef = useDialogFocus(open, onClose);
  const [nativeDraft, setNativeDraft] = useState({ label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "", apiKey: "" });
  if (!open) return null;
  const hasDetected = Boolean(state);
  const checkedAt = state?.checkedAt
    ? new Date(state.checkedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "尚未检测";

  return (
    <div className="dialog-backdrop account-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="account-dialog accounts-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
        <header className="account-dialog-header">
          <div>
            <span className="account-dialog-icon"><UserRound size={18} /></span>
            <span>
              <h2 id="account-dialog-title">Agent 与 Provider</h2>
              <p>无需 Rux 账号；原生 Provider 无需安装 Agent CLI，本机 CLI 作为可选 Engine</p>
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭账户与登录">
            <X size={17} />
          </button>
        </header>

        <div className="account-dialog-body">
          <section className="native-provider-section" aria-labelledby="native-provider-title">
            <header><span><strong id="native-provider-title">Rux Native Provider</strong><small>直接使用 Responses-compatible API，不依赖 Codex 或 Claude Code</small></span><span className="account-provider-status is-connected"><Zap size={13} />无需 CLI</span></header>
            {nativeConnections.length ? <div className="native-provider-connections">{nativeConnections.map((connection) => {
              const agent = agentChoices.find((choice) => choice.providerConnection?.id === connection.id);
              const isSelected = Boolean(agent && agent.id === selectedAgentId);
              return <article key={connection.id}><span><strong>{connection.label}</strong><small>{connection.baseUrl} · {connection.defaultModel}</small>{connection.lastTestDetail ? <small className={connection.lastTestStatus === "error" ? "is-error" : "is-success"}>{connection.lastTestDetail}</small> : null}</span><span className="native-provider-actions">{agent?.available ? <>{isSelected ? <span className="account-current-agent-badge"><Check size={13} />当前使用</span> : null}<button type="button" className="account-use-agent-button" disabled={!canCreateTask} title={canCreateTask ? `使用 ${agent.name} 新建任务` : "请先打开项目"} onClick={() => onUseAgent(agent.id)}><SquarePen size={13} />新建任务</button></> : null}<button type="button" className="secondary-button" disabled={nativeBusy} onClick={() => onTestNative(connection.id)}>测试</button><button type="button" className="danger-ghost-button" disabled={nativeBusy} onClick={() => onDeleteNative(connection.id)}>删除</button></span></article>;
            })}</div> : null}
            <form className="native-provider-form" onSubmit={(event) => { event.preventDefault(); if (!nativeDraft.label.trim() || !nativeDraft.defaultModel.trim() || !nativeDraft.apiKey) return; onSaveNative({ label: nativeDraft.label.trim(), providerType: "openai-responses", baseUrl: nativeDraft.baseUrl.trim(), defaultModel: nativeDraft.defaultModel.trim(), apiKey: nativeDraft.apiKey }).then(() => setNativeDraft((draft) => ({ ...draft, apiKey: "" }))).catch(() => undefined); }}>
              <label><span>名称</span><input value={nativeDraft.label} maxLength={80} onChange={(event) => setNativeDraft((draft) => ({ ...draft, label: event.target.value }))} /></label>
              <label><span>Base URL</span><input value={nativeDraft.baseUrl} onChange={(event) => setNativeDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} /></label>
              <label><span>默认模型</span><input value={nativeDraft.defaultModel} placeholder="例如 gpt-5.6" onChange={(event) => setNativeDraft((draft) => ({ ...draft, defaultModel: event.target.value }))} /></label>
              <label><span>API Key</span><input type="password" autoComplete="off" value={nativeDraft.apiKey} placeholder="仅提交到 Main 安全边界" onChange={(event) => setNativeDraft((draft) => ({ ...draft, apiKey: event.target.value }))} /></label>
              <button type="submit" className="primary-button" disabled={nativeBusy || !nativeDraft.label.trim() || !nativeDraft.baseUrl.trim() || !nativeDraft.defaultModel.trim() || !nativeDraft.apiKey}>{nativeBusy ? <LoaderCircle size={14} className="status-running" /> : <Plus size={14} />}添加 Connection</button>
            </form>
            <p className="native-provider-security"><ShieldCheck size={13} />API Key 由 Main 使用操作系统加密能力保存；Renderer、普通 IPC、日志和导出都不会获得原始值。</p>
          </section>

          <section className="account-detection-card" aria-label="本机 Agent 检测">
            <span className="account-sync-icon">{checking ? <LoaderCircle size={17} className="status-running" /> : <Laptop size={17} />}</span>
            <span>
              <strong>{checking ? "正在检测 Rux 与 Claude Code…" : hasDetected ? "本机 Agent 检测完成" : "检测本机 Agent"}</strong>
              <small>{hasDetected ? `上次检测 ${checkedAt} · 不会后台自动刷新` : "检查安装、版本和非敏感连接状态，不读取凭据文件"}</small>
            </span>
            <button
              data-dialog-initial-focus
              type="button"
              className="account-sync-button"
              onClick={onDetect}
              disabled={checking || Boolean(loginProvider) || !window.rux}
            >
              <RefreshCw size={13} className={checking ? "status-running" : ""} />
              {checking ? "检测中" : hasDetected ? "重新检测" : "开始检测"}
            </button>
          </section>
          {error ? (
            <div className="account-error" role="alert">
              <CircleAlert size={15} />
              <span>{error}</span>
            </div>
          ) : null}
          {notice ? <div className="account-notice" role="status">{loginProvider ? <LoaderCircle size={15} className="status-running" /> : notice.includes("取消") ? <Circle size={13} /> : <CheckCircle2 size={15} />}<span>{notice}</span></div> : null}

          {agentChoices.some((choice) => choice.available && choice.id !== "mock") ? <div className="account-agent-selection-help"><Bot size={16} /><span><strong>连接不等于当前使用</strong><small>当前任务固定的 Agent 会标记为“当前使用”；选择其他 Agent 会创建新任务，已有任务不会改变。</small></span></div> : null}

          <div className="account-provider-list">
            {providerSurfaces.map((surface) => {
              const provider = state?.providers?.find((item) => item.id === surface.id);
              const adapter = adapters.find((item) => item.id === surface.adapter);
              const isLoggingIn = loginProvider === surface.id;
              const phase = checking
                ? "checking"
                : !hasDetected ? "unchecked" : provider?.status || "error";
              const connected = phase === "connected";
              const statusCopy = isLoggingIn
                ? "等待浏览器授权"
                : {
                    unchecked: "未检测",
                    checking: "检测中",
                    "not-installed": "未安装",
                    "signed-out": "已安装 · 未连接",
                    connected: `已连接 · ${authMethodLabel(provider?.authMethod)}`,
                    error: "检测错误",
                  }[phase];
              const detail = isLoggingIn
                ? "请在官方浏览器授权页完成登录；Rux 不接收或保存 Token。"
                : phase === "unchecked"
                  ? `点击“开始检测”后检查 ${surface.cliLabel}。`
                  : phase === "checking"
                    ? `正在读取 ${surface.cliLabel} 的安装与非敏感状态…`
                    : provider?.detail || adapter?.detail || `无法读取 ${surface.cliLabel} 状态。`;
              const canStartLogin = Boolean(window.rux)
                && provider?.installed
                && provider?.canLogin
                && !checking
                && !loginProvider;
              const loginLabel = connected
                ? ["api-key", "cloud"].includes(provider?.authMethod) ? "改用 OAuth" : "重新登录"
                : surface.id === "chatgpt" ? "使用 ChatGPT 登录" : "使用 Claude 登录";
              const agent = agentChoices.find((choice) => choice.id === surface.adapter);
              const isSelectedAgent = selectedAgentId === surface.adapter;

              return (
                <section className="account-provider" key={surface.id} data-provider={surface.id}>
                  <span className={`account-provider-mark ${surface.id === "chatgpt" ? "is-chatgpt" : "is-claude"}`}><Bot size={19} /></span>
                  <div className="account-provider-copy">
                    <div className="account-provider-title"><h3>{surface.engineName}</h3><span>{surface.connectionName}</span></div>
                    <p>{detail}</p>
                    {provider?.installed ? (
                      <code title={provider.executable || surface.cliLabel}>
                        {surface.cliLabel}{provider.version ? ` ${provider.version}` : ""}{provider.executable ? ` · ${provider.executable}` : ""}
                      </code>
                    ) : null}
                  </div>
                  <div className="account-provider-actions">
                    <span className={`account-provider-status ${connected ? "is-connected" : phase === "error" || phase === "not-installed" ? "is-error" : isLoggingIn || phase === "checking" ? "is-loading" : ""}`}>
                      {connected ? <CheckCircle2 size={13} /> : isLoggingIn || phase === "checking" ? <LoaderCircle size={13} className="status-running" /> : phase === "error" || phase === "not-installed" ? <CircleAlert size={13} /> : <Circle size={11} />}
                      {statusCopy}
                    </span>
                    {connected && agent?.available ? <div className="account-agent-action-row">{isSelectedAgent ? <span className="account-current-agent-badge"><Check size={13} />当前使用</span> : null}<button type="button" className="account-use-agent-button" disabled={!canCreateTask} title={canCreateTask ? `使用 ${agent.name} 新建任务` : "请先打开项目"} onClick={() => onUseAgent(agent.id)}><SquarePen size={13} />新建任务</button></div> : null}
                    {phase === "not-installed" ? (
                      <a className="account-install-link" href={surface.installUrl} target="_blank" rel="noreferrer"><Globe2 size={13} />官方安装说明</a>
                    ) : phase === "error" ? (
                      <button type="button" className="account-login-button is-secondary" onClick={onDetect} disabled={checking || Boolean(loginProvider)}><RefreshCw size={13} />重新检测</button>
                    ) : phase === "unchecked" ? null : (
                      <button
                        type="button"
                        className={`account-login-button ${isLoggingIn ? "is-cancel" : ""}`}
                        onClick={() => isLoggingIn ? onCancelLogin(surface.id) : onLogin(surface.id)}
                        disabled={!isLoggingIn && !canStartLogin}
                      >
                        {isLoggingIn ? <X size={14} /> : <LogIn size={14} />}
                        {isLoggingIn ? "取消登录" : loginLabel}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="account-dialog-secondary-actions">
            <button type="button" className="secondary-button" onClick={onOpenSettings} disabled={Boolean(loginProvider)}><Settings size={14} /> Rux 设置</button>
            <p>原生 Connection 在上方管理；CLI 自有的 API Key、Base URL 与云 Provider 配置仍由对应 CLI 管理。</p>
          </div>
        </div>

        <footer className="account-dialog-footer">
          <ShieldCheck size={15} />
          <p>原生 API Key 只在 Main/Runtime 特权边界内使用；CLI 登录与 CLI 凭据仍由官方工具管理，二者互不复制。</p>
        </footer>
      </section>
    </div>
  );
}

function SessionDiscoveryDialog({ open, workspace, engine, state, previewState, importedTasks, onEngine, onDiscover, onCancel, onPreview, onImport, onClose, onOpenWorkspace }) {
  const dialogRef = useDialogFocus(open, onClose);
  if (!open) return null;
  const groups = [
    ["current", "当前项目", "这些会话的规范化工作目录属于当前项目。"],
    ["migrationSuggestions", "归属迁移建议", "发现了更具体的已授权项目；Rux 不会静默移动已有归属。"],
    ["unassigned", "待归属", "缺少或无法解析工作目录，目前只保留元数据。"],
    ["authorizationRequired", "需要项目授权", "工作目录在授权范围之外；先打开项目才能继续。"],
  ];
  const hasResults = groups.some(([key]) => state.result?.[key]?.length);
  const busy = state.status === "loading" || previewState.status === "loading" || previewState.status === "importing";
  const importedBindingFor = (item) => importedTasks.find((task) => task.importedSession?.identityKey === item.identityKey)?.importedSession;
  const importedStatusLabel = (binding) => binding?.status === "linked" ? "已关联" : binding?.status === "unlinked" ? "已解除关联 · 可重新导入" : binding?.status === "native-unavailable" ? "原会话不可用" : binding ? "仅查看" : "";
  return (
    <div className="dialog-backdrop account-dialog-backdrop session-discovery-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="account-dialog session-discovery-dialog" role="dialog" aria-modal="true" aria-labelledby="session-discovery-title">
        <header className="account-dialog-header">
          <div>
            <span className="account-dialog-icon"><History size={18} /></span>
            <span>
              <h2 id="session-discovery-title">导入 Agent 会话</h2>
              <p>{workspace.name} · 只在你点击后读取非敏感会话元数据</p>
            </span>
          </div>
          <button type="button" className="icon-button" onClick={busy ? onCancel : onClose} aria-label={busy ? "取消会话操作" : "关闭导入 Agent 会话"}>
            <X size={17} />
          </button>
        </header>
        <div className="account-dialog-body session-discovery-body">
          <section className="session-discovery-controls" aria-label="会话发现设置">
            <div className="session-engine-tabs" role="radiogroup" aria-label="选择 Agent Engine">
              <button type="button" role="radio" aria-checked={engine === "codex"} className={engine === "codex" ? "is-active" : ""} onClick={() => onEngine("codex")} disabled={busy}>Rux</button>
              <button type="button" role="radio" aria-checked={engine === "claude-code"} className={engine === "claude-code" ? "is-active" : ""} onClick={() => onEngine("claude-code")} disabled={busy}>Claude Code</button>
            </div>
            <button data-dialog-initial-focus type="button" className="primary-button" onClick={state.status === "loading" ? onCancel : onDiscover} disabled={!window.rux || (busy && state.status !== "loading")} aria-label={state.status === "loading" ? "取消查找会话" : `查找 ${engine === "codex" ? "Rux" : "Claude Code"} 会话`}>
              {state.status === "loading" ? <><LoaderCircle size={14} className="status-running" />取消查找</> : <><Search size={14} />查找会话</>}
            </button>
          </section>
          <div className="session-discovery-privacy"><ShieldCheck size={15} /><span><strong>首次发现不会读取完整对话</strong><small>Rux 仅通过官方接口获取标题、时间、模型、目录与消息数量；不会后台扫描。</small></span></div>
          {state.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{state.error}</span></div> : null}
          {state.status === "idle" ? <div className="session-discovery-empty"><History size={28} /><strong>尚未查找本机会话</strong><p>选择 Engine 后点击“查找会话”。打开此窗口本身不会访问任何历史。</p></div> : null}
          {state.status === "loading" ? <div className="session-discovery-empty" role="status"><LoaderCircle size={28} className="status-running" /><strong>正在读取会话元数据…</strong><p>不会读取完整 Transcript；你可以随时取消。</p></div> : null}
          {state.status === "done" && !hasResults ? <div className="session-discovery-empty" role="status"><Search size={28} /><strong>当前范围没有可显示的会话</strong><p>Rux 已隐藏属于其他已授权项目的会话。</p></div> : null}
          {state.status === "done" ? groups.map(([key, title, description]) => {
            const items = state.result?.[key] || [];
            if (!items.length) return null;
            return (
              <section className={`session-discovery-group is-${key}`} key={key} aria-label={title}>
                <header><span><strong>{title}</strong><small>{description}</small></span><em>{items.length}</em></header>
                <div className="session-discovery-list">
                  {items.map((item) => (
                    <article className="session-discovery-item" key={item.identityKey}>
                      <span className="session-provider-mark"><Bot size={16} /></span>
                      <span className="session-discovery-copy">
                        <strong>{item.metadata.title || item.metadata.summary || "未命名会话"}</strong>
                        <small>{[
                          item.metadata.updatedAt ? new Date(item.metadata.updatedAt).toLocaleString("zh-CN") : null,
                          item.metadata.model,
                          Number.isFinite(item.metadata.messageCount) ? `${item.metadata.messageCount} 条消息` : null,
                        ].filter(Boolean).join(" · ") || "官方接口未提供时间、模型或消息数"}</small>
                        {item.metadata.cwd ? <code title={item.metadata.cwd}>{item.metadata.cwd}</code> : null}
                        {item.attribution.reason ? <p>{item.attribution.reason}</p> : null}
                      </span>
                      {importedBindingFor(item) ? <span className="session-metadata-only">{importedStatusLabel(importedBindingFor(item))}</span> : null}
                      {key === "authorizationRequired" ? <button type="button" className="secondary-button" onClick={onOpenWorkspace}>打开项目…</button> : key === "current" ? (
                        <button type="button" className="secondary-button" onClick={() => onPreview(item)} disabled={["loading", "importing"].includes(previewState.status)}>
                          {previewState.status === "loading" && previewState.item?.identityKey === item.identityKey ? <LoaderCircle size={13} className="status-running" /> : <Eye size={13} />}预览
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            );
          }) : null}
          {previewState.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{previewState.error}</span></div> : null}
          {previewState.preview ? (
            <section className="session-import-preview" aria-label="会话导入预览">
              <header><span><strong>{previewState.preview.metadata.title || "未命名会话"}</strong><small>已读取 {previewState.preview.messages.length} 条规范化消息{previewState.preview.truncated ? "（达到本地预览上限）" : ""}</small></span><em>{previewState.preview.resume.status === "available" ? "可继续" : "仅查看"}</em></header>
              <div className="session-import-warning"><CircleAlert size={15} /><span><strong>完整内容将复制到 Rux 本地，且可能包含敏感信息</strong><small>原生会话仍可能被其他客户端写入。导入不会删除、归档或修改 Provider 侧会话；若要隔离后续工作，可稍后通过上下文交接创建新任务。</small></span></div>
              <div className="session-import-message-list">
                {previewState.preview.messages.slice(0, 12).map((message) => <article key={message.id} className={`is-${message.role}`}><strong>{message.role === "user" ? "你" : message.role === "assistant" ? "Agent" : message.role === "system" ? "System" : "Tool"}</strong><p>{message.content.map((part) => part.type === "text" ? part.text : part.type === "tool-call" ? `[工具调用: ${part.name}]` : part.type === "tool-result" ? "[工具结果]" : `[暂不支持的内容类型: ${part.providerType}]`).join("\n\n") || "（空消息）"}</p></article>)}
                {previewState.preview.messages.length > 12 ? <small>其余 {previewState.preview.messages.length - 12} 条将在确认后写入本地 Projection。</small> : null}
              </div>
              <footer>
                <button type="button" className="secondary-button" onClick={() => onImport("view")} disabled={previewState.status === "importing"}>仅导入查看</button>
                <button type="button" className="primary-button" onClick={() => onImport("continue")} disabled={previewState.status === "importing" || previewState.preview.resume.status !== "available"}>{previewState.status === "importing" ? <LoaderCircle size={14} className="status-running" /> : <Play size={14} />}导入并继续</button>
              </footer>
            </section>
          ) : null}
        </div>
        <footer className="account-dialog-footer"><CircleHelp size={15} /><p>发现阶段只读元数据；点“预览”才读取内容，点导入后才在一个本地事务中创建 Projection 与 Task。</p></footer>
      </section>
    </div>
  );
}

function SessionSyncDialog({ state, onClose, onRebuild, onRestore }) {
  const dialogRef = useDialogFocus(state.open, onClose);
  if (!state.open) return null;
  const diff = state.result?.diff;
  const labels = { added: "新增", modified: "修改", deleted: "删除", moved: "重排", uncertain: "不确定匹配" };
  return (
    <div className="dialog-backdrop account-dialog-backdrop" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="account-dialog session-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="session-sync-title">
        <header className="account-dialog-header"><div><span className="account-dialog-icon"><RefreshCw size={18} /></span><span><h2 id="session-sync-title">原生会话刷新与版本</h2><p>只在用户操作时读取；本地版本恢复不会写回 Provider</p></span></div><button type="button" className="icon-button" onClick={onClose} disabled={state.loading} aria-label="关闭会话版本"><X size={17} /></button></header>
        <div className="account-dialog-body session-sync-body">
          {state.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{state.error}</span></div> : null}
          {state.loading ? <div className="session-discovery-empty"><LoaderCircle size={25} className="status-running" /><strong>正在处理本地 Projection…</strong></div> : null}
          {diff ? <section className={`session-sync-diff is-${diff.status}`}><header><span><strong>{diff.status === "unchanged" ? "原生会话没有变化" : diff.status === "append-only" ? "已安全追加新消息" : "发现外部差异，当前版本未改变"}</strong><small>+{diff.additions} 新增 · {diff.modifications} 修改 · {diff.deletions} 删除 · {diff.moves} 重排 · {diff.uncertainMatches} 不确定</small></span>{state.result?.candidateRevisionId ? <button type="button" className="primary-button" onClick={() => onRebuild(state.result.candidateRevisionId)}>确认按原生会话重建</button> : null}</header>{diff.changes?.length ? <div className="session-sync-change-list">{diff.changes.map((change, index) => <article key={`${change.kind}-${change.messageId || index}`}><em>{labels[change.kind]}</em><span><strong>{change.role || "消息"} · {change.previousIndex === undefined ? "—" : change.previousIndex + 1} → {change.nextIndex === undefined ? "—" : change.nextIndex + 1}</strong><p>{change.preview}</p></span></article>)}</div> : null}</section> : null}
          <section className="session-revision-list"><header><strong>本地 Projection Revisions</strong><small>{state.revisions?.revisions?.length || 0} 个不可变版本</small></header>{(state.revisions?.revisions || []).map((revision) => <article key={revision.id}><span><strong>Revision {revision.ordinal}{revision.current ? " · 当前" : ""}</strong><small>{revision.messageCount} 条消息 · {new Date(revision.createdAt).toLocaleString("zh-CN")}</small></span>{!revision.current ? <button type="button" className="secondary-button" onClick={() => onRestore(revision.id)}>恢复此本地版本</button> : null}</article>)}</section>
          {(state.revisions?.audits || []).length ? <section className="session-audit-list"><strong>刷新审计</strong>{state.revisions.audits.slice(0, 12).map((audit) => <small key={audit.id}>{new Date(audit.occurredAt).toLocaleString("zh-CN")} · {audit.action} · {audit.result} · {audit.fromRevisionId.split("-").at(-1)}{audit.toRevisionId ? ` → ${audit.toRevisionId.split("-").at(-1)}` : ""}</small>)}</section> : null}
        </div>
        <footer className="account-dialog-footer"><ShieldCheck size={15} /><p>修改、删除、重排和不确定匹配不会自动覆盖当前 Projection；重建与恢复都保留旧 Revision、Run、审批和 Task 元数据。</p></footer>
      </section>
    </div>
  );
}

function ContextHandoffDialog({ state, agents, onChange, onPreview, onGenerateSummary, onCommit, onClose }) {
  const dialogRef = useDialogFocus(state.open, onClose);
  if (!state.open) return null;
  const facts = state.preview?.facts;
  return <div className="dialog-backdrop account-dialog-backdrop" role="presentation"><section ref={dialogRef} tabIndex={-1} className="account-dialog handoff-dialog" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
    <header className="account-dialog-header"><div><span className="account-dialog-icon"><GitCompareArrows size={18} /></span><span><h2 id="handoff-title">复制为新任务</h2><p>先审查确定性事实包，确认后才创建目标 Task</p></span></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭 Context Handoff"><X size={17} /></button></header>
    <div className="account-dialog-body handoff-body">
      <label className="handoff-field"><span>目标 Agent 与 Provider</span><select value={state.targetAgentId} onChange={(event) => onChange({ targetAgentId: event.target.value, preview: null, agentSummary: "", agentSummaryGenerationId: "", summaryProvenance: null })}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.providerConnection.label}</option>)}</select></label>
      <section className="handoff-selection"><header><strong>本地事实来源</strong><small>只使用当前 Task 已持久化的消息与 Run-owned 文件证据</small></header><div className="handoff-message-select">{state.source.messages.map((message) => <label key={message.id}><input type="checkbox" checked={state.messageIds.includes(message.id)} onChange={() => onChange({ messageIds: state.messageIds.includes(message.id) ? state.messageIds.filter((id) => id !== message.id) : [...state.messageIds, message.id], preview: null, agentSummary: "", agentSummaryGenerationId: "", summaryProvenance: null })} /><span><strong>{message.role === "user" ? "你" : "Agent"}</strong><small>{message.text.slice(0, 160)}</small></span></label>)}</div>{state.source.files.length ? <div className="handoff-file-select">{state.source.files.map((file) => <label key={file.path}><input type="checkbox" checked={state.filePaths.includes(file.path)} onChange={() => onChange({ filePaths: state.filePaths.includes(file.path) ? state.filePaths.filter((path) => path !== file.path) : [...state.filePaths, file.path], preview: null, agentSummary: "", agentSummaryGenerationId: "", summaryProvenance: null })} /><code>{file.path}</code></label>)}</div> : <small>当前没有可引用的持久化 Run-owned 文件变更；不会使用展示数据补齐。</small>}</section>
      {state.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{state.error}</span></div> : null}
      {facts ? <section className="handoff-preview"><header><strong>确定性事实包</strong><small>{facts.messages.length} 条消息 · {facts.files.length} 个文件 · {facts.incomplete.length} 个未完成项</small></header>{!state.preview.sourceAgentAvailable ? <p className="handoff-note">来源 Agent 不可用；仍可仅使用以下事实包交接。</p> : null}<div className="handoff-field"><span className="handoff-summary-heading"><span>可选叙事摘要</span><button type="button" className="secondary-button" aria-label="让来源 Agent 生成交接摘要" onClick={onGenerateSummary} disabled={state.loading || !state.preview.sourceAgentAvailable}>{state.loading ? "来源 Agent 正在生成…" : "让来源 Agent 生成"}</button></span>{state.summaryProvenance ? <small className="handoff-summary-provenance">由 {state.summaryProvenance.sourceAdapter === "codex" ? "Rux" : "Claude Code"} 的固定 Revision 临时生成 · 未保存原生会话 · 可编辑或移除</small> : <small>可自行填写，或显式调用来源 Agent 生成；留空不会影响交接。</small>}<textarea aria-label="可选叙事摘要" value={state.agentSummary} onChange={(event) => onChange({ agentSummary: event.target.value })} placeholder="摘要只用于帮助目标 Agent 理解事实包，不替代下方确定性事实。" /></div><label className="handoff-field"><span>补充约束</span><textarea value={state.constraints} onChange={(event) => onChange({ constraints: event.target.value })} placeholder="例如：先只做方案，不修改文件。" /></label><footer><span><ShieldCheck size={14} />确认前不会调用目标 Agent，也不会创建 Native Session。</span><button type="button" className="primary-button" onClick={onCommit} disabled={state.loading}>确认并创建新任务</button></footer></section> : <button type="button" className="primary-button handoff-preview-button" onClick={onPreview} disabled={state.loading || !state.targetAgentId}>{state.loading ? "正在生成…" : "生成交接预览"}</button>}
    </div>
  </section></div>;
}

function localDataSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function LocalDataDialog({ state, task, workspace, onChange, onPreview, onExecute, onExport, onClose }) {
  const dialogRef = useDialogFocus(state.open, onClose);
  if (!state.open) return null;
  const actionCopy = {
    unlink: ["解除关联", "保留任务、消息、投影版本和 Rux 记录，但停止刷新与继续原生会话。"],
    "remove-imported": ["删除导入内容", "删除来自原生会话的本地消息和投影版本；保留 Rux 运行记录、任务元数据与上下文交接。"],
    "delete-task": [state.scope === "workspace" ? "清理工作区任务" : "删除整个任务", "删除范围内任务的全部 Rux 本地记录，包括运行、审批、交接和版本历史。"],
  };
  const [actionTitle, actionDetail] = actionCopy[state.action];
  return <div className="dialog-backdrop account-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !state.loading) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="account-dialog local-data-dialog" role="dialog" aria-modal="true" aria-labelledby="local-data-title">
      <header className="account-dialog-header"><div><span className="account-dialog-icon"><Database size={18} /></span><span><h2 id="local-data-title">本地数据与导出</h2><p>{workspace.name} · 本地操作不会删除、归档或修改服务商原生会话</p></span></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭本地数据管理"><X size={17} /></button></header>
      <div className="account-dialog-body local-data-body">
        {state.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{state.error}</span></div> : null}
        {state.notice ? <div className="account-notice" role="status"><CheckCircle2 size={15} /><span>{state.notice}</span></div> : null}
        <section className="local-data-summary" aria-label="工作区本地占用">
          <span><small>预计本地占用</small><strong>{state.summary ? localDataSize(state.summary.estimatedBytes) : "正在计算…"}</strong></span>
          <span><small>任务</small><strong>{state.summary?.taskCount ?? "—"}</strong></span>
          <span><small>导入任务</small><strong>{state.summary?.importedTaskCount ?? "—"}</strong></span>
          <span><small>投影版本</small><strong>{state.summary?.projectionRevisionCount ?? "—"}</strong></span>
        </section>
        <section className="local-data-section">
          <header><span><strong>本地清理</strong><small>先生成影响预览，再明确确认执行。</small></span></header>
          <div className="local-data-controls">
            <label><span>范围</span><select aria-label="本地数据范围" value={state.scope} onChange={(event) => onChange({ scope: event.target.value, preview: null, notice: "" })}><option value="task">当前任务{task ? ` · ${task.title}` : ""}</option><option value="workspace">整个工作区</option></select></label>
            <label><span>操作</span><select aria-label="本地数据操作" value={state.action} onChange={(event) => onChange({ action: event.target.value, preview: null, notice: "" })}><option value="unlink">解除关联</option><option value="remove-imported">删除导入内容</option><option value="delete-task">{state.scope === "workspace" ? "清理工作区任务" : "删除整个任务"}</option></select></label>
          </div>
          <div className="local-data-action-copy"><strong>{actionTitle}</strong><small>{actionDetail}</small></div>
          {!state.preview ? <button type="button" className="secondary-button" onClick={onPreview} disabled={state.loading}>{state.loading ? <LoaderCircle size={14} className="status-running" /> : <Eye size={14} />}生成影响预览</button> : <div className="local-data-impact" role="status">
            <header><strong>影响预览</strong><span>预计释放 {localDataSize(state.preview.estimatedReclaimableBytes)}</span></header>
            <ul><li><strong>{state.preview.affectedTaskCount}</strong><span>任务</span></li><li><strong>{state.preview.importedMessageCount}</strong><span>导入消息</span></li><li><strong>{state.preview.affectedProjectionRevisionCount}</strong><span>投影版本</span></li><li><strong>{state.preview.runCount}</strong><span>Rux 运行记录</span></li><li><strong>{state.preview.affectedHandoffCount}</strong><span>上下文交接</span></li></ul>
            <p><ShieldCheck size={14} /><span><strong>{state.preview.nativeSessions.length} 个原生会话不受影响</strong><small>{state.action === "unlink"
              ? "Task、消息和投影版本会完整保留；重新导入可以恢复刷新与继续。"
              : state.action === "remove-imported"
                ? "导入内容删除后不承诺本地恢复；若原生会话仍存在，可以重新导入。"
                : "Task 本地数据删除后不承诺恢复；Provider 原生会话不会被删除或归档。"}</small></span></p>
            <button type="button" className={state.action === "unlink" ? "secondary-button" : "danger-ghost-button"} onClick={onExecute} disabled={state.loading}>{state.loading ? <LoaderCircle size={14} className="status-running" /> : state.action === "unlink" ? <Link2 size={14} /> : <Trash2 size={14} />}{actionTitle}</button>
          </div>}
        </section>
        <section className="local-data-section">
          <header><span><strong>导出</strong><small>Markdown 便于阅读；JSON 保留结构。凭据字段不会写入导出文件。</small></span></header>
          <div className="local-data-controls"><label><span>格式</span><select aria-label="导出格式" value={state.format} onChange={(event) => onChange({ format: event.target.value })}><option value="markdown">Markdown</option><option value="json">JSON</option></select></label><label><span>投影版本</span><select aria-label="导出版本范围" value={state.revisions} onChange={(event) => onChange({ revisions: event.target.value })}><option value="current">仅当前版本</option><option value="all">包含历史版本</option></select></label></div>
          <div className="session-import-warning"><CircleAlert size={15} /><span><strong>导出文件可能包含敏感内容</strong><small>包括提示词、文件内容、命令输出和会话消息。请确认保存位置和后续分享范围。</small></span></div>
          <button type="button" className="primary-button" onClick={onExport} disabled={state.loading}>{state.loading ? <LoaderCircle size={14} className="status-running" /> : <Download size={14} />}确认风险并导出</button>
        </section>
      </div>
    </section>
  </div>;
}

function CodexSettingsDialog({ open, connected, catalog, settings, onClose, onReload, onSave, onOpenAccounts, onOpenLocalData }) {
  const [draft, setDraft] = useState(settings);
  const [query, setQuery] = useState("");
  const dialogRef = useDialogFocus(open, onClose);
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setQuery("");
    }
  }, [open, settings]);
  if (!open) return null;

  const models = catalog.models || [];
  const selectedModel = draft.model || "Rux default";
  const refreshedAt = catalog.refreshedAt
    ? new Date(catalog.refreshedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "尚未刷新";
  const reasoningOptions = codexReasoningOptions(models, selectedModel);
  const selectedReasoningSupported = !draft.reasoningEffort
    || reasoningOptions.some((option) => option.reasoningEffort === draft.reasoningEffort);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (...terms) => !normalizedQuery
    || terms.some((term) => String(term).toLocaleLowerCase().includes(normalizedQuery));
  const showPermissions = matchesQuery("权限", "只读", "工作区", "确认", "写入");
  const showGeneral = matchesQuery("常规", "模型", "推理", "登录", "Agent", "刷新");
  const applyDraft = (nextDraft) => {
    setDraft(nextDraft);
    onSave(nextDraft);
  };
  const choosePermission = (permissionMode) => applyDraft({ ...draft, permissionMode });

  return (
    <div className="rux-settings-surface" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="rux-settings-window" role="dialog" aria-modal="true" aria-labelledby="codex-settings-title">
        <aside className="rux-settings-sidebar" aria-label="设置导航">
          <div className="rux-settings-sidebar-top">
            <button type="button" className="rux-settings-back" onClick={onClose} aria-label="返回 Rux">
              <ArrowLeft size={17} />
              <span>返回应用</span>
            </button>
            <div className="rux-settings-all"><ListFilter size={16} /><strong>所有设置</strong><ChevronDown size={14} /></div>
            <label className="rux-settings-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设置…" aria-label="搜索设置" />
            </label>
          </div>

          <nav className="rux-settings-nav">
            <div className="rux-settings-nav-group">
              <p>个人</p>
              <button type="button" className="is-active"><Settings size={16} /><span>常规</span></button>
              <button type="button" onClick={onOpenAccounts}><UserRound size={16} /><span>账户与登录</span><ArrowRight size={13} /></button>
              <button type="button" onClick={onOpenLocalData}><Database size={16} /><span>本地数据</span><ArrowRight size={13} /></button>
            </div>
            <div className="rux-settings-nav-group">
              <p>编码</p>
              <button type="button" onClick={() => document.getElementById("rux-agent-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Bot size={16} /><span>Rux</span></button>
              <button type="button" disabled title="即将推出"><GitBranch size={16} /><span>Git</span></button>
            </div>
          </nav>
        </aside>

        <main className="rux-settings-main">
          <div className="rux-settings-content">
            <header className="rux-settings-title-row">
              <h1 id="codex-settings-title">常规</h1>
              <button type="button" className="icon-button rux-settings-close" onClick={onClose} aria-label="关闭 Rux 设置"><X size={17} /></button>
            </header>

            {!showPermissions && !showGeneral ? (
              <div className="rux-settings-empty"><Search size={20} /><strong>没有匹配的设置</strong><span>请尝试搜索“权限”“模型”或“推理”。</span></div>
            ) : null}

            {showPermissions ? (
              <section className="rux-settings-section" aria-labelledby="rux-permission-settings">
                <h2 id="rux-permission-settings">权限</h2>
                <div className="rux-settings-card rux-permission-card" role="radiogroup" aria-label="默认权限">
                  <button type="button" role="radio" aria-checked={(draft.permissionMode || "acceptEdits") === "plan"} onClick={() => choosePermission("plan")}>
                    <span><strong>只读规划</strong><small>Rux 可以读取当前工作区并制定方案，不会编辑文件或运行写操作。</small></span>
                    <i className={(draft.permissionMode || "acceptEdits") === "plan" ? "is-selected" : ""} aria-hidden="true"><Check size={13} /></i>
                  </button>
                  <button type="button" role="radio" aria-checked={(draft.permissionMode || "acceptEdits") === "acceptEdits"} onClick={() => choosePermission("acceptEdits")}>
                    <span><strong>工作区访问</strong><small>Rux 可以读取和编辑工作区文件；需要额外访问时会请求你的确认。</small></span>
                    <i className={(draft.permissionMode || "acceptEdits") === "acceptEdits" ? "is-selected" : ""} aria-hidden="true"><Check size={13} /></i>
                  </button>
                  <button type="button" role="radio" aria-checked={(draft.permissionMode || "acceptEdits") === "dontAsk"} onClick={() => choosePermission("dontAsk")}>
                    <span><strong>工作区访问，不询问</strong><small>Rux 可以在当前工作区内直接编辑；仍不会获得系统完整访问权限。</small></span>
                    <i className={(draft.permissionMode || "acceptEdits") === "dontAsk" ? "is-selected" : ""} aria-hidden="true"><Check size={13} /></i>
                  </button>
                </div>
              </section>
            ) : null}

            {showGeneral ? (
              <section className="rux-settings-section" id="rux-agent-settings" aria-labelledby="rux-general-settings">
                <h2 id="rux-general-settings">Agent 默认设置</h2>
                {!connected ? (
                  <div className="settings-login-required" role="status">
                    <Bot size={18} />
                    <span><strong>先连接 Rux</strong><small>在 Agent 与 Provider 中检测并连接后，即可读取模型与推理强度。</small></span>
                    <button type="button" className="primary-button" onClick={onOpenAccounts}>账户与登录</button>
                  </div>
                ) : null}
                {catalog.error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{catalog.error}</span><button type="button" className="secondary-button" onClick={onReload}>重试</button></div> : null}
                <div className="rux-settings-card rux-general-card">
                  <label>
                    <span><strong>默认模型</strong><small>可选择官方目录，或输入高级模型 ID</small></span>
                    <input list="rux-settings-models" value={selectedModel} onChange={(event) => applyDraft({ ...draft, model: event.target.value, reasoningEffort: "" })} disabled={catalog.loading} aria-label="默认模型或高级模型 ID" />
                    <datalist id="rux-settings-models"><option value="Rux default">Rux 默认</option>{models.map((model) => <option key={model.id} value={model.model}>{ruxModelLabel(model.displayName || model.model)}{model.isDefault ? "（默认）" : ""}</option>)}</datalist>
                  </label>
                  <label>
                    <span><strong>推理强度</strong><small>只显示所选模型支持的值</small></span>
                    <select value={draft.reasoningEffort || ""} onChange={(event) => applyDraft({ ...draft, reasoningEffort: event.target.value })} disabled={catalog.loading || !connected}>
                      <option value="">模型默认</option>
                      {!selectedReasoningSupported ? <option value={draft.reasoningEffort}>{reasoningEffortLabel(draft.reasoningEffort)}（当前）</option> : null}
                      {reasoningOptions.map((option) => <option key={option.reasoningEffort} value={option.reasoningEffort}>{reasoningEffortLabel(option.reasoningEffort)} · {option.description}</option>)}
                    </select>
                  </label>
                  <div className="rux-settings-action-row">
                    <span><strong>模型目录</strong><small>官方 Engine 目录 · {refreshedAt}</small></span>
                    <button type="button" className="secondary-button" onClick={onReload} disabled={!connected || catalog.loading}>{catalog.loading ? <LoaderCircle size={14} className="status-running" /> : <RefreshCw size={14} />}刷新模型</button>
                  </div>
                  <div className="rux-settings-boundary"><ShieldCheck size={15} /><span><strong>权限边界</strong><small>设置会自动保存。Rux 的所有写入仍限制在当前工作区内。</small></span></div>
                </div>
              </section>
            ) : null}
          </div>
        </main>
      </section>
    </div>
  );
}

function RestoreDialog({ preview, busy, error, onClose, onConfirm }) {
  const dialogRef = useDialogFocus(Boolean(preview), onClose);
  if (!preview) return null;
  const hasDeletes = preview.deletePaths.length > 0;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="restore-dialog" role="alertdialog" aria-modal="true" aria-labelledby="restore-dialog-title">
        <header>
          <span className={`restore-dialog-icon ${hasDeletes ? "is-danger" : ""}`}><RotateCcw size={18} /></span>
          <div><h2 id="restore-dialog-title">确认 Restore</h2><p>只修改下列 worktree 路径；已有 staged index 会原样保留，操作前会再次验证 Git snapshot。</p></div>
        </header>
        {error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{error}</span></div> : null}
        <div className="restore-paths">
          {preview.restoreFromHeadPaths.map((path) => <div key={`restore-${path}`}><FileCode2 size={14} /><span>恢复 HEAD 到 worktree</span><code>{path}</code></div>)}
          {preview.deletePaths.map((path) => <div className="is-delete" key={`delete-${path}`}><Trash2 size={14} /><span>永久删除未跟踪文件</span><code>{path}</code></div>)}
        </div>
        {hasDeletes ? <p className="restore-warning"><CircleAlert size={15} /> 未跟踪文件没有 Git 恢复点，确认后会永久删除。</p> : null}
        <footer>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className={hasDeletes ? "danger-button" : "primary-button"} onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle size={14} className="status-running" /> : <RotateCcw size={14} />}
            {busy ? "正在 Restore…" : "确认 Restore"}
          </button>
        </footer>
      </section>
    </div>
  );
}

const emptyAgentDraft = {
  name: "",
  description: "",
  backend: "codex",
  providerConnectionId: "",
  model: "",
  autoEnabled: false,
  autoSimpleModel: "",
  autoComplexModel: "",
  autoStrategy: "balanced",
  autoFallbackEnabled: true,
  autoAllowlist: [],
  reasoningEffort: "",
  instructions: "",
  permissionMode: "acceptEdits",
  skillIds: "",
  toolIds: "",
  enabled: true,
};

function AgentsDialog({ open, profiles, adapters, nativeConnections, codexModels, tasks, busy, error, onClose, onSave, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setAgentDraft] = useState(emptyAgentDraft);
  const dialogRef = useDialogFocus(open, onClose);

  const editProfile = (profile) => {
    setEditingId(profile.id);
    setAgentDraft({
      name: profile.name,
      description: profile.description,
      backend: profile.backend,
      providerConnectionId: profile.providerConnection?.kind === "rux-native" ? profile.providerConnection.id : "",
      model: profile.model || "",
      autoEnabled: Boolean(profile.autoModelPolicy),
      autoSimpleModel: profile.autoModelPolicy?.simpleModel.model || "",
      autoComplexModel: profile.autoModelPolicy?.complexModel.model || "",
      autoStrategy: profile.autoModelPolicy?.strategy || "balanced",
      autoFallbackEnabled: profile.autoModelPolicy?.fallbackEnabled ?? true,
      autoAllowlist: profile.autoModelPolicy?.allowlist.map((candidate) => candidate.model) || [],
      reasoningEffort: profile.reasoningEffort || "",
      instructions: profile.instructions,
      permissionMode: profile.permissionMode,
      skillIds: profile.skillIds.join(", "),
      toolIds: profile.toolIds.join(", "),
      enabled: profile.enabled,
    });
  };
  const reset = () => {
    setEditingId(null);
    setAgentDraft(emptyAgentDraft);
  };
  const update = (key, value) => setAgentDraft((current) => ({ ...current, [key]: value }));
  const selectedProfile = profiles.find((profile) => profile.id === editingId);
  const selectedConnectionId = draft.backend === "rux-native"
    ? draft.providerConnectionId
    : selectedProfile?.backend === draft.backend
      ? selectedProfile.providerConnection.id
      : defaultProviderConnectionForAdapter(draft.backend).id;
  const verifiedModels = verifiedModelHistory(tasks, draft.backend, selectedConnectionId);
  const autoCandidates = Array.from(new Map([
    ...verifiedModels.map((item) => [item.model, { model: item.model, source: "verified-history" }]),
    ...(draft.backend === "codex" ? codexModels.map((item) => [item.model, { model: item.model, source: "engine-catalog" }]) : []),
  ]).values());
  const candidateFor = (model) => autoCandidates.find((candidate) => candidate.model === model);
  const autoPolicyValid = !draft.autoEnabled || Boolean(
    candidateFor(draft.autoSimpleModel)
    && candidateFor(draft.autoComplexModel)
    && draft.autoAllowlist.includes(draft.autoSimpleModel)
    && draft.autoAllowlist.includes(draft.autoComplexModel)
  );
  const profileInput = (name = draft.name.trim()) => {
    const splitIds = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
    const nativeConnection = nativeConnections.find((connection) => connection.id === draft.providerConnectionId);
    return {
      name,
      description: draft.description.trim(),
      backend: draft.backend,
      ...(draft.backend === "rux-native" && nativeConnection ? { providerConnection: { id: nativeConnection.id, kind: "rux-native", engine: "rux-native", label: nativeConnection.label } } : {}),
      ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
      ...(draft.autoEnabled ? { autoModelPolicy: {
        simpleModel: candidateFor(draft.autoSimpleModel),
        complexModel: candidateFor(draft.autoComplexModel),
        strategy: draft.autoStrategy,
        fallbackEnabled: draft.autoFallbackEnabled,
        allowlist: draft.autoAllowlist.map(candidateFor).filter(Boolean),
      } } : editingId ? { autoModelPolicy: null } : {}),
      ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
      instructions: draft.instructions.trim(),
      permissionMode: draft.permissionMode,
      skillIds: splitIds(draft.skillIds),
      toolIds: splitIds(draft.toolIds),
      enabled: draft.enabled,
    };
  };
  const submit = () => {
    if (!draft.name.trim() || !draft.instructions.trim() || !autoPolicyValid) return;
    onSave(editingId, profileInput()).then(() => reset()).catch(() => undefined);
  };
  const duplicate = () => {
    if (!editingId || !draft.name.trim() || !draft.instructions.trim()) return;
    const existingNames = new Set(profiles.map((profile) => profile.name.trim().toLocaleLowerCase()));
    const baseName = `${draft.name.trim()} 副本`;
    let name = baseName;
    let suffix = 2;
    while (existingNames.has(name.toLocaleLowerCase())) {
      name = `${baseName} ${suffix}`;
      suffix += 1;
    }
    const input = profileInput(name);
    if (input.autoModelPolicy === null) delete input.autoModelPolicy;
    onSave(null, input).then((profile) => editProfile(profile)).catch(() => undefined);
  };

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="agents-dialog" role="dialog" aria-modal="true" aria-labelledby="agents-dialog-title">
        <header className="agents-dialog-header">
          <div><span className="account-dialog-icon"><Wrench size={18} /></span><span><h2 id="agents-dialog-title">自定义 Agents</h2><p>组合 Engine、Provider、指令和 Permission；Agent Revision 不保存凭据。</p></span></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭 Agents"><X size={17} /></button>
        </header>
        <div className="agents-dialog-body">
          <aside className="agent-profile-list">
            <button type="button" className={!editingId ? "is-selected" : ""} onClick={reset}><Plus size={15} /><span><strong>新建 Agent</strong><small>创建可复用配置</small></span></button>
            {profiles.map((profile) => (
              <button type="button" className={editingId === profile.id ? "is-selected" : ""} key={profile.id} onClick={() => editProfile(profile)}>
                <Bot size={15} /><span><strong>{ruxAgentLabel(profile.name)}</strong><small>{ruxAdapterLabel(profile.backend)} · Revision {profile.revisionNumber} · {profile.enabled ? "启用" : "停用"}</small></span>
              </button>
            ))}
          </aside>
          <form className="agent-profile-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            {error ? <div className="account-error" role="alert"><CircleAlert size={15} /><span>{error}</span></div> : null}
            <div className="agent-form-grid">
              <label><span>名称</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} maxLength={80} required /></label>
              <label><span>底座</span><select value={draft.backend} onChange={(event) => { update("backend", event.target.value); if (event.target.value !== "rux-native") update("providerConnectionId", ""); }}>
                {adapters.filter((item) => ["codex", "claude-code", "rux-native"].includes(item.id)).map((adapter) => <option key={adapter.id} value={adapter.id}>{ruxAgentLabel(adapter.name)}{adapter.available ? "" : adapter.id === "rux-native" ? "（请先添加 Provider）" : "（尚未检测或本机组件不可用）"}</option>)}
              </select></label>
              {draft.backend === "rux-native" ? <label><span>原生 Provider</span><select required value={draft.providerConnectionId} onChange={(event) => update("providerConnectionId", event.target.value)}><option value="">选择 Connection</option>{nativeConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label} · {connection.defaultModel}</option>)}</select></label> : null}
              <label className="is-wide"><span>描述</span><input value={draft.description} onChange={(event) => update("description", event.target.value)} maxLength={400} /></label>
              <label><span>模型（可选）</span><input value={draft.model} onChange={(event) => update("model", event.target.value)} placeholder="使用底座默认模型" /></label>
              <label><span>推理强度（可选）</span><input value={draft.reasoningEffort} onChange={(event) => update("reasoningEffort", event.target.value)} placeholder="使用模型默认值" /></label>
              <label><span>Permission</span><select value={draft.permissionMode} onChange={(event) => update("permissionMode", event.target.value)}>{permissionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
              <fieldset className="agent-auto-policy is-wide">
                <legend>Auto 模型路由</legend>
                <label className="agent-enabled-toggle"><input type="checkbox" checked={draft.autoEnabled} onChange={(event) => update("autoEnabled", event.target.checked)} /><span>允许新 Task 选择 Auto 模式</span></label>
                {draft.autoEnabled ? <>
                  <p>候选模型只来自当前 Engine 目录或这个 Connection 的成功验证历史。未验证的手动模型不会出现在这里。</p>
                  {!autoCandidates.length ? <div className="account-error" role="alert"><CircleAlert size={14} /><span>当前 Connection 没有可用于 Auto 的目录或已验证模型。请先刷新模型目录或用固定模型成功运行一次。</span></div> : null}
                  <div className="agent-auto-grid">
                    <label><span>简单任务模型</span><select aria-label="Auto 简单任务模型" value={draft.autoSimpleModel} onChange={(event) => { update("autoSimpleModel", event.target.value); if (!draft.autoAllowlist.includes(event.target.value)) update("autoAllowlist", [...draft.autoAllowlist, event.target.value].filter(Boolean)); }}><option value="">选择模型</option>{autoCandidates.map((candidate) => <option key={`simple-${candidate.model}`} value={candidate.model}>{candidate.model} · {candidate.source === "engine-catalog" ? "官方目录" : "已验证"}</option>)}</select></label>
                    <label><span>复杂任务模型</span><select aria-label="Auto 复杂任务模型" value={draft.autoComplexModel} onChange={(event) => { update("autoComplexModel", event.target.value); if (!draft.autoAllowlist.includes(event.target.value)) update("autoAllowlist", [...draft.autoAllowlist, event.target.value].filter(Boolean)); }}><option value="">选择模型</option>{autoCandidates.map((candidate) => <option key={`complex-${candidate.model}`} value={candidate.model}>{candidate.model} · {candidate.source === "engine-catalog" ? "官方目录" : "已验证"}</option>)}</select></label>
                    <label><span>路由策略</span><select aria-label="Auto 路由策略" value={draft.autoStrategy} onChange={(event) => update("autoStrategy", event.target.value)}><option value="conservative">保守 · 更多简单模型</option><option value="balanced">均衡</option><option value="quality">质量优先 · 更早使用复杂模型</option></select></label>
                  </div>
                  <div className="agent-auto-allowlist" role="group" aria-label="Auto 模型白名单">{autoCandidates.map((candidate) => <label key={`allow-${candidate.model}`}><input type="checkbox" checked={draft.autoAllowlist.includes(candidate.model)} disabled={[draft.autoSimpleModel, draft.autoComplexModel].includes(candidate.model)} onChange={(event) => update("autoAllowlist", event.target.checked ? [...new Set([...draft.autoAllowlist, candidate.model])] : draft.autoAllowlist.filter((model) => model !== candidate.model))} /><span>{candidate.model}</span><small>{candidate.source === "engine-catalog" ? "官方目录" : "已验证"}</small></label>)}</div>
                  <label className="agent-enabled-toggle"><input type="checkbox" checked={draft.autoFallbackEnabled} onChange={(event) => update("autoFallbackEnabled", event.target.checked)} /><span>仅在明确模型不兼容时允许白名单内回退</span></label>
                  {!autoPolicyValid ? <small className="agent-form-error">简单与复杂模型必须都在白名单中。</small> : null}
                </> : null}
              </fieldset>
              <label className="is-wide"><span>系统指令</span><textarea value={draft.instructions} onChange={(event) => update("instructions", event.target.value)} rows={7} maxLength={20000} required /></label>
              <label><span>Skill IDs（逗号分隔）</span><input value={draft.skillIds} onChange={(event) => update("skillIds", event.target.value)} /></label>
              <label><span>Tool IDs（逗号分隔）</span><input value={draft.toolIds} onChange={(event) => update("toolIds", event.target.value)} /></label>
            </div>
            <label className="agent-enabled-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span>在 Agent 选择器中启用</span></label>
            {editingId ? <p className="agent-revision-save-note"><History size={13} />保存会创建 Revision {(profiles.find((profile) => profile.id === editingId)?.revisionNumber || 0) + 1}；已存在的任务继续固定原 Revision。</p> : null}
            <footer>
              {editingId ? <button type="button" className="secondary-button" onClick={duplicate} disabled={busy}><Copy size={14} /> 复制</button> : null}
              {editingId ? <button type="button" className="danger-ghost-button" onClick={() => {
                if (window.confirm(`删除自定义 Agent「${draft.name}」？`)) onDelete(editingId).then(reset).catch(() => undefined);
              }} disabled={busy}><Trash2 size={14} /> 删除</button> : <span />}
              <button type="submit" className="primary-button" disabled={busy || !draft.name.trim() || !draft.instructions.trim() || !autoPolicyValid || (draft.backend === "rux-native" && !draft.providerConnectionId)}>{busy ? <LoaderCircle size={14} className="status-running" /> : <Check size={14} />}{editingId ? "保存 Agent" : "创建 Agent"}</button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const uiPreferences = useMemo(() => showcaseMode ? {} : readUiPreferences(), []);
  const [tasks, setTasks] = useState(() => window.rux || !showcaseMode
    ? []
    : initialTasks.map((task) => normalizePersistedTask(task)));
  const [selectedTaskId, setSelectedTaskId] = useState(() => window.rux
    ? ""
    : showcaseMode && initialTasks.some((task) => task.id === uiPreferences.selectedTaskId)
      ? uiPreferences.selectedTaskId
      : showcaseMode ? "devspace-intro" : "");
  const [workspaceState, setWorkspaceState] = useState(fallbackWorkspaceState);
  const [hydratedWorkspaceId, setHydratedWorkspaceId] = useState(null);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [startupLoading, setStartupLoading] = useState(Boolean(window.rux));
  const [startupError, setStartupError] = useState("");
  const [persistenceError, setPersistenceError] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = useState(() => showcaseMode
    ? [fallbackWorkspaceState.active.id]
    : Array.isArray(uiPreferences.expandedProjectIds) ? uiPreferences.expandedProjectIds : []);
  const [adapters, setAdapters] = useState(fallbackAdapters);
  const [inspectorTab, setInspectorTab] = useState(showcaseMode ? "environment" : uiPreferences.inspectorTab || "environment");
  const [inspectorOpen, setInspectorOpen] = useState(showcaseMode || (Boolean(uiPreferences.inspectorOpen) && Boolean(window.rux)));
  const [selectedFile, setSelectedFile] = useState(uiPreferences.selectedFile || "");
  const [changesState, setChangesState] = useState({ loading: false, snapshot: null, diff: null, diffLoading: false, error: "", acceptance: null });
  const [contextState, setContextState] = useState({ loading: false, snapshot: null, error: "" });
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [runRestorePreview, setRunRestorePreview] = useState(null);
  const [runRestoreBusy, setRunRestoreBusy] = useState(false);
  const [runRestoreError, setRunRestoreError] = useState("");
  const [runReviewState, setRunReviewState] = useState({ runId: "", path: "", loading: false, accepting: false, diff: null, error: "" });
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(Boolean(uiPreferences.sidebarCollapsed));
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskAgentId, setNewTaskAgentId] = useState("");
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentProfiles, setAgentProfiles] = useState([]);
  const [agentProfileBusy, setAgentProfileBusy] = useState(false);
  const [agentProfileError, setAgentProfileError] = useState("");
  const [nativeConnections, setNativeConnections] = useState([]);
  const [nativeProviderBusy, setNativeProviderBusy] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [sessionDiscoveryOpen, setSessionDiscoveryOpen] = useState(false);
  const [sessionDiscoveryEngine, setSessionDiscoveryEngine] = useState("codex");
  const [sessionDiscoveryState, setSessionDiscoveryState] = useState({ status: "idle", operationId: "", result: null, error: "" });
  const [sessionPreviewState, setSessionPreviewState] = useState({ status: "idle", operationId: "", item: null, preview: null, error: "" });
  const [sessionSyncState, setSessionSyncState] = useState({ open: false, loading: false, error: "", result: null, revisions: null });
  const [handoffState, setHandoffState] = useState({ open: false, loading: false, error: "", targetAgentId: "", messageIds: [], filePaths: [], agentSummary: "", agentSummaryGenerationId: "", summaryProvenance: null, constraints: "", preview: null, source: { messages: [], files: [] } });
  const [localDataState, setLocalDataState] = useState({ open: false, loading: false, error: "", notice: "", summary: null, preview: null, scope: "task", action: "unlink", format: "markdown", revisions: "current" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authState, setAuthState] = useState(null);
  const [authChecking, setAuthChecking] = useState(false);
  const [authLoginProvider, setAuthLoginProvider] = useState(null);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [codexSettings, setCodexSettings] = useState(() => {
    const saved = uiPreferences.codexSettings || {};
    return {
      ...defaultCodexSettings,
      ...saved,
      model: /^codex default$/i.test(saved.model || "") ? "Rux default" : saved.model || defaultCodexSettings.model,
    };
  });
  const [codexCatalog, setCodexCatalog] = useState({ loading: false, models: [], error: "", source: "", refreshedAt: "" });
  const [streamingMessagesByTask, setStreamingMessagesByTask] = useState({});
  const [taskActionError, setTaskActionError] = useState("");
  const [permissionBusy, setPermissionBusy] = useState("");
  const [permissionError, setPermissionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [drafts, setDrafts] = useState(() => {
    if (uiPreferences.drafts && typeof uiPreferences.drafts === "object") return uiPreferences.drafts;
    if (uiPreferences.selectedTaskId && typeof uiPreferences.draft === "string" && uiPreferences.draft) {
      return { [uiPreferences.selectedTaskId]: uiPreferences.draft };
    }
    return {};
  });
  const runtimeRef = useRef(null);
  const cancellationsRef = useRef(new Map());
  const runTokensRef = useRef(new Map());
  const composerInputRef = useRef(null);
  const codexProvider = authState?.providers?.find((provider) => provider.id === "chatgpt");
  const codexConnected = codexProvider?.status === "connected";
  const connectedProviderCount = authState?.providers?.filter((provider) => provider.status === "connected").length || 0;

  useEffect(() => {
    let disposed = false;
    const runtime = createRuntimeClient();
    runtimeRef.current = runtime;
    setStartupError("");
    setStartupLoading(Boolean(window.rux));
    if (window.rux) setHydratedWorkspaceId(null);

    const hydrate = async () => {
      const [agentResult, profileResult, connectionResult, nextState] = await Promise.all([
        window.rux ? Promise.resolve({ adapters: fallbackAdapters }) : runtime.listAgents(),
        runtime.listAgentProfiles(),
        runtime.listProviderConnections(),
        window.rux ? window.rux.getWorkspaceState() : Promise.resolve(null),
      ]);
      if (disposed) return;
      setAdapters(agentResult.adapters.map((adapter) => adapter.id === "rux-native" ? {
        ...adapter,
        available: connectionResult.length > 0,
        detail: connectionResult.length ? `${connectionResult.length} 个原生 Provider Connection` : adapter.detail,
      } : adapter));
      setAgentProfiles(profileResult.profiles);
      setNativeConnections(connectionResult);
      setAgentProfileError("");

      if (window.rux && nextState) {
        const snapshots = await Promise.all(nextState.recent.map((workspace) =>
          window.rux.loadTaskState(workspace.id)));
        if (disposed) return;

        const activeSnapshot = snapshots.find((snapshot) => snapshot.workspaceId === nextState.active.id);
        const storedActiveTasks = withoutSupersededWorkspaceStarter((activeSnapshot?.tasks || [])
          .filter((task) => !isLegacyShowcaseTask(task))
          .map((task) => normalizePersistedTask(task, nextState.active.id)), nextState.active.id);
        const activeTasks = storedActiveTasks.length
          ? storedActiveTasks
          : [normalizePersistedTask(createWorkspaceStarterTask(nextState.active, codexSettings), nextState.active.id)];
        const inactiveTasks = snapshots
          .filter((snapshot) => snapshot.workspaceId !== nextState.active.id)
          .flatMap((snapshot) => withoutSupersededWorkspaceStarter(snapshot.tasks
            .filter((task) => !isLegacyShowcaseTask(task))
            .map((task) => normalizePersistedTask(task, snapshot.workspaceId)), snapshot.workspaceId));
        const hydratedTasks = [...activeTasks, ...inactiveTasks];
        const preferredTask = activeTasks.find((task) => task.id === uiPreferences.selectedTaskId)
          ?? activeTasks[0];

        setWorkspaceState(nextState);
        setTasks(hydratedTasks);
        setSelectedTaskId(preferredTask.id);
        setHydratedWorkspaceId(nextState.active.id);
      } else {
        setHydratedWorkspaceId(fallbackWorkspaceState.active.id);
      }
      setStartupLoading(false);
    };

    void hydrate().catch((error) => {
      if (disposed) return;
      setStartupLoading(false);
      setStartupError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      disposed = true;
      runtime.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      cancellationsRef.current.clear();
      runTokensRef.current.clear();
    };
  }, [startupAttempt]);

  useEffect(() => {
    if (!window.rux || hydratedWorkspaceId !== workspaceState.active.id) return;
    const snapshot = workspaceTaskSnapshot(workspaceState.active.id, tasks);
    void window.rux.saveTaskState(snapshot).then(() => {
      setPersistenceError("");
    }).catch((error) => {
      setPersistenceError(error instanceof Error ? error.message : String(error));
      for (const activeRun of cancellationsRef.current.values()) activeRun.cancel();
    });
  }, [hydratedWorkspaceId, tasks, workspaceState.active.id]);

  useEffect(() => {
    if (showcaseMode) return;
    try {
      window.localStorage.setItem(uiPreferencesKey, JSON.stringify({
        selectedTaskId,
        expandedProjectIds,
        sidebarCollapsed,
        inspectorOpen,
        inspectorTab,
        selectedFile,
        drafts,
        draft: drafts[selectedTaskId] || "",
        codexSettings,
      }));
    } catch {
      // UI preferences are optional; private sessions may reject storage.
    }
  }, [codexSettings, drafts, expandedProjectIds, inspectorOpen, inspectorTab, selectedFile, selectedTaskId, sidebarCollapsed]);

  useEffect(() => {
    const handleGlobalShortcut = (event) => {
      if (event.key === "Escape") {
        setInspectorOpen(false);
        setTerminalOpen(false);
        setSidebarOpen(false);
        setNewTaskOpen(false);
        setAgentsOpen(false);
        setAccountsOpen(false);
        setSettingsOpen(false);
        setRestorePreview(null);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setAccountsOpen(false);
        setNewTaskOpen(false);
        setAgentsOpen(false);
        setSettingsOpen(true);
        setSidebarOpen(false);
        if (codexConnected) window.setTimeout(() => void loadCodexModels(), 0);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setInspectorOpen(false);
        setTerminalOpen(false);
        if (workspaceState.active.placeholder) void chooseWorkspace();
        else {
          setNewTaskAgentId("");
          setNewTaskOpen(true);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalShortcut, true);
    return () => window.removeEventListener("keydown", handleGlobalShortcut, true);
  }, [codexConnected, workspaceState.active.placeholder, workspaceBusy]);

  const workspaceTasks = useMemo(
    () => tasks.filter((task) => task.workspaceId === workspaceState.active.id),
    [tasks, workspaceState.active.id],
  );

  const selectedTask = useMemo(
    () => workspaceTasks.find((task) => task.id === selectedTaskId)
      || workspaceTasks[0]
      || createWorkspaceStarterTask(workspaceState.active, codexSettings),
    [codexSettings, selectedTaskId, workspaceState.active, workspaceTasks],
  );
  const draft = drafts[selectedTask.id] || "";
  const setDraft = (value) => {
    setDrafts((items) => {
      const current = items[selectedTask.id] || "";
      const nextValue = typeof value === "function" ? value(current) : value;
      if (nextValue === current) return items;
      if (!nextValue) {
        const next = { ...items };
        delete next[selectedTask.id];
        return next;
      }
      return { ...items, [selectedTask.id]: nextValue };
    });
  };

  useEffect(() => {
    setPermissionError("");
    setPermissionBusy("");
    setRunRestorePreview(null);
    setRunRestoreError("");
  }, [selectedTask.id]);

  useEffect(() => {
    setStreamingMessagesByTask({});
  }, [workspaceState.active.id]);

  const agentChoices = useMemo(() => {
    const builtIns = adapters.filter((adapter) => ["codex", "claude-code", "mock"].includes(adapter.id)).map((adapter) => {
      const provider = authProviderForAdapter(authState, adapter.id);
      const authenticationReady = adapter.id === "mock" || provider?.status === "connected";
      const providerConnection = provider?.providerConnection || defaultProviderConnectionForAdapter(adapter.id);
      const verifiedModels = verifiedModelHistory(tasks, adapter.id, providerConnection.id);
      const defaultModel = adapter.id === "codex"
        ? codexSettings.model
        : adapter.id === "claude-code" ? "Claude default" : "Rux prototype";
      return {
        id: adapter.id,
        name: adapter.id === "mock" ? "Rux Demo" : adapter.id === "claude-code" ? "Claude Code" : "Rux",
        adapter: adapter.id,
        available: adapter.available && authenticationReady,
        detail: adapter.id === "codex" ? "Rux 本机 Agent" : adapter.detail,
        unavailableReason: !adapter.available
          ? authState
            ? `未找到可用的 ${adapter.id === "claude-code" ? "Claude Code" : "Rux"} 本机组件`
            : "请配置 Rux Native Provider，或检测可选的本机 Agent CLI"
          : !authenticationReady
            ? `请先在账户与登录中连接 ${adapter.id === "claude-code" ? "Claude Code" : "Rux"}`
            : "",
        requiresLogin: adapter.id !== "mock" && adapter.available && provider?.status === "signed-out",
        agentRevisionId: builtInAgentRevisionId(adapter.id),
        providerConnection,
        model: defaultModel,
        ...modelSelectionState(adapter.id, defaultModel, codexCatalog.models, verifiedModels),
        verifiedModels,
        reasoningEffort: adapter.id === "codex" ? codexSettings.reasoningEffort : "",
        permissionMode: adapter.id === "codex" ? codexSettings.permissionMode : "acceptEdits",
      };
    });
    const custom = agentProfiles.map((profile) => {
      const backend = adapters.find((adapter) => adapter.id === profile.backend);
      const provider = authProviderForAdapter(authState, profile.backend);
      const nativeConnectionReady = profile.backend === "rux-native" && nativeConnections.some((connection) => connection.id === profile.providerConnection.id && connection.hasCredential);
      const authenticationReady = profile.backend === "rux-native" ? nativeConnectionReady : provider?.status === "connected";
      const verifiedModels = verifiedModelHistory(tasks, profile.backend, profile.providerConnection.id);
      return {
        id: profile.id,
        name: profile.name,
        adapter: profile.backend,
        profileId: profile.id,
        agentRevisionId: profile.latestRevisionId,
        providerConnection: profile.providerConnection,
        available: profile.enabled && Boolean(backend?.available) && authenticationReady,
        detail: profile.description || "自定义 Agent",
        unavailableReason: !profile.enabled
          ? "这个自定义 Agent 已停用"
          : !backend?.available
            ? profile.backend === "rux-native"
              ? "原生 Provider Connection 当前不可用"
              : authState
              ? `未找到可用的 ${profile.backend === "claude-code" ? "Claude Code" : "Rux"} 本机组件`
              : "请配置 Rux Native Provider，或检测可选的本机 Agent CLI"
            : !authenticationReady
              ? `请先在账户与登录中连接 ${profile.backend === "claude-code" ? "Claude Code" : "Rux"}`
              : "",
        requiresLogin: Boolean(backend?.available) && provider?.status === "signed-out",
        model: profile.model || (profile.backend === "codex" ? codexSettings.model : profile.backend === "rux-native" ? nativeConnections.find((connection) => connection.id === profile.providerConnection.id)?.defaultModel || "Provider default" : "Claude default"),
        modelSource: profile.modelSource,
        modelVerificationStatus: profile.modelVerificationStatus,
        autoModelPolicy: profile.autoModelPolicy,
        verifiedModels,
        reasoningEffort: profile.reasoningEffort || (profile.backend === "codex" ? codexSettings.reasoningEffort : ""),
        permissionMode: profile.permissionMode,
      };
    });
    return [...builtIns.filter((item) => item.id !== "mock"), ...custom, ...builtIns.filter((item) => item.id === "mock")];
  }, [adapters, agentProfiles, authState, codexCatalog.models, codexSettings, nativeConnections, tasks]);

  const taskAgentChoices = useMemo(() => {
    if (!selectedTask.agentProfileId) return agentChoices;
    const existing = agentChoices.find((choice) => choice.id === selectedTask.agentProfileId);
    if (existing) return agentChoices;
    const backend = adapters.find((adapter) => adapter.id === runtimeAdapterForTask(selectedTask));
    const provider = authProviderForAdapter(authState, runtimeAdapterForTask(selectedTask));
    const nativeReady = runtimeAdapterForTask(selectedTask) === "rux-native" && nativeConnections.some((connection) => connection.id === selectedTask.providerConnection?.id && connection.hasCredential);
    const available = Boolean(backend?.available) && (nativeReady || provider?.status === "connected");
    return [...agentChoices, {
      id: selectedTask.agentProfileId,
      name: selectedTask.agent,
      adapter: runtimeAdapterForTask(selectedTask),
      profileId: selectedTask.agentProfileId,
      agentRevisionId: selectedTask.agentRevisionId,
      providerConnection: selectedTask.providerConnection,
      available,
      detail: `已删除 Definition 的历史 Revision ${agentRevisionNumber(selectedTask.agentRevisionId) || ""}`.trim(),
      unavailableReason: !backend?.available
        ? "这个历史 Agent 的本机组件不可用"
        : !nativeReady && provider?.status !== "connected" ? "请先在账户与登录中连接对应 Provider" : "",
      requiresLogin: runtimeAdapterForTask(selectedTask) !== "rux-native" && Boolean(backend?.available) && provider?.status === "signed-out",
      model: selectedTask.model,
      modelSource: selectedTask.modelSource,
      modelVerificationStatus: selectedTask.modelVerificationStatus,
      verifiedModels: verifiedModelHistory(tasks, runtimeAdapterForTask(selectedTask), selectedTask.providerConnection?.id),
      reasoningEffort: selectedTask.reasoningEffort || "",
      permissionMode: selectedTask.permissionMode || "acceptEdits",
      historical: true,
    }];
  }, [adapters, agentChoices, authState, nativeConnections, selectedTask, tasks]);

  const selectedAgentRevisionUpdate = useMemo(() => {
    const update = agentRevisionUpdateForTask(selectedTask, agentProfiles);
    if (!update) return null;
    const latestChoice = agentChoices.find((choice) => choice.id === update.profile.id);
    return {
      ...update,
      available: Boolean(latestChoice?.available),
      unavailableReason: latestChoice?.unavailableReason || "最新版 Agent 当前不可用",
    };
  }, [agentChoices, agentProfiles, selectedTask]);

  const appReady = !workspaceState.active.placeholder
    && !startupLoading
    && !startupError
    && !persistenceError
    && hydratedWorkspaceId === workspaceState.active.id;
  const selectedAgentReady = Boolean(taskAgentChoices.find((choice) =>
    choice.id === (selectedTask.agentProfileId || runtimeAdapterForTask(selectedTask)))?.available);

  async function loadCodexModels() {
    const runtime = runtimeRef.current;
    if (!runtime || !codexConnected) return;
    setCodexCatalog((state) => ({ ...state, loading: true, error: "" }));
    try {
      const collected = [];
      let cursor = null;
      let refreshedAt = "";
      let source = "";
      for (let page = 0; page < 10; page += 1) {
        const result = await runtime.listAgentModels({ adapter: "codex", limit: 100, ...(cursor ? { cursor } : {}) });
        collected.push(...(result.models || []));
        refreshedAt = result.fetchedAt || refreshedAt;
        source = result.source || source;
        cursor = result.nextCursor || null;
        if (!cursor) break;
      }
      const unique = [...new Map(collected.map((model) => [model.id, model])).values()];
      setCodexCatalog({ loading: false, models: unique, error: "", source, refreshedAt });
    } catch (error) {
      setCodexCatalog((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  useEffect(() => {
    const fallback = agentChoices.find((choice) => choice.available);
    if (!fallback) return;
    setTasks((items) => {
      let changed = false;
      const next = items.map((task) => {
        const emptyTask = task.status === "waiting"
          && !(task.messages || []).length
          && !(task.runs || []).length;
        const selectedId = task.agentProfileId || runtimeAdapterForTask(task);
        const selectedChoice = agentChoices.find((choice) => choice.id === selectedId);
        const untouchedWorkspaceStarter = task.id === `workspace-${task.workspaceId}`;
        if (!emptyTask || selectedChoice?.available || (selectedChoice?.requiresLogin && !untouchedWorkspaceStarter)) return task;
        changed = true;
        return {
          ...task,
          agent: fallback.name,
          adapter: fallback.adapter,
          model: fallback.model,
          ...(fallback.reasoningEffort ? { reasoningEffort: fallback.reasoningEffort } : { reasoningEffort: undefined }),
          permissionMode: fallback.permissionMode || task.permissionMode || "acceptEdits",
          ...(fallback.profileId ? { agentProfileId: fallback.profileId } : { agentProfileId: undefined }),
          agentRevisionId: fallback.agentRevisionId,
          providerConnection: fallback.providerConnection,
          modelSource: fallback.modelSource,
          modelVerificationStatus: fallback.modelVerificationStatus,
          updatedAtIso: isoNow(),
        };
      });
      return changed ? next : items;
    });
  }, [agentChoices]);

  const refreshChanges = async () => {
    const runtime = runtimeRef.current;
    if (workspaceState.active.placeholder) {
      setChangesState({ loading: false, snapshot: null, diff: null, diffLoading: false, error: "", acceptance: null });
      setSelectedFile("");
      return;
    }
    if (!runtime) return;
    setChangesState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const snapshot = await runtime.listChanges();
      setChangesState((state) => ({
        ...state,
        loading: false,
        snapshot,
        error: "",
        acceptance: state.acceptance?.snapshotId === snapshot.snapshotId ? state.acceptance : null,
        ...(state.diff?.snapshotId === snapshot.snapshotId ? {} : { diff: null }),
      }));
      setSelectedFile((current) => snapshot.files.some((file) => file.path === current)
        ? current
        : snapshot.files[0]?.path || "");
    } catch (error) {
      setChangesState((state) => ({ ...state, loading: false, snapshot: null, diff: null, error: error instanceof Error ? error.message : String(error) }));
      setSelectedFile("");
    }
  };

  const refreshContext = async (selectedPaths = selectedTask.contextFiles || []) => {
    const runtime = runtimeRef.current;
    if (workspaceState.active.placeholder) {
      setContextState({ loading: false, snapshot: null, error: "" });
      return;
    }
    if (!runtime) return;
    setContextState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const snapshot = await runtime.contextSnapshot(selectedPaths);
      setContextState({ loading: false, snapshot, error: "" });
    } catch (error) {
      setContextState({ loading: false, snapshot: null, error: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(() => {
    if (hydratedWorkspaceId !== workspaceState.active.id || !runtimeRef.current) return;
    if (workspaceState.active.placeholder) {
      setChangesState({ loading: false, snapshot: null, diff: null, diffLoading: false, error: "", acceptance: null });
      setContextState({ loading: false, snapshot: null, error: "" });
      setSelectedFile("");
      setInspectorOpen(false);
      setTerminalOpen(false);
      return;
    }
    void refreshChanges();
    void refreshContext();
  }, [hydratedWorkspaceId, workspaceState.active.id, workspaceState.active.placeholder, selectedTask.id]);

  const toggleContextFile = async (path) => {
    const runtime = runtimeRef.current;
    if (!runtime || contextState.loading) return;
    const current = selectedTask.contextFiles || [];
    const next = current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
    setContextState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const snapshot = await runtime.contextSnapshot(next);
      setTasks((items) => items.map((task) => task.id === selectedTask.id
        ? { ...task, contextFiles: next, updatedAtIso: isoNow() }
        : task));
      setContextState({ loading: false, snapshot, error: "" });
    } catch (error) {
      setContextState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const addContextSource = async (requestedPath) => {
    const runtime = runtimeRef.current;
    if (!runtime || workspaceState.active.placeholder) {
      throw new Error("请先在 Rux 桌面应用中打开项目。");
    }

    const trimmed = String(requestedPath || "").trim();
    if (!trimmed) throw new Error("请输入工作区相对文件路径。");
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      throw new Error("来源只接受工作区相对文件路径，不支持 URL。");
    }
    const normalized = trimmed.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
    if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.includes("\0")) {
      throw new Error("请输入工作区内的相对文件路径。");
    }
    setContextState((state) => ({ ...state, loading: true, error: "" }));
    try {
      // Runtime performs the authoritative workspace-boundary, symlink and secret checks.
      const validationSnapshot = await runtime.contextSnapshot([normalized]);
      const validatedSource = validationSnapshot.selectedFiles?.[0];
      if (!validatedSource) {
        throw new Error("该文件由 Runtime 作为工作区指令自动管理，无需手动添加。");
      }
      if (!validatedSource.exists) {
        throw new Error(`工作区内找不到文件：${validatedSource.path || normalized}`);
      }

      const canonicalPath = validatedSource.path || normalized;
      const current = selectedTask.contextFiles || [];
      const alreadyIncluded = current.includes(normalized) || current.includes(canonicalPath);
      const next = alreadyIncluded ? current : [...current, canonicalPath];
      const snapshot = await runtime.contextSnapshot(next);

      if (!alreadyIncluded) {
        setTasks((items) => items.map((task) => task.id === selectedTask.id
          ? { ...task, contextFiles: next, updatedAtIso: isoNow() }
          : task));
      }
      setContextState({ loading: false, snapshot, error: "" });
      return { alreadyIncluded, path: canonicalPath, snapshot };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setContextState((state) => ({ ...state, loading: false, error: message }));
      throw error;
    }
  };

  useEffect(() => {
    const snapshot = changesState.snapshot;
    const runtime = runtimeRef.current;
    if (!runtime || !snapshot || !selectedFile || !snapshot.files.some((file) => file.path === selectedFile)) {
      setChangesState((state) => state.diff || state.diffLoading ? { ...state, diff: null, diffLoading: false } : state);
      return;
    }
    let disposed = false;
    setChangesState((state) => ({ ...state, diffLoading: true, error: "" }));
    void runtime.getFileDiff(selectedFile, snapshot.snapshotId).then((diff) => {
      if (!disposed) setChangesState((state) => ({ ...state, diff, diffLoading: false }));
    }).catch((error) => {
      if (!disposed) setChangesState((state) => ({ ...state, diff: null, diffLoading: false, error: error instanceof Error ? error.message : String(error) }));
    });
    return () => { disposed = true; };
  }, [changesState.snapshot?.snapshotId, selectedFile]);

  useEffect(() => {
    const acceptance = [...(selectedTask.reviewAcceptances || [])].reverse()
      .find((item) => item.snapshotId === changesState.snapshot?.snapshotId);
    if (acceptance) setChangesState((state) => ({ ...state, acceptance }));
  }, [selectedTask.id, changesState.snapshot?.snapshotId]);

  const updateTaskFromRuntime = (taskId, event) => {
    setTasks((items) => items.map((task) => {
      if (task.id !== taskId) return task;
      task = recordRuntimeEvent(task, event);
      if (event.type === "run.started") {
        return {
          ...task,
          status: "running",
          updatedAt: "现在",
          preview: `${ruxAgentLabel(task.agent)} 正在运行`,
        };
      }
      if (event.type === "permission.requested") {
        const singleAction = event.request.scope?.appliesTo === "single-action";
        return {
          ...task,
          status: "blocked",
          updatedAt: "现在",
          preview: singleAction
            ? `等待你确认 ${event.request.toolName || "Agent 工具"} 操作`
            : "等待你确认 Workspace 写入权限",
        };
      }
      if (event.type === "permission.decided") {
        const eventRun = task.runs?.find((run) => run.id === event.runId);
        const decidedRequest = eventRun?.permissionRequests?.find((request) => request.id === event.decision.requestId);
        const remainingRequest = eventRun?.permissionRequests?.find((request) => request.status === "pending");
        if (decidedRequest?.provider) {
          return {
            ...task,
            status: event.decision.decision === "cancelled" ? "stopped" : remainingRequest ? "blocked" : "running",
            updatedAt: "现在",
            preview: remainingRequest
              ? `仍在等待你确认 ${remainingRequest.toolName || "Agent 工具"} 操作`
              : event.decision.decision === "approved"
              ? `已允许 ${decidedRequest.toolName || "Agent 工具"}，Agent 继续运行`
              : event.decision.decision === "denied"
                ? `已拒绝 ${decidedRequest.toolName || "Agent 工具"}，Agent 继续运行`
                : "正在停止 Agent",
          };
        }
        if (event.decision.decision === "approved") {
          return {
            ...task,
            status: "running",
            updatedAt: "现在",
            preview: "权限已批准，正在启动 Agent",
          };
        }
        return {
          ...task,
          status: "stopped",
          updatedAt: "现在",
          preview: event.decision.decision === "denied" ? "权限已拒绝" : "等待权限时已停止",
        };
      }
      if (event.type === "run.metadata") {
        return {
          ...task,
          model: task.model === "Auto" ? "Auto" : event.model || task.model,
          reasoningEffort: event.reasoningEffort || task.reasoningEffort,
        };
      }
      if (event.type === "run.cancelled") {
        return {
          ...task,
          status: "stopped",
          updatedAt: "现在",
          preview: "运行已由用户停止",
          plan: task.plan.map((step) => step.state === "active" ? { ...step, state: "pending" } : step),
          activity: task.activity.map((item) => item.state === "active" ? { ...item, state: "error" } : item),
        };
      }
      if (event.type === "activity.started" || event.type === "activity.completed") {
        const exists = task.activity.some((item) => item.id === event.activity.id);
        const activity = exists
          ? task.activity.map((item) => item.id === event.activity.id ? event.activity : item)
          : [...task.activity, event.activity];
        return { ...task, activity, preview: event.activity.title };
      }
      if (event.type === "assistant.message") {
        const createdAt = isoNow();
        const eventRun = task.runs?.find((run) => run.id === event.runId);
        return {
          ...task,
          messages: [...task.messages, {
            id: `assistant-${event.runId}-${Date.now()}`,
            role: "assistant",
            text: event.text,
            time: "现在",
            createdAt,
            runId: event.runId,
            agent: ruxAgentLabel(eventRun?.agentSnapshot?.name || task.agent),
            adapter: eventRun?.adapter || runtimeAdapterForTask(task),
            ...(eventRun?.profileId ? { profileId: eventRun.profileId } : {}),
          }],
          preview: event.text.slice(0, 90),
        };
      }
      if (event.type === "plan.updated") {
        return {
          ...task,
          plan: event.items.map((item, index, items) => ({
            label: item.text,
            state: item.completed ? "done" : items.slice(0, index).every((prior) => prior.completed) ? "active" : "pending",
          })),
        };
      }
      if (event.type === "run.usage") {
        return task;
      }
      if (event.type === "run.completed") {
        const completedRun = task.runs?.find((run) => run.id === event.runId);
        const hasFailureEvidence = task.activity.some((item) => item.state === "error")
          || completedRun?.verifications?.some((verification) => verification.status === "failed");
        const verifiedModelUpdate = task.model !== "Auto" && completedRun?.modelVerificationStatus === "verified"
          && ["manual", "verified-history"].includes(completedRun.modelSource)
          ? { modelSource: "verified-history", modelVerificationStatus: "verified" }
          : {};
        return {
          ...task,
          ...verifiedModelUpdate,
          status: hasFailureEvidence ? "failed" : "completed",
          updatedAt: "现在",
          elapsed: formatDuration(event.durationMs) || task.elapsed,
          preview: hasFailureEvidence ? "运行结束，但存在失败证据" : "运行完成，等待审查",
          activity: task.activity.map((item) => item.state === "active"
            ? { ...item, state: hasFailureEvidence ? "error" : "done" }
            : item),
        };
      }
      if (event.type === "run.failed") {
        const createdAt = isoNow();
        const eventRun = task.runs?.find((run) => run.id === event.runId);
        return {
          ...task,
          ...(eventRun?.modelVerificationStatus === "unavailable"
            ? { modelVerificationStatus: "unavailable" }
            : {}),
          status: "failed",
          updatedAt: "现在",
          preview: "运行失败",
          plan: task.plan.map((step) => step.state === "active" ? { ...step, state: "pending" } : step),
          activity: task.activity.map((item) => item.state === "active" ? { ...item, state: "error" } : item),
          messages: [...task.messages, {
            id: `error-${event.runId}-${Date.now()}`,
            role: "assistant",
            text: `${ruxAgentLabel(eventRun?.agentSnapshot?.name || task.agent)} 运行失败：${event.error}`,
            time: "现在",
            createdAt,
            runId: event.runId,
            agent: ruxAgentLabel(eventRun?.agentSnapshot?.name || task.agent),
            adapter: eventRun?.adapter || runtimeAdapterForTask(task),
            ...(eventRun?.profileId ? { profileId: eventRun.profileId } : {}),
          }],
        };
      }
      return task;
    }));
  };

  const receiveRunEvent = (taskId, token, event) => {
    if (runTokensRef.current.get(taskId) !== token) return;
    if (event.type === "assistant.message.delta") {
      setStreamingMessagesByTask((state) => appendStreamingAssistantDelta(state, taskId, event));
      return;
    }
    if (event.type === "assistant.message") {
      setStreamingMessagesByTask((state) => clearStreamingAssistantMessages(state, taskId, event));
    } else if (["run.completed", "run.cancelled", "run.failed"].includes(event.type)) {
      setStreamingMessagesByTask((state) => clearStreamingAssistantMessages(state, taskId, {
        runId: event.runId,
      }));
    }
    updateTaskFromRuntime(taskId, event);
    if (["run.completed", "run.cancelled", "run.failed"].includes(event.type)) {
      cancellationsRef.current.delete(taskId);
      runTokensRef.current.delete(taskId);
      window.setTimeout(() => {
        void refreshChanges();
        void refreshContext();
      }, 120);
    }
  };

  const runPreflight = (taskSnapshot, prompt) => {
    const runtime = runtimeRef.current;
    const selectedAgentId = taskSnapshot.agentProfileId || runtimeAdapterForTask(taskSnapshot);
    const selectedAgentChoice = agentChoices.find((choice) => choice.id === selectedAgentId);
    if (workspaceState.active.placeholder) {
      return { ok: false, error: "请先打开项目，再启动 Agent。" };
    }
    if (!String(prompt || "").trim()) {
      return { ok: false, error: "请先在输入框中描述你想完成的任务。" };
    }
    if (taskSnapshot.importedSession?.mode === "view") {
      return { ok: false, error: "这是仅查看的导入会话。若要继续，请重新导入并选择“导入并继续”，或通过上下文交接创建新任务。" };
    }
    if (taskSnapshot.importedSession?.status === "native-unavailable") {
      return { ok: false, error: "原生会话当前不可用。本地 Projection 仍可查看；请先刷新确认，或通过上下文交接创建新任务。" };
    }
    if (taskSnapshot.importedSession?.status === "unlinked") {
      return { ok: false, error: "该会话已解除关联。本地内容仍可查看；请重新导入原生会话，或通过上下文交接创建新任务。" };
    }
    if (!taskSnapshot.agentRevisionId || !taskSnapshot.providerConnection?.id) {
      return { ok: false, error: "这个任务缺少可验证的 Agent Revision 或 Provider Connection，请新建任务。" };
    }
    if (taskSnapshot.model === "Auto") {
      const pinnedPolicy = taskSnapshot.agentRevisionSnapshot?.autoModelPolicy
        || (selectedAgentChoice?.agentRevisionId === taskSnapshot.agentRevisionId ? selectedAgentChoice.autoModelPolicy : undefined);
      if (!pinnedPolicy) {
        return { ok: false, error: "这个 Task 固定的 Agent Revision 未配置 Auto Model Policy。请改用固定模型，或基于最新 Revision 新建 Task。" };
      }
    }
    if (!runtime || !appReady) {
      const reason = persistenceError
        ? `任务状态尚未安全保存：${persistenceError}`
        : startupError || "Rux Runtime 尚未就绪";
      return { ok: false, error: reason };
    }
    if (!selectedAgentChoice?.available) {
      return {
        ok: false,
        error: selectedAgentChoice?.unavailableReason
          || `Agent「${taskSnapshot.agent}」不可用或未登录。请选择一个可用 Agent 后再运行。`,
      };
    }
    return { ok: true, runtime, selectedAgentChoice };
  };

  const launchRun = (taskId, prompt, taskSnapshot, messageId, prepared) => {
    const preflight = prepared || runPreflight(taskSnapshot, prompt);
    if (!preflight.ok) {
      setTaskActionError(preflight.error);
      return false;
    }
    const runtime = preflight.runtime;
    setTaskActionError("");
    setStreamingMessagesByTask((state) => clearStreamingAssistantMessages(state, taskId));

    const token = Symbol(taskId);
    runTokensRef.current.set(taskId, token);
    const previousRun = cancellationsRef.current.get(taskId);
    if (previousRun) {
      previousRun.cancel();
      updateTaskFromRuntime(taskId, { type: "run.cancelled", runId: previousRun.runId });
    }
    const resetAt = isoNow();
    setTasks((items) => items.map((task) => task.id === taskId ? {
      ...task,
      status: "running",
      preview: "正在启动新的 Run",
      updatedAt: "现在",
      updatedAtIso: resetAt,
      elapsed: "—",
      tokens: "—",
      activity: [],
      plan: [],
    } : task));
    const adapter = runtimeAdapterForTask(taskSnapshot);
    const sessionLink = latestCompatibleSessionLink(taskSnapshot);
    const sessionId = sessionLink?.nativeSessionId;
    const requestedModel = adapter === "claude-code"
      ? modelAlias(taskSnapshot.model)
      : taskSnapshot.model && !taskSnapshot.model.toLowerCase().includes("default") ? taskSnapshot.model : undefined;
    let run;
    try {
      run = runtime.run(prompt, {
        adapter,
        permissionMode: taskSnapshot.permissionMode || "acceptEdits",
        model: requestedModel,
        modelMode: taskSnapshot.model === "Auto" ? "auto" : "fixed",
        modelSource: taskSnapshot.modelSource,
        modelVerificationStatus: taskSnapshot.modelVerificationStatus,
        reasoningEffort: taskSnapshot.reasoningEffort || undefined,
        sessionId,
        profileId: taskSnapshot.agentProfileId,
        agentRevisionId: taskSnapshot.agentRevisionId,
        providerConnectionId: taskSnapshot.providerConnection.id,
        contextFiles: taskSnapshot.contextFiles || [],
      }, (event) => receiveRunEvent(taskId, token, event));
    } catch (error) {
      runTokensRef.current.delete(taskId);
      const message = error instanceof Error ? error.message : String(error);
      setTaskActionError(message);
      updateTaskFromRuntime(taskId, { type: "run.failed", runId: `runtime-launch-${Date.now()}`, error: message });
      return false;
    }
    cancellationsRef.current.set(taskId, run);
    if (messageId) {
      setTasks((items) => items.map((task) => task.id === taskId ? {
        ...task,
        messages: task.messages.map((message) => message.id === messageId ? {
          ...message,
          runId: run.runId,
          agent: taskSnapshot.agent,
          adapter,
          ...(taskSnapshot.agentProfileId ? { profileId: taskSnapshot.agentProfileId } : {}),
          agentRevisionId: taskSnapshot.agentRevisionId,
        } : message),
      } : task));
    }
    return true;
  };

  const decidePermission = async (request, decision) => {
    const runtime = runtimeRef.current;
    if (!runtime || permissionBusy) return;
    const taskId = selectedTask.id;
    const token = runTokensRef.current.get(taskId) || Symbol(taskId);
    runTokensRef.current.set(taskId, token);
    setPermissionBusy(request.id);
    setPermissionError("");
    try {
      await runtime.decidePermission(
        request.runId,
        request.id,
        decision,
        (event) => receiveRunEvent(taskId, token, event),
      );
      if (decision === "approved" && !cancellationsRef.current.has(taskId)) {
        cancellationsRef.current.set(taskId, {
          runId: request.runId,
          cancel: () => { void runtime.cancelRun(request.runId); },
        });
      }
    } catch (error) {
      setPermissionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPermissionBusy("");
    }
  };

  const sendMessage = () => {
    const prompt = draft.trim();
    if (!prompt) return;
    const preflight = runPreflight(selectedTask, prompt);
    if (!preflight.ok) {
      setTaskActionError(preflight.error);
      return;
    }
    const taskId = selectedTask.id;
    const createdAt = isoNow();
    const messageId = `user-${Date.now()}`;
    setTasks((items) => items.map((task) => task.id === taskId ? {
      ...task,
      ...(task.id === `workspace-${task.workspaceId}` && !task.messages.length && !(task.runs || []).length
        ? { title: taskTitleFromPrompt(prompt) }
        : {}),
      updatedAt: "现在",
      updatedAtIso: createdAt,
      messages: [...task.messages, {
        id: messageId,
        role: "user",
        text: prompt,
        time: "现在",
        createdAt,
      }],
    } : task));
    setDraft("");
    launchRun(taskId, prompt, selectedTask, messageId, preflight);
  };

  const toggleRun = () => {
    if (workspaceState.active.placeholder) return;
    if (selectedTask.status === "running" || selectedTask.status === "blocked") {
      const active = cancellationsRef.current.get(selectedTask.id);
      if (active) {
        active.cancel();
      } else {
        const latestRun = selectedTask.runs?.[selectedTask.runs.length - 1];
        if (latestRun) {
          const token = runTokensRef.current.get(selectedTask.id) || Symbol(selectedTask.id);
          runTokensRef.current.set(selectedTask.id, token);
          void runtimeRef.current?.cancelRun(
            latestRun.id,
            (event) => receiveRunEvent(selectedTask.id, token, event),
          ).catch((error) => setPermissionError(error instanceof Error ? error.message : String(error)));
        }
      }
      const updatedAtIso = isoNow();
      setTasks((items) => items.map((task) => task.id === selectedTask.id
        ? { ...task, status: "stopped", preview: "正在停止运行…", updatedAt: "现在", updatedAtIso }
        : task));
      return;
    }

    const prompt = [...selectedTask.messages].reverse().find((message) => message.role === "user")?.text;
    if (!prompt) {
      composerInputRef.current?.focus();
      setTaskActionError("请先在输入框中描述你想完成的任务。");
      return;
    }
    launchRun(selectedTask.id, prompt, selectedTask);
  };

  const createTask = (prompt, choice, permissionMode, contextFiles = []) => {
    if (workspaceState.active.placeholder) return;
    const id = `task-${Date.now()}`;
    const createdAt = isoNow();
    const task = {
      id,
      workspaceId: workspaceState.active.id,
      title: taskTitleFromPrompt(prompt),
      preview: "新任务正在启动",
      status: "waiting",
      updatedAt: "现在",
      updatedAtIso: createdAt,
      createdAt,
      agent: choice.name,
      adapter: choice.adapter,
      ...(choice.profileId ? { agentProfileId: choice.profileId } : {}),
      agentRevisionId: choice.agentRevisionId,
      providerConnection: choice.providerConnection,
      permissionMode,
      model: choice.model,
      modelSource: choice.modelSource,
      modelVerificationStatus: choice.modelVerificationStatus,
      ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : {}),
      contextFiles,
      branch: workspaceState.active.branch,
      elapsed: "—",
      tokens: "—",
      messages: [{ id: `m-${id}`, role: "user", text: prompt, time: "现在", createdAt }],
      plan: [],
      activity: [],
      runs: [],
    };
    const preflight = runPreflight(task, prompt);
    if (!preflight.ok) {
      setTaskActionError(preflight.error);
      return;
    }
    setTasks((items) => [task, ...items.filter((item) => item.id !== `workspace-${workspaceState.active.id}`)]);
    setSelectedTaskId(id);
    setNewTaskOpen(false);
    setSidebarOpen(false);
    launchRun(id, prompt, task, `m-${id}`, preflight);
  };

  const createTaskWithLatestAgent = () => {
    if (!selectedAgentRevisionUpdate || workspaceState.active.placeholder) return;
    if (["running", "blocked"].includes(selectedTask.status)) {
      setTaskActionError("请先停止当前 Run，再基于新版 Agent 创建新任务。");
      return;
    }
    const choice = agentChoices.find((item) => item.id === selectedAgentRevisionUpdate.profile.id);
    if (!choice?.available) {
      setTaskActionError(choice?.unavailableReason || "最新版 Agent 当前不可用，请先检查 Provider 连接。");
      return;
    }
    const id = `task-${Date.now()}`;
    const createdAt = isoNow();
    const revisionNumber = selectedAgentRevisionUpdate.latestRevisionNumber || choice.agentRevisionId;
    const task = {
      id,
      workspaceId: selectedTask.workspaceId,
      title: `${selectedTask.title.slice(0, 80)} · Revision ${revisionNumber}`,
      preview: `使用 ${choice.name} 最新 Revision 创建的空白任务`,
      status: "waiting",
      updatedAt: "现在",
      updatedAtIso: createdAt,
      createdAt,
      agent: choice.name,
      adapter: choice.adapter,
      agentProfileId: choice.profileId,
      agentRevisionId: choice.agentRevisionId,
      providerConnection: choice.providerConnection,
      permissionMode: choice.permissionMode || "acceptEdits",
      model: choice.model,
      modelSource: choice.modelSource,
      modelVerificationStatus: choice.modelVerificationStatus,
      ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : {}),
      contextFiles: [],
      branch: selectedTask.branch || workspaceState.active.branch,
      elapsed: "—",
      tokens: "—",
      messages: [],
      plan: [],
      activity: [],
      runs: [],
    };
    setTaskActionError("");
    setTasks((items) => [task, ...items.filter((item) => item.id !== `workspace-${selectedTask.workspaceId}`)]);
    setSelectedTaskId(id);
    setInspectorOpen(false);
    setSidebarOpen(false);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  };

  const retryFailedSession = () => {
    const recovery = resumeFailureForTask(selectedTask);
    if (!recovery || ["running", "blocked"].includes(selectedTask.status)) return;
    const sourceMessage = [...(selectedTask.messages || [])].reverse()
      .find((message) => message.role === "user" && message.runId === recovery.run.id);
    if (!sourceMessage?.text) {
      setTaskActionError("找不到这次恢复尝试对应的用户输入；请创建新任务后重新发送。");
      return;
    }
    setTaskActionError("");
    launchRun(selectedTask.id, sourceMessage.text, selectedTask, sourceMessage.id);
  };

  const createFreshTaskAfterSessionFailure = () => {
    const recovery = resumeFailureForTask(selectedTask);
    if (!recovery || workspaceState.active.placeholder) return;
    const sourceMessage = [...(selectedTask.messages || [])].reverse()
      .find((message) => message.role === "user" && message.runId === recovery.run.id);
    const id = `task-${Date.now()}`;
    const createdAt = isoNow();
    const task = {
      id,
      workspaceId: selectedTask.workspaceId,
      title: `${selectedTask.title.slice(0, 72)} · 新会话`,
      preview: "已创建空白任务；不会复用失败的 Native Session",
      status: "waiting",
      updatedAt: "现在",
      updatedAtIso: createdAt,
      createdAt,
      agent: selectedTask.agent,
      adapter: runtimeAdapterForTask(selectedTask),
      ...(selectedTask.agentProfileId ? { agentProfileId: selectedTask.agentProfileId } : {}),
      agentRevisionId: selectedTask.agentRevisionId,
      providerConnection: selectedTask.providerConnection,
      permissionMode: selectedTask.permissionMode || "acceptEdits",
      model: selectedTask.model,
      modelSource: selectedTask.modelSource,
      modelVerificationStatus: selectedTask.modelVerificationStatus,
      ...(selectedTask.reasoningEffort ? { reasoningEffort: selectedTask.reasoningEffort } : {}),
      contextFiles: [],
      branch: selectedTask.branch || workspaceState.active.branch,
      elapsed: "—",
      tokens: "—",
      messages: [],
      plan: [],
      activity: [],
      runs: [],
    };
    setTaskActionError("");
    setTasks((items) => [task, ...items]);
    if (sourceMessage?.text) setDrafts((items) => ({ ...items, [id]: sourceMessage.text }));
    setSelectedTaskId(id);
    setInspectorOpen(false);
    setSidebarOpen(false);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  };

  const selectTask = (id) => {
    setSelectedTaskId(id);
    setTaskActionError("");
    setSidebarOpen(false);
    setInspectorOpen(false);
  };

  const applyWorkspaceState = async (nextState, preferredTaskId) => {
    const previousWorkspaceId = workspaceState.active.id;
    setHydratedWorkspaceId(null);
    for (const run of cancellationsRef.current.values()) run.cancel();
    cancellationsRef.current.clear();
    runTokensRef.current.clear();
    setTerminalOpen(false);
    setInspectorOpen(false);

    const stoppedAt = isoNow();
    const stoppedTasks = tasks.map((task) => {
      if (!["running", "blocked"].includes(task.status)) return task;
      const runs = (task.runs || []).map((run) => {
        if (!["running", "waiting-permission"].includes(run.status)) return run;
        const pendingPermission = run.status === "waiting-permission"
          ? [...(run.permissionRequests || [])].reverse().find((request) => request.status === "pending")
          : null;
        const decision = pendingPermission ? {
          id: `permission-decision-workspace-switch-${run.id}`,
          requestId: pendingPermission.id,
          runId: run.id,
          decision: "cancelled",
          source: "user",
          decidedAt: stoppedAt,
        } : null;
        const permissionEvents = decision ? [{
          id: `${run.id}:${run.events.length + 1}`,
          sequence: run.events.length + 1,
          type: "permission.decided",
          occurredAt: stoppedAt,
          payload: { type: "permission.decided", runId: run.id, decision },
        }] : [];
        const sequence = run.events.length + permissionEvents.length + 1;
        return {
          ...run,
          status: "cancelled",
          updatedAt: stoppedAt,
          finishedAt: stoppedAt,
          permissionRequests: decision
            ? (run.permissionRequests || []).map((request) => request.id === decision.requestId ? { ...request, status: "cancelled" } : request)
            : run.permissionRequests,
          permissionDecisions: decision
            ? [...(run.permissionDecisions || []), decision]
            : run.permissionDecisions,
          events: [...run.events, ...permissionEvents, {
            id: `${run.id}:${sequence}`,
            sequence,
            type: "run.cancelled",
            occurredAt: stoppedAt,
            payload: { type: "run.cancelled", runId: run.id, reason: "workspace-switched" },
          }],
        };
      });
      return {
        ...task,
        status: "stopped",
        preview: "工作区切换后已停止",
        updatedAt: "现在",
        updatedAtIso: stoppedAt,
        runs,
      };
    });
    if (window.rux && hydratedWorkspaceId === previousWorkspaceId) {
      try {
        await window.rux.saveTaskState(workspaceTaskSnapshot(previousWorkspaceId, stoppedTasks));
      } catch (error) {
        console.error("Unable to persist the previous RUX workspace", error);
      }
    }

    let nextWorkspaceTasks = stoppedTasks.filter((task) => task.workspaceId === nextState.active.id);
    if (window.rux) {
      try {
        const stored = await window.rux.loadTaskState(nextState.active.id);
        nextWorkspaceTasks = withoutSupersededWorkspaceStarter(stored.tasks
          .filter((task) => !isLegacyShowcaseTask(task))
          .map((task) => normalizePersistedTask(task, nextState.active.id)), nextState.active.id);
      } catch (error) {
        console.error("Unable to hydrate the selected RUX workspace", error);
      }
    }
    if (!nextWorkspaceTasks.length) {
      nextWorkspaceTasks = [normalizePersistedTask(createWorkspaceStarterTask(nextState.active, codexSettings), nextState.active.id)];
    }
    const nextTasks = [
      ...nextWorkspaceTasks,
      ...stoppedTasks.filter((task) => task.workspaceId !== nextState.active.id),
    ];
    const nextWorkspaceTaskList = nextTasks.filter((task) => task.workspaceId === nextState.active.id);
    const nextSelected = nextWorkspaceTaskList.find((task) => task.id === preferredTaskId)
      ?? nextWorkspaceTaskList[0];
    setWorkspaceState(nextState);
    setExpandedProjectIds((ids) => ids.includes(nextState.active.id) ? ids : [nextState.active.id, ...ids]);
    setTasks(nextTasks);
    setSelectedTaskId(nextSelected.id);
    setHydratedWorkspaceId(nextState.active.id);
    setSidebarOpen(false);
  };

  const chooseWorkspace = async () => {
    if (workspaceBusy) return;
    if (!window.rux) {
      setTaskActionError("Web 预览不会读取本机目录；请在 Rux 桌面应用中打开项目。");
      return;
    }
    setWorkspaceBusy(true);
    try {
      if (terminalOpen) {
        setTerminalOpen(false);
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      const nextState = await window.rux.chooseWorkspace();
      if (nextState) {
        await applyWorkspaceState(nextState);
        setTaskActionError("");
      }
    } catch (error) {
      setTaskActionError(`无法打开项目：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const activateWorkspace = async (path, preferredTaskId) => {
    if (workspaceBusy) return false;
    if (path === workspaceState.active.path) {
      if (preferredTaskId) selectTask(preferredTaskId);
      return true;
    }

    if (!window.rux) {
      const workspace = workspaceState.recent.find((item) => item.path === path);
      if (!workspace) return false;
      await applyWorkspaceState({
        active: workspace,
        recent: [workspace, ...workspaceState.recent.filter((item) => item.id !== workspace.id)],
      }, preferredTaskId);
      return true;
    }

    setWorkspaceBusy(true);
    try {
      if (terminalOpen) {
        setTerminalOpen(false);
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      await applyWorkspaceState(await window.rux.activateWorkspace(path), preferredTaskId);
      setTaskActionError("");
      return true;
    } catch (error) {
      setTaskActionError(`无法切换项目：${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const selectWorkspaceTask = async (taskId, path) => {
    if (!path || path === workspaceState.active.path) {
      selectTask(taskId);
      return;
    }
    await activateWorkspace(path, taskId);
  };

  const createTaskInWorkspace = async (path) => {
    const activated = await activateWorkspace(path);
    if (!activated) return;
    setNewTaskAgentId("");
    setNewTaskOpen(true);
  };

  const toggleProject = (workspaceId) => {
    setExpandedProjectIds((ids) => ids.includes(workspaceId)
      ? ids.filter((id) => id !== workspaceId)
      : [...ids, workspaceId]);
  };

  const persistTaskLifecycle = async (workspaceId, nextTasks) => {
    if (!window.rux) return true;
    try {
      await window.rux.saveTaskState(workspaceTaskSnapshot(workspaceId, nextTasks));
      setTaskActionError("");
      return true;
    } catch (error) {
      setTaskActionError(`任务更新未保存：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const renameTask = (taskId, title) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    const target = tasks.find((task) => task.id === taskId);
    if (!target) return;
    const updatedAtIso = isoNow();
    const update = (task) => task.id === taskId
      ? { ...task, title: normalizedTitle, updatedAt: "现在", updatedAtIso }
      : task;
    setTasks((items) => items.map(update));
    void persistTaskLifecycle(target.workspaceId, tasks.map(update));
  };

  const togglePinTask = (taskId) => {
    const target = tasks.find((task) => task.id === taskId);
    if (!target || target.archived) return;
    const updatedAtIso = isoNow();
    const update = (task) => task.id === taskId && !task.archived
      ? { ...task, pinned: !task.pinned, updatedAt: "现在", updatedAtIso }
      : task;
    setTasks((items) => items.map(update));
    void persistTaskLifecycle(target.workspaceId, tasks.map(update));
  };

  const archiveTask = async (taskId, archived) => {
    const target = tasks.find((task) => task.id === taskId);
    if (!target || (archived && ["running", "blocked"].includes(target.status))) return;
    const activeSiblings = tasks.filter((task) => task.workspaceId === target.workspaceId
      && task.id !== taskId
      && !task.archived);
    if (archived && !activeSiblings.length) return;
    const updatedAtIso = isoNow();
    const update = (task) => task.id === taskId
      ? {
          ...task,
          archived,
          ...(archived ? { pinned: false } : {}),
          updatedAt: "现在",
          updatedAtIso,
        }
      : task;
    const nextTasks = tasks.map(update);
    setTasks((items) => items.map(update));
    const saved = await persistTaskLifecycle(target.workspaceId, nextTasks);
    if (!saved) return;
    if (archived && selectedTaskId === taskId) {
      setSelectedTaskId(activeSiblings[0].id);
    } else if (!archived) {
      if (target.workspaceId === workspaceState.active.id) {
        setSelectedTaskId(taskId);
      } else {
        const workspace = workspaceState.recent.find((item) => item.id === target.workspaceId);
        if (workspace) await activateWorkspace(workspace.path, taskId);
      }
    }
  };

  const changeSelectedAgent = (choiceId) => {
    const choice = agentChoices.find((item) => item.id === choiceId);
    if (!choice || !choice.available) return;
    if ((selectedTask.messages || []).length || (selectedTask.runs || []).length) {
      setTaskActionError("已有内容的任务已固定 Agent Revision；请新建任务以切换 Agent。");
      return;
    }
    setTaskActionError("");
    const updatedAtIso = isoNow();
    setTasks((items) => items.map((task) => task.id === selectedTask.id
      ? {
          ...task,
          agent: choice.name,
          adapter: choice.adapter,
          model: choice.model,
          ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : { reasoningEffort: undefined }),
          permissionMode: choice.permissionMode || task.permissionMode || "acceptEdits",
          ...(choice.profileId ? { agentProfileId: choice.profileId } : { agentProfileId: undefined }),
          agentRevisionId: choice.agentRevisionId,
          agentRevisionSnapshot: undefined,
          providerConnection: choice.providerConnection,
          modelSource: choice.modelSource,
          modelVerificationStatus: choice.modelVerificationStatus,
          updatedAtIso,
        }
      : task));
  };

  const changeSelectedModel = (model) => {
    const updatedAtIso = isoNow();
    setTasks((items) => items.map((task) => {
      if (task.id !== selectedTask.id) return task;
      const supported = codexReasoningOptions(codexCatalog.models, model)
        .some((option) => option.reasoningEffort === task.reasoningEffort);
      const verifiedModels = verifiedModelHistory(items, runtimeAdapterForTask(task), task.providerConnection?.id);
      const modelState = modelSelectionState(runtimeAdapterForTask(task), model, codexCatalog.models, verifiedModels);
      return {
        ...task,
        model,
        ...modelState,
        ...(supported ? {} : { reasoningEffort: undefined }),
        updatedAtIso,
      };
    }));
  };

  const changeSelectedReasoningEffort = (reasoningEffort) => {
    const updatedAtIso = isoNow();
    setTasks((items) => items.map((task) => task.id === selectedTask.id
      ? { ...task, reasoningEffort: reasoningEffort || undefined, updatedAtIso }
      : task));
  };

  const changeSelectedPermission = (permissionMode) => {
    const updatedAtIso = isoNow();
    setTasks((items) => items.map((task) => task.id === selectedTask.id ? { ...task, permissionMode, updatedAtIso } : task));
  };

  const saveCodexSettings = (nextSettings) => {
    const normalized = {
      model: nextSettings.model || "Rux default",
      reasoningEffort: nextSettings.reasoningEffort || "",
      permissionMode: permissionOptions.some((option) => option.id === nextSettings.permissionMode)
        ? nextSettings.permissionMode
        : "acceptEdits",
    };
    setCodexSettings(normalized);
    const updatedAtIso = isoNow();
    setTasks((items) => items.map((task) => {
      if (task.id !== selectedTask.id || runtimeAdapterForTask(task) !== "codex" || ["running", "blocked"].includes(task.status)) return task;
      const verifiedModels = verifiedModelHistory(items, "codex", task.providerConnection?.id);
      return {
        ...task,
        model: normalized.model,
        ...modelSelectionState("codex", normalized.model, codexCatalog.models, verifiedModels),
        permissionMode: normalized.permissionMode,
        reasoningEffort: normalized.reasoningEffort || undefined,
        updatedAtIso,
      };
    }));
    setTaskActionError("");
  };

  const saveAgentProfile = async (id, input) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("Rux Runtime 尚未就绪");
    setAgentProfileBusy(true);
    setAgentProfileError("");
    try {
      const profile = id
        ? await runtime.updateAgentProfile(id, input)
        : await runtime.createAgentProfile(input);
      setAgentProfiles((items) => id
        ? items.map((item) => item.id === id ? profile : item)
        : [...items, profile]);
      return profile;
    } catch (error) {
      setAgentProfileError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setAgentProfileBusy(false);
    }
  };

  const deleteAgentProfile = async (id) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("Rux Runtime 尚未就绪");
    setAgentProfileBusy(true);
    setAgentProfileError("");
    try {
      await runtime.deleteAgentProfile(id);
      setAgentProfiles((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      setAgentProfileError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setAgentProfileBusy(false);
    }
  };

  const retryTaskPersistence = async () => {
    if (!window.rux || hydratedWorkspaceId !== workspaceState.active.id) return;
    try {
      await window.rux.saveTaskState(workspaceTaskSnapshot(workspaceState.active.id, tasks));
      setPersistenceError("");
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : String(error));
    }
  };

  const exportStartupDiagnostics = () => {
    const payload = JSON.stringify({
      capturedAt: isoNow(),
      product: "Rux Desktop",
      startupError,
      workspaceId: workspaceState.active.id,
      workspaceName: workspaceState.active.name,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rux-startup-diagnostics-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const previewRestoreChanges = async (requestedPath) => {
    const runtime = runtimeRef.current;
    const snapshot = changesState.snapshot;
    const path = typeof requestedPath === "string" ? requestedPath : selectedFile;
    if (!runtime || !snapshot || !path) return;
    setSelectedFile(path);
    setRestoreError("");
    try {
      const selection = { scope: "file", path, expectedSnapshotId: snapshot.snapshotId };
      const preview = await runtime.previewRestore(selection);
      setRestorePreview({ ...preview, selection });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChangesState((state) => ({ ...state, error: message }));
      void refreshChanges();
    }
  };

  const confirmRestoreChanges = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || !restorePreview) return;
    setRestoreBusy(true);
    setRestoreError("");
    try {
      const result = await runtime.restoreChanges({ ...restorePreview.selection, confirmed: true });
      setChangesState((state) => ({ ...state, snapshot: result.remaining, diff: null, acceptance: null, error: "" }));
      setSelectedFile(result.remaining.files[0]?.path || "");
      setRestorePreview(null);
      void refreshContext();
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoreBusy(false);
    }
  };

  const previewRunRestore = async (targetRun) => {
    const runtime = runtimeRef.current;
    if (!runtime || !targetRun?.gitBaseline || !targetRun.gitPatch) return;
    setRunRestoreBusy(true);
    setRunRestoreError("");
    try {
      const selection = {
        baseline: targetRun.gitBaseline,
        patch: targetRun.gitPatch,
        expectedSnapshotId: targetRun.gitPatch.snapshotId,
      };
      const preview = await runtime.previewRunRestore(selection);
      setRunRestorePreview({ ...preview, selection, runId: targetRun.id });
    } catch (error) {
      setRunRestoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunRestoreBusy(false);
    }
  };

  const openRunFileDiff = async (targetRun, path) => {
    const runtime = runtimeRef.current;
    if (!runtime || !targetRun?.gitBaseline || !targetRun.gitPatch) return;
    setRunReviewState({ runId: targetRun.id, path, loading: true, accepting: false, diff: null, error: "" });
    try {
      const diff = await runtime.getRunFileDiff({
        baseline: targetRun.gitBaseline,
        patch: targetRun.gitPatch,
        expectedSnapshotId: targetRun.gitPatch.snapshotId,
        path,
      });
      setRunReviewState({ runId: targetRun.id, path, loading: false, accepting: false, diff, error: "" });
    } catch (error) {
      setRunReviewState({ runId: targetRun.id, path, loading: false, accepting: false, diff: null, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const acceptRunReview = async (targetRun) => {
    const runtime = runtimeRef.current;
    if (!runtime || !targetRun?.gitBaseline || !targetRun.gitPatch) return;
    setRunReviewState((state) => ({ ...state, runId: targetRun.id, accepting: true, error: "" }));
    try {
      const acceptance = await runtime.acceptRunChanges({
        baseline: targetRun.gitBaseline,
        patch: targetRun.gitPatch,
        expectedSnapshotId: targetRun.gitPatch.snapshotId,
      });
      setTasks((items) => items.map((task) => task.id !== selectedTask.id ? task : {
        ...task,
        updatedAtIso: isoNow(),
        reviewAcceptances: [...(task.reviewAcceptances || []).filter((item) => item.id !== acceptance.id), acceptance],
      }));
      setRunReviewState((state) => ({ ...state, runId: targetRun.id, accepting: false, error: "" }));
    } catch (error) {
      setRunReviewState((state) => ({ ...state, runId: targetRun.id, accepting: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const confirmRunRestore = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || !runRestorePreview || runRestorePreview.conflicts.length) return;
    setRunRestoreBusy(true);
    setRunRestoreError("");
    try {
      const record = await runtime.restoreRunChanges({ ...runRestorePreview.selection, confirmed: true });
      const updatedAtIso = isoNow();
      setTasks((items) => items.map((task) => task.id !== selectedTask.id ? task : {
        ...task,
        updatedAt: "现在",
        updatedAtIso,
        preview: `已安全恢复 ${record.result.restoredPaths.length + record.result.deletedPaths.length} 个 Run-owned 文件`,
        runs: (task.runs || []).map((run) => {
          if (run.id !== record.runId) return run;
          const sequence = (run.events || []).length + 1;
          return {
            ...run,
            gitRestores: [...(run.gitRestores || []), record],
            updatedAt: updatedAtIso,
            events: [...(run.events || []), {
              id: `${run.id}:${sequence}`,
              sequence,
              type: "run.git-restored",
              occurredAt: updatedAtIso,
              payload: { type: "run.git-restored", runId: run.id, record },
            }],
          };
        }),
      }));
      setRunRestorePreview(null);
      await refreshChanges();
      await refreshContext();
    } catch (error) {
      setRunRestoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunRestoreBusy(false);
    }
  };

  const acceptChanges = async () => {
    const runtime = runtimeRef.current;
    const snapshot = changesState.snapshot;
    if (!runtime || !snapshot || !snapshot.files.length) return;
    setChangesState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const acceptance = await runtime.acceptChanges({ scope: "all", expectedSnapshotId: snapshot.snapshotId });
      setChangesState((state) => ({ ...state, loading: false, acceptance }));
      setTasks((items) => items.map((task) => task.id === selectedTask.id
        ? { ...task, reviewAcceptances: [...(task.reviewAcceptances || []), acceptance], updatedAtIso: isoNow() }
        : task));
    } catch (error) {
      setChangesState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
      void refreshChanges();
    }
  };

  const openAccounts = () => {
    setAccountsOpen(true);
    setSettingsOpen(false);
    setNewTaskOpen(false);
    setAgentsOpen(false);
    setSessionDiscoveryOpen(false);
    setSidebarOpen(false);
    setAuthError("");
  };

  const openSessionDiscovery = () => {
    if (workspaceState.active.placeholder) {
      void chooseWorkspace();
      return;
    }
    setSessionDiscoveryOpen(true);
    setAccountsOpen(false);
    setSettingsOpen(false);
    setNewTaskOpen(false);
    setAgentsOpen(false);
    setSidebarOpen(false);
    setSessionDiscoveryState({ status: "idle", operationId: "", result: null, error: "" });
    setSessionPreviewState({ status: "idle", operationId: "", item: null, preview: null, error: "" });
  };

  const discoverSessions = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || sessionDiscoveryState.status === "loading") return;
    const operationId = globalThis.crypto?.randomUUID?.() ?? `session-discovery-${Date.now()}`;
    setSessionPreviewState({ status: "idle", operationId: "", item: null, preview: null, error: "" });
    setSessionDiscoveryState({ status: "loading", operationId, result: null, error: "" });
    try {
      const result = await runtime.discoverSessions({
        operationId,
        engine: sessionDiscoveryEngine,
        providerConnection: defaultProviderConnectionForAdapter(sessionDiscoveryEngine),
        activeWorkspaceId: workspaceState.active.id,
        limit: 100,
      });
      setSessionDiscoveryState((state) => state.operationId === operationId
        ? { status: "done", operationId: "", result, error: "" }
        : state);
    } catch (error) {
      setSessionDiscoveryState((state) => state.operationId === operationId
        ? { status: "error", operationId: "", result: null, error: sessionDiscoveryErrorMessage(error, sessionDiscoveryEngine) }
        : state);
    }
  };

  const cancelSessionDiscovery = () => {
    const operationId = sessionDiscoveryState.operationId;
    if (operationId) void runtimeRef.current?.cancelSessionDiscovery(operationId).catch(() => undefined);
    const previewOperationId = sessionPreviewState.operationId;
    if (previewOperationId) void runtimeRef.current?.cancelSessionDiscovery(previewOperationId).catch(() => undefined);
    setSessionDiscoveryState({ status: "idle", operationId: "", result: null, error: "" });
    setSessionPreviewState({ status: "idle", operationId: "", item: null, preview: null, error: "" });
  };

  const previewDiscoveredSession = async (item) => {
    const runtime = runtimeRef.current;
    if (!runtime || ["loading", "importing"].includes(sessionPreviewState.status)) return;
    const operationId = globalThis.crypto?.randomUUID?.() ?? `session-preview-${Date.now()}`;
    setSessionPreviewState({ status: "loading", operationId, item, preview: null, error: "" });
    try {
      const preview = await runtime.previewSession({
        operationId,
        engine: sessionDiscoveryEngine,
        providerConnection: defaultProviderConnectionForAdapter(sessionDiscoveryEngine),
        activeWorkspaceId: workspaceState.active.id,
        nativeSessionId: item.metadata.nativeSessionId,
        limit: 100,
      });
      setSessionPreviewState((state) => state.operationId === operationId
        ? { status: "done", operationId: "", item, preview, error: "" }
        : state);
    } catch (error) {
      setSessionPreviewState((state) => state.operationId === operationId
        ? { status: "error", operationId: "", item, preview: null, error: sessionDiscoveryErrorMessage(error, sessionDiscoveryEngine) }
        : state);
    }
  };

  const importDiscoveredSession = async (mode) => {
    const runtime = runtimeRef.current;
    const item = sessionPreviewState.item;
    if (!runtime || !item || !sessionPreviewState.preview || sessionPreviewState.status === "importing") return;
    const operationId = globalThis.crypto?.randomUUID?.() ?? `session-import-${Date.now()}`;
    setSessionPreviewState((state) => ({ ...state, status: "importing", operationId, error: "" }));
    try {
      const result = await runtime.importSession({
        operationId,
        engine: sessionDiscoveryEngine,
        providerConnection: defaultProviderConnectionForAdapter(sessionDiscoveryEngine),
        activeWorkspaceId: workspaceState.active.id,
        nativeSessionId: item.metadata.nativeSessionId,
        limit: 100,
        mode,
      });
      setTasks((items) => [result.task, ...items.filter((task) => task.id !== result.task.id && task.id !== `workspace-${workspaceState.active.id}`)]);
      setSelectedTaskId(result.task.id);
      setSessionDiscoveryOpen(false);
      setSessionDiscoveryState({ status: "idle", operationId: "", result: null, error: "" });
      setSessionPreviewState({ status: "idle", operationId: "", item: null, preview: null, error: "" });
    } catch (error) {
      setSessionPreviewState((state) => ({ ...state, status: "error", operationId: "", error: sessionDiscoveryErrorMessage(error, sessionDiscoveryEngine) }));
    }
  };

  const loadSessionRevisions = async (task = selectedTask) => {
    if (!task?.importedSession) return;
    setSessionSyncState((state) => ({ ...state, open: true, loading: true, error: "" }));
    try {
      const revisions = await runtimeRef.current.listSessionRevisions({ taskId: task.id });
      setSessionSyncState((state) => ({ ...state, open: true, loading: false, revisions, error: "" }));
    } catch (error) {
      setSessionSyncState((state) => ({ ...state, open: true, loading: false, error: sessionDiscoveryErrorMessage(error, task.adapter) }));
    }
  };

  const refreshImportedSession = async () => {
    if (!selectedTask?.importedSession || sessionSyncState.loading) return;
    const operationId = globalThis.crypto?.randomUUID?.() ?? `session-refresh-${Date.now()}`;
    setSessionSyncState((state) => ({ ...state, open: true, loading: true, error: "", result: null }));
    try {
      const result = await runtimeRef.current.refreshSession({ taskId: selectedTask.id, operationId });
      setTasks((items) => items.map((task) => task.id === result.task.id ? result.task : task));
      const revisions = await runtimeRef.current.listSessionRevisions({ taskId: selectedTask.id });
      setSessionSyncState({ open: true, loading: false, error: "", result, revisions });
    } catch (error) {
      setSessionSyncState((state) => ({ ...state, open: true, loading: false, error: sessionDiscoveryErrorMessage(error, selectedTask.adapter) }));
    }
  };

  const rebuildImportedSession = async (candidateRevisionId) => {
    if (!selectedTask?.importedSession || !window.confirm("按原生会话重建当前本地 Projection？旧 Revision、Rux Run、审批和 Task 元数据会保留，Provider 原会话不会被修改。")) return;
    setSessionSyncState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const result = await runtimeRef.current.rebuildSession({ taskId: selectedTask.id, candidateRevisionId, confirmed: true });
      setTasks((items) => items.map((task) => task.id === result.task.id ? result.task : task));
      const revisions = await runtimeRef.current.listSessionRevisions({ taskId: selectedTask.id });
      setSessionSyncState({ open: true, loading: false, error: "", result, revisions });
    } catch (error) {
      setSessionSyncState((state) => ({ ...state, loading: false, error: sessionDiscoveryErrorMessage(error, selectedTask.adapter) }));
    }
  };

  const restoreImportedRevision = async (revisionId) => {
    if (!selectedTask?.importedSession || !window.confirm("恢复这个本地 Projection Revision？这不会修改原生会话，当前版本也会继续保留。")) return;
    setSessionSyncState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const result = await runtimeRef.current.restoreSessionRevision({ taskId: selectedTask.id, revisionId, confirmed: true });
      setTasks((items) => items.map((task) => task.id === result.task.id ? result.task : task));
      const revisions = await runtimeRef.current.listSessionRevisions({ taskId: selectedTask.id });
      setSessionSyncState({ open: true, loading: false, error: "", result, revisions });
    } catch (error) {
      setSessionSyncState((state) => ({ ...state, loading: false, error: sessionDiscoveryErrorMessage(error, selectedTask.adapter) }));
    }
  };

  const openLocalData = async (scope = "task") => {
    setSettingsOpen(false);
    setLocalDataState((state) => ({ ...state, open: true, loading: true, error: "", notice: "", preview: null, scope }));
    try {
      const summary = await runtimeRef.current.getLocalDataSummary();
      setLocalDataState((state) => ({ ...state, loading: false, summary }));
    } catch (error) {
      setLocalDataState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const previewLocalData = async () => {
    const current = localDataState;
    setLocalDataState((state) => ({ ...state, loading: true, error: "", notice: "" }));
    try {
      const preview = await runtimeRef.current.previewLocalData({ scope: current.scope, ...(current.scope === "task" ? { taskId: selectedTask.id } : {}), action: current.action });
      setLocalDataState((state) => ({ ...state, loading: false, preview }));
    } catch (error) {
      setLocalDataState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const executeLocalData = async () => {
    const current = localDataState;
    if (!current.preview) return;
    const confirmation = current.action === "unlink"
      ? "确认解除关联？本地内容会保留，但必须重新导入后才能刷新或继续原生会话。"
      : "确认执行本地删除？Provider 原生会话不受影响，但 Rux 不承诺恢复被删除的本地数据。";
    if (!window.confirm(confirmation)) return;
    setLocalDataState((state) => ({ ...state, loading: true, error: "", notice: "" }));
    try {
      await runtimeRef.current.executeLocalData({ scope: current.scope, ...(current.scope === "task" ? { taskId: selectedTask.id } : {}), action: current.action, fingerprint: current.preview.fingerprint, confirmed: true });
      const stored = await window.rux.loadTaskState(workspaceState.active.id);
      const nextActiveTasks = stored.tasks.length
        ? stored.tasks.map((task) => normalizePersistedTask(task, workspaceState.active.id))
        : [normalizePersistedTask(createWorkspaceStarterTask(workspaceState.active, codexSettings), workspaceState.active.id)];
      setTasks((items) => [...nextActiveTasks, ...items.filter((task) => task.workspaceId !== workspaceState.active.id)]);
      setSelectedTaskId((currentId) => nextActiveTasks.some((task) => task.id === currentId) ? currentId : nextActiveTasks[0].id);
      const summary = await runtimeRef.current.getLocalDataSummary();
      setSessionSyncState({ open: false, loading: false, error: "", result: null, revisions: null });
      setLocalDataState((state) => ({ ...state, loading: false, summary, preview: null, notice: current.action === "unlink" ? "已解除关联，本地内容与版本仍保留。" : "本地清理已完成；Provider 原生会话未被修改。" }));
    } catch (error) {
      setLocalDataState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const exportLocalData = async () => {
    const current = localDataState;
    setLocalDataState((state) => ({ ...state, loading: true, error: "", notice: "" }));
    try {
      const result = await runtimeRef.current.exportLocalData({ scope: current.scope, ...(current.scope === "task" ? { taskId: selectedTask.id } : {}), format: current.format, revisions: current.revisions, confirmedSensitiveContent: true });
      setLocalDataState((state) => ({ ...state, loading: false, notice: result.saved ? `已导出 ${localDataSize(result.bytes || 0)} 本地数据。` : "已取消导出。" }));
    } catch (error) {
      setLocalDataState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const openContextHandoff = () => {
    const latestRun = selectedTask.runs?.at(-1);
    const messages = selectedTask.messages.slice(-20);
    const files = latestRun?.gitPatch?.files || [];
    const fallbackTarget = agentChoices.find((choice) => choice.id !== (selectedTask.agentProfileId || runtimeAdapterForTask(selectedTask))) || agentChoices[0];
    setHandoffState({ open: true, loading: false, error: "", targetAgentId: fallbackTarget?.id || "", messageIds: messages.map((message) => message.id), filePaths: files.map((file) => file.path), agentSummary: "", agentSummaryGenerationId: "", summaryProvenance: null, constraints: "", preview: null, source: { messages, files } });
  };

  const previewContextHandoff = async () => {
    setHandoffState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const current = handoffState;
      const preview = await runtimeRef.current.previewHandoff({ sourceTaskId: selectedTask.id, targetAgentId: current.targetAgentId, messageIds: current.messageIds, filePaths: current.filePaths });
      setHandoffState((state) => ({ ...state, loading: false, preview }));
    } catch (error) {
      setHandoffState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const generateContextHandoffSummary = async () => {
    const current = handoffState;
    if (!current.preview) return;
    setHandoffState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const generated = await runtimeRef.current.generateHandoffSummary({ sourceTaskId: selectedTask.id, targetAgentId: current.targetAgentId, messageIds: current.messageIds, filePaths: current.filePaths, fingerprint: current.preview.fingerprint });
      setHandoffState((state) => ({ ...state, loading: false, agentSummary: generated.summary, agentSummaryGenerationId: generated.generationId, summaryProvenance: generated.provenance }));
    } catch (error) {
      setHandoffState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const commitContextHandoff = async () => {
    const current = handoffState;
    if (!current.preview || !window.confirm("确认创建新的 Task 并固定目标 Agent Revision？此操作不会修改来源 Task，也不会立即调用目标 Agent 或创建 Native Session。")) return;
    setHandoffState((state) => ({ ...state, loading: true, error: "" }));
    try {
      const result = await runtimeRef.current.commitHandoff({ sourceTaskId: selectedTask.id, targetAgentId: current.targetAgentId, messageIds: current.messageIds, filePaths: current.filePaths, fingerprint: current.preview.fingerprint, agentSummary: current.agentSummary || undefined, agentSummaryGenerationId: current.agentSummary && current.agentSummaryGenerationId ? current.agentSummaryGenerationId : undefined, constraints: current.constraints || undefined, confirmed: true });
      setTasks((items) => [result.targetTask, ...items.map((task) => task.id === result.sourceTask.id ? result.sourceTask : task).filter((task) => task.id !== result.targetTask.id)]);
      setSelectedTaskId(result.targetTask.id);
      setHandoffState((state) => ({ ...state, open: false, loading: false }));
    } catch (error) {
      setHandoffState((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const detectProviders = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || authChecking || authLoginProvider) return;
    setAuthChecking(true);
    setAuthError("");
    setAuthNotice("");
    try {
      const nextAuthState = await runtime.authStatus();
      setAuthState(nextAuthState);
      const agentResult = await runtime.listAgents({ refresh: true });
      setAdapters(agentResult.adapters);
      const connected = nextAuthState.providers.filter((provider) => provider.status === "connected").length;
      const installed = nextAuthState.providers.filter((provider) => provider.installed).length;
      setAuthNotice(connected
        ? `检测完成：${connected} 个 Agent 已连接。`
        : installed
          ? `检测完成：找到 ${installed} 个 Agent，尚未连接。`
          : "检测完成：未找到受支持的本机 Agent。可查看官方安装说明后重新检测。");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setAuthChecking(false);
    }
  };

  const saveNativeProvider = async (input) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("Rux Runtime 尚未就绪");
    setNativeProviderBusy(true);
    setAuthError("");
    try {
      const saved = await runtime.saveProviderConnection(input);
      setNativeConnections((items) => [...items.filter((item) => item.id !== saved.id), saved]);
      setAdapters((items) => items.map((adapter) => adapter.id === "rux-native" ? { ...adapter, available: true, detail: "原生 Provider 已配置，无需 Agent CLI" } : adapter));
      if (!agentProfiles.some((profile) => profile.providerConnection?.id === saved.id)) {
        const profile = await runtime.createAgentProfile({
          name: `Rux Native · ${saved.label}`,
          description: "Rux 内置 Responses API coding agent，无需安装外部 Agent CLI",
          backend: "rux-native",
          providerConnection: { id: saved.id, kind: "rux-native", engine: "rux-native", label: saved.label },
          model: saved.defaultModel,
          modelSource: "manual",
          modelVerificationStatus: "unverified",
          instructions: "You are a coding agent working inside the active Rux workspace. Inspect relevant files before editing, keep changes scoped, explain important decisions, and use only the tools exposed by Rux.",
          permissionMode: "acceptEdits",
          skillIds: [],
          toolIds: ["read_file", "list_files", "write_file"],
          enabled: true,
        });
        setAgentProfiles((items) => [...items, profile]);
      }
      setAuthNotice(`已安全保存 ${saved.label}，并创建可直接使用的 Rux Native Agent。`);
      return saved;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setNativeProviderBusy(false);
    }
  };

  const testNativeProvider = async (id) => {
    const runtime = runtimeRef.current;
    if (!runtime || nativeProviderBusy) return;
    setNativeProviderBusy(true);
    setAuthError("");
    try {
      const result = await runtime.testProviderConnection(id);
      const refreshed = await runtime.listProviderConnections();
      setNativeConnections(refreshed);
      if (!result.ok) throw new Error(result.detail);
      setAuthNotice(result.detail);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setNativeProviderBusy(false);
    }
  };

  const deleteNativeProvider = async (id) => {
    const runtime = runtimeRef.current;
    const connection = nativeConnections.find((item) => item.id === id);
    if (!runtime || nativeProviderBusy || !connection || !window.confirm(`删除原生 Connection「${connection.label}」及其本地加密凭据？此操作不会撤销 Provider 侧 API Key。`)) return;
    setNativeProviderBusy(true);
    setAuthError("");
    try {
      await runtime.deleteProviderConnection(id);
      const next = nativeConnections.filter((item) => item.id !== id);
      setNativeConnections(next);
      if (!next.length) setAdapters((items) => items.map((adapter) => adapter.id === "rux-native" ? { ...adapter, available: false, detail: "添加原生 Provider 后即可使用，无需安装 Agent CLI" } : adapter));
      setAuthNotice(`已删除 ${connection.label} 的本地 Connection 和加密凭据；Provider 侧 Key 未被撤销。`);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setNativeProviderBusy(false);
    }
  };

  const loginWithProvider = async (provider = "chatgpt") => {
    const runtime = runtimeRef.current;
    if (!runtime || authLoginProvider || authChecking) return;
    const providerName = provider === "claude-code" ? "Claude Code" : "Rux";
    setAuthLoginProvider(provider);
    setAuthError("");
    setAuthNotice(`${providerName} 的官方浏览器授权进行中；完成后请返回 Rux。`);
    try {
      const result = await runtime.login(provider);
      setAuthState((current) => mergeAuthState(current, result));
      setAuthNotice(`${providerName} 已连接，可以创建或继续任务。`);
      if (provider === "chatgpt") setCodexCatalog({ loading: false, models: [], error: "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("已取消")) {
        setAuthNotice(`${providerName} 登录已取消。你可以随时重新开始。`);
        setAuthError("");
      } else {
        setAuthNotice("");
        setAuthError(message);
      }
    } finally {
      setAuthLoginProvider(null);
    }
  };

  const cancelLoginWithProvider = async (provider = authLoginProvider) => {
    const runtime = runtimeRef.current;
    if (!runtime || !provider) return;
    const providerName = provider === "claude-code" ? "Claude Code" : "Rux";
    setAuthNotice(`正在取消 ${providerName} 登录…`);
    try {
      await runtime.cancelLogin(provider);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  const closeAccounts = () => {
    if (authLoginProvider) void cancelLoginWithProvider(authLoginProvider);
    setAccountsOpen(false);
  };

  const useAgentForNewTask = (agentId) => {
    const choice = agentChoices.find((item) => item.id === agentId && item.available);
    if (!choice) return;
    if (workspaceState.active.placeholder) {
      setTaskActionError("请先打开项目，再使用 Agent 创建任务。");
      closeAccounts();
      void chooseWorkspace();
      return;
    }
    setNewTaskAgentId(choice.id);
    setAccountsOpen(false);
    setNewTaskOpen(true);
  };

  const openSettings = () => {
    setSettingsOpen(true);
    setAccountsOpen(false);
    setNewTaskOpen(false);
    setAgentsOpen(false);
    setSidebarOpen(false);
    if (codexConnected) window.setTimeout(() => void loadCodexModels(), 0);
  };

  const updateWorkspaceBranch = (branch) => {
    if (!branch || workspaceState.active.placeholder) return;
    const activeWorkspaceId = workspaceState.active.id;
    setWorkspaceState((state) => ({
      ...state,
      active: state.active.id === activeWorkspaceId ? { ...state.active, branch } : state.active,
      recent: state.recent.map((workspace) => workspace.id === activeWorkspaceId ? { ...workspace, branch } : workspace),
    }));
    setTasks((items) => items.map((task) => task.workspaceId === activeWorkspaceId
      ? { ...task, branch, updatedAtIso: isoNow() }
      : task));
  };

  const openEnvironment = () => {
    if (workspaceState.active.placeholder) {
      setTaskActionError("请先打开项目，再查看环境信息。");
      return;
    }
    setInspectorTab("environment");
    setInspectorOpen(true);
  };

  const openChanges = (path) => {
    if (workspaceState.active.placeholder) {
      setTaskActionError("请先打开项目，再查看代码变更。");
      return;
    }
    if (typeof path === "string") setSelectedFile(path);
    setInspectorTab("changes");
    setInspectorOpen(true);
    void refreshChanges();
  };

  const toggleEnvironment = () => {
    if (inspectorOpen && inspectorTab === "environment") {
      setInspectorOpen(false);
      return;
    }
    openEnvironment();
  };

  const openWorkspaceLocation = async (target = "vscode") => {
    if (!window.rux) {
      setTaskActionError("请使用 Rux 桌面应用在 VS Code 或 Finder 中打开当前项目。");
      return;
    }
    try {
      setTaskActionError("");
      const result = await window.rux.openWorkspaceLocation(target);
      setTaskActionError(result.detail || (result.opened ? "" : "无法打开当前项目位置"));
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const accountLabel = "账户与登录";

  return (
    <div className={`app-shell codex-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      {window.rux && (startupLoading || startupError) ? (
        <div className="startup-gate" role={startupError ? "alertdialog" : "status"} aria-modal={startupError ? "true" : undefined} aria-live="polite">
          <section>
            <span className={`startup-gate-icon ${startupError ? "is-error" : ""}`}>{startupError ? <CircleAlert size={22} /> : <LoaderCircle size={22} className="status-running" />}</span>
            <h1>{startupError ? "Rux 无法安全启动" : "正在恢复工作区"}</h1>
            <p>{startupError ? "任务历史或 Runtime 未能完成初始化。为避免在未保存状态下运行 Agent，编辑器已暂停。" : "正在初始化工作台与任务历史；不会自动导入项目或启动登录。"}</p>
            {startupError ? <pre>{startupError}</pre> : null}
            {startupError ? (
              <div className="startup-gate-actions">
                <button type="button" className="secondary-button" onClick={exportStartupDiagnostics}>导出诊断</button>
                <button type="button" className="secondary-button" onClick={() => window.close()}>退出</button>
                <button type="button" className="primary-button" onClick={() => setStartupAttempt((value) => value + 1)}><RefreshCw size={14} /> 重试</button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
      <Sidebar
        tasks={tasks}
        selectedTaskId={selectedTask.id}
        onSelectTask={selectWorkspaceTask}
        onNewTask={() => {
          if (workspaceState.active.placeholder) void chooseWorkspace();
          else {
            setNewTaskAgentId("");
            setNewTaskOpen(true);
          }
        }}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceState={workspaceState}
        workspaceBusy={workspaceBusy}
        onChooseWorkspace={chooseWorkspace}
        expandedProjectIds={expandedProjectIds}
        onToggleProject={toggleProject}
        onCreateTaskInWorkspace={createTaskInWorkspace}
        onCollapse={() => setSidebarCollapsed(true)}
        onOpenAccounts={openAccounts}
        onOpenSettings={openSettings}
        onOpenAgents={() => { setAgentsOpen(true); setSidebarOpen(false); setAgentProfileError(""); if (codexConnected) void loadCodexModels(); }}
        onOpenSessionDiscovery={openSessionDiscovery}
        onOpenEnvironment={openEnvironment}
        onOpenChanges={() => openChanges()}
        onRenameTask={renameTask}
        onTogglePinTask={togglePinTask}
        onArchiveTask={(taskId, archived) => void archiveTask(taskId, archived)}
        taskActionError={taskActionError}
        onDismissTaskActionError={() => setTaskActionError("")}
        accountLabel={accountLabel}
        accountConnected={connectedProviderCount > 0}
        collapsed={sidebarCollapsed}
      />

      {sidebarOpen ? <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" /> : null}

      {persistenceError && !startupError ? (
        <div className="persistence-alert" role="alert">
          <CircleAlert size={15} />
          <span><strong>任务状态未保存</strong><small>{persistenceError}</small></span>
          <button type="button" onClick={() => void retryTaskPersistence()}><RefreshCw size={13} /> 重试</button>
        </div>
      ) : null}

      <main className={`main-surface ${terminalOpen ? "terminal-is-open" : ""} ${inspectorOpen ? "inspector-is-open" : ""}`}>
        <section className="task-workspace">
          <TaskHeader
            task={selectedTask}
            workspace={workspaceState.active}
            onMenu={() => setSidebarOpen(true)}
            onExpandSidebar={() => setSidebarCollapsed(false)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleTerminal={() => {
              if (workspaceState.active.placeholder) void chooseWorkspace();
              else setTerminalOpen((value) => !value);
            }}
            terminalOpen={terminalOpen}
            onToggleRun={toggleRun}
            onToggleInspector={() => {
              toggleEnvironment();
            }}
            onOpenWorkspace={(target) => workspaceState.active.placeholder ? void chooseWorkspace() : void openWorkspaceLocation(target)}
            onRenameTask={(title) => renameTask(selectedTask.id, title)}
            onTogglePinTask={() => togglePinTask(selectedTask.id)}
            onArchiveTask={(archived) => void archiveTask(selectedTask.id, archived)}
            inspectorOpen={inspectorOpen}
            changesCount={changesState.snapshot?.totals.files || 0}
            canRun={appReady && (["running", "blocked"].includes(selectedTask.status) || selectedAgentReady)}
            canArchive={tasks.filter((task) => task.workspaceId === selectedTask.workspaceId && !task.archived).length > 1}
          />
          <TaskTimeline
            task={selectedTask}
            streamingMessages={streamingMessagesByTask[selectedTask.id] || []}
            changes={changesState}
            onOpenChanges={openChanges}
            onRestoreChanges={(path) => void previewRestoreChanges(path)}
            onOpenRun={() => {
              setInspectorTab("run");
              setInspectorOpen(true);
            }}
            onWaitingAction={workspaceState.active.placeholder ? chooseWorkspace : () => {
              setTaskActionError("");
              composerInputRef.current?.focus();
            }}
            onPermissionDecision={decidePermission}
            permissionBusy={permissionBusy}
            permissionError={permissionError}
            taskActionError={taskActionError}
            onDismissTaskActionError={() => setTaskActionError("")}
            agentRevisionUpdate={selectedAgentRevisionUpdate}
            onCreateTaskWithLatestAgent={createTaskWithLatestAgent}
            onRetrySession={retryFailedSession}
            onCreateFreshTask={createFreshTaskAfterSessionFailure}
            onRefreshSession={() => void refreshImportedSession()}
            onOpenSessionVersions={() => void loadSessionRevisions()}
            onOpenHandoff={openContextHandoff}
            onOpenLocalData={() => void openLocalData("task")}
            sessionSyncBusy={sessionSyncState.loading}
            workspacePlaceholder={workspaceState.active.placeholder}
          />
          <Composer
            task={selectedTask}
            draft={draft}
            onDraft={setDraft}
            onSend={sendMessage}
            onAgentChange={changeSelectedAgent}
            onModelChange={changeSelectedModel}
            onReasoningEffortChange={changeSelectedReasoningEffort}
            onPermissionChange={changeSelectedPermission}
            onOpenAccounts={openAccounts}
            focusRef={composerInputRef}
            agentChoices={taskAgentChoices}
            codexModels={codexCatalog.models}
            codexCatalog={codexCatalog}
            canRun={appReady && selectedTask.importedSession?.mode !== "view" && selectedTask.importedSession?.status !== "unlinked"}
          />
        </section>

        <Inspector
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          tab={inspectorTab}
          onTab={setInspectorTab}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          workspace={workspaceState.active}
          task={selectedTask}
          onToggleRun={toggleRun}
          changesState={changesState}
          contextState={contextState}
          gitClient={runtimeRef.current}
          onBranchChanged={updateWorkspaceBranch}
          onRefreshChanges={refreshChanges}
          onRefreshContext={refreshContext}
          onToggleContextFile={toggleContextFile}
          onAddContextSource={addContextSource}
          onRestoreChanges={previewRestoreChanges}
          onAcceptChanges={acceptChanges}
          runReviewState={runReviewState}
          onOpenRunDiff={openRunFileDiff}
          onAcceptRunReview={acceptRunReview}
          runRestorePreview={runRestorePreview}
          runRestoreBusy={runRestoreBusy}
          runRestoreError={runRestoreError}
          onPreviewRunRestore={previewRunRestore}
          onConfirmRunRestore={confirmRunRestore}
          onCancelRunRestore={() => setRunRestorePreview(null)}
        />

        <TerminalPanel open={terminalOpen} onClose={() => setTerminalOpen(false)} />
      </main>

      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreate={createTask}
        onOpenAccounts={openAccounts}
        agentChoices={agentChoices}
        initialAgentId={newTaskAgentId}
        codexSettings={codexSettings}
        codexModels={codexCatalog.models}
        workspace={workspaceState.active}
        contextCandidates={changesState.snapshot?.files || []}
        onValidateContext={(paths) => runtimeRef.current?.contextSnapshot(paths) ?? Promise.reject(new Error("Rux Runtime 尚未就绪"))}
      />
      <AccountsDialog
        open={accountsOpen}
        state={authState}
        adapters={adapters}
        agentChoices={agentChoices}
        selectedAgentId={selectedTask.agentProfileId || runtimeAdapterForTask(selectedTask)}
        canCreateTask={!workspaceState.active.placeholder}
        nativeConnections={nativeConnections}
        nativeBusy={nativeProviderBusy}
        checking={authChecking}
        loginProvider={authLoginProvider}
        error={authError}
        notice={authNotice}
        onClose={closeAccounts}
        onDetect={() => void detectProviders()}
        onLogin={loginWithProvider}
        onCancelLogin={cancelLoginWithProvider}
        onSaveNative={saveNativeProvider}
        onTestNative={(id) => void testNativeProvider(id)}
        onDeleteNative={(id) => void deleteNativeProvider(id)}
        onUseAgent={useAgentForNewTask}
        onOpenSettings={openSettings}
      />
      <SessionDiscoveryDialog
        open={sessionDiscoveryOpen}
        workspace={workspaceState.active}
        engine={sessionDiscoveryEngine}
        state={sessionDiscoveryState}
        previewState={sessionPreviewState}
        importedTasks={workspaceTasks}
        onEngine={(engine) => {
          setSessionDiscoveryEngine(engine);
          setSessionDiscoveryState({ status: "idle", operationId: "", result: null, error: "" });
          setSessionPreviewState({ status: "idle", operationId: "", item: null, preview: null, error: "" });
        }}
        onDiscover={() => void discoverSessions()}
        onCancel={cancelSessionDiscovery}
        onPreview={(item) => void previewDiscoveredSession(item)}
        onImport={(mode) => void importDiscoveredSession(mode)}
        onClose={() => {
          if (sessionDiscoveryState.status === "loading") cancelSessionDiscovery();
          setSessionDiscoveryOpen(false);
        }}
        onOpenWorkspace={() => {
          setSessionDiscoveryOpen(false);
          void chooseWorkspace();
        }}
      />
      <SessionSyncDialog
        state={sessionSyncState}
        onClose={() => setSessionSyncState((state) => ({ ...state, open: false }))}
        onRebuild={(revisionId) => void rebuildImportedSession(revisionId)}
        onRestore={(revisionId) => void restoreImportedRevision(revisionId)}
      />
      <ContextHandoffDialog
        state={handoffState}
        agents={agentChoices.filter((agent) => agent.id !== "mock")}
        onChange={(patch) => setHandoffState((state) => ({ ...state, ...patch }))}
        onPreview={() => void previewContextHandoff()}
        onGenerateSummary={() => void generateContextHandoffSummary()}
        onCommit={() => void commitContextHandoff()}
        onClose={() => setHandoffState((state) => ({ ...state, open: false }))}
      />
      <LocalDataDialog
        state={localDataState}
        task={selectedTask}
        workspace={workspaceState.active}
        onChange={(patch) => setLocalDataState((state) => ({ ...state, ...patch }))}
        onPreview={() => void previewLocalData()}
        onExecute={() => void executeLocalData()}
        onExport={() => void exportLocalData()}
        onClose={() => setLocalDataState((state) => ({ ...state, open: false }))}
      />
      <CodexSettingsDialog
        open={settingsOpen}
        connected={codexConnected}
        catalog={codexCatalog}
        settings={codexSettings}
        onClose={() => setSettingsOpen(false)}
        onReload={() => void loadCodexModels()}
        onSave={saveCodexSettings}
        onOpenAccounts={openAccounts}
        onOpenLocalData={() => void openLocalData("workspace")}
      />
      <AgentsDialog
        open={agentsOpen}
        profiles={agentProfiles}
        adapters={adapters}
        nativeConnections={nativeConnections}
        codexModels={codexCatalog.models}
        tasks={tasks}
        busy={agentProfileBusy}
        error={agentProfileError}
        onClose={() => setAgentsOpen(false)}
        onSave={saveAgentProfile}
        onDelete={deleteAgentProfile}
      />
      <RestoreDialog
        preview={restorePreview}
        busy={restoreBusy}
        error={restoreError}
        onClose={() => { setRestorePreview(null); setRestoreError(""); }}
        onConfirm={confirmRestoreChanges}
      />
    </div>
  );
}
