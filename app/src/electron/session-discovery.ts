import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DiscoveredSession,
  SessionAttribution,
  SessionAttributionMigrateParams,
  SessionAttributionMigrateResult,
  SessionDiscoverParams,
  SessionDiscoverResult,
  SessionMetadata,
  SessionPreviewParams,
  SessionPreviewResult,
  WorkspaceSummary,
} from "../shared/protocol.ts";
import { sessionAttributionMigrateResultSchema, sessionDiscoverResultSchema, sessionPreviewResultSchema } from "../shared/protocol.ts";
import type { SessionConnectorService } from "./session-connector.ts";

export type AuthorizedWorkspace = Pick<WorkspaceSummary, "id" | "name" | "path">;

type CanonicalWorkspace = AuthorizedWorkspace & { canonicalPath: string };
type StoredAssignment = {
  identity_key: string;
  workspace_id: string;
  workspace_name: string;
  workspace_path: string;
};
type StoredAssignmentAudit = {
  identity_key: string;
  previous_workspace_id: string;
  workspace_id: string;
  migrated_at: string;
};

function canonicalDirectory(path: string): string | undefined {
  if (!isAbsolute(path) || !existsSync(path)) return undefined;
  try {
    const canonical = realpathSync(resolve(path));
    return statSync(canonical).isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function containsPath(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset));
}

function pathDepth(path: string): number {
  return resolve(path).split(sep).filter(Boolean).length;
}

export function sessionIdentityKey(metadata: Pick<SessionMetadata, "engine" | "providerConnectionId" | "nativeSessionId">): string {
  return createHash("sha256")
    .update(JSON.stringify([metadata.engine, metadata.providerConnectionId, metadata.nativeSessionId]))
    .digest("hex");
}

export function canonicalAuthorizedWorkspaces(
  workspaces: AuthorizedWorkspace[],
  activeWorkspaceId?: string,
): CanonicalWorkspace[] {
  const byPath = new Map<string, CanonicalWorkspace>();
  for (const workspace of workspaces) {
    const canonicalPath = canonicalDirectory(workspace.path);
    if (!canonicalPath) continue;
    const existing = byPath.get(canonicalPath);
    if (!existing || workspace.id === activeWorkspaceId) {
      byPath.set(canonicalPath, { ...workspace, canonicalPath });
    }
  }
  return [...byPath.values()].sort((left, right) =>
    pathDepth(right.canonicalPath) - pathDepth(left.canonicalPath)
    || right.canonicalPath.length - left.canonicalPath.length
    || left.id.localeCompare(right.id));
}

export function matchAuthorizedWorkspace(
  cwd: string | undefined,
  workspaces: CanonicalWorkspace[],
): { kind: "matched"; workspace: CanonicalWorkspace; canonicalCwd: string }
  | { kind: "unassigned"; reason: string }
  | { kind: "authorization-required"; canonicalCwd: string; reason: string } {
  if (!cwd) return { kind: "unassigned", reason: "原生会话没有提供工作目录" };
  const canonicalCwd = canonicalDirectory(cwd);
  if (!canonicalCwd) return { kind: "unassigned", reason: "工作目录不存在或无法解析" };
  const workspace = workspaces.find((candidate) => containsPath(candidate.canonicalPath, canonicalCwd));
  if (!workspace) {
    return {
      kind: "authorization-required",
      canonicalCwd,
      reason: "工作目录不在任何已授权项目中；请先通过“打开项目…”授权",
    };
  }
  return { kind: "matched", workspace, canonicalCwd };
}

export class SessionAttributionStore {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS session_assignment (
        identity_key TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        workspace_name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_assignment_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_key TEXT NOT NULL,
        previous_workspace_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        migrated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  get(identityKey: string): StoredAssignment | undefined {
    return this.#database.prepare(`
      SELECT identity_key, workspace_id, workspace_name, workspace_path
      FROM session_assignment WHERE identity_key = ?
    `).get(identityKey) as StoredAssignment | undefined;
  }

  assign(identityKey: string, workspace: CanonicalWorkspace): void {
    this.#database.prepare(`
      INSERT INTO session_assignment(identity_key, workspace_id, workspace_name, workspace_path, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(identity_key) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        workspace_name = excluded.workspace_name,
        workspace_path = excluded.workspace_path,
        updated_at = excluded.updated_at
    `).run(identityKey, workspace.id, workspace.name, workspace.canonicalPath, new Date().toISOString());
  }

  migrate(identityKey: string, expectedPreviousWorkspaceId: string, workspace: CanonicalWorkspace, migratedAt: string): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(identityKey);
      if (!current || current.workspace_id !== expectedPreviousWorkspaceId) {
        throw Object.assign(new Error("Session Workspace attribution changed; discover the Session again"), {
          code: "SESSION_ATTRIBUTION_STALE",
        });
      }
      this.assign(identityKey, workspace);
      this.#database.prepare(`
        INSERT INTO session_assignment_audit(identity_key, previous_workspace_id, workspace_id, migrated_at)
        VALUES (?, ?, ?, ?)
      `).run(identityKey, expectedPreviousWorkspaceId, workspace.id, migratedAt);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  audits(identityKey: string): StoredAssignmentAudit[] {
    return this.#database.prepare(`
      SELECT identity_key, previous_workspace_id, workspace_id, migrated_at
      FROM session_assignment_audit WHERE identity_key = ? ORDER BY id ASC
    `).all(identityKey) as unknown as StoredAssignmentAudit[];
  }

  close(): void {
    this.#database.close();
  }
}

function unassignedAttribution(reason: string): SessionAttribution {
  return { status: "unassigned", reason };
}

function migrationAttribution(
  candidate: CanonicalWorkspace,
  previous: StoredAssignment,
): SessionAttribution {
  return {
    status: "migration-suggested",
    workspaceId: candidate.id,
    workspaceName: candidate.name,
    previousWorkspaceId: previous.workspace_id,
    previousWorkspaceName: previous.workspace_name,
    reason: `发现更具体或不同的已授权项目；当前归属仍保留在 ${previous.workspace_name}`,
  };
}

export class SessionDiscoveryService {
  private readonly connectors: SessionConnectorService;
  private readonly authorizedWorkspaces: AuthorizedWorkspace[];
  private readonly assignments: SessionAttributionStore;
  private readonly migrationTickets = new Map<string, { previousWorkspaceId: string; workspace: CanonicalWorkspace }>();
  constructor(
    connectors: SessionConnectorService,
    authorizedWorkspaces: AuthorizedWorkspace[],
    assignments: SessionAttributionStore,
  ) {
    this.connectors = connectors;
    this.authorizedWorkspaces = authorizedWorkspaces;
    this.assignments = assignments;
  }

  async discover(params: SessionDiscoverParams): Promise<SessionDiscoverResult> {
    const workspaces = canonicalAuthorizedWorkspaces(this.authorizedWorkspaces, params.activeWorkspaceId);
    if (!workspaces.some((workspace) => workspace.id === params.activeWorkspaceId)) {
      throw Object.assign(new Error("Session discovery requires the active authorized Workspace"), {
        code: "SESSION_WORKSPACE_UNAUTHORIZED",
      });
    }
    const page = await this.connectors.list(params);
    const current: DiscoveredSession[] = [];
    const unassigned: DiscoveredSession[] = [];
    const authorizationRequired: DiscoveredSession[] = [];
    const migrationSuggestions: DiscoveredSession[] = [];
    const seen = new Set<string>();
    this.migrationTickets.clear();

    for (const metadata of page.sessions) {
      const identityKey = sessionIdentityKey(metadata);
      if (seen.has(identityKey)) continue;
      seen.add(identityKey);
      const match = matchAuthorizedWorkspace(metadata.cwd, workspaces);
      if (match.kind === "unassigned") {
        unassigned.push({ identityKey, metadata, attribution: unassignedAttribution(match.reason) });
        continue;
      }
      if (match.kind === "authorization-required") {
        authorizationRequired.push({
          identityKey,
          metadata,
          attribution: { status: "authorization-required", reason: match.reason },
        });
        continue;
      }

      const previous = this.assignments.get(identityKey);
      if (previous && previous.workspace_id !== match.workspace.id) {
        this.migrationTickets.set(identityKey, {
          previousWorkspaceId: previous.workspace_id,
          workspace: match.workspace,
        });
        migrationSuggestions.push({
          identityKey,
          metadata,
          attribution: migrationAttribution(match.workspace, previous),
        });
        continue;
      }
      if (!previous) this.assignments.assign(identityKey, match.workspace);
      if (match.workspace.id === params.activeWorkspaceId) {
        current.push({
          identityKey,
          metadata: { ...metadata, cwd: match.canonicalCwd },
          attribution: {
            status: "current-workspace",
            workspaceId: match.workspace.id,
            workspaceName: match.workspace.name,
          },
        });
      }
      // Sessions assigned to another authorized Workspace are intentionally hidden.
    }

    return sessionDiscoverResultSchema.parse({
      engine: params.engine,
      current,
      unassigned,
      authorizationRequired,
      migrationSuggestions,
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    });
  }

  migrateAttribution(params: SessionAttributionMigrateParams): SessionAttributionMigrateResult {
    const ticket = this.migrationTickets.get(params.identityKey);
    if (!ticket
      || ticket.previousWorkspaceId !== params.expectedPreviousWorkspaceId
      || ticket.workspace.id !== params.targetWorkspaceId) {
      throw Object.assign(new Error("Session migration suggestion is stale; discover the Session again"), {
        code: "SESSION_MIGRATION_STALE",
      });
    }
    const migratedAt = new Date().toISOString();
    this.assignments.migrate(params.identityKey, params.expectedPreviousWorkspaceId, ticket.workspace, migratedAt);
    this.migrationTickets.delete(params.identityKey);
    return sessionAttributionMigrateResultSchema.parse({
      identityKey: params.identityKey,
      previousWorkspaceId: params.expectedPreviousWorkspaceId,
      workspaceId: ticket.workspace.id,
      workspaceName: ticket.workspace.name,
      migratedAt,
    });
  }

  async preview(params: SessionPreviewParams): Promise<SessionPreviewResult> {
    const workspaces = canonicalAuthorizedWorkspaces(this.authorizedWorkspaces, params.activeWorkspaceId);
    const activeWorkspace = workspaces.find((workspace) => workspace.id === params.activeWorkspaceId);
    if (!activeWorkspace) {
      throw Object.assign(new Error("Session preview requires the active authorized Workspace"), {
        code: "SESSION_WORKSPACE_UNAUTHORIZED",
      });
    }

    const expectedIdentityKey = sessionIdentityKey({
      engine: params.engine,
      providerConnectionId: params.providerConnection.id,
      nativeSessionId: params.nativeSessionId,
    });
    const assignment = this.assignments.get(expectedIdentityKey);
    if (!assignment || assignment.workspace_id !== activeWorkspace.id) {
      throw Object.assign(new Error("请先在当前项目中发现并选择该会话"), {
        code: "SESSION_NOT_ASSIGNED_TO_ACTIVE_WORKSPACE",
      });
    }

    const page = await this.connectors.readAll(params, 20_000);
    const { metadata, messages } = page;

    const actualIdentityKey = sessionIdentityKey(metadata);
    const match = matchAuthorizedWorkspace(metadata.cwd, workspaces);
    if (actualIdentityKey !== expectedIdentityKey || match.kind !== "matched" || match.workspace.id !== activeWorkspace.id) {
      throw Object.assign(new Error("原生会话身份或工作目录已变化，请重新发现"), {
        code: "SESSION_ATTRIBUTION_CHANGED",
      });
    }
    const resume = await this.connectors.checkResume({
      operationId: params.operationId,
      engine: params.engine,
      providerConnection: params.providerConnection,
      nativeSessionId: params.nativeSessionId,
    });
    return sessionPreviewResultSchema.parse({
      metadata: { ...metadata, cwd: match.canonicalCwd },
      messages: messages.slice(0, 20_000),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      truncated: page.truncated,
      identityKey: actualIdentityKey,
      resume,
    });
  }
}

export function authorizedWorkspacesFromEnvironment(
  active: AuthorizedWorkspace,
  raw = process.env.RUX_AUTHORIZED_WORKSPACES,
): AuthorizedWorkspace[] {
  if (!raw) return [active];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [active];
    const workspaces = parsed.flatMap((value): AuthorizedWorkspace[] => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Record<string, unknown>;
      return typeof candidate.id === "string"
        && typeof candidate.name === "string"
        && typeof candidate.path === "string"
        ? [{ id: candidate.id, name: candidate.name, path: candidate.path }]
        : [];
    });
    return workspaces.some((workspace) => workspace.id === active.id)
      ? workspaces
      : [active, ...workspaces];
  } catch {
    return [active];
  }
}
