import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  contextSnapshotParamsSchema,
  type ContextSnapshot,
  type ContextSource,
} from "../shared/protocol.ts";

const instructionCandidates = ["AGENTS.md", "CLAUDE.md", ".codex/AGENTS.md"];
const perSourceLimit = 64_000;
const instructionBudget = 96_000;
const selectedFileBudget = 160_000;
const emptySha256 = createHash("sha256").update("").digest("hex");
const sensitiveDirectoryNames = new Set([".ssh", ".aws", ".gnupg", ".azure", ".kube"]);
const sensitiveFileNames = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "service-account.json",
]);

export class ContextSafetyError extends Error {
  readonly code: "CONTEXT_SECRET_FILE_BLOCKED" | "CONTEXT_SECRET_CONTENT_BLOCKED";

  constructor(code: ContextSafetyError["code"], message: string) {
    super(message);
    this.name = "ContextSafetyError";
    this.code = code;
  }
}

export function sensitivePathReason(path: string): string | undefined {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const fileName = segments.at(-1)?.toLowerCase() ?? "";
  if (segments.some((segment) => sensitiveDirectoryNames.has(segment.toLowerCase()))) {
    return "credential directory";
  }
  if (fileName === ".env" || fileName.startsWith(".env.")) return "environment file";
  if (sensitiveFileNames.has(fileName)) return "credential file";
  if (/\.(?:key|p12|pfx|pem)$/i.test(fileName)) return "private key or certificate container";
  return undefined;
}

export function secretContentReason(content: string): string | undefined {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) return "private key material";
  if (/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(content)) {
    return "credential-shaped token";
  }
  if (/^\s*[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*["']?(?!(?:change-?me|example|placeholder|your[_-]))\S{12,}/im.test(content)) {
    return "secret-like environment assignment";
  }
  return undefined;
}

function checkedRelativePath(workspaceRoot: string, requestedPath: string): {
  absolute: string;
  relativePath: string;
} {
  const absolute = resolve(workspaceRoot, requestedPath);
  const relativePath = relative(workspaceRoot, absolute);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    if (!relativePath && requestedPath !== ".") {
      throw new Error(`Context path must name a file inside the workspace: ${requestedPath}`);
    }
    throw new Error(`Context path is outside the active workspace: ${requestedPath}`);
  }
  return { absolute, relativePath };
}

async function inspectSource(
  workspaceRoot: string,
  requestedPath: string,
  kind: ContextSource["kind"],
  contentLimit: number,
): Promise<ContextSource> {
  const checked = checkedRelativePath(workspaceRoot, requestedPath);
  try {
    await access(checked.absolute, constants.R_OK);
  } catch {
    return {
      path: checked.relativePath,
      kind,
      bytes: 0,
      exists: false,
      sha256: emptySha256,
      truncated: false,
      binary: false,
    };
  }

  const [actualWorkspaceRoot, actual] = await Promise.all([
    realpath(workspaceRoot),
    realpath(checked.absolute),
  ]);
  const actualRelative = relative(actualWorkspaceRoot, actual);
  if (actualRelative.startsWith("..") || isAbsolute(actualRelative)) {
    throw new Error(`Context file resolves outside the active workspace: ${requestedPath}`);
  }
  if (kind === "selected-file") {
    const reason = sensitivePathReason(actualRelative);
    if (reason) {
      throw new ContextSafetyError(
        "CONTEXT_SECRET_FILE_BLOCKED",
        `Context file blocked because its resolved path is a protected ${reason}: ${actualRelative}`,
      );
    }
  }
  const metadata = await stat(actual);
  if (!metadata.isFile()) throw new Error(`Context path is not a file: ${requestedPath}`);

  const digest = createHash("sha256");
  const handle = await open(actual, "r");
  const chunks: Buffer[] = [];
  let captured = 0;
  let position = 0;
  let binary = false;
  try {
    while (true) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      if (position < 8_192 && chunk.subarray(0, Math.min(chunk.length, 8_192 - position)).includes(0)) {
        binary = true;
      }
      if (!binary && captured < contentLimit) {
        const remaining = contentLimit - captured;
        const capturedChunk = chunk.subarray(0, Math.min(remaining, chunk.length));
        chunks.push(capturedChunk);
        captured += capturedChunk.length;
      }
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }

  return {
    path: actualRelative,
    kind,
    bytes: metadata.size,
    exists: true,
    sha256: digest.digest("hex"),
    ...(!binary && captured ? { content: Buffer.concat(chunks).toString("utf8") } : {}),
    truncated: binary ? metadata.size > 0 : metadata.size > captured,
    binary,
  };
}

async function collectSources(
  workspaceRoot: string,
  paths: string[],
  kind: ContextSource["kind"],
  totalBudget: number,
): Promise<ContextSource[]> {
  let remaining = totalBudget;
  const sources: ContextSource[] = [];
  for (const path of paths) {
    const source = await inspectSource(workspaceRoot, path, kind, Math.min(perSourceLimit, remaining));
    if (source.content) {
      const reason = secretContentReason(source.content);
      if (reason) {
        throw new ContextSafetyError(
          "CONTEXT_SECRET_CONTENT_BLOCKED",
          `Context file blocked because it contains ${reason}: ${source.path}`,
        );
      }
    }
    sources.push(source);
    remaining = Math.max(0, remaining - Buffer.byteLength(source.content ?? "", "utf8"));
  }
  return sources;
}

export async function createContextSnapshot(
  workspaceRoot: string,
  params: unknown,
  capabilities: string[],
): Promise<ContextSnapshot> {
  const input = contextSnapshotParamsSchema.parse(params);
  const selectedPaths = [...new Set(input.selectedFiles ?? [])]
    .filter((path) => !instructionCandidates.includes(path));
  for (const path of selectedPaths) {
    const reason = sensitivePathReason(path);
    if (reason) {
      throw new ContextSafetyError(
        "CONTEXT_SECRET_FILE_BLOCKED",
        `Context file blocked because its path is a protected ${reason}: ${path}`,
      );
    }
  }
  const instructions = (await collectSources(
    workspaceRoot,
    instructionCandidates,
    "instructions",
    instructionBudget,
  )).filter((source) => source.exists);
  const selectedFiles = await collectSources(
    workspaceRoot,
    selectedPaths,
    "selected-file",
    selectedFileBudget,
  );
  return {
    workspaceRoot,
    generatedAt: new Date().toISOString(),
    instructions,
    selectedFiles,
    capabilities: [...new Set(capabilities)],
  };
}

export function contextSnapshotPrompt(snapshot: ContextSnapshot): string {
  const sources = [...snapshot.instructions, ...snapshot.selectedFiles];
  const renderedSources = sources.map((source) => {
    const header = `[${source.kind}] ${source.path} · sha256:${source.sha256} · ${source.bytes} bytes${source.truncated ? " · truncated" : ""}${source.binary ? " · binary/not injected" : ""}${!source.exists ? " · missing" : ""}`;
    return source.content ? `${header}\n${source.content}` : header;
  });
  return [
    "Rux immutable context snapshot for this Run.",
    `Workspace: ${snapshot.workspaceRoot}`,
    `Generated: ${snapshot.generatedAt}`,
    `Capabilities: ${snapshot.capabilities.join(", ") || "none"}`,
    ...renderedSources,
  ].join("\n\n");
}
