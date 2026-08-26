import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type ProviderProtocol = "openai-responses" | "openai-chat" | "anthropic-messages" | "ollama";

export type ProviderModel = {
  id: string;
  name: string;
  reasoningLevels: string[];
};

export type ProviderProfile = {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  encryptedApiKey: string;
  hasApiKey: boolean;
  headers: Record<string, string>;
  compatibleAgents: Array<"pi">;
  models: ProviderModel[];
};

type ProviderStore = {
  activeProfileId: string;
  profiles: ProviderProfile[];
};

export class ProviderProfileStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<{ activeProfileId: string; profiles: Array<Omit<ProviderProfile, "encryptedApiKey">> }> {
    const store = await this.read();
    return {
      activeProfileId: store.activeProfileId,
      profiles: store.profiles.map(({ encryptedApiKey: _secret, ...profile }) => profile),
    };
  }

  async save(input: Partial<ProviderProfile> & { apiKey?: string }): Promise<Omit<ProviderProfile, "encryptedApiKey">> {
    const store = await this.read();
    const id = String(input.id || randomUUID());
    const current = store.profiles.find((profile) => profile.id === id);
    const protocol = this.protocol(input.protocol || current?.protocol);
    const baseUrl = this.baseUrl(String(input.baseUrl || current?.baseUrl || ""));
    const name = String(input.name || current?.name || "自定义 Provider").trim().slice(0, 80);
    if (!name) throw new Error("Provider 名称不能为空");
    const headers = this.headers(input.headers || current?.headers || {});
    const compatibleAgents = (input.compatibleAgents || current?.compatibleAgents || ["pi"]).filter((value): value is "pi" => value === "pi");
    const models = (input.models || current?.models || []).map((model) => ({
      id: String(model.id || "").trim().slice(0, 160),
      name: String(model.name || model.id || "").trim().slice(0, 160),
      reasoningLevels: (model.reasoningLevels || []).filter((level) => ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level)),
    })).filter((model) => model.id);
    if (!models.length) throw new Error("至少配置一个模型 ID");
    let encryptedApiKey = current?.encryptedApiKey || "";
    if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用，无法保存 API key");
      encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
    }
    const profile: ProviderProfile = {
      id,
      name,
      protocol,
      baseUrl,
      encryptedApiKey,
      hasApiKey: Boolean(encryptedApiKey),
      headers,
      compatibleAgents,
      models,
    };
    const index = store.profiles.findIndex((item) => item.id === id);
    if (index >= 0) store.profiles[index] = profile;
    else store.profiles.push(profile);
    if (!store.activeProfileId) store.activeProfileId = id;
    await this.write(store);
    const { encryptedApiKey: _secret, ...publicProfile } = profile;
    return publicProfile;
  }

  async remove(id: string): Promise<{ activeProfileId: string; profiles: Array<Omit<ProviderProfile, "encryptedApiKey">> }> {
    const store = await this.read();
    const index = store.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) throw new Error("Provider 配置不存在");
    store.profiles.splice(index, 1);
    if (store.activeProfileId === id) store.activeProfileId = store.profiles[0]?.id || "";
    await this.write(store);
    return await this.list();
  }

  async setActive(id: string): Promise<{ activeProfileId: string }> {
    const store = await this.read();
    if (!store.profiles.some((profile) => profile.id === id)) throw new Error("Provider 配置不存在");
    store.activeProfileId = id;
    await this.write(store);
    return { activeProfileId: id };
  }

  async test(id: string): Promise<{ ok: true; message: string }> {
    const store = await this.read();
    const profile = store.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Provider 配置不存在");
    const model = profile.models[0]?.id;
    if (!model) throw new Error("Provider 没有可测试的模型");
    const apiKey = this.decrypt(profile.encryptedApiKey);
    const base = profile.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json", ...profile.headers };
    let endpoint = `${base}/responses`;
    let body: unknown = { model, input: "Reply with OK", max_output_tokens: 16 };
    if (profile.protocol === "openai-chat" || profile.protocol === "ollama") {
      endpoint = `${base}/chat/completions`;
      body = { model, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 16 };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    } else if (profile.protocol === "anthropic-messages") {
      endpoint = `${base}/v1/messages`;
      body = { model, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 16 };
      if (apiKey) headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`连接测试失败（${response.status}）：${detail || response.statusText}`);
    }
    return { ok: true, message: `${profile.name} · ${model} 连接成功` };
  }

  async materializePiRuntime(runtimeRoot: string): Promise<{ agentDir: string; env: Record<string, string>; providerId: string } | null> {
    const store = await this.read();
    const profile = store.profiles.find((item) => item.id === store.activeProfileId && item.compatibleAgents.includes("pi"));
    if (!profile) return null;
    const agentDir = join(runtimeRoot, "pi-agent");
    await mkdir(agentDir, { recursive: true });
    const providerId = `rux-${profile.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`;
    const api = profile.protocol === "openai-chat" || profile.protocol === "ollama" ? "openai-completions" : profile.protocol;
    const config = {
      providers: {
        [providerId]: {
          baseUrl: profile.baseUrl,
          api,
          apiKey: "$RUX_PI_API_KEY",
          authHeader: profile.protocol !== "anthropic-messages",
          headers: profile.headers,
          models: profile.models.map((model) => ({
            id: model.id,
            name: model.name,
            reasoning: model.reasoningLevels.length > 0,
            thinkingLevelMap: Object.fromEntries(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => [level, model.reasoningLevels.includes(level) ? level : null])),
          })),
        },
      },
    };
    await writeFile(join(agentDir, "models.json"), `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { agentDir, providerId, env: { RUX_PI_API_KEY: this.decrypt(profile.encryptedApiKey) || (profile.protocol === "ollama" ? "ollama" : "") } };
  }

  private decrypt(value: string): string {
    if (!value) return "";
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用");
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }

  private protocol(value: unknown): ProviderProtocol {
    return ["openai-responses", "openai-chat", "anthropic-messages", "ollama"].includes(String(value)) ? value as ProviderProtocol : "openai-responses";
  }

  private baseUrl(value: string): string {
    const clean = value.trim().replace(/\/+$/, "");
    let url: URL;
    try { url = new URL(clean); } catch { throw new Error("Base URL 无效"); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Base URL 仅支持 HTTP(S)");
    return clean;
  }

  private headers(value: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(value || {})) {
      const name = key.trim();
      if (!name || /[\r\n]/.test(name) || /[\r\n]/.test(String(headerValue))) throw new Error("Header 包含无效字符");
      if (["authorization", "x-api-key"].includes(name.toLowerCase())) throw new Error("认证 Header 请使用 API key 字段配置");
      result[name] = String(headerValue).trim();
    }
    return result;
  }

  private async read(): Promise<ProviderStore> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as ProviderStore;
      return {
        activeProfileId: String(value.activeProfileId || ""),
        profiles: Array.isArray(value.profiles)
          ? value.profiles.map((profile) => ({ ...profile, compatibleAgents: (profile.compatibleAgents || []).filter((agent): agent is "pi" => agent === "pi") }))
          : [],
      };
    } catch {
      return { activeProfileId: "", profiles: [] };
    }
  }

  private async write(value: ProviderStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}
