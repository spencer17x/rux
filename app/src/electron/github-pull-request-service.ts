import { spawn } from "node:child_process";
import { constants, existsSync, accessSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  pullRequestListResultSchema,
  type PullRequestListResult,
} from "../shared/protocol.ts";

const MAX_GITHUB_JSON_BYTES = 2 * 1024 * 1024;
const GITHUB_COMMAND_TIMEOUT_MS = 30_000;

function findGitHubCli(environment: NodeJS.ProcessEnv): string | undefined {
  const candidates = [
    environment.RUX_GH_CLI_PATH,
    ...(environment.PATH || "").split(delimiter).filter(Boolean).map((directory) => join(directory, process.platform === "win32" ? "gh.exe" : "gh")),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the explicitly bounded PATH candidates.
    }
  }
  return undefined;
}

async function runJson(executable: string, args: string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<unknown> {
  const child = spawn(executable, args, {
    cwd,
    env: { ...environment, NO_COLOR: "1", FORCE_COLOR: "0", GH_PAGER: "cat", PAGER: "cat" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let overflow = false;
  child.stdout.on("data", (chunk: string) => {
    if (overflow) return;
    stdout += chunk;
    if (Buffer.byteLength(stdout, "utf8") > MAX_GITHUB_JSON_BYTES) {
      overflow = true;
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-16_000);
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("GITHUB_CLI_TIMEOUT: GitHub CLI 请求超时"));
    }, GITHUB_COMMAND_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (overflow) {
        reject(new Error("GITHUB_CLI_OUTPUT_TOO_LARGE: GitHub CLI 返回内容过大"));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().replace(/\s+/g, " ").slice(0, 500);
        reject(new Error(`GITHUB_CLI_FAILED: ${detail || `退出码 ${code}`}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("GITHUB_CLI_INVALID_JSON: GitHub CLI 返回了无效数据"));
      }
    });
  });
}

function authorLogin(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const login = (value as { login?: unknown }).login;
  return typeof login === "string" && login.trim() ? login.trim().slice(0, 120) : undefined;
}

export class GitHubPullRequestService {
  private readonly workspaceRoot: string;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    workspaceRoot: string,
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.environment = environment;
  }

  async list(): Promise<PullRequestListResult> {
    const executable = findGitHubCli(this.environment);
    if (!executable) {
      return pullRequestListResultSchema.parse({
        source: "unavailable",
        fetchedAt: new Date().toISOString(),
        items: [],
        unavailableReason: "未找到 GitHub CLI（gh）。安装并登录 gh 后可读取当前仓库的拉取请求。",
      });
    }
    const [repositoryRaw, requestsRaw] = await Promise.all([
      runJson(executable, ["repo", "view", "--json", "nameWithOwner,url"], this.workspaceRoot, this.environment),
      runJson(executable, ["pr", "list", "--state", "all", "--limit", "100", "--json", "number,title,url,state,isDraft,author,headRefName,baseRefName,updatedAt,reviewDecision"], this.workspaceRoot, this.environment),
    ]);
    const repository = repositoryRaw && typeof repositoryRaw === "object" && !Array.isArray(repositoryRaw)
      ? repositoryRaw as Record<string, unknown>
      : {};
    if (!Array.isArray(requestsRaw)) throw new Error("GITHUB_CLI_INVALID_RESPONSE: 拉取请求列表格式无效");
    return pullRequestListResultSchema.parse({
      source: "github-cli",
      fetchedAt: new Date().toISOString(),
      repository: typeof repository.nameWithOwner === "string" ? repository.nameWithOwner : undefined,
      repositoryUrl: typeof repository.url === "string" ? repository.url : undefined,
      items: requestsRaw.map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("GITHUB_CLI_INVALID_RESPONSE: 拉取请求记录格式无效");
        const item = raw as Record<string, unknown>;
        return {
          number: item.number,
          title: item.title,
          url: item.url,
          state: String(item.state || "OPEN").toLocaleLowerCase(),
          isDraft: Boolean(item.isDraft),
          author: authorLogin(item.author),
          headRefName: item.headRefName,
          baseRefName: item.baseRefName,
          updatedAt: item.updatedAt,
          ...(typeof item.reviewDecision === "string" && item.reviewDecision ? { reviewDecision: item.reviewDecision } : {}),
        };
      }),
    });
  }
}
