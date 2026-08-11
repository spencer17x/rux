import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createContextSnapshot } from "../src/electron/context-snapshot.ts";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "rux-context-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "src"), { recursive: true });
  return root;
}

test("injects no changed file unless the user explicitly selects it", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "src", "safe.ts"), "export const safe = true;\n");

  const empty = await createContextSnapshot(root, { selectedFiles: [] }, ["filesystem"]);
  assert.deepEqual(empty.selectedFiles, []);

  const selected = await createContextSnapshot(root, { selectedFiles: ["src/safe.ts"] }, ["filesystem"]);
  assert.equal(selected.selectedFiles.length, 1);
  assert.equal(selected.selectedFiles[0].path, "src/safe.ts");
  assert.match(selected.selectedFiles[0].content, /safe = true/);
});

test("blocks protected credential paths before reading provider context", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, ".env"), "API_KEY=not-for-a-provider\n");

  await assert.rejects(
    createContextSnapshot(root, { selectedFiles: [".env"] }, []),
    (error) => error?.code === "CONTEXT_SECRET_FILE_BLOCKED" && !error.message.includes("not-for-a-provider"),
  );
});

test("blocks a benign-looking symlink that resolves to a protected file", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, ".env"), "SAFE_LOOKING_VALUE=local-only\n");
  await symlink(join(root, ".env"), join(root, "src", "settings.txt"));

  await assert.rejects(
    createContextSnapshot(root, { selectedFiles: ["src/settings.txt"] }, []),
    (error) => error?.code === "CONTEXT_SECRET_FILE_BLOCKED" && !error.message.includes("local-only"),
  );
});

test("blocks clear secret material in an otherwise ordinary file without echoing it", async (t) => {
  const root = await workspace(t);
  const secret = "sk-proj-abcdefghijklmnopqrstuv";
  await writeFile(join(root, "src", "config.txt"), `token=${secret}\n`);

  await assert.rejects(
    createContextSnapshot(root, { selectedFiles: ["src/config.txt"] }, []),
    (error) => error?.code === "CONTEXT_SECRET_CONTENT_BLOCKED" && !error.message.includes(secret),
  );
});

test("also blocks secret material in automatically discovered instruction files", async (t) => {
  const root = await workspace(t);
  const secret = "AKIAABCDEFGHIJKLMNOP";
  await writeFile(join(root, "AGENTS.md"), `Never print ${secret}\n`);

  await assert.rejects(
    createContextSnapshot(root, { selectedFiles: [] }, []),
    (error) => error?.code === "CONTEXT_SECRET_CONTENT_BLOCKED" && !error.message.includes(secret),
  );
});
