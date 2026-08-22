import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubPullRequestService } from "../src/electron/github-pull-request-service.ts";

test("returns a truthful unavailable result when GitHub CLI is absent", async () => {
  const service = new GitHubPullRequestService(process.cwd(), { PATH: "" });
  const result = await service.list();
  assert.equal(result.source, "unavailable");
  assert.deepEqual(result.items, []);
  assert.match(result.unavailableReason, /GitHub CLI/);
});

test("lists bounded pull request metadata without exposing GitHub credentials", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "rux-gh-pr-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "gh");
  await writeFile(executable, `#!/bin/sh
if [ "$1" = "repo" ]; then
  echo '{"nameWithOwner":"openai/rux","url":"https://github.com/openai/rux"}'
else
  echo '[{"number":42,"title":"Keep the surface honest","url":"https://github.com/openai/rux/pull/42","state":"OPEN","isDraft":false,"author":{"login":"octocat"},"headRefName":"feature/pr","baseRefName":"main","updatedAt":"2026-08-22T08:00:00.000Z","reviewDecision":"REVIEW_REQUIRED"}]'
fi
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const service = new GitHubPullRequestService(directory, { RUX_GH_CLI_PATH: executable, PATH: "/usr/bin:/bin" });
  const result = await service.list();
  assert.equal(result.source, "github-cli");
  assert.equal(result.repository, "openai/rux");
  assert.deepEqual(result.items, [{
    number: 42,
    title: "Keep the surface honest",
    url: "https://github.com/openai/rux/pull/42",
    state: "open",
    isDraft: false,
    author: "octocat",
    headRefName: "feature/pr",
    baseRefName: "main",
    updatedAt: "2026-08-22T08:00:00.000Z",
    reviewDecision: "REVIEW_REQUIRED",
  }]);
  assert.equal(JSON.stringify(result).includes("token"), false);
});
