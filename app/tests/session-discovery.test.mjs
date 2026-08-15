import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  canonicalAuthorizedWorkspaces,
  matchAuthorizedWorkspace,
  SessionAttributionStore,
  SessionDiscoveryService,
  sessionIdentityKey,
} from "../src/electron/session-discovery.ts";
import { officialCliProviderConnection } from "../src/shared/protocol.ts";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rux-session-discovery-"));
  const parent = join(root, "project");
  const child = join(parent, "packages", "child");
  const prefixSibling = join(root, "project-copy");
  const outside = join(root, "outside");
  mkdirSync(child, { recursive: true });
  mkdirSync(prefixSibling);
  mkdirSync(outside);
  const alias = join(root, "child-alias");
  symlinkSync(child, alias, "dir");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, parent, child, prefixSibling, outside, alias };
}

function metadata(nativeSessionId, cwd) {
  return {
    engine: "codex",
    providerConnectionId: "cli:codex:default",
    nativeSessionId,
    ...(cwd ? { cwd } : {}),
    title: nativeSessionId,
    resumeStatus: "available",
  };
}

test("canonical attribution uses realpath, component boundaries, and the most specific Workspace", (t) => {
  const paths = fixture(t);
  const workspaces = canonicalAuthorizedWorkspaces([
    { id: "parent", name: "Parent", path: paths.parent },
    { id: "child", name: "Child", path: paths.child },
    { id: "child-alias", name: "Alias", path: paths.alias },
  ], "child");
  assert.equal(workspaces.length, 2, "symlink aliases must collapse to one canonical Workspace");
  assert.equal(matchAuthorizedWorkspace(paths.child, workspaces).workspace.id, "child");
  assert.equal(matchAuthorizedWorkspace(paths.alias, workspaces).workspace.id, "child");
  assert.equal(matchAuthorizedWorkspace(paths.prefixSibling, workspaces).kind, "authorization-required");
  assert.equal(matchAuthorizedWorkspace(undefined, workspaces).kind, "unassigned");
  assert.equal(matchAuthorizedWorkspace(join(paths.root, "missing"), workspaces).kind, "unassigned");
});

test("discovery returns only current Workspace metadata plus explicit unassigned and authorization-required groups", async (t) => {
  const paths = fixture(t);
  let listCalls = 0;
  const connectors = {
    async list() {
      listCalls += 1;
      return {
        engine: "codex",
        sessions: [
          metadata("current", paths.child),
          metadata("other", paths.parent),
          metadata("unassigned"),
          metadata("outside", paths.outside),
          metadata("current", paths.child),
        ],
      };
    },
  };
  const store = new SessionAttributionStore(join(paths.root, "state", "attribution.sqlite3"));
  t.after(() => store.close());
  const service = new SessionDiscoveryService(connectors, [
    { id: "parent", name: "Parent", path: paths.parent },
    { id: "child", name: "Child", path: paths.child },
  ], store);
  const result = await service.discover({
    operationId: "discover-1",
    engine: "codex",
    providerConnection: officialCliProviderConnection("codex"),
    activeWorkspaceId: "child",
    limit: 100,
  });
  assert.equal(listCalls, 1, "discovery must fetch metadata only once and never read transcript content");
  assert.deepEqual(result.current.map((item) => item.metadata.nativeSessionId), ["current"]);
  assert.deepEqual(result.unassigned.map((item) => item.metadata.nativeSessionId), ["unassigned"]);
  assert.deepEqual(result.authorizationRequired.map((item) => item.metadata.nativeSessionId), ["outside"]);
  assert.deepEqual(result.migrationSuggestions, []);
  assert.equal(result.current[0].identityKey, sessionIdentityKey(metadata("current", paths.child)));
  assert.equal(JSON.stringify(result).includes('"other"'), false, "sessions assigned to another Workspace stay hidden");
});

test("a newly authorized child Workspace produces a migration suggestion without changing the stored assignment", async (t) => {
  const paths = fixture(t);
  const databasePath = join(paths.root, "state", "attribution.sqlite3");
  const store = new SessionAttributionStore(databasePath);
  t.after(() => store.close());
  const connectors = { async list() { return { engine: "codex", sessions: [metadata("nested", paths.child)] }; } };
  const params = {
    operationId: "discover-parent",
    engine: "codex",
    providerConnection: officialCliProviderConnection("codex"),
    activeWorkspaceId: "parent",
    limit: 50,
  };
  const initial = await new SessionDiscoveryService(connectors, [
    { id: "parent", name: "Parent", path: paths.parent },
  ], store).discover(params);
  assert.deepEqual(initial.current.map((item) => item.metadata.nativeSessionId), ["nested"]);

  const nestedKey = initial.current[0].identityKey;
  const withChild = new SessionDiscoveryService(connectors, [
    { id: "parent", name: "Parent", path: paths.parent },
    { id: "child", name: "Child", path: paths.child },
  ], store);
  const suggested = await withChild.discover({ ...params, operationId: "discover-child", activeWorkspaceId: "child" });
  assert.equal(suggested.current.length, 0);
  assert.equal(suggested.migrationSuggestions[0].attribution.previousWorkspaceId, "parent");
  assert.equal(suggested.migrationSuggestions[0].attribution.workspaceId, "child");
  assert.equal(store.get(nestedKey).workspace_id, "parent", "discovery must not silently migrate ownership");

  const migrated = withChild.migrateAttribution({
    identityKey: nestedKey,
    expectedPreviousWorkspaceId: "parent",
    targetWorkspaceId: "child",
    confirmed: true,
  });
  assert.equal(migrated.workspaceId, "child");
  assert.equal(store.get(nestedKey).workspace_id, "child");
  assert.deepEqual(store.audits(nestedKey).map((audit) => ({
    previousWorkspaceId: audit.previous_workspace_id,
    workspaceId: audit.workspace_id,
  })), [{ previousWorkspaceId: "parent", workspaceId: "child" }]);
  assert.throws(() => withChild.migrateAttribution({
    identityKey: nestedKey,
    expectedPreviousWorkspaceId: "parent",
    targetWorkspaceId: "child",
    confirmed: true,
  }), (error) => error.code === "SESSION_MIGRATION_STALE");
});

test("discovery rejects a Workspace id absent from the privileged authorization snapshot", async (t) => {
  const paths = fixture(t);
  const store = new SessionAttributionStore(join(paths.root, "state", "attribution.sqlite3"));
  t.after(() => store.close());
  const service = new SessionDiscoveryService({ async list() { throw new Error("must not call provider"); } }, [
    { id: "parent", name: "Parent", path: paths.parent },
  ], store);
  await assert.rejects(service.discover({
    operationId: "unauthorized",
    engine: "codex",
    providerConnection: officialCliProviderConnection("codex"),
    activeWorkspaceId: "forged",
    limit: 50,
  }), (error) => error.code === "SESSION_WORKSPACE_UNAUTHORIZED");
});

test("preview reads content only after discovery, revalidates Workspace attribution, and checks resume", async (t) => {
  const paths = fixture(t);
  const calls = [];
  const connectors = {
    async list() {
      calls.push("list");
      return { engine: "codex", sessions: [metadata("thread-preview", paths.child)] };
    },
    async read(params) {
      calls.push(`read:${params.cursor ?? "first"}`);
      return {
        metadata: metadata("thread-preview", paths.child),
        messages: [{ id: params.cursor ? "m2" : "m1", role: params.cursor ? "assistant" : "user", content: [{ type: "text", text: params.cursor ? "world" : "hello" }] }],
        ...(params.cursor ? {} : { nextCursor: "1" }),
        truncated: !params.cursor,
      };
    },
    async readAll(params) {
      const first = await this.read(params);
      const second = await this.read({ ...params, cursor: first.nextCursor });
      return { metadata: second.metadata, messages: [...first.messages, ...second.messages], truncated: false };
    },
    async checkResume() {
      calls.push("resume");
      return { engine: "codex", providerConnectionId: "cli:codex:default", nativeSessionId: "thread-preview", status: "available" };
    },
  };
  const store = new SessionAttributionStore(join(paths.root, "state", "preview.sqlite3"));
  t.after(() => store.close());
  const service = new SessionDiscoveryService(connectors, [{ id: "child", name: "Child", path: paths.child }], store);
  const params = {
    operationId: "preview-1",
    engine: "codex",
    providerConnection: officialCliProviderConnection("codex"),
    activeWorkspaceId: "child",
    nativeSessionId: "thread-preview",
    limit: 100,
  };
  await assert.rejects(service.preview(params), (error) => error.code === "SESSION_NOT_ASSIGNED_TO_ACTIVE_WORKSPACE");
  assert.deepEqual(calls, [], "preview must not read an undiscovered or unassigned Session");
  await service.discover({ ...params, operationId: "discover-preview" });
  assert.deepEqual(calls, ["list"]);
  const preview = await service.preview(params);
  assert.deepEqual(preview.messages.map((message) => message.id), ["m1", "m2"]);
  assert.equal(preview.resume.status, "available");
  assert.deepEqual(calls, ["list", "read:first", "read:1", "resume"]);
});
