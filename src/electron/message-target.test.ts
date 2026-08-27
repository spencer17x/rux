import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectMessageFile } from "./message-target";

describe("resolveProjectMessageFile", () => {
  it("resolves project-relative links with line fragments", async () => {
    const root = await mkdtemp(join(tmpdir(), "rux-message-target-"));
    await mkdir(join(root, "src"));
    const file = join(root, "src", "App.tsx");
    await writeFile(file, "export default 1");
    const canonicalFile = await realpath(file);
    await expect(resolveProjectMessageFile(root, "src/App.tsx#L12")).resolves.toBe(canonicalFile);
    await expect(resolveProjectMessageFile(root, `${file}:12:4`)).resolves.toBe(canonicalFile);
  });

  it("rejects traversal and symlinks that escape the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "rux-message-root-"));
    const outside = await mkdtemp(join(tmpdir(), "rux-message-outside-"));
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "secret");
    await expect(resolveProjectMessageFile(root, secret)).rejects.toThrow("当前项目内");
    if (process.platform !== "win32") {
      await symlink(secret, join(root, "linked.txt"));
      await expect(resolveProjectMessageFile(root, "linked.txt")).rejects.toThrow("当前项目内");
    }
  });
});
