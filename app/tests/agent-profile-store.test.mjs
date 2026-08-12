import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentProfileStore } from "../src/electron/agent-profile-store.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rux-agent-profiles-"));
  const file = join(directory, "agents.json");
  let tick = 0;
  const store = new AgentProfileStore(file, {
    clock: () => new Date(`2026-08-10T00:00:0${tick++}.000Z`),
    idFactory: () => "00000000-0000-4000-8000-000000000001",
  });
  return {
    directory,
    file,
    store,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const example = {
  name: "Review specialist",
  description: "Reviews a completed implementation before handoff.",
  backend: "claude-code",
  model: "sonnet",
  reasoningEffort: "high",
  instructions: "Review the diff, run focused tests, and report only evidenced findings.",
  permissionMode: "plan",
  skillIds: ["review/code"],
  toolIds: ["git"],
};

test("creates, persists, and reloads a custom Agent profile", (t) => {
  const { directory, file, store, cleanup } = fixture();
  t.after(cleanup);

  const created = store.create(example);
  assert.equal(created.id, "custom-00000000-0000-4000-8000-000000000001");
  assert.equal(created.enabled, true);
  assert.equal(created.createdAt, "2026-08-10T00:00:00.000Z");

  const reloaded = new AgentProfileStore(file);
  assert.deepEqual(reloaded.list(), [created]);
  const persisted = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.storeRevision, 1);
  assert.equal(persisted.agentRevisions.length, 1);
  assert.equal(created.latestRevisionId, persisted.agentRevisions[0].id);
  assert.deepEqual(reloaded.getRevision(created.latestRevisionId), persisted.agentRevisions[0]);
  assert.ok(directory);
});

test("serializes interleaved mutations from independent store instances", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-agent-profiles-concurrent-"));
  const file = join(directory, "agents.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let leftTick = 0;
  let rightTick = 0;
  const left = new AgentProfileStore(file, {
    clock: () => new Date(`2026-08-10T01:00:0${leftTick++}.000Z`),
    idFactory: () => "00000000-0000-4000-8000-000000000001",
  });
  const right = new AgentProfileStore(file, {
    clock: () => new Date(`2026-08-10T02:00:0${rightTick++}.000Z`),
    idFactory: () => "00000000-0000-4000-8000-000000000002",
  });

  const first = left.create(example);
  const second = right.create({ ...example, name: "Implementation specialist" });
  const updated = left.update(first.id, { description: "Updated by the desktop process." });
  right.delete(second.id);

  assert.deepEqual(left.list(), [updated]);
  assert.deepEqual(right.list(), [updated]);
  const persisted = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.storeRevision, 4);
  assert.deepEqual(persisted.profiles, [updated]);
  assert.equal(persisted.agentRevisions.length, 3);
  assert.ok(persisted.agentRevisions.some((revision) => revision.profileId === second.id));
});

test("applies stale updates to the latest revision and never resurrects deleted profiles", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-agent-profiles-stale-"));
  const file = join(directory, "agents.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  let tick = 0;
  const left = new AgentProfileStore(file, {
    clock: () => new Date(`2026-08-10T03:00:0${tick++}.000Z`),
    idFactory: () => "00000000-0000-4000-8000-000000000003",
  });
  const stale = new AgentProfileStore(file, {
    clock: () => new Date(`2026-08-10T04:00:0${tick++}.000Z`),
  });

  const created = left.create(example);
  const externallyUpdated = stale.update(created.id, {
    description: "Updated by the TUI process.",
    toolIds: ["git", "tests"],
  });
  const merged = left.update(created.id, { name: "Merged specialist" });

  assert.equal(merged.description, externallyUpdated.description);
  assert.deepEqual(merged.toolIds, externallyUpdated.toolIds);

  left.delete(created.id);
  assert.throws(() => stale.update(created.id, { enabled: false }), /not found/);
  assert.throws(() => stale.delete(created.id), /not found/);
  const persisted = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.storeRevision, 4);
  assert.deepEqual(persisted.profiles, []);
  assert.equal(persisted.agentRevisions.length, 3);
});

test("updates policy fields without changing profile identity", (t) => {
  const { store, cleanup } = fixture();
  t.after(cleanup);
  const created = store.create(example);
  const updated = store.update(created.id, {
    name: "Verification specialist",
    backend: "codex",
    reasoningEffort: "medium",
    permissionMode: "acceptEdits",
    skillIds: ["review/code", "test/focused"],
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, "2026-08-10T00:00:01.000Z");
  assert.equal(updated.backend, "codex");
  assert.equal(updated.reasoningEffort, "medium");
  assert.deepEqual(updated.skillIds, ["review/code", "test/focused"]);
});

test("appends immutable Agent Revisions and keeps them after Definition deletion", (t) => {
  const { file, store, cleanup } = fixture();
  t.after(cleanup);
  const created = store.create(example);
  const firstBytes = JSON.stringify(store.getRevision(created.latestRevisionId));

  const second = store.update(created.id, { instructions: "Use the second immutable policy." });
  const third = store.update(created.id, { permissionMode: "dontAsk" });

  assert.equal(second.revisionNumber, 2);
  assert.equal(third.revisionNumber, 3);
  assert.equal(JSON.stringify(store.getRevision(created.latestRevisionId)), firstBytes);
  assert.deepEqual(
    store.listRevisions(created.id).map((revision) => revision.revisionNumber),
    [1, 2, 3],
  );

  store.delete(created.id);
  assert.equal(store.get(created.id), undefined);
  assert.equal(JSON.stringify(store.getRevision(created.latestRevisionId)), firstBytes);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).agentRevisions.length, 3);
});

test("atomically migrates each v1 Profile to a deterministic initial Revision", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-agent-profiles-v1-"));
  const file = join(directory, "agents.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const legacyProfile = {
    id: "custom-00000000-0000-4000-8000-000000000009",
    ...example,
    description: example.description,
    permissionMode: example.permissionMode,
    skillIds: example.skillIds,
    toolIds: example.toolIds,
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
  writeFileSync(file, `${JSON.stringify({ version: 1, revision: 7, profiles: [legacyProfile] })}\n`, "utf8");

  const store = new AgentProfileStore(file);
  const [profile] = store.list();
  const persisted = JSON.parse(readFileSync(file, "utf8"));

  assert.equal(persisted.version, 2);
  assert.equal(persisted.storeRevision, 7);
  assert.equal(profile.latestRevisionId, `${profile.id.replace(/^/, "agent-revision:")}@1`);
  assert.equal(profile.modelSource, "legacy");
  assert.equal(persisted.agentRevisions[0].id, profile.latestRevisionId);
  assert.equal(persisted.agentRevisions[0].instructions, legacyProfile.instructions);
});

test("rejects a future Profile Store version without mutating it", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-agent-profiles-future-"));
  const file = join(directory, "agents.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = '{"version":3,"storeRevision":9,"profiles":[],"agentRevisions":[]}\n';
  writeFileSync(file, source, "utf8");

  assert.throws(() => new AgentProfileStore(file), /Invalid Agent profile store/);
  assert.equal(readFileSync(file, "utf8"), source);
  assert.equal(existsSync(`${file}.lock`), false);
});

test("rejects duplicate names and secret or executable fields", (t) => {
  const { store, cleanup } = fixture();
  t.after(cleanup);
  store.create(example);

  assert.throws(() => store.create({ ...example, name: " review SPECIALIST " }), /already exists/);
  assert.throws(() => store.create({ ...example, name: "Unsafe", apiKey: "secret" }), /unrecognized/i);
  assert.throws(() => store.create({ ...example, name: "Unsafe", executable: "/tmp/agent" }), /unrecognized/i);
});

test("deletes an existing profile and rejects unknown ids", (t) => {
  const { file, store, cleanup } = fixture();
  t.after(cleanup);
  const created = store.create(example);
  store.delete(created.id);

  assert.deepEqual(store.list(), []);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).profiles, []);
  assert.throws(() => store.delete(created.id), /not found/);
});

test("does not silently replace a corrupt profile store", (t) => {
  const { directory, file, store, cleanup } = fixture();
  t.after(cleanup);
  writeFileSync(file, "{not-json", "utf8");

  assert.throws(() => store.create(example), /Unable to read Agent profiles/);
  assert.throws(() => new AgentProfileStore(file), /Unable to read Agent profiles/);
  assert.equal(readFileSync(file, "utf8"), "{not-json");
  assert.equal(existsSync(`${file}.lock`), false);
  assert.ok(directory);
});

test("times out on a held lock without writing and recovers after the lock is released", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rux-agent-profiles-locked-"));
  const file = join(directory, "agents.json");
  const lockFile = `${file}.lock`;
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new AgentProfileStore(file, {
    idFactory: () => "00000000-0000-4000-8000-000000000004",
    lockTimeoutMs: 20,
    lockRetryMs: 1,
  });
  writeFileSync(lockFile, "another-process\n", { encoding: "utf8", mode: 0o600 });

  assert.throws(() => store.create(example), /Timed out acquiring Agent profile store lock/);
  assert.equal(existsSync(file), false);
  assert.equal(readFileSync(lockFile, "utf8"), "another-process\n");

  rmSync(lockFile);
  const created = store.create(example);
  assert.deepEqual(store.list(), [created]);
  assert.equal(existsSync(lockFile), false);
});
