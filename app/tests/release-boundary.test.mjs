import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import plist from "plist";
import afterPack, {
  hardenMacInfoPlist,
  UNUSED_PRIVACY_USAGE_KEYS,
} from "../build/after-pack.mjs";
import {
  DEVELOPMENT_CONTENT_SECURITY_POLICY,
  developmentContentSecurityPolicyPlugin,
  PRODUCTION_CONTENT_SECURITY_POLICY,
} from "../build/content-security-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parsePolicy(policy) {
  return Object.fromEntries(
    policy.split(";").map((entry) => {
      const [directive, ...sources] = entry.trim().split(/\s+/);
      return [directive, sources];
    }),
  );
}

test("production renderer CSP is restrictive and contains no arbitrary network source", async () => {
  const html = await readFile(path.join(root, "index.html"), "utf8");
  assert.equal(html.includes(`content="${PRODUCTION_CONTENT_SECURITY_POLICY}"`), true);
  assert.match(html, /<title>Rux — Coding Agent Workbench<\/title>/);

  const policy = parsePolicy(PRODUCTION_CONTENT_SECURITY_POLICY);
  assert.deepEqual(policy["default-src"], ["'self'"]);
  assert.deepEqual(policy["base-uri"], ["'none'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["frame-src"], ["'none'"]);
  assert.deepEqual(policy["connect-src"], ["'self'"]);
  assert.equal(policy["connect-src"].some((source) => /^(?:https?|wss?):|\*/.test(source)), false);
});

test("development CSP adds only explicit local HMR websocket origins", () => {
  const plugin = developmentContentSecurityPolicyPlugin();
  const transformed = plugin.transformIndexHtml(
    `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CONTENT_SECURITY_POLICY}">`,
  );

  assert.equal(plugin.apply({}, { command: "serve" }), true);
  assert.equal(plugin.apply({}, { command: "build" }), false);
  assert.equal(transformed.includes(DEVELOPMENT_CONTENT_SECURITY_POLICY), true);
  assert.deepEqual(parsePolicy(DEVELOPMENT_CONTENT_SECURITY_POLICY)["connect-src"], [
    "'self'",
    "ws://localhost:*",
    "ws://127.0.0.1:*",
    "ws://terminal.local:*",
  ]);
});

test("mac Info.plist hardening removes ATS exceptions and unused privacy prompts", () => {
  const info = {
    CFBundleName: "RUX",
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
    },
    ...Object.fromEntries(UNUSED_PRIVACY_USAGE_KEYS.map((key) => [key, "unused"])),
  };

  assert.deepEqual(hardenMacInfoPlist(info), { CFBundleName: "RUX" });
});

test("afterPack rewrites the packaged macOS Info.plist before signing", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "rux-after-pack-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const contents = path.join(temporaryRoot, "RUX.app", "Contents");
  const infoPath = path.join(contents, "Info.plist");
  await mkdir(contents, { recursive: true });
  await writeFile(
    infoPath,
    plist.build({
      CFBundleName: "RUX",
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSCameraUsageDescription: "unused",
    }),
  );

  await afterPack({
    electronPlatformName: "darwin",
    appOutDir: temporaryRoot,
    packager: { appInfo: { productFilename: "RUX" } },
  });

  assert.deepEqual(plist.parse(await readFile(infoPath, "utf8")), { CFBundleName: "RUX" });
});

test("electron-builder keeps required Node mode while hardening packaged execution", async () => {
  const config = yaml.load(await readFile(path.join(root, "electron-builder.yml"), "utf8"));

  assert.equal(config.productName, "Rux");
  assert.equal(config.afterPack, "build/after-pack.mjs");
  assert.equal(config.electronFuses.runAsNode, true);
  assert.equal(config.electronFuses.enableCookieEncryption, true);
  assert.equal(config.electronFuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(config.electronFuses.enableNodeCliInspectArguments, false);
  assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(config.electronFuses.grantFileProtocolExtraPrivileges, true);
  assert.equal(config.electronFuses.resetAdHocDarwinSignature, true);
  for (const key of UNUSED_PRIVACY_USAGE_KEYS) {
    assert.equal(config.mac.extendInfo[key], null);
  }
});

test("Main accepts IPC only from the trusted main frame and ignores packaged dev URLs", async () => {
  const source = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  assert.match(source, /event\.sender !== window\.webContents/);
  assert.match(source, /event\.senderFrame !== window\.webContents\.mainFrame/);
  assert.match(source, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(source, /setPermissionRequestHandler/);
  assert.match(source, /target\.protocol === "https:"/);
  assert.match(source, /if \(!app\.isPackaged && process\.env\.ELECTRON_RENDERER_URL\)/);
  assert.match(source, /IPC_CHANNELS\.workspaceOpen/);
  assert.match(source, /const workspace = requireWorkspaceState\(\)\.active/);
  assert.match(source, /shell\.openExternal\(`vscode:\/\/file\$\{workspaceUrl\.pathname\}`\)/);
  assert.match(source, /shell\.openPath\(workspace\.path\)/);
});

test("workspace opening validates the requested desktop target without launching during tests", async () => {
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");

  assert.match(protocolSource, /workspaceOpenTargets = \["vscode", "finder"\] as const/);
  assert.match(protocolSource, /target: z\.enum\(workspaceOpenTargets\)\.default\("vscode"\)/);
  assert.match(protocolSource, /openWorkspaceLocation\(target\?: WorkspaceOpenTarget\)/);

  assert.match(preloadSource, /openWorkspaceLocation\(target\?: WorkspaceOpenTarget\)/);
  assert.match(preloadSource, /target \? \{ target \} : undefined/);

  assert.match(mainSource, /workspaceOpenParamsSchema\.parse\(input \?\? \{\}\)/);
  assert.match(mainSource, /if \(workspace\.placeholder\) return \{ opened: false, target, detail: "请先选择一个项目" \}/);
  assert.match(mainSource, /requireAuthorizedWorkspaceId\(workspace\.id\)/);
  assert.match(mainSource, /if \(target === "finder"\)/);
  assert.match(mainSource, /shell\.openExternal\(`vscode:\/\/file\$\{workspaceUrl\.pathname\}`\)/);
  assert.match(mainSource, /VS Code 打开失败，已回退到 Finder 显示项目目录/);
});

test("clean startup waits for explicit project and account actions", async () => {
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const webRuntimeSource = await readFile(path.join(root, "src/runtime.js"), "utf8");

  const defaultWorkspaceStart = mainSource.indexOf("function defaultWorkspacePath()");
  const defaultWorkspaceEnd = mainSource.indexOf("\nfunction legacyDevelopmentWorkspacePath", defaultWorkspaceStart);
  const defaultWorkspaceSource = mainSource.slice(defaultWorkspaceStart, defaultWorkspaceEnd);
  assert.match(defaultWorkspaceSource, /welcome-workspace/);
  assert.match(defaultWorkspaceSource, /process\.env\.RUX_WORKSPACE_ROOT \?\? welcomePlaceholder/);
  assert.doesNotMatch(defaultWorkspaceSource, /developmentRoot/);
  assert.match(mainSource, /WORKSPACE_STATE_VERSION = 2/);
  assert.match(mainSource, /function legacyDevelopmentWorkspacePath\(\)/);
  assert.match(mainSource, /authorizationSource: workspaceAuthorizationSource/);
  assert.match(mainSource, /storedActive\.path === legacyDevelopmentPath/);
  assert.match(mainSource, /workspaceAuthorizationSource = "picker"/);

  assert.match(rendererSource, /get\("showcase"\) === "codex"/);
  assert.match(rendererSource, /window\.rux \|\| !showcaseMode/);
  assert.match(rendererSource, /workspaceState\.recent\.filter\(\(workspace\) => !workspace\.placeholder\)/);
  assert.doesNotMatch(rendererSource, /SuperZ|<span className="account-avatar">SU<\/span>/);
  assert.match(rendererSource, /task\.id === `workspace-\$\{task\.workspaceId\}` && !task\.messages\.length/);
  assert.match(rendererSource, /title: taskTitleFromPrompt\(prompt\)/);

  const hydrateStart = rendererSource.indexOf("const hydrate = async () =>");
  const hydrateEnd = rendererSource.indexOf("void hydrate()", hydrateStart);
  const hydrateSource = rendererSource.slice(hydrateStart, hydrateEnd);
  assert.equal(hydrateSource.includes("runtime.authStatus()"), false);
  assert.match(hydrateSource, /window\.rux \? Promise\.resolve\(\{ adapters: fallbackAdapters \}\) : runtime\.listAgents\(\)/);
  const openAccountsStart = rendererSource.indexOf("const openAccounts = () =>");
  const openAccountsEnd = rendererSource.indexOf("const detectProviders = async", openAccountsStart);
  assert.doesNotMatch(rendererSource.slice(openAccountsStart, openAccountsEnd), /authStatus|listAgents|login\(/);
  const detectStart = rendererSource.indexOf("const detectProviders = async");
  const detectEnd = rendererSource.indexOf("const loginWithProvider = async", detectStart);
  const detectSource = rendererSource.slice(detectStart, detectEnd);
  assert.match(detectSource, /runtime\.authStatus\(\)/);
  assert.match(detectSource, /runtime\.listAgents\(\{ refresh: true \}\)/);
  assert.doesNotMatch(detectSource, /setTasks|setDrafts|setContextState|setWorkspaceState/);
  const accountsStart = rendererSource.indexOf("function AccountsDialog(");
  const accountsEnd = rendererSource.indexOf("\nfunction SessionDiscoveryDialog", accountsStart);
  const accountsSource = rendererSource.slice(accountsStart, accountsEnd);
  assert.match(accountsSource, /Agent 与 Provider/);
  assert.match(accountsSource, /无需 Rux 账号/);
  assert.match(accountsSource, /开始检测/);
  assert.match(accountsSource, /使用 ChatGPT 登录/);
  assert.match(accountsSource, /使用 Claude 登录/);
  assert.match(accountsSource, /未检测/);
  assert.match(accountsSource, /未安装/);
  assert.match(accountsSource, /已安装 · 未连接/);
  assert.match(accountsSource, /已连接/);
  assert.match(accountsSource, /检测错误/);
  assert.match(accountsSource, /连接不等于当前使用/);
  assert.match(accountsSource, />新建任务</);
  assert.match(accountsSource, /当前使用/);
  assert.doesNotMatch(accountsSource, /设为默认/);
  assert.match(rendererSource, /initialAgentId=\{newTaskAgentId\}/);
  assert.match(rendererSource, /https:\/\/developers\.openai\.com\/codex\/cli\//);
  assert.match(rendererSource, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/getting-started/);
  assert.doesNotMatch(accountsSource, /一键同步|onSync|登录 Codex|Codex 设置/);
  assert.match(rendererSource, /if \(value === "codex"\) return "Rux"/);
  assert.match(rendererSource, /aria-label="Rux 推理强度"/);
  assert.match(rendererSource, />Rux 设置</);
  assert.match(rendererSource, /ruxAdapterLabel\(message\.adapter\)/);
  assert.match(rendererSource, /ruxAdapterLabel\(run\.adapter\)/);
  assert.match(rendererSource, /ruxAdapterLabel\(request\.provider\)/);
  assert.match(rendererSource, /ruxAdapterLabel\(inspectedRun\.agentSnapshot\.backend\)/);
  assert.match(rendererSource, /ruxModelLabel\(model\.displayName \|\| model\.model\)/);
  assert.match(rendererSource, /showcaseMode \? \{\} : readUiPreferences\(\)/);
  assert.match(rendererSource, /if \(showcaseMode\) return;/);
  assert.match(rendererSource, /setTaskActionError\("Web 预览不会读取本机目录；请在 Rux 桌面应用中打开项目。"\)/);
  assert.match(rendererSource, /工作区未提交 \{files\.length\} 个文件/);
  assert.match(rendererSource, /本次 Run 的文件归属以 Run Evidence 为准/);
  assert.doesNotMatch(rendererSource, /<strong>已编辑 \{files\.length\} 个文件<\/strong>/);
  assert.match(rendererSource, /reconcileEngineDefaultModelDecision\(nextRun\.modelDecision, event\.model\)/);

  assert.match(webRuntimeSource, /showcasePreview \? changedFiles : \[\]/);
});

test("Session Connectors use supported provider interfaces without credential or transcript parsing", async () => {
  const connectorSource = await readFile(path.join(root, "src/electron/session-connector.ts"), "utf8");
  const codexSource = await readFile(path.join(root, "src/electron/codex-app-server-adapter.ts"), "utf8");

  assert.match(codexSource, /this\.request\("thread\/list"/);
  assert.match(codexSource, /this\.request\("thread\/read"/);
  assert.match(connectorSource, /from claude_agent_sdk import list_sessions, get_session_info, get_session_messages/);
  assert.doesNotMatch(connectorSource, /\.jsonl|Keychain|security find-generic-password|credentials\.json/);
  assert.doesNotMatch(connectorSource, /readFile|readFileSync|createReadStream|readdir|readdirSync/);
  assert.match(connectorSource, /MAX_RESPONSE_BYTES = 2 \* 1024 \* 1024/);
  assert.match(connectorSource, /redactSensitiveText/);
});

test("external Session discovery is explicit, Workspace-filtered, and cannot expose raw Connector methods to Renderer", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const runtimeClientSource = await readFile(path.join(root, "src/runtime.js"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");

  assert.match(rendererSource, />导入 Agent 会话</);
  assert.match(rendererSource, /首次发现不会读取完整对话/);
  assert.match(rendererSource, /本机 Claude Agent SDK 尚未提供会话浏览能力/);
  assert.match(rendererSource, /打开此窗口本身不会访问任何历史/);
  assert.match(rendererSource, /onClick=\{state\.status === "loading" \? onCancel : onDiscover\}/);
  const openStart = rendererSource.indexOf("const openSessionDiscovery = () =>");
  const discoverStart = rendererSource.indexOf("const discoverSessions = async", openStart);
  assert.equal(rendererSource.slice(openStart, discoverStart).includes("discoverSessions("), false);
  assert.match(runtimeClientSource, /api\.request\("session\.discover", params\)/);
  assert.doesNotMatch(runtimeClientSource, /api\.request\("session\.list"/);
  assert.doesNotMatch(runtimeClientSource, /api\.request\("session\.read"/);
  assert.match(runtimeClientSource, /api\.migrateSessionAttribution\(params\)/);
  assert.match(rendererSource, /迁移到 \{item\.attribution\.workspaceName\}/);
  assert.match(mainSource, /RUX_AUTHORIZED_WORKSPACES: JSON\.stringify\(authorizedWorkspaces\)/);
  assert.match(mainSource, /\["runtime\.shutdown", "session\.list", "session\.attribution\.migrate", "session\.read", "session\.resume\.check"\]/);
  assert.match(protocolSource, /"runtime\.shutdown" \| "session\.list" \| "session\.attribution\.migrate" \| "session\.read" \| "session\.resume\.check"/);
  assert.match(mainSource, /migrateImportedSessionWorkspace/);
});

test("external Session refresh is user-triggered, versioned, and mediated by Main", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");

  assert.match(rendererSource, /刷新原生会话<\/button>/);
  assert.match(rendererSource, /确认按原生会话重建<\/button>/);
  assert.match(rendererSource, /恢复此本地版本<\/button>/);
  assert.match(rendererSource, /window\.confirm\("按原生会话重建当前本地 Projection？旧 Revision、Rux Run、审批和 Task 元数据会保留，Provider 原会话不会被修改/);
  assert.match(rendererSource, /window\.confirm\("恢复这个本地 Projection Revision？这不会修改原生会话，当前版本也会继续保留/);
  assert.match(rendererSource, /onClick=\{onRefreshSession\}/);
  assert.match(preloadSource, /refreshSession\(params: SessionRefreshParams\)[\s\S]*ipcRenderer\.invoke\(IPC_CHANNELS\.sessionRefresh/);
  assert.match(mainSource, /ipcMain\.handle\(IPC_CHANNELS\.sessionRefresh/);
  assert.match(mainSource, /method: "session\.preview"/);
  assert.match(mainSource, /requireTaskStore\(\)\.refreshExternalSession/);
  assert.match(mainSource, /requireTaskStore\(\)\.activateSessionRevision/);
  assert.doesNotMatch(rendererSource, /useEffect\(\(\) => \{[^}]*refreshImportedSession\(/s);
});

test("Context Handoff previews local facts and creates a target Task only after confirmation", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");

  assert.match(rendererSource, /复制为新任务/);
  assert.match(rendererSource, /确定性事实包/);
  assert.match(rendererSource, /让来源 Agent 生成/);
  assert.match(rendererSource, /未保存原生会话 · 可编辑或移除/);
  assert.match(rendererSource, /不会使用展示数据补齐/);
  assert.match(rendererSource, /确认前不会调用目标 Agent，也不会创建 Native Session/);
  assert.match(rendererSource, /window\.confirm\("确认创建新的 Task 并固定目标 Agent Revision/);
  assert.match(preloadSource, /IPC_CHANNELS\.handoffPreview/);
  assert.match(preloadSource, /IPC_CHANNELS\.handoffSummaryGenerate/);
  assert.match(preloadSource, /IPC_CHANNELS\.handoffCommit/);
  assert.match(mainSource, /resolveHandoffTarget/);
  assert.match(mainSource, /requireTaskStore\(\)\.previewContextHandoff/);
  assert.match(mainSource, /method: "handoff\.summary\.generate"/);
  assert.match(mainSource, /agentSummaryGenerationId/);
  assert.match(mainSource, /requireTaskStore\(\)\.commitContextHandoff/);
  assert.doesNotMatch(rendererSource, /runtimeRef\.current\.startRun[^\n]*handoff/i);
});

test("local data cleanup and export are impact-previewed, confirmation-gated, and Main-owned", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const storeSource = await readFile(path.join(root, "src/electron/task-store.ts"), "utf8");

  assert.match(rendererSource, /本地数据与导出/);
  assert.match(rendererSource, /先生成影响预览，再明确确认执行/);
  assert.match(rendererSource, /原生会话不受影响/);
  assert.match(rendererSource, /Task、消息和投影版本会完整保留；重新导入可以恢复刷新与继续/);
  assert.match(rendererSource, /Provider 原生会话不会被删除或归档/);
  assert.match(rendererSource, /导出文件可能包含敏感内容/);
  assert.match(rendererSource, /confirmedSensitiveContent: true/);
  assert.match(preloadSource, /IPC_CHANNELS\.localDataPreview/);
  assert.match(preloadSource, /IPC_CHANNELS\.localDataExecute/);
  assert.match(preloadSource, /IPC_CHANNELS\.localDataExport/);
  assert.match(mainSource, /localDataExecuteParamsSchema\.parse/);
  assert.match(mainSource, /dialog\.showSaveDialog/);
  assert.match(mainSource, /mode: 0o600/);
  assert.match(storeSource, /Local data changed; review the impact again/);
  assert.match(storeSource, /DELETE FROM session_projection_revision/);
  assert.doesNotMatch(mainSource, /method: "session\.(?:delete|archive)"/);
});

test("renderer keeps Agent setup actionable and resumes the selected task session", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");

  assert.match(rendererSource, /className="composer-agent-select" aria-label="选择 Agent"/);
  assert.match(rendererSource, /已折叠 \{message\.unsupportedContent\.total\} 个导入事件/);
  assert.match(rendererSource, /composer-connect-button/);
  assert.match(rendererSource, /className="composer-agent-warning"/);
  assert.match(rendererSource, /onClick=\{onOpenAccounts\}>账户与登录<\/button>/);
  assert.match(rendererSource, /const preflight = runPreflight\(selectedTask, prompt\)/);
  assert.match(rendererSource, /const sessionLink = latestCompatibleSessionLink\(taskSnapshot\);\s+const sessionId = sessionLink\?\.nativeSessionId/);
  assert.match(rendererSource, /model: requestedModel,\s+modelMode: taskSnapshot\.model === "Auto" \? "auto" : "fixed",\s+modelSource: taskSnapshot\.modelSource,\s+modelVerificationStatus: taskSnapshot\.modelVerificationStatus,\s+reasoningEffort: taskSnapshot\.reasoningEffort \|\| undefined,\s+sessionId,\s+profileId: taskSnapshot\.agentProfileId,\s+agentRevisionId:/);
  assert.match(rendererSource, /runtime\.listAgentModels\(\{ adapter: "codex", limit: 100/);
  assert.match(rendererSource, /const \[drafts, setDrafts\] = useState/);
  assert.match(rendererSource, /composerInputRef\.current\?\.focus\(\)/);
  assert.match(rendererSource, /&& !task\.agentProfileId\s+&& adapter === "codex"\s+&& \(!task\.agentRevisionId \|\| task\.agentRevisionId === builtInAgentRevisionId\("codex"\)\)/);
  assert.match(rendererSource, /agentRevisionId: choice\.agentRevisionId,\s+agentRevisionSnapshot: undefined,/);
  assert.match(rendererSource, /agentRevisionId: taskRevisionId,\s+\.\.\.\(task\.agentProfileId \? \{ profileId: task\.agentProfileId \} : \{\}\),/);
  assert.match(await readFile(path.join(root, "src/runtime.js"), "utf8"), /isSessionModelSwitchRestriction = \/Native Session \.\*按 Run 切换模型\//);
  assert.doesNotMatch(rendererSource, /selectedTask\.messages\[0\]\?\.text \|\| selectedTask\.title/);
});

test("Rux Native tool authority is pinned by the immutable Agent Revision", async () => {
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const runtime = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  const adapter = await readFile(path.join(root, "src/electron/native-provider-adapter.ts"), "utf8");

  assert.match(renderer, /toolIds: \["read_file", "list_files", "write_file", "run_command"\]/);
  assert.match(runtime, /nativeRunParamsForLaunch\(params\)/);
  assert.match(runtime, /profiles\(\)\.getRevision\(params\.agentRevisionId\)/);
  assert.match(runtime, /allowedToolIds: \[\.\.\.revision\.toolIds\]/);
  assert.match(adapter, /params\.allowedToolIds && !params\.allowedToolIds\.includes\(name\)/);
  assert.match(adapter, /permissionMode !== "plan" && process\.platform === "darwin"/);
});

test("Rux Native Connection mutations require a fresh non-secret impact preview", async () => {
  const main = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const preload = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  assert.match(main, /providerConnectionImpactPreview/);
  assert.match(main, /assertNativeProviderImpactFingerprint/);
  assert.match(main, /Connection 影响已变化，请重新预览并确认/);
  assert.match(main, /listProviderConnectionTaskImpacts/);
  assert.doesNotMatch(main.slice(main.indexOf("function nativeProviderImpactPreview"), main.indexOf("async function syncNativeProviderConnections")), /apiKey|encryptedApiKey/);
  assert.match(preload, /previewProviderConnectionImpact/);
  assert.match(renderer, /留空保留当前 Key；填写则替换/);
  assert.match(renderer, /固定到该 Connection 的 Task/);
});

test("renderer keeps Tasks pinned to immutable Agent Revisions and branches upgrades", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");

  assert.match(rendererSource, /function agentRevisionUpdateForTask\(task, profiles\)/);
  assert.match(rendererSource, /profile\.latestRevisionId === task\.agentRevisionId/);
  assert.match(rendererSource, /此任务继续固定使用 Revision/);
  assert.match(rendererSource, /使用新版创建新任务/);
  assert.match(rendererSource, /const createTaskWithLatestAgent = \(\) =>/);
  assert.match(rendererSource, /agentRevisionId: choice\.agentRevisionId/);
  assert.match(rendererSource, /messages: \[\],\s+plan: \[\],\s+activity: \[\],\s+runs: \[\]/);
  assert.match(rendererSource, /保存会创建 Revision/);
  assert.match(rendererSource, /已删除 Definition 的历史 Revision/);

  const upgradeStart = rendererSource.indexOf("const createTaskWithLatestAgent = () =>");
  const upgradeEnd = rendererSource.indexOf("\n  const retryFailedSession =", upgradeStart);
  const upgradeSource = rendererSource.slice(upgradeStart, upgradeEnd);
  assert.doesNotMatch(upgradeSource, /selectedTask\.messages|selectedTask\.runs|selectedTask\.contextFiles|sessionId/);
  assert.doesNotMatch(upgradeSource, /map\(\(task\).*agentRevisionId/);
});

test("renderer makes Native Session resume failure recoverable without silent fallback", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const runtime = await readFile(path.join(root, "src", "runtime.js"), "utf8");
  assert.match(renderer, /未能恢复原 Native Session/);
  assert.match(renderer, /重试原 Session/);
  assert.match(renderer, /创建新任务/);
  assert.match(renderer, /Session<\/dt><dd title=/);
  assert.match(renderer, /Revision<\/dt>/);
  assert.match(renderer, /Connection<\/dt>/);
  assert.match(runtime, /resumeSessionId: normalized\.options\.sessionId/);
  assert.match(runtime, /modelMode: normalized\.options\.modelMode/);
});

test("renderer exposes truthful model source, manual verification, and catalog-removal states", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const modelState = await readFile(path.join(root, "src", "model-state.js"), "utf8");
  assert.match(renderer, /官方 Engine 目录/);
  assert.match(renderer, /高级模型 ID/);
  assert.match(renderer, /首次运行后验证/);
  assert.match(renderer, /已不在最新官方目录中，不会自动替换/);
  assert.match(renderer, /\^codex default\$.*Rux default/);
  assert.match(modelState, /providerConnection\?\.id !== connectionId/);
  assert.match(modelState, /model\[_ -\]not\[_ -\]found/);
});

test("renderer exposes Revision-owned Auto policy, actual per-turn model, and sourced Token evidence", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  assert.match(renderer, /Auto 简单任务模型/);
  assert.match(renderer, /Auto 复杂任务模型/);
  assert.match(renderer, /Auto 模型白名单/);
  assert.match(renderer, /未验证的手动模型不会出现在这里/);
  assert.match(renderer, /本回合模型与 Token 证据/);
  assert.match(renderer, /Auto · \{run\.modelDecision\.classification === "complex" \? "复杂任务" : "简单任务"\}/);
  assert.match(renderer, /Engine \/ Provider 未报告本次 Run 的 Token 用量/);
  assert.match(renderer, /Cached input/);
  assert.match(renderer, /Rux 估算/);
});
