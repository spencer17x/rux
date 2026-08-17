import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalProductEventStore } from "../src/electron/local-product-event-store.ts";

test("local product events persist only allowlisted non-content dimensions across launches", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-local-events-"));
  const file = join(directory, "events.json");
  const first = new LocalProductEventStore(file);
  first.record("cli-detection");
  first.record("run-failed", { subjectHash: "hash-only", engine: "codex" });
  first.record("error-recovery-attempted", { subjectHash: "hash-only", engine: "codex" });
  first.record("run-succeeded", { subjectHash: "hash-only", engine: "codex" });
  const stored = readFileSync(file, "utf8");
  assert.doesNotMatch(stored, /prompt|message|sessionId|workspacePath|apiKey/i);

  const reopened = new LocalProductEventStore(file);
  assert.equal(reopened.summary().counts["cli-detection"], 1);
  assert.equal(reopened.summary().counts["run-succeeded"], 1);
  assert.ok(reopened.summary().firstSuccessfulRunAt);
  assert.equal(reopened.has("run-failed", "hash-only"), true);
});

test("local product event store preserves and refuses a future version", () => {
  const directory = mkdtempSync(join(tmpdir(), "rux-local-events-future-"));
  const file = join(directory, "events.json");
  const future = '{"version":99,"events":[]}\n';
  writeFileSync(file, future, { mode: 0o600 });
  const store = new LocalProductEventStore(file);
  assert.throws(() => store.record("cli-detection"), /was preserved/);
  assert.equal(readFileSync(file, "utf8"), future);
});
