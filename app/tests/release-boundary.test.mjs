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
  assert.match(html, /<title>Rux<\/title>/);

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

test("release workflow fails closed on signing inputs and keeps publishing approval-gated", async () => {
  const workflowSource = await readFile(path.join(root, "../.github/workflows/release.yml"), "utf8");
  const releaseContract = await readFile(path.join(root, "../docs/release-playbook.md"), "utf8");
  const manifestScript = await readFile(path.join(root, "scripts/release-manifest.mjs"), "utf8");
  assert.match(workflowSource, /test -n "\$CSC_LINK"/);
  assert.match(workflowSource, /xcrun stapler validate/);
  assert.match(workflowSource, /environment: production-release/);
  assert.doesNotMatch(workflowSource, /--publish always/);
  assert.match(releaseContract, /Signed release builds embed a non-secret HTTPS Feed URL/);
  assert.match(releaseContract, /Never promise downgrade/);
  assert.match(manifestScript, /sha256/);
});

test("signed application updates are Main-owned, explicit, staged, and exact-version rollback only", async () => {
  const manager = await readFile(path.join(root, "src/electron/update-manager.ts"), "utf8");
  const main = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const preload = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const workflow = await readFile(path.join(root, "../.github/workflows/release.yml"), "utf8");
  assert.match(manager, /autoDownload = false/);
  assert.match(manager, /autoInstallOnAppQuit = false/);
  assert.match(manager, /allowDowngrade = true/);
  assert.match(manager, /result\?\.updateInfo\?\.version !== rollbackVersion/);
  assert.match(main, /立即重启并安装已校验的更新/);
  assert.match(preload, /installUpdate/);
  assert.match(renderer, /SHA-512 与平台代码签名校验/);
  assert.match(workflow, /RUX_UPDATE_FEED_URL/);
  assert.match(workflow, /latest\*\.yml/);
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
  const rendererStyles = await readFile(path.join(root, "src/styles.css"), "utf8");
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
  assert.match(rendererSource, /const accountLabel = codexConnected \|\| showcaseMode \? "ChatGPT" : "登录 ChatGPT"/);
  assert.doesNotMatch(rendererSource, /剩余 29%/);
  assert.doesNotMatch(rendererSource, /显示宠物|<span>宠物<\/span>/);
  assert.match(rendererStyles, /\.codex-shell \.account-popover \{ right: auto; bottom: 44px; left: 9px; width: 224px; height: auto; min-height: 0;/);
  assert.match(rendererStyles, /\.codex-shell \.account-popover > button \{ min-height: 28px;/);
  assert.match(rendererSource, /task\.id === `workspace-\$\{task\.workspaceId\}` && !task\.messages\.length/);
  assert.match(rendererSource, /title: taskTitleFromPrompt\(prompt\)/);

  const hydrateStart = rendererSource.indexOf("const hydrate = async () =>");
  const hydrateEnd = rendererSource.indexOf("void hydrate()", hydrateStart);
  const hydrateSource = rendererSource.slice(hydrateStart, hydrateEnd);
  assert.equal(hydrateSource.includes("runtime.authStatus()"), false);
  assert.match(hydrateSource, /window\.rux \? Promise\.resolve\(\{ adapters: cachedAgentDetection\?\.adapters \|\| fallbackAdapters \}\) : runtime\.listAgents\(\)/);
  const openAccountsStart = rendererSource.indexOf("const openAccounts = () =>");
  const openAccountsEnd = rendererSource.indexOf("const detectProviders = async", openAccountsStart);
  assert.doesNotMatch(rendererSource.slice(openAccountsStart, openAccountsEnd), /authStatus|listAgents|login\(/);
  const detectStart = rendererSource.indexOf("const detectProviders = async");
  const detectEnd = rendererSource.indexOf("const loginWithProvider = async", detectStart);
  const detectSource = rendererSource.slice(detectStart, detectEnd);
  assert.match(detectSource, /runtime\.authStatus\(\)/);
  assert.match(detectSource, /runtime\.listAgents\(\{ refresh: true \}\)/);
  assert.doesNotMatch(detectSource, /setTasks|setDrafts|setContextState|setWorkspaceState/);
  const accountsStart = rendererSource.indexOf("function CodexAccountDialog(");
  const accountsEnd = rendererSource.indexOf("\nfunction AccountsDialog", accountsStart);
  const accountsSource = rendererSource.slice(accountsStart, accountsEnd);
  assert.match(accountsSource, /账户与登录/);
  assert.match(accountsSource, /官方登录与本机 Session/);
  assert.match(accountsSource, /使用 ChatGPT 登录/);
  assert.match(accountsSource, /已连接/);
  assert.doesNotMatch(accountsSource, /Claude Code|Rux Native|检测本机 Agent|选择 Agent/);
  assert.match(rendererSource, /initialAgentId=\{newTaskAgentId\}/);
  assert.match(rendererSource, /https:\/\/developers\.openai\.com\/codex\/cli\//);
  assert.match(rendererSource, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/getting-started/);
  assert.doesNotMatch(accountsSource, /一键同步|onSync|登录 Codex|Codex 设置/);
  assert.match(rendererSource, /if \(value === "codex"\) return "Codex"/);
  assert.match(rendererSource, /aria-label="Rux 推理强度"/);
  assert.match(rendererSource, /这是仅查看的导入会话，原会话的模型、权限和消息不会在这里修改/);
  assert.match(rendererSource, /const createBlankTask = \(choice, workspace = workspaceState\.active, sourceTask = selectedTask, initialDraft = "", boardSource = null\) =>/);
  assert.match(rendererSource, /else startEditableConversation\(\);/);
  assert.match(rendererSource, /className="project-new-task-button"/);
  assert.match(rendererSource, /aria-label=\{`在项目 \$\{project\.name\} 中新建对话`\}/);
  assert.match(rendererSource, /onClick=\{\(\) => onCreateTaskInWorkspace\(workspace\.path\)\}/);
  assert.doesNotMatch(rendererSource, /!searchQuery && !hasUnpinnedTasks/);
  const sidebarStart = rendererSource.indexOf("function Sidebar(");
  const sidebarEnd = rendererSource.indexOf("\nfunction ActivityRow", sidebarStart);
  const sidebarSource = rendererSource.slice(sidebarStart, sidebarEnd);
  assert.doesNotMatch(sidebarSource, />Agents<|>改进中心<|>看板<|>工作副本<|>导入 Agent 会话</);
  assert.match(rendererSource, /Rux approved improvement assets pinned when this Task was created/);
  assert.doesNotMatch(rendererSource, /composer-interaction-lock/);
  assert.match(rendererSource, /title: "新对话"/);
  assert.match(rendererSource, /messages: \[\],\s+plan: \[\],\s+activity: \[\],\s+runs: \[\]/);
  assert.match(rendererSource, /placeholder=\{interactionLockReason \? "当前会话不可编辑" : "随心输入"\}/);
  assert.match(rendererSource, /aria-label="添加文件和更多"[^>]+disabled=\{!canRun \|\| isActive\}/);
  assert.match(rendererSource, /role="menu" aria-label="如何批准 Rux 操作"/);
  assert.match(rendererSource, /className=\{`permission-chip[^>]+disabled=\{!canRun \|\| isActive\}/);
  assert.match(rendererSource, />设置<\/span>/);
  assert.match(rendererSource, /ruxAdapterLabel\(message\.adapter\)/);
  assert.match(rendererSource, /ruxAdapterLabel\(run\.adapter\)/);
  assert.match(rendererSource, /ruxAdapterLabel\(request\.provider\)/);
  assert.match(rendererSource, /ruxAdapterLabel\(inspectedRun\.agentSnapshot\.backend\)/);
  assert.match(rendererSource, /displayModelOptions\.map\(\(model\) => <button/);
  assert.match(rendererSource, /showcaseMode \? \{\} : readUiPreferences\(\)/);
  assert.match(rendererSource, /agentDetectionCacheKey = "rux\.agent-detection\.v1"/);
  assert.match(rendererSource, /sanitizeAgentDetectionCache/);
  assert.match(rendererSource, /不会后台自动刷新；发送前会重新校验/);
  assert.match(rendererSource, /const validateCliAgentForRun = async/);
  assert.match(rendererSource, /runtime\.listAgents\(\{ refresh: true \}\)/);
  assert.match(rendererSource, /if \(showcaseMode\) return;/);
  assert.match(rendererSource, /setTaskActionError\("Web 预览不会读取本机目录；请在 Rux 桌面应用中打开项目。"\)/);
  assert.match(rendererSource, /工作区未提交 \{files\.length\} 个文件/);
  assert.match(rendererSource, /本次 Run 的文件归属以 Run Evidence 为准/);
  assert.doesNotMatch(rendererSource, /<strong>已编辑 \{files\.length\} 个文件<\/strong>/);
  assert.match(rendererSource, /reconcileEngineDefaultModelDecision\(nextRun\.modelDecision, event\.model\)/);

  assert.match(webRuntimeSource, /showcasePreview \? changedFiles : \[\]/);
});

test("welcome Workspace snapshots are acknowledged without entering the authorized Task Store", async () => {
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  assert.match(mainSource, /parsed\.workspaceId === welcomeWorkspaceId/);
  assert.match(mainSource, /persisted: false/);
  assert.match(mainSource, /persisted: true/);
  assert.match(protocolSource, /interface TaskStateSaveResult[\s\S]*persisted: boolean/);
});

test("composer file context uses a native workspace-bounded picker", async () => {
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");

  assert.match(protocolSource, /workspaceChooseFiles: "rux:workspace:choose-files"/);
  assert.match(protocolSource, /chooseContextFiles\(\): Promise<string\[\]>/);
  assert.match(preloadSource, /chooseContextFiles\(\): Promise<string\[\]>/);
  assert.match(preloadSource, /IPC_CHANNELS\.workspaceChooseFiles/);
  assert.match(mainSource, /properties: \["openFile", "multiSelections"\]/);
  assert.match(mainSource, /requireAuthorizedWorkspaceId\(workspace\.id\)/);
  assert.match(mainSource, /const canonicalPath = realpathSync\(selectedPath\)/);
  assert.match(mainSource, /所选文件必须位于当前授权 Workspace 内/);
  assert.match(rendererSource, />添加项目文件</);
  assert.match(rendererSource, /window\.rux\.chooseContextFiles\(\)/);
  assert.match(rendererSource, /runtime\.contextSnapshot\(requested\)/);
  assert.match(rendererSource, /aria-label=\{`移除文件 Context：\$\{path\}`\}/);
});

test("composer clipboard images are bounded, persisted by Main, and sent as Codex localImage inputs", async () => {
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const codexSource = await readFile(path.join(root, "src/electron/codex-app-server-adapter.ts"), "utf8");

  assert.match(protocolSource, /clipboardImageSave: "rux:clipboard-image:save"/);
  assert.match(protocolSource, /imagePaths: z\.array\(z\.string\(\)\.min\(1\)\.max\(4_096\)\)\.max\(10\)/);
  assert.match(preloadSource, /saveClipboardImage\(params: ClipboardImageSaveParams\)/);
  assert.match(mainSource, /clipboardImageSaveParamsSchema\.parse\(input\)/);
  assert.match(mainSource, /bytes\.length > 20 \* 1024 \* 1024/);
  assert.match(mainSource, /writeFileSync\(path, bytes, \{ flag: "wx", mode: 0o600 \}\)/);
  assert.match(rendererSource, /onPaste=\{\(event\) =>/);
  assert.match(rendererSource, /window\.rux\.saveClipboardImage/);
  assert.match(rendererSource, /contextFiles: taskSnapshot\.contextFiles \|\| \[\],\s+imagePaths,/);
  assert.match(codexSource, /type: "localImage", path/);
});

test("composer loads a real model menu and bottom/right panels are mutually exclusive", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const terminalSource = await readFile(path.join(root, "src/TerminalView.jsx"), "utf8");
  assert.match(rendererSource, /role="listbox" aria-label="可用模型"/);
  assert.match(rendererSource, /void onRequestModelCatalog\?\.\(\)/);
  assert.match(rendererSource, /runtime\.listAgentModels\(\{ adapter: "codex", limit: 100/);
  assert.match(rendererSource, /if \(!terminalOpen\) setInspectorOpen\(false\)/);
  assert.match(rendererSource, /setTerminalOpen\(false\);\s+setInspectorTab\("environment"\)/);
  assert.match(rendererSource, /className="terminal-new-tab"[^>]+onClick=\{addTab\}/);
  assert.match(terminalSource, /const onSessionChangeRef = useRef\(onSessionChange\)/);
  assert.match(terminalSource, /\}, \[\]\);/);
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
  assert.match(mainSource, /\["runtime\.shutdown", "session\.list", "session\.import", "session\.refresh", "session\.rebuild", "session\.revision\.list", "session\.revision\.restore", "session\.attribution\.migrate", "session\.read", "session\.resume\.check", "handoff\.preview", "handoff\.commit", "local\.data\.summary", "local\.data\.preview", "local\.data\.execute", "local\.data\.export"\]/);
  assert.match(protocolSource, /"runtime\.shutdown" \| "session\.list" \| "session\.import" \| "session\.refresh" \| "session\.rebuild" \| "session\.revision\.list" \| "session\.revision\.restore" \| "session\.attribution\.migrate" \| "session\.read" \| "session\.resume\.check" \| "handoff\.preview" \| "handoff\.commit" \| "handoff\.summary\.generate" \| "improvement\.evaluation\.run" \| "local\.data\.summary" \| "local\.data\.preview" \| "local\.data\.execute" \| "local\.data\.export"/);
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

test("large Context Handoff selection is searchable, bounded, and diagnostically reviewable", async () => {
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  assert.match(renderer, /筛选最多 500 条消息/);
  assert.match(renderer, /全选当前结果/);
  assert.match(renderer, /最近 20 条/);
  assert.match(renderer, /aria-label="交接诊断"/);
  assert.match(renderer, /事实指纹/);
  assert.match(renderer, /selectedTask\.messages\.slice\(-500\)/);
  assert.match(renderer, /messages\.slice\(-20\)\.map/);
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

test("renderer keeps the Codex session fixed while exposing the reference model control", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");

  assert.match(rendererSource, /className="composer-model-select"/);
  assert.doesNotMatch(rendererSource, /className="composer-agent-button is-fixed"/);
  assert.match(rendererSource, /const choice = agentChoices\.find\(\(item\) => item\.id === "codex" && item\.available\)/);
  assert.doesNotMatch(rendererSource.slice(rendererSource.indexOf("function Sidebar("), rendererSource.indexOf("\nfunction ActivityRow")), />Agents<|>改进中心<|>导入 Agent 会话/);
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

test("official CLI logout is explicit, confirmation-gated, and never deletes credentials directly", async () => {
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const authManager = await readFile(path.join(root, "src/electron/auth-manager.ts"), "utf8");
  const runtime = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  assert.match(renderer, /window\.confirm\(`退出 \$\{providerName\} 登录/);
  assert.match(renderer, /runtime\.logout\(provider\)/);
  assert.match(runtime, /case "auth\.logout"/);
  assert.match(authManager, /logoutArgs: \["logout"\]/);
  assert.match(authManager, /logoutArgs: \["auth", "logout"\]/);
  assert.doesNotMatch(authManager, /unlinkSync|rmSync|keytar|Keychain/);
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

test("Rux Native Anthropic protocol uses managed auth headers and Rux-owned conversation history", async () => {
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const adapter = await readFile(path.join(root, "src/electron/native-provider-adapter.ts"), "utf8");
  const protocol = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  assert.match(renderer, /<option value="anthropic-messages">Anthropic Messages<\/option>/);
  assert.match(renderer, /conversationHistory: conversationHistoryForRun\(taskSnapshot, prompt\)/);
  assert.match(adapter, /"x-api-key": connection\.apiKey, "anthropic-version": "2023-06-01"/);
  assert.match(adapter, /tool_result/);
  assert.equal((adapter.match(/redirect: "error"/g) ?? []).length, 4);
  assert.match(renderer, /<option value="openai-chat-completions">OpenAI Chat Completions<\/option>/);
  assert.match(protocol, /"authorization", "x-api-key", "anthropic-version"/);
  assert.match(protocol, /Base URL must not contain a query or fragment/);
});

test("Provider support, network, and migration contracts stay explicit and fail closed", async () => {
  const contract = await readFile(path.join(root, "../docs/provider-adapter-support-and-security.md"), "utf8");
  const store = await readFile(path.join(root, "src/electron/native-provider-store.ts"), "utf8");
  assert.match(contract, /Rux Native — Anthropic Messages/);
  assert.match(contract, /Provider redirects fail/);
  assert.match(contract, /future-version refusal tests/);
  assert.match(store, /Unsupported Native Provider store version/);
});

test("Rux Native OAuth remains provider-registration gated", async () => {
  const contract = await readFile(path.join(root, "../docs/rux-native-oauth-contract.md"), "utf8");
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  assert.match(contract, /Authorization Code \+ PKCE S256/);
  assert.match(contract, /Provider 官方桌面 OAuth 合同与 RUX Client 注册/);
  assert.match(contract, /Renderer.*不得出现明文 Token/s);
  assert.doesNotMatch(renderer, /Rux Native OAuth 登录/);
});

test("local success metrics are explainable and have no telemetry transport", async () => {
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const metrics = await readFile(path.join(root, "src/local-success-metrics.js"), "utf8");
  assert.match(renderer, /本机成功指标/);
  assert.match(renderer, /没有遥测或上传通道/);
  assert.match(metrics, /computeLocalSuccessMetrics/);
  assert.doesNotMatch(metrics, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  const eventStore = await readFile(path.join(root, "src/electron/local-product-event-store.ts"), "utf8");
  assert.match(eventStore, /main-local-only/);
  assert.doesNotMatch(eventStore, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.doesNotMatch(eventStore, /prompt|messageContent|workspacePath|apiKey/);
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

test("Provider credential diagnostics and migration stay Main-owned and secret-free", async () => {
  const main = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const store = await readFile(path.join(root, "src/electron/native-provider-store.ts"), "utf8");
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  assert.match(main, /providerCredentialDiagnostics/);
  assert.match(main, /providerCredentialMigrate/);
  assert.match(store, /migrateCredentials/);
  assert.match(store, /\.backup-/);
  assert.match(renderer, /仅在你点击后检查当前 OS 安全存储与密文可解密性/);
  assert.match(renderer, /重新封装凭据/);
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

test("Native Session writers are serialized and external-writer risk has refresh and branch exits", async () => {
  const main = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const runtime = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  const host = await readFile(path.join(root, "src/electron/stdio-runtime.ts"), "utf8");
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(runtime, /NATIVE_SESSION_WRITE_CONFLICT/);
  assert.match(host, /NATIVE_SESSION_WRITE_CONFLICT/);
  assert.match(renderer, /原生会话仍可能被其他客户端写入/);
  assert.match(renderer, /刷新原生会话/);
  assert.match(renderer, /复制为新任务/);
});

test("renderer exposes the reference model selector and truthful manual verification states", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const modelState = await readFile(path.join(root, "src", "model-state.js"), "utf8");
  assert.match(renderer, /5\.6 Sol 中/);
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

test("Project Board and controlled improvement remain Main-owned and message-only Runs avoid redundant Git scans", async () => {
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const runtimeSource = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  const hostSource = await readFile(path.join(root, "src/electron/stdio-runtime.ts"), "utf8");
  assert.match(mainSource, /new BoardStore\(resolve\(app\.getPath\("userData"\), "project-boards\.json"\)\)/);
  assert.match(mainSource, /new ImprovementStore\(resolve\(app\.getPath\("userData"\), "improvements\.json"\)\)/);
  assert.match(mainSource, /requireAuthorizedProjectWorkspaces\(parsed\.projectId\)/);
  assert.match(mainSource, /git", \["-C", source\.path, "worktree", "list", "--porcelain"\]/);
  assert.match(mainSource, /method: "git\.worktree\.create"/);
  assert.match(mainSource, /WORKTREE_IDENTITY_MISMATCH/);
  assert.match(mainSource, /improvementExportPreviews/);
  assert.match(mainSource, /publishAgentInstructionCandidate/);
  for (const source of [runtimeSource, hostSource]) {
    assert.match(source, /runsWithPossibleWorkspaceChanges/);
    assert.match(source, /gitChanges\.unchangedRunPatch\(baseline\)/);
    assert.match(source, /case "git\.worktree\.create"/);
  }
});
