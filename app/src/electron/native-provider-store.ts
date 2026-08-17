import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type {
  NativeProviderConnection,
  NativeProviderConnectionInput,
  NativeProviderConnectionTestResult,
  NativeProviderRuntimeCredential,
  NativeProviderCredentialDiagnostics,
  NativeProviderCredentialMigrationResult,
} from "../shared/protocol.ts";

type SecretCodec = {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
};

type StoredConnection = Omit<NativeProviderConnection, "hasCredential"> & {
  encryptedApiKey: string;
  encryptedCustomHeaders?: string;
};
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
    return this.state.connections.map(({ encryptedApiKey, encryptedCustomHeaders: _encryptedCustomHeaders, ...connection }) => ({
      ...connection,
      hasCredential: Boolean(encryptedApiKey),
      customHeaderNames: connection.customHeaderNames ?? [],
    }));
  }

  save(input: NativeProviderConnectionInput): NativeProviderConnection {
    this.assertWritable();
    const existing = input.id ? this.state.connections.find((item) => item.id === input.id) : undefined;
    if (!existing && !input.apiKey) throw new Error("API Key is required for a new Native Provider Connection");
    if ((input.apiKey || input.customHeaders) && !this.codec.available()) {
      throw new Error("Operating-system credential encryption is unavailable; Rux refused to store Provider secrets");
    }
    const now = new Date().toISOString();
    const id = existing?.id ?? `native:rux-native:${randomUUID()}`;
    const baseUrl = input.baseUrl.replace(/\/+$/, "");
    const preservesNegotiation = Boolean(existing && !input.apiKey && !input.customHeaders && existing.providerType === input.providerType && existing.baseUrl === baseUrl);
    const next: StoredConnection = {
      id,
      label: input.label,
      providerType: input.providerType,
      baseUrl,
      defaultModel: input.defaultModel,
      encryptedApiKey: input.apiKey ? this.codec.encrypt(input.apiKey).toString("base64") : existing?.encryptedApiKey ?? "",
      encryptedCustomHeaders: input.customHeaders
        ? this.encryptCustomHeaders(input.customHeaders)
        : existing?.encryptedCustomHeaders,
      customHeaderNames: input.customHeaders
        ? input.customHeaders.map((header) => header.name)
        : existing?.customHeaderNames ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(preservesNegotiation && existing?.lastTestedAt ? { lastTestedAt: existing.lastTestedAt } : {}),
      ...(preservesNegotiation && existing?.lastTestStatus ? { lastTestStatus: existing.lastTestStatus } : {}),
      ...(preservesNegotiation && existing?.lastTestDetail ? { lastTestDetail: existing.lastTestDetail } : {}),
      ...(preservesNegotiation && existing?.modelCatalog ? { modelCatalog: existing.modelCatalog } : {}),
      ...(preservesNegotiation && existing?.capabilities ? { capabilities: existing.capabilities } : {}),
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
    if (result.modelCatalog) connection.modelCatalog = result.modelCatalog;
    else delete connection.modelCatalog;
    if (result.capabilities) connection.capabilities = result.capabilities;
    else delete connection.capabilities;
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
      customHeaders: this.decryptCustomHeaders(connection.encryptedCustomHeaders),
      ...(connection.modelCatalog ? { modelCatalog: connection.modelCatalog } : {}),
      ...(connection.capabilities ? { capabilities: connection.capabilities } : {}),
    }));
  }

  diagnose(storageBackend: string): NativeProviderCredentialDiagnostics {
    const checkedAt = new Date().toISOString();
    if (this.loadError) return { status: "store-unreadable", storageBackend, encryptionAvailable: this.codec.available(), connectionCount: 0, decryptableCount: 0, failedConnectionLabels: [], checkedAt, migrationAvailable: false, detail: this.loadError.message };
    if (!this.state.connections.length) return { status: "empty", storageBackend, encryptionAvailable: this.codec.available(), connectionCount: 0, decryptableCount: 0, failedConnectionLabels: [], checkedAt, migrationAvailable: false, detail: "尚未保存 Rux Native Provider 凭据" };
    if (!this.codec.available()) return { status: "encryption-unavailable", storageBackend, encryptionAvailable: false, connectionCount: this.state.connections.length, decryptableCount: 0, failedConnectionLabels: this.state.connections.map((item) => item.label), checkedAt, migrationAvailable: false, detail: "操作系统安全存储当前不可用；不会尝试解密或降级为明文" };
    const failedConnectionLabels: string[] = [];
    for (const connection of this.state.connections) {
      try {
        this.codec.decrypt(Buffer.from(connection.encryptedApiKey, "base64"));
        this.decryptCustomHeaders(connection.encryptedCustomHeaders);
      } catch {
        failedConnectionLabels.push(connection.label);
      }
    }
    const decryptableCount = this.state.connections.length - failedConnectionLabels.length;
    return { status: failedConnectionLabels.length ? "credential-error" : "healthy", storageBackend, encryptionAvailable: true, connectionCount: this.state.connections.length, decryptableCount, failedConnectionLabels, checkedAt, migrationAvailable: failedConnectionLabels.length === 0, detail: failedConnectionLabels.length ? `${failedConnectionLabels.length} 个 Connection 的加密凭据无法解密` : "全部本地 Provider 凭据均可由当前操作系统安全存储解密" };
  }

  migrateCredentials(storageBackend: string): NativeProviderCredentialMigrationResult {
    this.assertWritable();
    const before = this.diagnose(storageBackend);
    if (!before.migrationAvailable) throw new Error(`Provider credential migration is unavailable: ${before.detail}`);
    const plaintext = this.state.connections.map((connection) => ({
      apiKey: this.codec.decrypt(Buffer.from(connection.encryptedApiKey, "base64")),
      customHeaders: this.decryptCustomHeaders(connection.encryptedCustomHeaders),
    }));
    const previous = this.state;
    const completedAt = new Date().toISOString();
    const backupPath = `${this.filePath}.backup-${completedAt.replace(/[:.]/g, "-")}`;
    copyFileSync(this.filePath, backupPath);
    try {
      this.state = {
        version: 1,
        connections: previous.connections.map((connection, index) => ({
          ...connection,
          encryptedApiKey: this.codec.encrypt(plaintext[index].apiKey).toString("base64"),
          encryptedCustomHeaders: plaintext[index].customHeaders.length ? this.encryptCustomHeaders(plaintext[index].customHeaders) : undefined,
          updatedAt: completedAt,
        })),
      };
      this.persist();
    } catch (error) {
      this.state = previous;
      throw error;
    }
    return { migratedConnections: this.state.connections.length, backupFileName: basename(backupPath), completedAt, diagnostics: this.diagnose(storageBackend) };
  }

  private load(): StoredState {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as StoredState;
      if (parsed.version === 1 && Array.isArray(parsed.connections)) return parsed;
      throw new Error(`Unsupported Native Provider store version: ${String(parsed?.version ?? "missing")}`);
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

  private encryptCustomHeaders(headers: Array<{ name: string; value: string }>): string | undefined {
    if (!headers.length) return undefined;
    return this.codec.encrypt(JSON.stringify(headers)).toString("base64");
  }

  private decryptCustomHeaders(encrypted: string | undefined): Array<{ name: string; value: string }> {
    if (!encrypted) return [];
    if (!this.codec.available()) throw new Error("Operating-system credential encryption is unavailable");
    const parsed = JSON.parse(this.codec.decrypt(Buffer.from(encrypted, "base64"))) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== "object" || typeof item.name !== "string" || typeof item.value !== "string")) {
      throw new Error("Encrypted Native Provider custom headers are invalid");
    }
    return parsed as Array<{ name: string; value: string }>;
  }

  private assertWritable(): void {
    if (this.loadError) throw this.loadError;
  }
}
