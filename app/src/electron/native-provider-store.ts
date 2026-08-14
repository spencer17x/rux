import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NativeProviderConnection,
  NativeProviderConnectionInput,
  NativeProviderConnectionTestResult,
  NativeProviderRuntimeCredential,
} from "../shared/protocol.ts";

type SecretCodec = {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
};

type StoredConnection = Omit<NativeProviderConnection, "hasCredential"> & { encryptedApiKey: string };
type StoredState = { version: 1; connections: StoredConnection[] };

export class NativeProviderStore {
  private readonly filePath: string;
  private readonly codec: SecretCodec;
  private state: StoredState;
  private loadError: Error | undefined;

  constructor(filePath: string, codec: SecretCodec) {
    this.filePath = filePath;
    this.codec = codec;
    this.state = this.load();
  }

  list(): NativeProviderConnection[] {
    return this.state.connections.map(({ encryptedApiKey, ...connection }) => ({
      ...connection,
      hasCredential: Boolean(encryptedApiKey),
    }));
  }

  save(input: NativeProviderConnectionInput): NativeProviderConnection {
    this.assertWritable();
    const existing = input.id ? this.state.connections.find((item) => item.id === input.id) : undefined;
    if (!existing && !input.apiKey) throw new Error("API Key is required for a new Native Provider Connection");
    if (input.apiKey && !this.codec.available()) {
      throw new Error("Operating-system credential encryption is unavailable; Rux refused to store the API Key");
    }
    const now = new Date().toISOString();
    const id = existing?.id ?? `native:rux-native:${randomUUID()}`;
    const next: StoredConnection = {
      id,
      label: input.label,
      providerType: input.providerType,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      defaultModel: input.defaultModel,
      encryptedApiKey: input.apiKey ? this.codec.encrypt(input.apiKey).toString("base64") : existing?.encryptedApiKey ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing?.lastTestedAt ? { lastTestedAt: existing.lastTestedAt } : {}),
      ...(existing?.lastTestStatus ? { lastTestStatus: existing.lastTestStatus } : {}),
      ...(existing?.lastTestDetail ? { lastTestDetail: existing.lastTestDetail } : {}),
    };
    this.state.connections = existing
      ? this.state.connections.map((item) => item.id === id ? next : item)
      : [...this.state.connections, next];
    this.persist();
    return this.list().find((item) => item.id === id)!;
  }

  delete(id: string): void {
    this.assertWritable();
    const before = this.state.connections.length;
    this.state.connections = this.state.connections.filter((item) => item.id !== id);
    if (this.state.connections.length === before) throw new Error("Native Provider Connection not found");
    this.persist();
  }

  recordTest(result: NativeProviderConnectionTestResult): void {
    this.assertWritable();
    const connection = this.state.connections.find((item) => item.id === result.id);
    if (!connection) throw new Error("Native Provider Connection not found");
    connection.lastTestedAt = result.testedAt;
    connection.lastTestStatus = result.ok ? "connected" : "error";
    connection.lastTestDetail = result.detail;
    connection.updatedAt = result.testedAt;
    this.persist();
  }

  runtimeCredentials(): NativeProviderRuntimeCredential[] {
    if (this.loadError) throw this.loadError;
    if (this.state.connections.length && !this.codec.available()) {
      throw new Error("Operating-system credential encryption is unavailable");
    }
    return this.state.connections.map((connection) => ({
      id: connection.id,
      label: connection.label,
      providerType: connection.providerType,
      baseUrl: connection.baseUrl,
      defaultModel: connection.defaultModel,
      apiKey: this.codec.decrypt(Buffer.from(connection.encryptedApiKey, "base64")),
    }));
  }

  private load(): StoredState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as StoredState;
      if (parsed.version === 1 && Array.isArray(parsed.connections)) return parsed;
    } catch (error) {
      try {
        readFileSync(this.filePath, "utf8");
        this.loadError = new Error(`Native Provider store is unreadable and was preserved: ${error instanceof Error ? error.message : String(error)}`);
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT") {
          this.loadError = new Error(`Native Provider store cannot be read and was preserved: ${readError instanceof Error ? readError.message : String(readError)}`);
        }
      }
    }
    return { version: 1, connections: [] };
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  private assertWritable(): void {
    if (this.loadError) throw this.loadError;
  }
}
