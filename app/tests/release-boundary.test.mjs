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
  MICROPHONE_USAGE_DESCRIPTION,
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

test("mac Info.plist hardening removes unused privacy prompts and keeps explicit voice input", () => {
  const info = {
    CFBundleName: "RUX",
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
    },
    ...Object.fromEntries(UNUSED_PRIVACY_USAGE_KEYS.map((key) => [key, "unused"])),
  };

  assert.deepEqual(hardenMacInfoPlist(info), {
    CFBundleName: "RUX",
    NSMicrophoneUsageDescription: MICROPHONE_USAGE_DESCRIPTION,
  });
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

  assert.deepEqual(plist.parse(await readFile(infoPath, "utf8")), {
    CFBundleName: "RUX",
    NSMicrophoneUsageDescription: MICROPHONE_USAGE_DESCRIPTION,
  });
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
  assert.equal(config.mac.extendInfo.NSMicrophoneUsageDescription, MICROPHONE_USAGE_DESCRIPTION);
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

test("signed application updates remain Main-owned compatibility code and are not exposed to Renderer", async () => {
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
  assert.doesNotMatch(preload, /getUpdateState|checkForUpdates|downloadUpdate|installUpdate|confirmUpdateHealthy/);
  assert.match(renderer, /SHA-512 与平台代码签名校验/);
  assert.match(workflow, /RUX_UPDATE_FEED_URL/);
  assert.match(workflow, /latest\*\.yml/);
});

test("Main accepts IPC only from the trusted frame and grants only user-triggered audio capture", async () => {
  const source = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  assert.match(source, /event\.sender !== window\.webContents/);
  assert.match(source, /event\.senderFrame !== window\.webContents\.mainFrame/);
  assert.match(source, /setPermissionCheckHandler\(\(webContents, permission, _origin, details\) =>/);
  assert.match(source, /webContents === window\.webContents[\s\S]*permission === "media"[\s\S]*details\.mediaType === "audio"/);
  assert.match(source, /mediaTypes\.length > 0[\s\S]*mediaTypes\.every\(\(mediaType\) => mediaType === "audio"\)/);
  assert.doesNotMatch(source, /mediaType === "video"|mediaType === "camera"/);
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
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");

  const defaultWorkspaceStart = mainSource.indexOf("function defaultWorkspacePath()");
  const defaultWorkspaceEnd = mainSource.indexOf("\nfunction legacyDevelopmentWorkspacePath", defaultWorkspaceStart);
  const defaultWorkspaceSource = mainSource.slice(defaultWorkspaceStart, defaultWorkspaceEnd);
  assert.match(defaultWorkspaceSource, /welcome-workspace/);
  assert.match(defaultWorkspaceSource, /mkdirSync\(welcomePlaceholder, \{ recursive: true \}\)/);
  assert.doesNotMatch(defaultWorkspaceSource, /if \(!process\.env\.RUX_WORKSPACE_ROOT\) mkdirSync/);
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
  assert.match(rendererSource, /const accountLabel = syncedChatGptConnected && chatGptAccount\.email/);
  assert.doesNotMatch(rendererSource, /剩余 29%/);
  assert.match(rendererSource, /role="menuitem" disabled title="宠物显示结果尚缺当前客户端点击证据"[^>]*><Ghost[^>]*\/><span>显示宠物<\/span>/);
  assert.doesNotMatch(rendererSource, />同步 ChatGPT<\/span>/);
  assert.match(rendererSource, /<span>\{accountSyncing \? "正在刷新" : "使用情况"\}<\/span>/);
  assert.match(rendererSource, /runtime\.syncChatGptAccount\(\)/);
  assert.match(rendererSource, /setChatGptAccount\(snapshot\)/);
  const accountSyncStart = rendererSource.indexOf("const syncChatGptAccount = async");
  const accountSyncEnd = rendererSource.indexOf("const openSessionDiscovery", accountSyncStart);
  assert.doesNotMatch(rendererSource.slice(accountSyncStart, accountSyncEnd), /authStatus|listAgents|listAgentProfiles|listProviderConnections/);
  assert.doesNotMatch(rendererSource, /chatGptAccount.*uiPreferences|uiPreferences.*chatGptAccount/);
  assert.match(rendererStyles, /\.codex-shell \.account-popover \{ right: auto; bottom: 44px; left: 9px; width: 224px; height: auto; min-height: 0;/);
  assert.match(rendererStyles, /\.codex-shell \.account-popover > button \{ min-height: 28px;/);
  assert.match(rendererSource, /<nav className="sidebar-nav" aria-label="主要导航">/);
  assert.match(rendererSource, /className="product-switcher"[\s\S]*aria-label="Rux 工作台"[\s\S]*title="工作台切换结果尚缺当前客户端点击证据"[\s\S]*disabled/);
  assert.doesNotMatch(rendererSource, /productMenuOpen|productMenuRef|productTriggerRef|id="product-switcher-menu"/);
  assert.match(rendererSource, /className="account-popover" role="menu" aria-label="账户菜单" onKeyDown=\{handleAccountMenuKeyDown\}/);
  assert.match(rendererSource, /querySelector\('\[role="menuitem"\]:not\(:disabled\)'\)/);
  assert.match(rendererSource, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(rendererSource, /accountTriggerRef\.current\?\.focus\(\)/);
  assert.match(rendererSource, /className="timeline-scroll" role="region" aria-label="对话记录" aria-busy=\{\["running", "blocked"\]\.includes\(task\.status\)\} tabIndex=\{0\}/);
  assert.match(rendererSource, /aria-label="应用代码片段" title="应用代码片段的目标行为尚缺当前客户端点击证据" disabled/);
  assert.match(rendererSource, /aria-label="赞" title="反馈提交接口与确认状态尚未完成目标客户端验收" disabled/);
  assert.match(rendererSource, /aria-label="踩" title="反馈提交接口与确认状态尚未完成目标客户端验收" disabled/);
  assert.match(rendererSource, /aria-label="展开回复" title="展开回复行为尚缺当前客户端点击证据" disabled/);
  assert.doesNotMatch(rendererSource, /<button type="button" aria-label="(?:应用代码片段|赞|踩|展开回复)"><\/button>/);
  assert.match(rendererStyles, /\.codex-shell \.timeline-region > \.timeline-scroll:focus-visible/);
  assert.match(rendererStyles, /\/\* High-zoom and narrow-viewport reflow\.[\s\S]*@media \(max-width: 700px\)/);
  assert.match(rendererStyles, /\.codex-shell \.session-recovery-actions \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(rendererStyles, /\.codex-shell \.composer-toolbar \{[\s\S]*flex-wrap: nowrap/);
  assert.match(rendererStyles, /\.codex-shell \.composer-shell textarea \{[\s\S]*height: 44px;[\s\S]*min-height: 44px/);
  assert.match(rendererStyles, /\.codex-shell \.composer-connect-button \{[\s\S]*width: 32px;[\s\S]*font-size: 0/);
  assert.match(rendererSource, /className="composer-connect-button"[^>]*><CircleAlert[^>]*\/><span>配置连接<\/span>/);
  assert.match(rendererStyles, /@media \(max-width: 560px\) \{[\s\S]*\.codex-shell \.composer-shell textarea \{[\s\S]*height: 36px;[\s\S]*\.codex-shell \.composer-model-select span \{[\s\S]*display: none/);
  assert.match(rendererStyles, /@media \(max-width: 560px\) \{[\s\S]*\.codex-shell \.terminal-trigger \{[\s\S]*display: none;[\s\S]*\.codex-shell \.transcript-change-actions \{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(rendererStyles, /@media \(max-width: 560px\) \{[\s\S]*\.codex-shell \.task-header-actions \{[\s\S]*margin-right: 24px;[\s\S]*\.codex-shell \.composer-submit-area \{[\s\S]*padding-right: 6px/);
  assert.match(rendererStyles, /\.codex-shell \.task-workspace > \.composer-dock \{[\s\S]*padding: 4px 12px 7px 6px/);
  assert.match(rendererStyles, /\.codex-shell \.open-location-button span,[\s\S]*display: none/);
  assert.match(rendererStyles, /\.codex-shell \.timeline-jump-button \{[\s\S]*top: 8px;[\s\S]*bottom: auto;[\s\S]*transform: none/);
  assert.match(rendererSource, /const handleInspectorTabKeyDown = \(event\) =>/);
  assert.match(rendererSource, /className="inspector-tabs" role="tablist" aria-label="任务检查器" onKeyDown=\{handleInspectorTabKeyDown\}/);
  assert.match(rendererSource, /id="inspector-tab-context"[^>]*tabIndex=\{tab === "context" \? 0 : -1\}/);
  assert.match(rendererSource, /const handleTerminalTabKeyDown = \(event\) =>/);
  assert.match(rendererSource, /className="terminal-tabs" role="tablist" aria-label="终端标签" onKeyDown=\{handleTerminalTabKeyDown\}/);
  assert.match(rendererSource, /role="tab" aria-selected=\{selected\} tabIndex=\{selected \? 0 : -1\}/);
  assert.match(rendererSource, /focusTerminalTab\(nextActiveTabId\)/);
  assert.match(rendererSource, /const handleTaskHeaderMenuKeyDown = \(event\) =>/);
  assert.match(rendererSource, /id="task-header-action-menu"[^>]*onKeyDown=\{renaming \? undefined : handleTaskHeaderMenuKeyDown\}/);
  assert.match(rendererSource, /id="open-location-menu"[^>]*onKeyDown=\{handleTaskHeaderMenuKeyDown\}/);
  assert.match(rendererSource, /id="quick-tools-menu"[^>]*role="menu"[^>]*onKeyDown=\{handleTaskHeaderMenuKeyDown\}/);
  assert.match(rendererSource, /quickToolsRef\.current\?\.querySelector\('\[role="menuitem"\]:not\(:disabled\)'\)\?\.focus\(\)/);
  assert.match(rendererSource, /quickToolsTriggerRef\.current\?\.focus\(\)/);
  assert.match(rendererSource, /ref=\{searchTriggerRef\}[\s\S]*aria-label="搜索任务"/);
  assert.match(rendererSource, /ref=\{notificationTriggerRef\}[\s\S]*aria-label="通知"/);
  assert.match(rendererSource, /restoreNotificationFocus[\s\S]*notificationTriggerRef\.current\?\.focus\(\)/);
  assert.match(rendererSource, /restoreSearchFocus[\s\S]*searchTriggerRef\.current\?\.focus\(\)/);
  assert.match(rendererSource, /\.sidebar-search-wrap, \.sidebar-notification-popover/);
  assert.match(rendererSource, /task\.id === `workspace-\$\{task\.workspaceId\}` && !task\.messages\.length/);
  assert.match(rendererSource, /title: taskTitleFromPrompt\(prompt\)/);

  const hydrateStart = rendererSource.indexOf("const hydrate = async () =>");
  const hydrateEnd = rendererSource.indexOf("void hydrate()", hydrateStart);
  const hydrateSource = rendererSource.slice(hydrateStart, hydrateEnd);
  assert.equal(hydrateSource.includes("runtime.authStatus()"), false);
  assert.match(hydrateSource, /window\.rux \? Promise\.resolve\(\{ adapters: cachedAgentDetection\?\.adapters \|\| fallbackAdapters \}\) : runtime\.listAgents\(\)/);
  const openAccountsStart = rendererSource.indexOf("const openAccounts = () =>");
  const openAccountsEnd = rendererSource.indexOf("const syncChatGptAccount = async", openAccountsStart);
  assert.doesNotMatch(rendererSource.slice(openAccountsStart, openAccountsEnd), /authStatus|listAgents|login\(/);
  const openSettingsStart = rendererSource.indexOf("const openSettings = () =>");
  const openSettingsEnd = rendererSource.indexOf("const loadExternalImport = async", openSettingsStart);
  assert.doesNotMatch(rendererSource.slice(openSettingsStart, openSettingsEnd), /getLocalProductEventSummary|getUpdateState|listAgentProfiles|listProviderConnections/);
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
  assert.doesNotMatch(rendererSource, /<NewTaskDialog/);
  assert.match(rendererSource, /https:\/\/developers\.openai\.com\/codex\/cli\//);
  assert.match(rendererSource, /https:\/\/docs\.anthropic\.com\/en\/docs\/claude-code\/getting-started/);
  assert.doesNotMatch(accountsSource, /一键同步|onSync|登录 Codex|Codex 设置/);
  assert.match(rendererSource, /if \(value === "codex"\) return "Codex"/);
  assert.match(rendererSource, /role="menu" aria-label="推理强度"/);
  assert.match(rendererSource, /aria-label=\{`选择模型：\$\{modelVisualLabel\(task\.model\)\}`\}/);
  assert.match(rendererSource, /const handleComposerMenuKeyDown = \(event\) =>/);
  assert.match(rendererSource, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(rendererSource, /ref=\{permissionMenuRef\} className="composer-permission-popover" role="menu"[^>]*onKeyDown=\{handleComposerMenuKeyDown\}/);
  assert.match(rendererSource, /ref=\{modelMenuRef\} className="composer-model-menu" role="menu"[^>]*onKeyDown=\{handleComposerMenuKeyDown\}/);
  assert.match(rendererSource, /data-menu-section="model"/);
  assert.match(rendererSource, /modelReturnSectionRef\.current = parentSection/);
  assert.match(rendererSource, /querySelector\(`\[data-menu-section="\$\{parentSection\}"\]`\)\?\.focus\(\)/);
  assert.match(rendererSource, /restoreComposerTrigger\(closingSection\)/);
  assert.match(rendererSource, /document\.querySelector\('\[role="menu"\], \[role="dialog"\], \[role="alertdialog"\], \.composer-options-popover, \.sidebar-search-wrap, \.sidebar-notification-popover'\)/);
  assert.match(rendererSource, /const defaultCodexSettings = \{[\s\S]*openTarget: "VS Code"[\s\S]*terminalPosition: "bottom"[\s\S]*preventSleep: true[\s\S]*speed: "标准"/);
  const settingsStart = rendererSource.indexOf("function CodexSettingsDialog(");
  const settingsEnd = rendererSource.indexOf("\nfunction RestoreDialog", settingsStart);
  const settingsSource = rendererSource.slice(settingsStart, settingsEnd);
  assert.doesNotMatch(settingsSource, /const \[generalPreferences, setGeneralPreferences\]/);
  assert.match(settingsSource, /const updateGeneralPreference = \(key, value\) => applyDraft\(\{ \.\.\.draft, \[key\]: value \}\)/);
  assert.match(settingsSource, /value=\{draft\.openTarget \|\| defaultCodexSettings\.openTarget\}/);
  assert.match(settingsSource, /checked=\{draft\.preventSleep \?\? defaultCodexSettings\.preventSleep\}/);
  assert.match(settingsSource, /value=\{draft\.openTarget \|\| defaultCodexSettings\.openTarget\} disabled/);
  assert.match(settingsSource, /value=\{draft\.language \|\| defaultCodexSettings\.language\} disabled/);
  assert.match(settingsSource, /checked=\{draft\.showInMenuBar \?\? defaultCodexSettings\.showInMenuBar\} disabled/);
  assert.match(settingsSource, /checked=\{draft\.bottomPanel \?\? defaultCodexSettings\.bottomPanel\} onChange=/);
  assert.match(settingsSource, /disabled title="右侧终端停靠尚未完成当前客户端验收">右侧/);
  assert.match(settingsSource, /checked=\{draft\.preventSleep \?\? defaultCodexSettings\.preventSleep\} onChange=\{\(event\) => updateGeneralPreference\('preventSleep', event\.target\.checked\)\}/);
  assert.match(rendererSource, /const shouldPreventSleep = Boolean\(codexSettings\.preventSleep[\s\S]*\["running", "blocked"\]\.includes\(task\.status\)/);
  assert.match(rendererSource, /window\.rux\.setPreventSleep\(shouldPreventSleep\)/);
  assert.match(rendererSource, /window\.rux\?\.setPreventSleep\?\.\(false\)/);
  assert.match(protocolSource, /preventSleepSet: "rux:power:prevent-sleep-set"/);
  assert.match(preloadSource, /setPreventSleep\(enabled: boolean\)[\s\S]*IPC_CHANNELS\.preventSleepSet/);
  assert.match(mainSource, /powerSaveBlocker\.start\("prevent-display-sleep"\)/);
  assert.match(mainSource, /IPC_CHANNELS\.preventSleepSet[\s\S]*preventSleepParamsSchema\.parse/);
  assert.match(mainSource, /updatePreventSleep\(false\);[\s\S]*stopRuntimeProcess\("workspace switch"\)/);
  const preloadApiStart = preloadSource.indexOf("const api: RuxDesktopApi = {");
  const preloadApiEnd = preloadSource.indexOf("contextBridge.exposeInMainWorld", preloadApiStart);
  const preloadApiSource = preloadSource.slice(preloadApiStart, preloadApiEnd);
  const desktopApiStart = protocolSource.indexOf("export interface RuxDesktopApi {");
  const desktopApiEnd = protocolSource.indexOf("\n}", desktopApiStart);
  const desktopApiSource = protocolSource.slice(desktopApiStart, desktopApiEnd);
  for (const legacyMethod of ["loadBoard", "mutateBoard", "listProjectWorkingCopies", "analyzeImprovements", "importSession", "previewHandoff", "getLocalDataSummary", "listProviderConnections", "getLocalProductEventSummary", "getUpdateState"]) {
    assert.doesNotMatch(preloadApiSource, new RegExp(`${legacyMethod}\\(`));
    assert.doesNotMatch(desktopApiSource, new RegExp(`${legacyMethod}\\(`));
  }
  assert.doesNotMatch(settingsSource, /onClick=\{\(\) => updateGeneralPreference\('terminalPosition', 'right'\)\}/);
  assert.match(rendererSource, /showBottomPanelControl=\{codexSettings\.bottomPanel\}/);
  assert.match(rendererSource, /showBottomPanelControl \? <button[\s\S]*className=\{`icon-button terminal-trigger/);
  assert.match(rendererSource, /const defaultSpeedTier = codexSettings\.speed === "快速"[\s\S]*find\(\(tier\) => tier\.id\)\?\.id/);
  assert.match(rendererSource, /const normalizedServiceTier = normalized\.speed === "快速"[\s\S]*serviceTier: normalizedServiceTier \|\| undefined/);
  assert.match(settingsSource, /const showUpdates = false;/);
  assert.match(settingsSource, /onClick=\{\(\) => \{ setPage\("import"\); setQuery\(""\); void onLoadExternalImport\(\); \}\}[^>]*><Download[^>]*\/><span>导入<\/span>/);
  for (const label of ["外观", "语音", "配置", "个性化", "键盘快捷键", "计算机历史记录", "应用快照", "浏览器", "电脑操控", "钩子", "连接", "Git"]) {
    assert.match(settingsSource, new RegExp(`<button type="button" disabled title="[^"]+">[^\\n]*<span>${label}<\\/span>`));
  }
  assert.match(rendererStyles, /--sidebar-width: 241px;[\s\S]*--environment-rail: 300px;[\s\S]*--inspector-width: 286px;[\s\S]*--reference-content-width: 736px;/);
  assert.match(rendererStyles, /\.codex-shell \.inspector \{[\s\S]*height: 397px;/);
  assert.match(rendererStyles, /\.codex-shell \.sidebar-footer \{ padding: 5px 16px;/);
  assert.match(rendererStyles, /\.main-surface\.inspector-is-open \.task-workspace \{ width: calc\(100% - var\(--environment-rail\)\); \}/);
  assert.match(rendererStyles, /\.main-surface\.inspector-is-open \.task-header \{ width: calc\(100% \+ var\(--environment-rail\)\); \}/);
  assert.match(rendererSource, /const createBlankTask = \(choice, workspace = workspaceState\.active, sourceTask = selectedTask, initialDraft = "", boardSource = null\) =>/);
  assert.match(rendererSource, /const reusableBlankTask = !initialDraft && !boardSource/);
  assert.match(rendererSource, /!\(task\.messages \|\| \[\]\)\.length[\s\S]*!\(task\.runs \|\| \[\]\)\.length[\s\S]*!\(drafts\[task\.id\] \|\| ""\)\.trim\(\)/);
  assert.match(rendererSource, /if \(reusableBlankTask\) \{[\s\S]*setSelectedTaskId\(reusableBlankTask\.id\)[\s\S]*return reusableBlankTask\.id/);
  assert.match(rendererSource, /else startEditableConversation\(\);/);
  assert.match(rendererSource, /className="project-new-task-button"/);
  assert.match(rendererSource, /aria-label=\{`在项目 \$\{project\.name\} 中新建对话`\}/);
  assert.match(rendererSource, /onClick=\{\(\) => onCreateTaskInWorkspace\(workspace\.path\)\}/);
  assert.doesNotMatch(rendererSource, /!searchQuery && !hasUnpinnedTasks/);
  assert.match(rendererSource, /className="icon-button task-share-trigger"[\s\S]*aria-label="共享任务"[\s\S]*title="共享结果与权限语义尚缺当前客户端点击证据"[\s\S]*disabled[\s\S]*<Upload size=\{17\} \/>/);
  const sidebarStart = rendererSource.indexOf("function Sidebar(");
  const sidebarEnd = rendererSource.indexOf("\nfunction ActivityRow", sidebarStart);
  const sidebarSource = rendererSource.slice(sidebarStart, sidebarEnd);
  assert.doesNotMatch(sidebarSource, />Agents<|>改进中心<|>看板<|>工作副本<|>导入 Agent 会话|>编辑项目</);
  assert.match(sidebarSource, /role="menuitem" disabled title="宠物显示结果尚缺当前客户端点击证据"[^>]*><Ghost[^>]*\/><span>显示宠物<\/span>/);
  assert.match(sidebarSource, /role="menuitem" disabled title="邀请流程尚未完成当前客户端验收"[^>]*><Share2[^>]*\/><span>邀请好友<\/span>/);
  assert.doesNotMatch(rendererSource, /Rux approved improvement assets pinned when this Task was created|improvementAssetsForWorkspace/);
  const hydrateStartBoundary = rendererSource.indexOf("const hydrate = async () =>");
  const hydrateEndBoundary = rendererSource.indexOf("void hydrate()", hydrateStartBoundary);
  const hydrateBoundarySource = rendererSource.slice(hydrateStartBoundary, hydrateEndBoundary);
  assert.doesNotMatch(hydrateBoundarySource, /getImprovementSummary|loadBoard|listAgentProfiles|listProviderConnections|getLocalProductEventSummary|getUpdateState/);
  assert.match(hydrateBoundarySource, /agentResult\.adapters\.filter\(\(adapter\) => adapter\.id === "codex"\)/);
  const saveEffectStart = rendererSource.indexOf("const snapshot = workspaceTaskSnapshot");
  const saveEffectEnd = rendererSource.indexOf("useEffect(() => {", saveEffectStart);
  assert.doesNotMatch(rendererSource.slice(saveEffectStart, saveEffectEnd), /loadBoard|setBoardState|setBoardSnapshotsByProject/);
  for (const legacySurface of ["NewTaskDialog", "ProjectBoard", "WorkingCopiesDialog", "ImprovementCenter", "ContextHandoffDialog", "AgentsDialog", "SessionDiscoveryDialog"]) {
    assert.doesNotMatch(rendererSource, new RegExp(`<${legacySurface}(?:\\s|>)`));
  }
  const createTaskStartBoundary = rendererSource.indexOf("const createTask = (");
  const createTaskEndBoundary = rendererSource.indexOf("\n  const retryFailedSession", createTaskStartBoundary);
  assert.doesNotMatch(rendererSource.slice(createTaskStartBoundary, createTaskEndBoundary), /improvementAssets|boardSource/);
  assert.doesNotMatch(rendererSource, /composer-interaction-lock/);
  assert.match(rendererSource, /title: "新对话"/);
  assert.match(rendererSource, /sanitizeCodexCatalogCache/);
  assert.match(rendererSource, /agentModelListResultSchema\.safeParse\(value\)/);
  assert.match(rendererSource, /codexCatalog: \{\s+adapter: "codex",\s+source: "engine-catalog"/);
  assert.match(rendererSource, /if \(choice\.adapter === "codex"\) void loadCodexModels\(\);/);
  assert.match(rendererSource, /return modelCatalogLoading \? "正在加载" : "选择模型"/);
  assert.doesNotMatch(rendererSource, /return "Codex 中"/);
  assert.match(rendererSource, /const lastAssistantMessageIndexByRun = new Map\(\)/);
  assert.match(rendererSource, /\["completed", "failed", "cancelled"\]\.includes\(messageRun\?\.status\)/);
  assert.match(rendererSource, /run=\{showRunEvidence \? messageRun : undefined\}/);
  assert.match(rendererSource, /\{!hasAssistantMessage \? <p className="agent-response-lead">/);
  assert.match(rendererSource, /messages: \[\],\s+plan: \[\],\s+activity: \[\],\s+runs: \[\]/);
  assert.match(rendererSource, /placeholder=\{interactionLockReason \? "当前会话不可编辑" : "随心输入"\}/);
  assert.match(rendererSource, /onImport\("copy"\)/);
  assert.match(rendererSource, /已导入为 Rux 独立副本/);
  assert.match(rendererSource, /importedCopyPrompt\(taskSnapshot, prompt\)/);
  assert.doesNotMatch(rendererSource, /仅导入查看|导入并继续|本地只读投影|这是仅查看的导入会话/);
  assert.match(rendererSource, /aria-label="添加文件和更多"[^>]+disabled=\{!canRun \|\| isActive\}/);
  assert.match(rendererSource, /role="menu" aria-label="如何批准 Rux 操作"/);
  assert.match(rendererSource, /className=\{`permission-chip[^>]+disabled=\{!canRun \|\| isActive\}/);
  assert.match(rendererSource, />设置<\/span>/);
  const runPaneStart = rendererSource.indexOf("function RunPane(");
  const runPaneEnd = rendererSource.indexOf("\nfunction EnvironmentGitFeedback", runPaneStart);
  assert.doesNotMatch(rendererSource.slice(runPaneStart, runPaneEnd), /Agent snapshot|ruxAdapterLabel\(inspectedRun\.agentSnapshot\.backend\)/);
  assert.match(rendererSource, /displayModelOptions\.map\(\(model\) => \{/);
  assert.match(rendererSource, /showcaseMode \? \{\} : readUiPreferences\(\)/);
  assert.match(rendererSource, /agentDetectionCacheKey = "rux\.agent-detection\.v1"/);
  assert.match(rendererSource, /sanitizeAgentDetectionCache/);
  assert.match(rendererSource, /不会后台自动刷新；发送前会重新校验/);
  assert.doesNotMatch(rendererSource, /const validateCliAgentForRun = async/);
  const loginStart = rendererSource.indexOf("const loginWithProvider = async");
  const loginEnd = rendererSource.indexOf("\n  const cancelLoginWithProvider", loginStart);
  const loginSource = rendererSource.slice(loginStart, loginEnd);
  assert.match(loginSource, /runtime\.login\(provider\)/);
  assert.doesNotMatch(loginSource, /listAgents|claude-code.*available|rux-native.*available/);
  assert.match(loginSource, /provider === "chatgpt"[\s\S]*adapter\.id === "codex"/);
  assert.match(rendererSource, /if \(showcaseMode\) return;/);
  assert.match(rendererSource, /setTaskActionError\("Web 预览不会读取本机目录；请在 Rux 桌面应用中打开项目。"\)/);
  assert.match(rendererSource, /工作区未提交 \{files\.length\} 个文件/);
  assert.match(rendererSource, /文件归属以本次运行证据为准/);
  assert.match(rendererSource, /本次运行修改 \{runPatch\.totals\.files\} 个文件/);
  assert.doesNotMatch(rendererSource, /Run changed|baseline-owned|Workspace Changes|Agent 消息/);
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

test("composer loads the Codex nested model menu and bottom/right panels are mutually exclusive", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const terminalSource = await readFile(path.join(root, "src/TerminalView.jsx"), "utf8");
  const runtimeClientSource = await readFile(path.join(root, "src/runtime.js"), "utf8");
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const codexSource = await readFile(path.join(root, "src/electron/codex-app-server-adapter.ts"), "utf8");
  assert.match(rendererSource, /role="menu" aria-label="模型与运行设置"/);
  assert.match(rendererSource, /<strong>模型<\/strong>/);
  assert.match(rendererSource, /<strong>推理强度<\/strong>/);
  assert.match(rendererSource, /<strong>速度<\/strong>/);
  assert.match(rendererSource, /role="menu" aria-label="模型"/);
  assert.match(rendererSource, /role="menu" aria-label="推理强度"/);
  assert.match(rendererSource, /role="menu" aria-label="速度"/);
  assert.match(rendererSource, /role="group" aria-label="高级模型设置"/);
  assert.match(rendererSource, /aria-label="高级推理强度"/);
  assert.match(rendererSource, /onServiceTierChange\(tier\.id\)/);
  assert.doesNotMatch(rendererSource, /className="composer-model-menu" role="listbox"/);
  assert.match(protocolSource, /serviceTiers: z\.array\(codexServiceTierInfoSchema\)/);
  assert.match(protocolSource, /serviceTier: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(64\)\.optional\(\)/);
  assert.match(codexSource, /serviceTier: params\.serviceTier \?\? null/);
  assert.match(codexSource, /\.\.\.\(params\.serviceTier \? \{ serviceTier: params\.serviceTier \} : \{\}\)/);
  assert.match(runtimeClientSource, /\.\.\.\(normalized\.options\.serviceTier \? \{ serviceTier: normalized\.options\.serviceTier \} : \{\}\)/);
  assert.match(rendererSource, /void onRequestModelCatalog\?\.\(\)/);
  assert.match(rendererSource, /runtime\.listAgentModels\(\{ adapter: "codex", limit: 100/);
  assert.match(rendererSource, /if \(!terminalOpen\) setInspectorOpen\(false\)/);
  assert.match(rendererSource, /setTerminalOpen\(false\);\s+setInspectorTab\("environment"\)/);
  assert.match(rendererSource, /className="terminal-new-tab"[^>]+onClick=\{addTab\}/);
  assert.match(rendererSource, /className="terminal-tabs" role="tablist" aria-label="终端标签"/);
  assert.match(rendererSource, /role="tab" aria-selected=\{selected\} tabIndex=\{selected \? 0 : -1\} aria-controls=\{`terminal-panel-\$\{tab\.id\}`\} aria-label=\{`终端 \$\{index \+ 1\}：\$\{label\}`\}/);
  assert.match(rendererSource, /role="tabpanel" aria-labelledby=\{`terminal-tab-\$\{tab\.id\}`\}/);
  assert.match(terminalSource, /const onSessionChangeRef = useRef\(onSessionChange\)/);
  assert.match(terminalSource, /\}, \[\]\);/);
  assert.match(rendererSource, /event\.ctrlKey && event\.shiftKey && event\.key\.toLowerCase\(\) === "g"/);
  assert.match(rendererSource, /setInspectorTab\("changes"\)[\s\S]*setInspectorOpen\(true\)/);
  assert.match(rendererSource, /event\.ctrlKey && event\.code === "Backquote"/);
  assert.match(rendererSource, /setTerminalOpen\(\(open\) => \{[\s\S]*if \(!open\) setInspectorOpen\(false\)/);
  const timelineStart = rendererSource.indexOf("function TaskTimeline(");
  const timelineEnd = rendererSource.indexOf("\nfunction Composer(", timelineStart);
  assert.doesNotMatch(rendererSource.slice(timelineStart, timelineEnd), /provider-native/);
  assert.match(rendererSource, /request\.provider === "codex"[\s\S]*"Codex 请求批准"/);
  assert.match(rendererSource, /<dt>操作<\/dt>/);
  assert.match(rendererSource, /<dt>范围<\/dt>/);
});

test("Composer /review starts the official inline read-only Codex review flow", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const runtimeClientSource = await readFile(path.join(root, "src/runtime.js"), "utf8");
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const adapterSource = await readFile(path.join(root, "src/electron/codex-app-server-adapter.ts"), "utf8");
  const composer = rendererSource.slice(rendererSource.indexOf("function Composer("), rendererSource.indexOf("\nfunction CodeReviewDialog"));
  const dialog = rendererSource.slice(rendererSource.indexOf("function CodeReviewDialog("), rendererSource.indexOf("\nfunction TaskHeader"));
  assert.match(protocolSource, /export type CodexReviewTarget/);
  assert.match(protocolSource, /reviewTarget: codexReviewTargetSchema\.optional\(\)/);
  assert.match(protocolSource, /Code review requires the Codex adapter/);
  assert.match(runtimeClientSource, /\.\.\.\(normalized\.options\.reviewTarget \? \{ reviewTarget: normalized\.options\.reviewTarget \} : \{\}\)/);
  assert.match(adapterSource, /this\.request\("review\/start", \{/);
  assert.match(adapterSource, /target: params\.reviewTarget/);
  assert.match(adapterSource, /delivery: "inline"/);
  assert.match(composer, /aria-label="Composer 命令"/);
  assert.match(composer, /<strong>\/review<\/strong>/);
  assert.match(composer, /onOpenReviewCommand\(\)/);
  assert.match(dialog, /审阅未提交变更/);
  assert.match(dialog, /与基准分支比较/);
  assert.match(dialog, /审阅一个提交/);
  assert.match(dialog, /自定义审阅说明/);
  assert.match(rendererSource, /permissionMode: runOptions\.reviewTarget \? "plan"/);
});

test("Composer queues Task-scoped inputs and drains them after terminal Run events", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const rendererStyles = await readFile(path.join(root, "src/styles.css"), "utf8");
  assert.match(rendererSource, /const \[queuedInputsByTask, setQueuedInputsByTask\] = useState\(\{\}\)/);
  assert.match(rendererSource, /current\.length >= 10/);
  assert.match(rendererSource, /aria-label=\{isActive \? "排队发送" : "发送"\}/);
  assert.match(rendererSource, /if \(isActive\) onQueue\(\)/);
  assert.match(rendererSource, /aria-label=\{`\$\{queuedInputs\.length\} 条排队输入`\}/);
  assert.match(rendererSource, /aria-label=\{`取消排队输入 \$\{index \+ 1\}`\}/);
  assert.match(rendererSource, /!\["running", "blocked"\]\.includes\(task\.status\)[\s\S]*queuedInputsByTask\[task\.id\]/);
  assert.match(rendererSource, /updateQueuedInputs\(taskSnapshot\.id[\s\S]*commitMessageAndLaunch\(taskSnapshot, entry\.text, entry\.images/);
  assert.match(rendererStyles, /\.task-workspace:has\(\.composer-queue\) \.timeline-content \{ padding-bottom: 338px; \}/);
});

test("Composer voice input uses real audio capture when supported and never fakes dictation", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  assert.match(rendererSource, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(rendererSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true, video: false \}\)/);
  assert.match(rendererSource, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(rendererSource, /recognition\.onresult = \(event\) =>/);
  assert.match(rendererSource, /if \(spoken\) onDraft\(\(current\) =>/);
  assert.match(rendererSource, /disabled=\{!canRun \|\| isActive \|\| !speechSupported\}/);
  assert.match(rendererSource, /aria-label=\{dictating \? "停止语音输入" : "语音输入"\}/);
  assert.doesNotMatch(rendererSource, /setDictating\(\(active\) => !active\)/);
});

test("Plugins navigation is backed by the official Codex CLI catalog", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const runtimeClientSource = await readFile(path.join(root, "src/runtime.js"), "utf8");
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const runtimeSource = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  const hostSource = await readFile(path.join(root, "src/electron/stdio-runtime.ts"), "utf8");
  const policySource = await readFile(path.join(root, "src/electron/runtime-request-policy.ts"), "utf8");
  const codexSource = await readFile(path.join(root, "src/electron/codex-app-server-adapter.ts"), "utf8");

  assert.match(protocolSource, /"plugin\.list"/);
  assert.match(protocolSource, /"plugin\.install"/);
  assert.match(protocolSource, /"plugin\.remove"/);
  assert.match(protocolSource, /codexPluginIdSchema[\s\S]*pluginId: codexPluginIdSchema[\s\S]*confirmed: z\.literal\(true\)/);
  assert.match(codexSource, /\["plugin", "list", "--available", "--json"\]/);
  assert.match(codexSource, /\["plugin", "add", pluginId, "--json"\]/);
  assert.match(codexSource, /\["plugin", "remove", pluginId, "--json"\]/);
  assert.match(codexSource, /MAX_CODEX_PLUGIN_JSON_BYTES = 8 \* 1024 \* 1024/);
  assert.match(runtimeSource, /case "plugin\.list"/);
  assert.match(hostSource, /case "plugin\.list"/);
  assert.match(policySource, /"plugin\.install"/);
  assert.match(policySource, /"plugin\.remove"/);
  assert.match(runtimeClientSource, /listCodexPlugins\(\)[\s\S]*api\.request\("plugin\.list", \{\}\)/);
  assert.match(runtimeClientSource, /source: "web-unavailable"/);
  assert.match(rendererSource, /function PluginsSurface\(/);
  assert.match(rendererSource, /onOpenPlugins=\{openPlugins\}/);
  assert.match(rendererSource, /<button type="button" onClick=\{onOpenPlugins\}><AtSign size=\{16\} \/><span>插件<\/span><\/button>/);
  assert.match(rendererSource, /<button type="button" onClick=\{onOpenAccounts\}><Activity size=\{16\} \/><span>使用情况和计费<\/span><\/button>/);
  assert.match(rendererSource, /runtime\.listCodexPlugins\(\)/);
  assert.match(rendererSource, /runtime\.installCodexPlugin\(\{ pluginId: plugin\.pluginId, confirmed: true \}\)/);
  assert.match(rendererSource, /runtime\.removeCodexPlugin\(\{ pluginId: plugin\.pluginId, confirmed: true \}\)/);
  const sidebarStart = rendererSource.indexOf("function Sidebar(");
  const sidebarEnd = rendererSource.indexOf("\nfunction ActivityRow", sidebarStart);
  const sidebarSource = rendererSource.slice(sidebarStart, sidebarEnd);
  assert.match(sidebarSource, /onClick=\{onOpenPlugins\}/);
  assert.doesNotMatch(sidebarSource, /<span>插件<\/span>[\s\S]{0,160}onOpenSettings/);
});

test("Settings Import uses official externalAgentConfig methods with stale-detection protection", async () => {
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const adapterSource = await readFile(path.join(root, "src/electron/codex-app-server-adapter.ts"), "utf8");
  const runtimeSource = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  const hostSource = await readFile(path.join(root, "src/electron/stdio-runtime.ts"), "utf8");
  const clientSource = await readFile(path.join(root, "src/runtime.js"), "utf8");
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  assert.match(protocolSource, /"externalConfig\.detect"/);
  assert.match(protocolSource, /"externalConfig\.import"/);
  assert.match(protocolSource, /"externalConfig\.history"/);
  assert.match(protocolSource, /confirmed: z\.literal\(true\)/);
  assert.match(adapterSource, /this\.request\("externalAgentConfig\/detect"/);
  assert.match(adapterSource, /cwds: \[this\.workspaceRoot\]/);
  assert.match(adapterSource, /this\.externalDetections\.set\(detectionId/);
  assert.match(adapterSource, /EXTERNAL_IMPORT_DETECTION_STALE/);
  assert.match(adapterSource, /this\.request\("externalAgentConfig\/import"/);
  assert.match(adapterSource, /externalAgentConfig\/import\/completed/);
  assert.match(adapterSource, /externalAgentConfig\/import\/readHistories/);
  assert.match(runtimeSource, /case "externalConfig\.detect"/);
  assert.match(hostSource, /case "externalConfig\.import"/);
  assert.match(clientSource, /detectExternalConfig\(params\)[\s\S]*api\.request\("externalConfig\.detect", params\)/);
  assert.match(rendererSource, /function ExternalImportSettings/);
  assert.match(rendererSource, /来源内容不会被修改或删除/);
  assert.match(rendererSource, /确认导入/);
  assert.match(rendererSource, /自动更新[\s\S]*尚未提供自动更新开关/);
});

test("Pull requests use a bounded read-only GitHub CLI Runtime path", async () => {
  const protocolSource = await readFile(path.join(root, "src/shared/protocol.ts"), "utf8");
  const runtimeSource = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  const hostSource = await readFile(path.join(root, "src/electron/stdio-runtime.ts"), "utf8");
  const clientSource = await readFile(path.join(root, "src/runtime.js"), "utf8");
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const serviceSource = await readFile(path.join(root, "src/electron/github-pull-request-service.ts"), "utf8");
  assert.match(protocolSource, /"pullRequest\.list"/);
  assert.match(protocolSource, /source: "github-cli" \| "unavailable" \| "web-unavailable"/);
  assert.match(runtimeSource, /case "pullRequest\.list"[\s\S]*pullRequests\.list\(\)/);
  assert.match(hostSource, /case "pullRequest\.list"[\s\S]*pullRequests\.list\(\)/);
  assert.match(clientSource, /listPullRequests\(\)[\s\S]*api\.request\("pullRequest\.list", \{\}\)/);
  assert.match(rendererSource, /runtime\.listPullRequests\(\)/);
  assert.match(rendererSource, /function PullRequestsSurface/);
  assert.doesNotMatch(rendererSource, /<span>拉取请求<\/span>[\s\S]{0,180}onOpenChanges/);
  assert.match(serviceSource, /MAX_GITHUB_JSON_BYTES/);
  assert.match(serviceSource, /GITHUB_COMMAND_TIMEOUT_MS/);
  assert.match(serviceSource, /\["pr", "list", "--state", "all", "--limit", "100", "--json"/);
  assert.doesNotMatch(serviceSource, /GH_TOKEN|GITHUB_TOKEN|auth token/);
});

test("unavailable Codex surfaces fail truthfully instead of routing to unrelated UI", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const sidebarStart = rendererSource.indexOf("function Sidebar(");
  const sidebarEnd = rendererSource.indexOf("\nfunction ActivityRow", sidebarStart);
  const sidebar = rendererSource.slice(sidebarStart, sidebarEnd);
  const quickToolsStart = rendererSource.indexOf('<div id="open-location-menu"');
  const quickToolsEnd = rendererSource.indexOf("</header>", quickToolsStart);
  const quickTools = rendererSource.slice(quickToolsStart, quickToolsEnd);
  assert.match(sidebar, /<span>站点<\/span>/);
  assert.match(sidebar, /onClick=\{onOpenSites\}/);
  assert.match(sidebar, /<span>已安排<\/span>/);
  assert.match(sidebar, /onClick=\{onOpenScheduled\}/);
  assert.doesNotMatch(sidebar, /<span>站点<\/span>[\s\S]{0,180}onOpenEnvironment|<span>已安排<\/span>[\s\S]{0,180}setNotificationsOpen/);
  assert.match(rendererSource, /function UnavailableFeatureSurface/);
  assert.match(rendererSource, /不会显示虚构站点或把环境面板冒充为站点/);
  assert.match(rendererSource, /不会把通知冒充为已安排任务/);
  assert.match(quickTools, /role="menuitem" disabled title="当前官方本地边界尚未提供内置浏览器控制"/);
  assert.match(quickTools, /role="menuitem" disabled title="当前官方本地边界尚未提供侧边聊天"/);
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

test("legacy external Session refresh remains internal and is absent from the Rux-owned copy UI", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");

  const timelineStart = rendererSource.indexOf("function TaskTimeline(");
  const timelineEnd = rendererSource.indexOf("\nfunction Composer(", timelineStart);
  const timelineSource = rendererSource.slice(timelineStart, timelineEnd);
  assert.doesNotMatch(timelineSource, /刷新原生会话|本地只读投影|原会话不可用/);
  assert.match(rendererSource, /确认按原生会话重建<\/button>/);
  assert.match(rendererSource, /恢复此本地版本<\/button>/);
  assert.match(rendererSource, /window\.confirm\("按原生会话重建当前本地 Projection？旧 Revision、Rux Run、审批和 Task 元数据会保留，Provider 原会话不会被修改/);
  assert.match(rendererSource, /window\.confirm\("恢复这个本地 Projection Revision？这不会修改原生会话，当前版本也会继续保留/);
  assert.doesNotMatch(preloadSource, /sessionRefresh|refreshSession|rebuildSession|listSessionRevisions|restoreSessionRevision/);
  assert.match(mainSource, /ipcMain\.handle\(IPC_CHANNELS\.sessionRefresh/);
  assert.match(mainSource, /method: "session\.preview"/);
  assert.match(mainSource, /requireTaskStore\(\)\.refreshExternalSession/);
  assert.match(mainSource, /requireTaskStore\(\)\.activateSessionRevision/);
  assert.doesNotMatch(rendererSource, /useEffect\(\(\) => \{[^}]*refreshImportedSession\(/s);
});

test("legacy Context Handoff stays Main-owned and is absent from the v1 timeline", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const mainSource = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const preloadSource = await readFile(path.join(root, "src/electron/preload.ts"), "utf8");

  const timelineStart = rendererSource.indexOf("function TaskTimeline(");
  const timelineEnd = rendererSource.indexOf("\nfunction Composer(", timelineStart);
  assert.doesNotMatch(rendererSource.slice(timelineStart, timelineEnd), /复制为新任务|onOpenHandoff|Agent 有新 Revision|管理本地数据/);
  assert.match(rendererSource, /确定性事实包/);
  assert.match(rendererSource, /让来源 Agent 生成/);
  assert.match(rendererSource, /未保存原生会话 · 可编辑或移除/);
  assert.match(rendererSource, /不会使用展示数据补齐/);
  assert.match(rendererSource, /确认前不会调用目标 Agent，也不会创建 Native Session/);
  assert.match(rendererSource, /window\.confirm\("确认创建新的 Task 并固定目标 Agent Revision/);
  assert.doesNotMatch(preloadSource, /handoffPreview|handoffSummaryGenerate|handoffCommit|previewHandoff|commitHandoff/);
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

test("legacy local data cleanup and export remain Main-owned and are not exposed to Renderer", async () => {
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
  assert.doesNotMatch(preloadSource, /localDataSummary|localDataPreview|localDataExecute|localDataExport|getLocalDataSummary|previewLocalData|executeLocalData|exportLocalData/);
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
  assert.match(rendererSource, /model: requestedModel,\s+modelMode: taskSnapshot\.model === "Auto" \? "auto" : "fixed",\s+modelSource: taskSnapshot\.modelSource,\s+modelVerificationStatus: taskSnapshot\.modelVerificationStatus,\s+reasoningEffort: taskSnapshot\.reasoningEffort \|\| undefined,\s+serviceTier: taskSnapshot\.serviceTier \|\| undefined,\s+sessionId,\s+profileId: taskSnapshot\.agentProfileId,\s+agentRevisionId:/);
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
  assert.doesNotMatch(preload, /previewProviderConnectionImpact\(/);
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

test("legacy Agent Revision compatibility remains internal and absent from the v1 timeline", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");

  assert.match(rendererSource, /function agentRevisionUpdateForTask\(task, profiles\)/);
  assert.match(rendererSource, /profile\.latestRevisionId === task\.agentRevisionId/);
  assert.match(rendererSource, /保存会创建 Revision/);
  assert.doesNotMatch(rendererSource, /已删除 Definition 的历史 Revision/);
  assert.match(rendererSource, /return agentChoices\.filter\(\(choice\) => choice\.id === "codex"\)/);
  const timelineStart = rendererSource.indexOf("function TaskTimeline(");
  const timelineEnd = rendererSource.indexOf("\nfunction Composer(", timelineStart);
  assert.doesNotMatch(rendererSource.slice(timelineStart, timelineEnd), /Agent 有新 Revision|使用新版创建新任务|Revision \{agentRevisionUpdate/);
});

test("renderer makes Native Session resume failure recoverable without silent fallback", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const runtime = await readFile(path.join(root, "src", "runtime.js"), "utf8");
  assert.match(renderer, /未能恢复原 Codex 会话/);
  assert.match(renderer, /重试原会话/);
  assert.match(renderer, /创建新任务/);
  const runPane = renderer.slice(renderer.indexOf("function RunPane("), renderer.indexOf("\nfunction EnvironmentGitFeedback"));
  assert.match(runPane, /会话<\/dt><dd title=/);
  assert.doesNotMatch(runPane, /Revision<\/dt>|Connection<\/dt>/);
  assert.match(runtime, /resumeSessionId: normalized\.options\.sessionId/);
  assert.match(runtime, /modelMode: normalized\.options\.modelMode/);
});

test("Native Session writers are serialized and imported copies never write the source Session", async () => {
  const main = await readFile(path.join(root, "src/electron/main.ts"), "utf8");
  const runtime = await readFile(path.join(root, "src/electron/runtime.ts"), "utf8");
  const host = await readFile(path.join(root, "src/electron/stdio-runtime.ts"), "utf8");
  const renderer = await readFile(path.join(root, "src/App.jsx"), "utf8");
  const sessionLinks = await readFile(path.join(root, "src/session-link.js"), "utf8");
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(runtime, /NATIVE_SESSION_WRITE_CONFLICT/);
  assert.match(host, /NATIVE_SESSION_WRITE_CONFLICT/);
  assert.match(renderer, /The original provider session must not be modified/);
  assert.match(sessionLinks, /link\.nativeSessionId !== importedNativeSessionId/);
  assert.match(renderer, /已导入为 Rux 独立副本/);
});

test("renderer exposes only the reference model selector in the active Composer", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const modelState = await readFile(path.join(root, "src", "model-state.js"), "utf8");
  const composerStart = renderer.indexOf("function Composer(");
  const composerEnd = renderer.indexOf("\nfunction TaskHeader(", composerStart);
  const composer = renderer.slice(composerStart, composerEnd);
  assert.match(renderer, /5\.6 Sol 中/);
  assert.doesNotMatch(composer, /高级模型 ID|手动模型 ID|Engine|切换 Agent|管理 Agent 与 Provider/);
  assert.match(composer, /role="menu" aria-label="模型与运行设置"/);
  assert.match(renderer, /已不在最新官方目录中，不会自动替换/);
  assert.match(renderer, /\^codex default\$.*Rux default/);
  assert.match(modelState, /providerConnection\?\.id !== connectionId/);
  assert.match(modelState, /model\[_ -\]not\[_ -\]found/);
  const choicesStart = renderer.indexOf("const agentChoices = useMemo(() =>");
  const choicesEnd = renderer.indexOf("const taskAgentChoices = useMemo", choicesStart);
  const choicesSource = renderer.slice(choicesStart, choicesEnd);
  assert.match(choicesSource, /return \[\{[\s\S]*id: "codex"/);
  assert.doesNotMatch(choicesSource, /agentProfiles|nativeConnections|claude-code|rux-native|mock|自定义 Agent|Provider default|Claude default/);
  assert.match(renderer, /const taskAgentChoices = useMemo\(\(\) => \{\s+return agentChoices\.filter\(\(choice\) => choice\.id === "codex"\);/);
  assert.match(renderer, /const fallback = agentChoices\.find\(\(choice\) => choice\.id === "codex" && choice\.available\)/);
});

test("renderer keeps legacy model policy internal while active Run evidence is Codex-only", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  assert.match(renderer, /Auto 简单任务模型/);
  assert.match(renderer, /Auto 复杂任务模型/);
  assert.match(renderer, /Auto 模型白名单/);
  assert.match(renderer, /未验证的手动模型不会出现在这里/);
  assert.match(renderer, /本回合模型与令牌证据/);
  const messageStart = renderer.indexOf("function Message(");
  const messageEnd = renderer.indexOf("\nfunction PermissionCard", messageStart);
  const message = renderer.slice(messageStart, messageEnd);
  assert.doesNotMatch(message, /ruxAdapterLabel\(message\.adapter\)|Auto ·|Token 未报告| tokens/);
  const runPaneStart = renderer.indexOf("function RunPane(");
  const runPaneEnd = renderer.indexOf("\nfunction EnvironmentGitFeedback", runPaneStart);
  const runPane = renderer.slice(runPaneStart, runPaneEnd);
  assert.match(runPane, /Codex 未报告本次运行的令牌用量/);
  assert.match(runPane, /缓存输入/);
  assert.match(renderer, /Rux 估算/);
  assert.doesNotMatch(runPane, /Agent|Engine|Revision|Connection|Provider|Model decision|Auto ·|Agent snapshot|Run-owned changes|immutable/);
});

test("active inspector uses localized Codex concepts without legacy product surfaces", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const changesPane = renderer.slice(renderer.indexOf("function ChangesPane("), renderer.indexOf("\nfunction ContextPane("));
  const contextPane = renderer.slice(renderer.indexOf("function ContextPane("), renderer.indexOf("\nfunction RunPane("));
  const runPane = renderer.slice(renderer.indexOf("function RunPane("), renderer.indexOf("\nfunction EnvironmentGitFeedback"));
  const inspector = renderer.slice(renderer.indexOf("function Inspector("), renderer.indexOf("\nfunction TerminalPanel("));
  assert.match(changesPane, /完成审查/);
  assert.match(contextPane, /运行上下文/);
  assert.match(runPane, /本次运行的变更/);
  assert.match(inspector, /\s变更 \{changesState/);
  assert.match(inspector, />上下文</);
  assert.match(inspector, />运行</);
  assert.doesNotMatch(`${changesPane}\n${contextPane}\n${runPane}`, /Workspace|Project instructions|Selected files|Capabilities|Provider|Agent snapshot|Run-owned changes|immutable|Restore selected|Accept review/);
});

test("active Transcript uses localized Codex lifecycle terminology", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const timeline = renderer.slice(renderer.indexOf("function TaskTimeline("), renderer.indexOf("\nfunction Composer("));
  assert.match(timeline, /Codex 正在执行这次运行/);
  assert.match(timeline, /推理摘要/);
  assert.match(timeline, /运行活动/);
  assert.match(timeline, /计划 \{doneCount\} \/ \{task\.plan\.length\}/);
  assert.match(timeline, /本次运行证据/);
  assert.doesNotMatch(timeline, /Reasoning summary|Runtime 活动|Plan \{| turn`|基线归属|Rux 新 Session|Native Session|Run 已停止|Agent 进程/);
});

test("approval and Restore confirmations use localized Codex safety copy", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const permission = renderer.slice(renderer.indexOf("function PermissionCard("), renderer.indexOf("\nfunction WorkspaceChangesCard"));
  const restore = renderer.slice(renderer.indexOf("function RestoreDialog("), renderer.indexOf("\nconst emptyAgentDraft"));
  assert.match(permission, /允许 Codex 运行此命令/);
  assert.match(permission, /仅本次运行/);
  assert.doesNotMatch(permission, /允许 Rux|Workspace 文件|仅本次 Run|Rux 工作区批准/);
  assert.match(restore, /确认恢复/);
  assert.match(restore, /Git 暂存区会原样保留/);
  assert.match(restore, /永久删除未跟踪文件/);
  assert.doesNotMatch(restore, /确认 Restore|worktree 路径|staged index|Git snapshot|正在 Restore/);
});

test("active Environment uses localized Git and context terminology", async () => {
  const renderer = await readFile(path.join(root, "src", "App.jsx"), "utf8");
  const environment = renderer.slice(renderer.indexOf("function EnvironmentPane("), renderer.indexOf("\nfunction Inspector("));
  assert.match(environment, /提交已暂存变更/);
  assert.match(environment, /当前运行正在占用工作区/);
  assert.match(environment, /在上下文中查看全部/);
  assert.match(environment, /运行边界会检查路径与敏感文件/);
  assert.doesNotMatch(environment, /Commit message|个 staged 文件|提交 staged|说明这次 staged|Run Context|Run 正在占用|commit 或 push|force push|现有 upstream|没有现有 upstream|Runtime 会检查|Run 的 Context|在 Context 中查看|>binary<|比较 patch/);
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
  assert.doesNotMatch(mainSource, /backgroundImprovementTimer|backgroundImprovementRunning|maybeRunBackgroundImprovementEvaluation|improvement-background/);
  for (const source of [runtimeSource, hostSource]) {
    assert.match(source, /runsWithPossibleWorkspaceChanges/);
    assert.match(source, /gitChanges\.unchangedRunPatch\(baseline\)/);
    assert.match(source, /case "git\.worktree\.create"/);
  }
});
