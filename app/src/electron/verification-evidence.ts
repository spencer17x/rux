import type { VerificationEvidence, VerificationKind } from "../shared/protocol.ts";

const maximumLogLength = 100_000;
const maximumCommandLength = 20_000;

export function redactSensitiveText(input: string, maximumLength = maximumLogLength): {
  text: string;
  redacted: boolean;
  truncated: boolean;
} {
  let text = input;
  const replacements: Array<[RegExp, string]> = [
    [/(\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH)[A-Z0-9_]*=)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]"],
    [/(--(?:api[-_]?key|token|password|secret|authorization)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]"],
    [/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]"],
    [/\b(?:sk|sk-proj|sk-ant)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]"],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  const redacted = text !== input;
  const truncated = text.length > maximumLength;
  if (truncated) text = `${text.slice(0, Math.max(0, maximumLength - 28))}\n… [Rux log truncated]`;
  return { text, redacted, truncated };
}

export function classifyVerification(command: string): VerificationKind {
  const normalized = command.toLowerCase();
  if (/\b(typecheck|tsc(?:\s|$)|mypy(?:\s|$)|pyright(?:\s|$))/.test(normalized)) return "typecheck";
  if (/\b(lint|eslint(?:\s|$)|clippy(?:\s|$)|ruff(?:\s|$)|golangci-lint(?:\s|$))/.test(normalized)) return "lint";
  if (/\b(test|pytest(?:\s|$)|jest(?:\s|$)|vitest(?:\s|$)|cargo\s+test|go\s+test)/.test(normalized)) return "test";
  if (/\b(build|package|bundle|cargo\s+build|go\s+build)/.test(normalized)) return "build";
  return "command";
}

export function createVerificationEvidence(input: {
  id: string;
  runId: string;
  command: string;
  cwd?: string;
  output?: string;
  exitCode?: number;
  failed?: boolean;
  startedAt?: string;
  finishedAt?: string;
}): VerificationEvidence {
  const command = redactSensitiveText(input.command, maximumCommandLength);
  const log = redactSensitiveText(input.output ?? "", maximumLogLength);
  const status = input.exitCode === 0
    ? "passed"
    : input.exitCode !== undefined || input.failed
      ? "failed"
      : "unknown";
  return {
    id: input.id,
    runId: input.runId,
    kind: classifyVerification(command.text),
    command: command.text,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    finishedAt: input.finishedAt ?? new Date().toISOString(),
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    status,
    log: log.text,
    redacted: command.redacted || log.redacted,
    truncated: command.truncated || log.truncated,
  };
}
