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
  const accountsEnd = rendererSource.indexOf("\nfunction CodexSettingsDialog", accountsStart);
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

  assert.match(webRuntimeSource, /showcasePreview \? changedFiles : \[\]/);
});

test("renderer keeps Agent setup actionable and resumes the selected task session", async () => {
  const rendererSource = await readFile(path.join(root, "src/App.jsx"), "utf8");

  assert.match(rendererSource, /className="composer-agent-select" aria-label="选择 Agent"/);
  assert.match(rendererSource, /className="composer-agent-warning"/);
  assert.match(rendererSource, /onClick=\{onOpenAccounts\}>账户与登录<\/button>/);
  assert.match(rendererSource, /const preflight = runPreflight\(selectedTask, prompt\)/);
  assert.match(rendererSource, /const sessionId = latestSessionIdForTask\([\s\S]*taskSnapshot\.agentRevisionId,[\s\S]*taskSnapshot\.providerConnection\?\.id/);
  assert.match(rendererSource, /model: requestedModel,\s+reasoningEffort: taskSnapshot\.reasoningEffort \|\| undefined,\s+sessionId,\s+profileId: taskSnapshot\.agentProfileId,\s+agentRevisionId:/);
  assert.match(rendererSource, /runtime\.listAgentModels\(\{ adapter: "codex", limit: 100/);
  assert.match(rendererSource, /const \[drafts, setDrafts\] = useState/);
  assert.match(rendererSource, /composerInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(rendererSource, /selectedTask\.messages\[0\]\?\.text \|\| selectedTask\.title/);
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
  const upgradeEnd = rendererSource.indexOf("\n  const selectTask =", upgradeStart);
  const upgradeSource = rendererSource.slice(upgradeStart, upgradeEnd);
  assert.doesNotMatch(upgradeSource, /selectedTask\.messages|selectedTask\.runs|selectedTask\.contextFiles|sessionId/);
  assert.doesNotMatch(upgradeSource, /map\(\(task\).*agentRevisionId/);
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
