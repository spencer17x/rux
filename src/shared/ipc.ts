import { z } from "zod";

export const projectIdSchema = z.string().trim().min(1).max(200);
export const threadIdSchema = z.string().trim().min(1).max(500);
export const agentIdSchema = z.enum(["codex", "claude-code", "pi"]);
export const sandboxModeSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);
export const reasoningSchema = z.enum(["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
export const relativeProjectPathSchema = z.string().min(1).max(4096).refine((value) => !value.includes("\0"), "文件路径包含无效字符");

export const projectImportSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  createThread: z.boolean().optional(),
});

export const projectCloneSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  parent: z.string().trim().min(1).max(4096),
  createThread: z.boolean().optional(),
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parent: z.string().trim().min(1).max(4096),
  template: z.enum(["empty", "react", "node"]),
  initGit: z.boolean(),
  createThread: z.boolean().optional(),
});

export const settingsInputSchema = z.object({
  provider: z.enum(["codex", "custom"]).optional(),
  serviceName: z.string().max(80).optional(),
  baseUrl: z.string().max(4096).optional(),
  apiKey: z.string().max(100_000).optional(),
  model: z.string().max(200).optional(),
  reasoning: reasoningSchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
  uiFontSize: z.number().min(8).max(32).optional(),
  allowConversationOverride: z.boolean().optional(),
  conversationSticky: z.boolean().optional(),
});

export const providerSaveSchema = z.object({
  id: z.string().max(200).optional(),
  name: z.string().max(80).optional(),
  protocol: z.enum(["openai-responses", "openai-chat", "anthropic-messages", "ollama"]).optional(),
  baseUrl: z.string().max(4096).optional(),
  apiKey: z.string().max(100_000).optional(),
  headers: z.record(z.string().max(200), z.string().max(10_000)).optional(),
  compatibleAgents: z.array(z.literal("pi")).max(1).optional(),
  models: z.array(z.object({ id: z.string().max(160), name: z.string().max(160), reasoningLevels: z.array(reasoningSchema).max(10) })).max(500).optional(),
});

export const modelListSchema = z.object({ agentId: agentIdSchema.optional(), projectId: projectIdSchema.optional() }).optional();
export const addProjectThreadSchema = z.object({ projectId: projectIdSchema, title: z.string().trim().min(1).max(100).optional() });
export const addStandaloneThreadSchema = z.object({ title: z.string().trim().min(1).max(100).optional() }).optional();
export const threadUpdateSchema = z.object({
  type: z.enum(["project", "standalone"]),
  projectId: projectIdSchema.optional(),
  threadId: threadIdSchema,
  codexThreadId: threadIdSchema.optional(),
  agentId: agentIdSchema.optional(),
  nativeSessionId: threadIdSchema.optional(),
  agentMode: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(100).optional(),
});

export const projectThreadUpdateSchema = threadUpdateSchema.omit({ type: true }).extend({ projectId: projectIdSchema });

export const agentStartSchema = z.object({
  runId: threadIdSchema,
  projectId: projectIdSchema.optional(),
  prompt: z.string().trim().min(1).max(1_000_000),
  model: z.string().trim().max(200).optional(),
  reasoning: reasoningSchema.optional(),
  serviceTier: z.string().trim().min(1).max(80).nullable().optional(),
  sandboxMode: sandboxModeSchema.optional(),
  images: z.array(z.string().min(1).max(4096)).max(8).optional(),
  webSearch: z.boolean().optional(),
  threadId: threadIdSchema.optional(),
  nativeSessionId: threadIdSchema.optional(),
  mode: z.string().trim().min(1).max(80).optional(),
  agentId: agentIdSchema.optional(),
});

export const agentSendSchema = agentStartSchema.omit({ runId: true, agentId: true, nativeSessionId: true, mode: true });

export const agentInterruptSchema = z.object({
  agentId: agentIdSchema.optional(),
  runId: threadIdSchema.optional(),
  threadId: threadIdSchema,
  turnId: threadIdSchema,
});

export const approvalSchema = z.object({
  approvalId: threadIdSchema,
  decision: z.enum(["accept", "acceptForSession", "decline"]),
});

export const projectFileSchema = z.object({ projectId: projectIdSchema, path: relativeProjectPathSchema });
export const gitSwitchSchema = z.object({ projectId: projectIdSchema, branch: z.string().trim().min(1).max(500) });
export const gitCompareSchema = z.object({ projectId: projectIdSchema, baseBranch: z.string().trim().min(1).max(500) });
export const gitCompareFileSchema = gitCompareSchema.extend({ path: relativeProjectPathSchema });
export const gitStageSchema = z.object({ projectId: projectIdSchema, paths: z.array(relativeProjectPathSchema).min(1).max(1000) });
export const gitCommitSchema = z.object({ projectId: projectIdSchema, message: z.string().max(20_000), push: z.boolean(), rulesAcknowledged: z.boolean().optional() });
export const terminalWriteSchema = z.string().max(100_000);
export const terminalResizeSchema = z.object({ cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(300) });
export const clipboardTextSchema = z.string().max(1_000_000);
export const messagesStoreSchema = z.record(threadIdSchema, z.array(z.unknown()).max(200));
export const externalUrlSchema = z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://"), "仅支持 HTTP(S) 地址");
export const messageTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: externalUrlSchema }),
  z.object({ kind: z.literal("file"), projectId: projectIdSchema, path: z.string().min(1).max(4096).refine((value) => !value.includes("\0"), "文件路径包含无效字符") }),
]);

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(`请求参数无效：${result.error.issues[0]?.message || "格式错误"}`);
}
