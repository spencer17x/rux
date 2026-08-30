import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export type ReasoningEffort = "none" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type RuxSettings = { provider: "codex" | "custom"; serviceName: string; baseUrl: string; encryptedApiKey: string; hasApiKey: boolean; model: string; reasoning: ReasoningEffort; sandboxMode: SandboxMode; uiFontSize: number; allowConversationOverride: boolean; conversationSticky: boolean };

export class SettingsStore {
  constructor(private readonly path: string) {}
  defaults(): RuxSettings { return { provider: "codex", serviceName: "OpenAI Compatible", baseUrl: "https://api.openai.com/v1", encryptedApiKey: "", hasApiKey: false, model: "", reasoning: "high", sandboxMode: "workspace-write", uiFontSize: 14, allowConversationOverride: true, conversationSticky: true }; }
  async load(): Promise<RuxSettings> { let stored: Partial<RuxSettings> = {}; try { stored = JSON.parse(await readFile(this.path, "utf8")); } catch {} return { ...this.defaults(), ...stored, hasApiKey: Boolean(stored.encryptedApiKey) }; }
  merge(current: RuxSettings, input: Partial<RuxSettings> & { apiKey?: string }): RuxSettings {
    const next: RuxSettings = { ...current, provider: input.provider === "custom" ? "custom" : input.provider === "codex" ? "codex" : current.provider, serviceName: String(input.serviceName ?? current.serviceName).slice(0, 80), baseUrl: String(input.baseUrl ?? current.baseUrl).trim(), model: String(input.model ?? current.model).trim().slice(0, 120), reasoning: ["none", "low", "medium", "high", "xhigh", "max", "ultra"].includes(String(input.reasoning)) ? input.reasoning as ReasoningEffort : current.reasoning, sandboxMode: ["read-only", "workspace-write", "danger-full-access"].includes(String(input.sandboxMode)) ? input.sandboxMode as SandboxMode : current.sandboxMode, uiFontSize: Math.min(16, Math.max(12, Number(input.uiFontSize ?? current.uiFontSize) || 14)), allowConversationOverride: typeof input.allowConversationOverride === "boolean" ? input.allowConversationOverride : current.allowConversationOverride, conversationSticky: typeof input.conversationSticky === "boolean" ? input.conversationSticky : current.conversationSticky };
    if (typeof input.apiKey === "string" && input.apiKey.trim()) { if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，无法保存 API key"); next.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64"); next.hasApiKey = true; }
    return next;
  }
  async save(input: Partial<RuxSettings> & { apiKey?: string }): Promise<RuxSettings> { const next = this.merge(await this.load(), input); await mkdir(dirname(this.path), { recursive: true }); const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8"); await rename(temporary, this.path); return next; }
  public(settings: RuxSettings): Omit<RuxSettings, "encryptedApiKey"> { const { encryptedApiKey: _secret, ...value } = settings; return value; }
  decryptApiKey(settings: RuxSettings): string { if (!settings.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return ""; return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, "base64")); }
}
