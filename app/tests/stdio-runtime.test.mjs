import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import test from "node:test";

const hostPath = resolve("out/runtime-host/rux-runtime.mjs");

function fakeCodex(directory) {
  const executable = join(directory, process.platform === "win32" ? "codex.cmd" : "codex");
  copyFileSync(resolve("tests/fixtures/fake-codex-app-server.mjs"), executable);
  chmodSync(executable, 0o755);
  return executable;
}

function waitFor(messages, predicate, timeoutMs = 5_000) {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolveWait, rejectWait) => {
    const timeout = setTimeout(() => {
      rejectWait(new Error(`Timed out waiting for Runtime message. Received: ${JSON.stringify(messages)}`));
    }, timeoutMs);
    messages.waiters.push((message) => {
      if (!predicate(message)) return false;
      clearTimeout(timeout);
      resolveWait(message);
      return true;
    });
  });
}

test("standalone JSONL Runtime runs Codex and custom Agent profiles over stdio", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-stdio-runtime-"));
  const workspace = join(directory, "workspace");
  const stateRoot = join(directory, "state");
  const bin = join(directory, "bin");
  mkdirSync(workspace);
  mkdirSync(stateRoot);
  mkdirSync(bin);
  writeFileSync(join(workspace, "AGENTS.md"), "RUX_CONTEXT_SENTINEL: inspect evidence first.\n", "utf8");
  execFileSync("git", ["-C", workspace, "init", "--quiet"]);
  execFileSync("git", ["-C", workspace, "config", "user.name", "RUX Runtime Test"]);
  execFileSync("git", ["-C", workspace, "config", "user.email", "rux-runtime@example.invalid"]);
  execFileSync("git", ["-C", workspace, "add", "AGENTS.md"]);
  execFileSync("git", ["-C", workspace, "commit", "--quiet", "-m", "runtime fixture"]);
  execFileSync("git", ["-C", workspace, "branch", "runtime-base"]);
  writeFileSync(join(workspace, "comparison.txt"), "stdio Git compare evidence\n", "utf8");
  execFileSync("git", ["-C", workspace, "add", "comparison.txt"]);
  execFileSync("git", ["-C", workspace, "commit", "--quiet", "-m", "comparison fixture"]);
  const fixtureBranch = execFileSync("git", ["-C", workspace, "branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
  const codex = fakeCodex(bin);
  const pluginState = join(directory, "plugin-state.json");
  writeFileSync(pluginState, JSON.stringify({ documents: true, github: false }), "utf8");
  const child = spawn(process.execPath, [hostPath], {
    cwd: workspace,
    env: {
      ...process.env,
      RUX_WORKSPACE_ROOT: workspace,
      RUX_STATE_ROOT: stateRoot,
      CODEX_CLI_PATH: codex,
      CLAUDE_CODE_PATH: join(bin, "missing-claude"),
      RUX_FAKE_CODEX_SCENARIO: "runtime-echo",
      RUX_FAKE_CODEX_AUTH_METHOD: "api-key",
      RUX_FAKE_CODEX_REQUIRE_CUSTOM_PROVIDER: "1",
      RUX_FAKE_CODEX_DROP_DEFAULT_AFTER_CATALOG: "1",
      RUX_FAKE_CODEX_PLUGIN_STATE: pluginState,
      OPENAI_BASE_URL: "https://provider.example.invalid/v1",
      OPENAI_API_KEY: "sk-proj-rux-fixture-secret-123456",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  });

  const messages = [];
  messages.waiters = [];
  const stderr = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    messages.push(message);
    messages.waiters = messages.waiters.filter((waiter) => !waiter(message));
  });
  createInterface({ input: child.stderr }).on("line", (line) => stderr.push(line));
  child.on("error", (error) => stderr.push(error.message));

  const ready = await waitFor(messages, (message) =>
    message.kind === "event" && message.event.type === "runtime.ready");
  assert.equal(ready.event.status.workspaceRoot, realpathSync(workspace));

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "git-branches",
    method: "git.branches.list",
    params: {},
  })}\n`);
  const branches = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "git-branches");
  assert.equal(branches.ok, true);
  assert.equal(branches.result.currentBranch, fixtureBranch);
  assert.ok(branches.result.comparable.some((branch) => branch.name === "runtime-base"));

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "git-compare",
    method: "git.compare",
    params: { base: "runtime-base" },
  })}\n`);
  const comparison = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "git-compare");
  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.result.files.map((file) => file.path), ["comparison.txt"]);
  assert.match(comparison.result.patch, /stdio Git compare evidence/);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "git-push-unconfirmed",
    method: "git.push",
    params: {},
  })}\n`);
  const unconfirmedPush = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "git-push-unconfirmed");
  assert.equal(unconfirmedPush.ok, false);
  assert.match(unconfirmedPush.error.message, /confirmed/);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "agents",
    method: "agent.list",
    params: {},
  })}\n`);
  const agents = await waitFor(messages, (message) => message.kind === "response" && message.id === "agents");
  assert.equal(agents.ok, true);
  assert.equal(agents.result.adapters.find((adapter) => adapter.id === "codex").version, "0.144.6-fake");
  assert.equal(agents.result.adapters.some((adapter) => adapter.id === "mock"), false);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "auth-status",
    method: "auth.status",
    params: {},
  })}\n`);
  const authStatus = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "auth-status");
  assert.equal(authStatus.ok, true);
  const codexConnection = authStatus.result.providers.find((provider) => provider.id === "chatgpt");
  assert.equal(codexConnection.status, "connected");
  assert.equal(codexConnection.authMethod, "api-key");
  assert.equal(codexConnection.providerConnection.id, "cli:codex:default");
  assert.equal(codexConnection.providerConnection.engine, "codex");
  assert.equal(JSON.stringify(authStatus.result).includes("sk-proj-rux-fixture-secret"), false);
  assert.equal(JSON.stringify(authStatus.result).includes("provider.example.invalid"), false);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "agent-models",
    method: "agent.model.list",
    params: { adapter: "codex", limit: 1, includeHidden: false },
  })}\n`);
  const models = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "agent-models");
  assert.equal(models.ok, true);
  assert.equal(models.result.adapter, "codex");
  assert.equal(models.result.source, "engine-catalog");
  assert.equal(Number.isNaN(Date.parse(models.result.fetchedAt)), false);
  assert.equal(models.result.models[0].model, "fake-model");
  assert.equal(models.result.models[0].defaultReasoningEffort, "medium");
  assert.equal(models.result.nextCursor, "models-page-2");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "plugin-list",
    method: "plugin.list",
    params: {},
  })}\n`);
  const plugins = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "plugin-list");
  assert.equal(plugins.ok, true);
  assert.deepEqual(plugins.result.installed.map((plugin) => plugin.pluginId), ["documents@openai-primary-runtime"]);
  assert.deepEqual(plugins.result.available.map((plugin) => plugin.pluginId), ["github@openai-curated"]);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "external-config-detect", method: "externalConfig.detect", params: { source: "cursor" } })}\n`);
  const externalDetect = await waitFor(messages, (message) => message.kind === "response" && message.id === "external-config-detect");
  assert.equal(externalDetect.ok, true);
  assert.equal(externalDetect.result.source, "cursor");
  assert.equal(externalDetect.result.items.length, 3);
  child.stdin.write(`${JSON.stringify({ kind: "request", id: "external-config-import", method: "externalConfig.import", params: { source: "cursor", detectionId: externalDetect.result.detectionId, itemIds: [externalDetect.result.items[0].id], confirmed: true } })}\n`);
  const externalImport = await waitFor(messages, (message) => message.kind === "response" && message.id === "external-config-import");
  assert.equal(externalImport.ok, true);
  assert.equal(externalImport.result.successes.length, 1);
  child.stdin.write(`${JSON.stringify({ kind: "request", id: "external-config-history", method: "externalConfig.history", params: {} })}\n`);
  const externalHistory = await waitFor(messages, (message) => message.kind === "response" && message.id === "external-config-history");
  assert.equal(externalHistory.ok, true);
  assert.equal(externalHistory.result.records[0].source, "cursor");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "session-list",
    method: "session.list",
    params: {
      operationId: "stdio-session-list",
      engine: "codex",
      providerConnection: codexConnection.providerConnection,
      limit: 1,
    },
  })}\n`);
  const sessionList = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "session-list");
  assert.equal(sessionList.ok, true);
  assert.equal(sessionList.result.sessions[0].nativeSessionId, "thread-discovered-1");
  assert.equal(sessionList.result.nextCursor, "threads-page-2");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "session-discover",
    method: "session.discover",
    params: {
      operationId: "stdio-session-discover",
      engine: "codex",
      providerConnection: codexConnection.providerConnection,
      activeWorkspaceId: createHash("sha256").update(realpathSync(workspace)).digest("hex").slice(0, 12),
      limit: 1,
    },
  })}\n`);
  const sessionDiscovery = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "session-discover");
  assert.equal(sessionDiscovery.ok, true);
  assert.equal(sessionDiscovery.result.current[0].metadata.nativeSessionId, "thread-discovered-1");
  assert.deepEqual(sessionDiscovery.result.unassigned, []);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "session-read",
    method: "session.read",
    params: {
      operationId: "stdio-session-read",
      engine: "codex",
      providerConnection: codexConnection.providerConnection,
      nativeSessionId: "thread-discovered-1",
      limit: 50,
    },
  })}\n`);
  const sessionRead = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "session-read");
  assert.equal(sessionRead.ok, true);
  assert.deepEqual(sessionRead.result.messages.map((message) => message.role), ["user", "assistant"]);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "session-resume-check",
    method: "session.resume.check",
    params: {
      operationId: "stdio-session-resume-check",
      engine: "codex",
      providerConnection: codexConnection.providerConnection,
      nativeSessionId: "thread-discovered-1",
    },
  })}\n`);
  const sessionResume = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "session-resume-check");
  assert.equal(sessionResume.ok, true);
  assert.equal(sessionResume.result.status, "available");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "task-load",
    method: "task.state.load",
    params: {},
  })}\n`);
  const loaded = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "task-load");
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.result.tasks, []);
  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "task-save",
    method: "task.state.save",
    params: {
      ...loaded.result,
      updatedAt: "2026-08-10T12:00:00.000Z",
    },
  })}\n`);
  const saved = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "task-save");
  assert.equal(saved.ok, true);
  assert.equal(saved.result.updatedAt, "2026-08-10T12:00:00.000Z");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "session-import",
    method: "session.import",
    params: {
      operationId: "stdio-session-import",
      engine: "codex",
      providerConnection: codexConnection.providerConnection,
      activeWorkspaceId: createHash("sha256").update(realpathSync(workspace)).digest("hex").slice(0, 12),
      nativeSessionId: "thread-discovered-1",
      limit: 50,
      mode: "copy",
    },
  })}\n`);
  const imported = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "session-import");
  assert.equal(imported.ok, true);
  assert.equal(imported.result.created, true);
  assert.equal(imported.result.task.importedSession.mode, "copy");
  assert.equal(imported.result.task.importedSession.sessionLink.nativeSessionId, "thread-discovered-1");

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "task-load-imported", method: "task.state.load", params: {} })}\n`);
  const loadedImported = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "task-load-imported");
  assert.equal(loadedImported.ok, true);
  assert.equal(loadedImported.result.tasks.length, 1);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "session-refresh", method: "session.refresh", params: { taskId: imported.result.task.id, operationId: "refresh-imported-session" } })}\n`);
  const refreshed = await waitFor(messages, (message) => message.kind === "response" && message.id === "session-refresh");
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.result.task.id, imported.result.task.id);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "session-revisions", method: "session.revision.list", params: { taskId: imported.result.task.id } })}\n`);
  const revisions = await waitFor(messages, (message) => message.kind === "response" && message.id === "session-revisions");
  assert.equal(revisions.ok, true);
  assert.ok(revisions.result.revisions.length >= 1);

  const importedMessageIds = imported.result.task.messages.map((message) => message.id);
  child.stdin.write(`${JSON.stringify({ kind: "request", id: "handoff-preview", method: "handoff.preview", params: { sourceTaskId: imported.result.task.id, targetAgentId: "claude-code", messageIds: importedMessageIds, filePaths: [] } })}\n`);
  const handoffPreview = await waitFor(messages, (message) => message.kind === "response" && message.id === "handoff-preview");
  assert.equal(handoffPreview.ok, true);
  assert.equal(handoffPreview.result.target.adapter, "claude-code");
  assert.equal(handoffPreview.result.facts.messages.length, importedMessageIds.length);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "handoff-summary", method: "handoff.summary.generate", params: { sourceTaskId: imported.result.task.id, targetAgentId: "claude-code", messageIds: importedMessageIds, filePaths: [], fingerprint: handoffPreview.result.fingerprint } })}\n`);
  const handoffSummary = await waitFor(messages, (message) => message.kind === "response" && message.id === "handoff-summary", 10_000);
  assert.equal(handoffSummary.ok, true);
  assert.equal(handoffSummary.result.provenance.isolated, true);
  assert.equal(handoffSummary.result.provenance.nativeSessionPersisted, false);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "handoff-commit", method: "handoff.commit", params: { sourceTaskId: imported.result.task.id, targetAgentId: "claude-code", messageIds: importedMessageIds, filePaths: [], fingerprint: handoffPreview.result.fingerprint, agentSummary: handoffSummary.result.summary, agentSummaryGenerationId: handoffSummary.result.generationId, confirmed: true } })}\n`);
  const handoffCommit = await waitFor(messages, (message) => message.kind === "response" && message.id === "handoff-commit");
  assert.equal(handoffCommit.ok, true);
  assert.equal(handoffCommit.result.targetTask.adapter, "claude-code");
  assert.equal(handoffCommit.result.targetTask.runs.length, 0);
  assert.equal(handoffCommit.result.snapshot.agentSummaryProvenance.isolated, true);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "local-data-summary", method: "local.data.summary", params: {} })}\n`);
  const localDataSummary = await waitFor(messages, (message) => message.kind === "response" && message.id === "local-data-summary");
  assert.equal(localDataSummary.ok, true);
  assert.equal(localDataSummary.result.importedTaskCount, 1);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "local-data-preview", method: "local.data.preview", params: { scope: "task", taskId: imported.result.task.id, action: "unlink" } })}\n`);
  const localDataPreview = await waitFor(messages, (message) => message.kind === "response" && message.id === "local-data-preview");
  assert.equal(localDataPreview.ok, true);
  assert.equal(localDataPreview.result.nativeSessions[0].nativeSessionId, "thread-discovered-1");

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "local-data-execute", method: "local.data.execute", params: { scope: "task", taskId: imported.result.task.id, action: "unlink", fingerprint: localDataPreview.result.fingerprint, confirmed: true } })}\n`);
  const localDataExecute = await waitFor(messages, (message) => message.kind === "response" && message.id === "local-data-execute");
  assert.equal(localDataExecute.ok, true);
  assert.equal(localDataExecute.result.action, "unlink");

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "local-data-export", method: "local.data.export", params: { scope: "workspace", format: "json", revisions: "all", destination: "rux-export.json", confirmedSensitiveContent: true } })}\n`);
  const localDataExport = await waitFor(messages, (message) => message.kind === "response" && message.id === "local-data-export");
  assert.equal(localDataExport.ok, true);
  assert.equal(localDataExport.result.filePath, join(realpathSync(workspace), "rux-export.json"));
  assert.ok(localDataExport.result.bytes > 0);
  const exportText = readFileSync(join(workspace, "rux-export.json"), "utf8");
  assert.match(exportText, /thread-discovered-1/);
  assert.doesNotMatch(exportText, /sk-proj-rux-fixture-secret/);

  child.stdin.write(`${JSON.stringify({ kind: "request", id: "local-data-export-overwrite", method: "local.data.export", params: { scope: "workspace", format: "json", revisions: "all", destination: "rux-export.json", confirmedSensitiveContent: true } })}\n`);
  const overwriteExport = await waitFor(messages, (message) => message.kind === "response" && message.id === "local-data-export-overwrite");
  assert.equal(overwriteExport.ok, false);
  assert.match(overwriteExport.error.message, /refusing to overwrite/);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "context-outside",
    method: "context.snapshot",
    params: { selectedFiles: ["../secret.txt"] },
  })}\n`);
  const outsideContext = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "context-outside");
  assert.equal(outsideContext.ok, false);
  assert.match(outsideContext.error.message, /outside the active workspace/);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "profile-create",
    method: "agent.profile.create",
    params: {
      name: "Review Agent",
      backend: "codex",
      model: "fake-model",
      modelSource: "engine-catalog",
      modelVerificationStatus: "not-required",
      autoModelPolicy: {
        simpleModel: { model: "fake-model", source: "engine-catalog" },
        complexModel: { model: "fake-fast", source: "engine-catalog" },
        strategy: "balanced",
        fallbackEnabled: true,
        allowlist: [
          { model: "fake-model", source: "engine-catalog" },
          { model: "fake-fast", source: "engine-catalog" },
        ],
      },
      reasoningEffort: "high",
      instructions: "Always review the evidence first.",
      permissionMode: "plan",
    },
  })}\n`);
  const created = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "profile-create");
  assert.equal(created.ok, true);
  assert.equal(created.result.providerConnection.id, "cli:codex:default");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "profile-create-unverified-auto",
    method: "agent.profile.create",
    params: {
      name: "Invalid Auto Agent",
      backend: "codex",
      instructions: "This save must fail closed.",
      autoModelPolicy: {
        simpleModel: { model: "unverified-manual", source: "verified-history" },
        complexModel: { model: "unverified-manual", source: "verified-history" },
        strategy: "balanced",
        fallbackEnabled: true,
        allowlist: [{ model: "unverified-manual", source: "verified-history" }],
      },
    },
  })}\n`);
  const unverifiedAuto = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "profile-create-unverified-auto");
  assert.equal(unverifiedAuto.ok, false);
  assert.match(unverifiedAuto.error.message, /verified Connection history/);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "profile-update",
    method: "agent.profile.update",
    params: {
      id: created.result.id,
      patch: {
        instructions: "Use the second immutable policy.",
        permissionMode: "dontAsk",
      },
    },
  })}\n`);
  const updated = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "profile-update");
  assert.equal(updated.ok, true);
  assert.equal(updated.result.revisionNumber, 2);
  assert.notEqual(updated.result.latestRevisionId, created.result.latestRevisionId);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "profile-delete",
    method: "agent.profile.delete",
    params: { id: created.result.id },
  })}\n`);
  const deleted = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "profile-delete");
  assert.equal(deleted.ok, true);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "run-start",
    method: "run.start",
    params: {
      runId: "stdio-run",
      adapter: "codex",
      prompt: "Only report the result.",
      modelMode: "auto",
      permissionMode: "plan",
      profileId: created.result.id,
      agentRevisionId: created.result.latestRevisionId,
      contextFiles: ["AGENTS.md"],
    },
  })}\n`);

  const completed = await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "run.completed"
      && message.event.runId === "stdio-run");
  assert.equal(completed.event.runId, "stdio-run");
  const started = messages.find((message) =>
    message.kind === "event" && message.event.type === "run.started" && message.event.runId === "stdio-run");
  assert.equal(started.event.adapter, "codex");
  assert.equal(started.event.permissionMode, "plan");
  assert.equal(started.event.model, "fake-fast");
  assert.equal(started.event.reasoningEffort, "high");
  assert.equal(started.event.profileId, created.result.id);
  assert.equal(started.event.agentRevisionId, created.result.latestRevisionId);
  const decision = messages.find((message) =>
    message.kind === "event" && message.event.type === "run.model-decision" && message.event.runId === "stdio-run");
  assert.equal(decision.event.decision.mode, "auto");
  assert.equal(decision.event.decision.classification, "simple");
  assert.equal(decision.event.decision.actualModel, "fake-fast");
  assert.deepEqual(decision.event.decision.allowlist, ["fake-model", "fake-fast"]);
  assert.deepEqual(decision.event.decision.fallback, {
    fromModel: "fake-model",
    toModel: "fake-fast",
    reason: "原选择模型已不在当前 Engine 目录或 Connection 验证历史中",
  });
  const agentSnapshot = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.agent-snapshot"
      && message.event.runId === "stdio-run");
  assert.equal(agentSnapshot.event.profile.id, created.result.latestRevisionId);
  assert.equal(agentSnapshot.event.profile.profileId, created.result.id);
  assert.equal(agentSnapshot.event.profile.instructions, "Always review the evidence first.");
  assert.equal(agentSnapshot.event.profile.permissionMode, "plan");
  assert.equal(agentSnapshot.event.profile.reasoningEffort, "high");
  const contextSnapshot = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.context-snapshot"
      && message.event.runId === "stdio-run");
  assert.equal(contextSnapshot.event.snapshot.instructions[0].path, "AGENTS.md");
  assert.match(contextSnapshot.event.snapshot.instructions[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(contextSnapshot.event.snapshot.instructions[0].content, /RUX_CONTEXT_SENTINEL/);
  const gitBaseline = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.git-baseline"
      && message.event.runId === "stdio-run");
  const gitPatch = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.git-patch"
      && message.event.runId === "stdio-run");
  assert.match(gitBaseline.event.baseline.treeId, /^[a-f0-9]{40,64}$/);
  assert.equal(gitBaseline.event.baseline.ignoredFilesExcluded, true);
  assert.equal(gitPatch.event.patch.baselineId, gitBaseline.event.baseline.id);
  assert.deepEqual(gitPatch.event.patch.files, []);
  assert.equal(gitPatch.event.patch.totals.files, 0);
  const baselineIndex = messages.indexOf(gitBaseline);
  const patchIndex = messages.indexOf(gitPatch);
  const completedIndex = messages.indexOf(completed);
  assert.ok(baselineIndex < patchIndex);
  assert.ok(patchIndex < completedIndex);
  const assistant = messages.find((message) =>
    message.kind === "event" && message.event.type === "assistant.message" && message.event.runId === "stdio-run");
  assert.match(assistant.event.text, /Always review the evidence first/);
  assert.match(assistant.event.text, /RUX_CONTEXT_SENTINEL/);
  assert.match(assistant.event.text, /Only report the result/);
  assert.doesNotMatch(assistant.event.text, /second immutable policy/);
  assert.ok(messages.some((message) =>
    message.kind === "event" && message.event.type === "run.metadata" && message.event.sessionId === "thread-runtime-1"));
  const verification = messages.find((message) =>
    message.kind === "event" && message.event.type === "verification.recorded" && message.event.runId === "stdio-run");
  assert.equal(verification.event.verification.status, "passed");
  assert.equal(verification.event.verification.cwd, realpathSync(workspace));

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "review-start",
    method: "run.start",
    params: {
      runId: "stdio-review",
      adapter: "codex",
      prompt: "/review · 未提交变更",
      modelMode: "fixed",
      permissionMode: "plan",
      agentRevisionId: "builtin:codex@1",
      providerConnectionId: "cli:codex:default",
      contextFiles: [],
      reviewTarget: { type: "uncommittedChanges" },
    },
  })}\n`);
  const inlineReviewCompleted = await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "run.completed"
      && message.event.runId === "stdio-review");
  assert.equal(inlineReviewCompleted.event.runId, "stdio-review");
  const inlineReviewAssistant = messages.find((message) =>
    message.kind === "event" && message.event.type === "assistant.message" && message.event.runId === "stdio-review");
  assert.equal(inlineReviewAssistant.event.text, "[P1] Review finding from the selected diff");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "run-latest-deleted-definition",
    method: "run.start",
    params: {
      runId: "stdio-run-latest",
      adapter: "codex",
      prompt: "Use the latest retained Revision.",
      permissionMode: "dontAsk",
      profileId: created.result.id,
      agentRevisionId: updated.result.latestRevisionId,
      contextFiles: [],
    },
  })}\n`);
  await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "run.completed"
      && message.event.runId === "stdio-run-latest");
  const latestSnapshot = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.agent-snapshot"
      && message.event.runId === "stdio-run-latest");
  assert.equal(latestSnapshot.event.profile.id, updated.result.latestRevisionId);
  assert.equal(latestSnapshot.event.profile.instructions, "Use the second immutable policy.");
  assert.equal(latestSnapshot.event.profile.permissionMode, "dontAsk");
  const persistedProviderState = [
    readFileSync(join(stateRoot, "agent-profiles.json")),
    readFileSync(join(stateRoot, "rux-task-state.sqlite3")),
  ].map((contents) => contents.toString("utf8")).join("\n");
  assert.equal(persistedProviderState.includes("sk-proj-rux-fixture-secret"), false);
  assert.equal(persistedProviderState.includes("provider.example.invalid"), false);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "run-review-start",
    method: "run.start",
    params: {
      runId: "runtime-review-run",
      adapter: "codex",
      prompt: "Create immutable Run review evidence.",
      permissionMode: "plan",
      agentRevisionId: "builtin:codex@1",
      contextFiles: [],
    },
  })}\n`);
  const reviewCompleted = await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "run.completed"
      && message.event.runId === "runtime-review-run");
  const reviewBaseline = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.git-baseline"
      && message.event.runId === "runtime-review-run");
  const reviewPatch = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.git-patch"
      && message.event.runId === "runtime-review-run");
  assert.ok(reviewBaseline);
  assert.ok(reviewPatch);
  assert.ok(messages.indexOf(reviewPatch) < messages.indexOf(reviewCompleted));
  assert.deepEqual(reviewPatch.event.patch.files.map((file) => file.path), ["runtime-review.txt"]);

  writeFileSync(
    join(workspace, "runtime-review.txt"),
    "runtime run evidence\npost-run workspace drift\n",
    "utf8",
  );
  const indexBeforeReview = readFileSync(join(workspace, ".git", "index"));
  const worktreeBeforeReview = readFileSync(join(workspace, "runtime-review.txt"));
  const runReviewSelection = {
    baseline: reviewBaseline.event.baseline,
    patch: reviewPatch.event.patch,
    expectedSnapshotId: reviewPatch.event.patch.snapshotId,
  };

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "run-review-diff",
    method: "run.changes.diff",
    params: { ...runReviewSelection, path: "runtime-review.txt" },
  })}\n`);
  const reviewDiff = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "run-review-diff");
  assert.equal(reviewDiff.ok, true);
  assert.equal(reviewDiff.result.runId, "runtime-review-run");
  assert.equal(reviewDiff.result.runPatchSnapshotId, reviewPatch.event.patch.snapshotId);
  assert.match(reviewDiff.result.patch, /^\+runtime run evidence$/m);
  assert.doesNotMatch(reviewDiff.result.patch, /post-run workspace drift/);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "run-review-accept-stale",
    method: "run.changes.accept",
    params: { ...runReviewSelection, expectedSnapshotId: "0".repeat(64) },
  })}\n`);
  const staleAcceptance = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "run-review-accept-stale");
  assert.equal(staleAcceptance.ok, false);
  assert.equal(staleAcceptance.error.code, "STALE_RUN_PATCH");

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "run-review-accept",
    method: "run.changes.accept",
    params: runReviewSelection,
  })}\n`);
  const reviewAcceptance = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "run-review-accept");
  assert.equal(reviewAcceptance.ok, true);
  assert.equal(reviewAcceptance.result.semantics, "review-only");
  assert.equal(reviewAcceptance.result.runId, "runtime-review-run");
  assert.equal(reviewAcceptance.result.snapshotId, reviewPatch.event.patch.snapshotId);
  assert.equal(reviewAcceptance.result.runPatchSnapshotId, reviewPatch.event.patch.snapshotId);
  assert.deepEqual(reviewAcceptance.result.paths, ["runtime-review.txt"]);
  assert.equal(reviewAcceptance.result.additions, 1);
  assert.equal(reviewAcceptance.result.deletions, 0);
  assert.deepEqual(readFileSync(join(workspace, ".git", "index")), indexBeforeReview);
  assert.deepEqual(readFileSync(join(workspace, "runtime-review.txt")), worktreeBeforeReview);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "permission-approved-start",
    method: "run.start",
    params: {
      runId: "permission-approved-run",
      adapter: "codex",
      prompt: "Proceed after approval.",
      permissionMode: "acceptEdits",
      model: "fake-model",
      reasoningEffort: "high",
      agentRevisionId: "builtin:codex@1",
      contextFiles: [],
    },
  })}\n`);
  const providerRequest = await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "permission.requested"
      && message.event.runId === "permission-approved-run");
  assert.equal(providerRequest.event.request.provider, "codex");
  assert.equal(providerRequest.event.request.action, "command.execute");
  assert.equal(providerRequest.event.request.scope.path, "npm run package");
  assert.equal(providerRequest.event.request.scope.appliesTo, "single-action");
  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "provider-permission-approve",
    method: "permission.decide",
    params: {
      runId: "permission-approved-run",
      requestId: providerRequest.event.request.id,
      decision: "approved",
    },
  })}\n`);
  const providerDecision = await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "permission.decided"
      && message.event.runId === "permission-approved-run"
      && message.event.decision.requestId === providerRequest.event.request.id);
  assert.equal(providerDecision.event.decision.decision, "approved");
  const approvedCompleted = await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "run.completed"
      && message.event.runId === "permission-approved-run");
  const approvedStarted = messages.find((message) =>
    message.kind === "event"
      && message.event.type === "run.started"
      && message.event.runId === "permission-approved-run");
  assert.equal(approvedStarted.event.model, "fake-model");
  assert.equal(approvedStarted.event.reasoningEffort, "high");
  assert.equal(messages.some((message) => message.kind === "event"
    && message.event.type === "permission.requested"
    && message.event.runId === "permission-approved-run"
    && message.event.request.action === "workspace.write"), false);
  assert.ok(messages.indexOf(approvedStarted) < messages.indexOf(providerRequest));
  assert.ok(messages.indexOf(providerRequest) < messages.indexOf(providerDecision));
  assert.ok(messages.indexOf(approvedStarted) < messages.indexOf(approvedCompleted));

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "permission-stop-start",
    method: "run.start",
    params: {
      runId: "permission-stop-run",
      adapter: "codex",
      prompt: "Wait and stop.",
      permissionMode: "acceptEdits",
      agentRevisionId: "builtin:codex@1",
      contextFiles: [],
    },
  })}\n`);
  await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "permission.requested"
      && message.event.runId === "permission-stop-run");
  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "permission-stop",
    method: "run.cancel",
    params: { runId: "permission-stop-run" },
  })}\n`);
  const stoppedDecision = await waitFor(messages, (message) =>
    message.kind === "event"
      && message.event.type === "permission.decided"
      && message.event.runId === "permission-stop-run");
  assert.equal(stoppedDecision.event.decision.decision, "cancelled");
  await waitFor(messages, (message) =>
    message.kind === "event" && message.event.type === "run.cancelled" && message.event.runId === "permission-stop-run");
  assert.equal(messages.some((message) =>
    message.kind === "event" && message.event.type === "run.started" && message.event.runId === "permission-stop-run"), true);
  assert.deepEqual(stderr, []);

  child.stdin.write(`${JSON.stringify({
    kind: "request",
    id: "runtime-shutdown",
    method: "runtime.shutdown",
    params: { reason: "standalone Runtime test complete" },
  })}\n`);
  const shutdown = await waitFor(messages, (message) =>
    message.kind === "response" && message.id === "runtime-shutdown");
  assert.deepEqual(shutdown, {
    kind: "response",
    id: "runtime-shutdown",
    ok: true,
    result: { ok: true },
  });
  await new Promise((resolveExit, rejectExit) => {
    child.once("exit", (code) => code === 0
      ? resolveExit()
      : rejectExit(new Error(`Runtime host exited with ${code}: ${stderr.join("\n")}`)));
  });
});
