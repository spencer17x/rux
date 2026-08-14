import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  agentProfileInputSchema,
  agentProfilePatchSchema,
  agentProfileSchema,
  agentRevisionIdFor,
  agentRevisionSchema,
  defaultModelState,
  officialCliProviderConnection,
  type AgentProfile,
  type AgentProfileInput,
  type AgentRevision,
  type ModelSource,
  type ModelVerificationStatus,
} from "../shared/protocol.ts";

const legacyAgentProfileSchema = z.object({
  id: z.string().regex(/^custom-[a-f0-9-]{36}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400),
  backend: z.enum(["claude-code", "codex"]),
  model: z.string().trim().min(1).max(120).optional(),
  reasoningEffort: z.string().trim().min(1).max(64).optional(),
  instructions: z.string().trim().min(1).max(20_000),
  permissionMode: z.enum(["plan", "acceptEdits", "dontAsk"]),
  skillIds: z.array(z.string().trim().min(1).max(120)).max(64),
  toolIds: z.array(z.string().trim().min(1).max(120)).max(64),
  enabled: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

const persistedAgentProfilesV1Schema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  profiles: z.array(legacyAgentProfileSchema),
}).strict();

const persistedAgentProfilesV2Schema = z.object({
  version: z.literal(2),
  storeRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  profiles: z.array(agentProfileSchema),
  agentRevisions: z.array(agentRevisionSchema),
}).strict().superRefine((state, context) => {
  const profileIds = new Set<string>();
  const revisionIds = new Set<string>();
  state.profiles.forEach((profile, index) => {
    if (profileIds.has(profile.id)) {
      context.addIssue({ code: "custom", path: ["profiles", index, "id"], message: "Agent profile ids must be unique" });
    }
    profileIds.add(profile.id);
  });
  state.agentRevisions.forEach((revision, index) => {
    if (revisionIds.has(revision.id)) {
      context.addIssue({ code: "custom", path: ["agentRevisions", index, "id"], message: "Agent Revision ids must be unique" });
    }
    revisionIds.add(revision.id);
  });
  state.profiles.forEach((profile, index) => {
    const revision = state.agentRevisions.find((candidate) => candidate.id === profile.latestRevisionId);
    if (!revision || revision.profileId !== profile.id || revision.revisionNumber !== profile.revisionNumber) {
      context.addIssue({
        code: "custom",
        path: ["profiles", index, "latestRevisionId"],
        message: "Agent profile must reference its persisted latest Revision",
      });
    }
  });
});

type AgentProfileStoreOptions = {
  clock?: () => Date;
  idFactory?: () => string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
};

type PersistedAgentProfiles = z.output<typeof persistedAgentProfilesV2Schema>;

const lockWaiter = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function durationOption(value: number | undefined, fallback: number, name: string): number {
  const duration = value ?? fallback;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return duration;
}

function sleepSync(durationMs: number): void {
  if (durationMs <= 0) return;
  Atomics.wait(lockWaiter, 0, 0, durationMs);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function cloneProfile(profile: AgentProfile): AgentProfile {
  return {
    ...profile,
    providerConnection: { ...profile.providerConnection },
    ...(profile.autoModelPolicy ? {
      autoModelPolicy: {
        ...profile.autoModelPolicy,
        simpleModel: { ...profile.autoModelPolicy.simpleModel },
        complexModel: { ...profile.autoModelPolicy.complexModel },
        allowlist: profile.autoModelPolicy.allowlist.map((candidate) => ({ ...candidate })),
      },
    } : {}),
    skillIds: [...profile.skillIds],
    toolIds: [...profile.toolIds],
  };
}

function cloneRevision(revision: AgentRevision): AgentRevision {
  return {
    ...revision,
    providerConnection: { ...revision.providerConnection },
    ...(revision.autoModelPolicy ? {
      autoModelPolicy: {
        ...revision.autoModelPolicy,
        simpleModel: { ...revision.autoModelPolicy.simpleModel },
        complexModel: { ...revision.autoModelPolicy.complexModel },
        allowlist: revision.autoModelPolicy.allowlist.map((candidate) => ({ ...candidate })),
      },
    } : {}),
    skillIds: [...revision.skillIds],
    toolIds: [...revision.toolIds],
  };
}

function selectedModelState(input: {
  model?: string;
  modelSource?: ModelSource;
  modelVerificationStatus?: ModelVerificationStatus;
}): { modelSource: ModelSource; modelVerificationStatus: ModelVerificationStatus } {
  const fallback = defaultModelState(input.model);
  return {
    modelSource: input.modelSource ?? fallback.modelSource,
    modelVerificationStatus: input.modelVerificationStatus ?? fallback.modelVerificationStatus,
  };
}

function revisionFromProfile(profile: AgentProfile, createdAt: string): AgentRevision {
  return agentRevisionSchema.parse({
    id: profile.latestRevisionId,
    profileId: profile.id,
    revisionNumber: profile.revisionNumber,
    origin: "profile-store",
    name: profile.name,
    description: profile.description,
    backend: profile.backend,
    providerConnection: profile.providerConnection,
    ...(profile.model ? { model: profile.model } : {}),
    modelSource: profile.modelSource,
    modelVerificationStatus: profile.modelVerificationStatus,
    ...(profile.autoModelPolicy ? { autoModelPolicy: profile.autoModelPolicy } : {}),
    ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
    instructions: profile.instructions,
    permissionMode: profile.permissionMode,
    skillIds: profile.skillIds,
    toolIds: profile.toolIds,
    enabled: profile.enabled,
    createdAt,
  });
}

function migrateV1(state: z.output<typeof persistedAgentProfilesV1Schema>): PersistedAgentProfiles {
  const profiles = state.profiles.map((legacy) => agentProfileSchema.parse({
    ...legacy,
    providerConnection: officialCliProviderConnection(legacy.backend),
    modelSource: "legacy",
    modelVerificationStatus: "legacy",
    latestRevisionId: agentRevisionIdFor(legacy.id, 1),
    revisionNumber: 1,
  }));
  return persistedAgentProfilesV2Schema.parse({
    version: 2,
    storeRevision: state.revision,
    profiles,
    agentRevisions: profiles.map((profile) => revisionFromProfile(profile, profile.updatedAt)),
  });
}

function emptyState(): PersistedAgentProfiles {
  return { version: 2, storeRevision: 0, profiles: [], agentRevisions: [] };
}

/**
 * Owns non-secret custom Agent definitions and append-only immutable Revisions.
 * Credentials and Engine process discovery remain owned by official adapters.
 */
export class AgentProfileStore {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private state: PersistedAgentProfiles;

  constructor(filePath: string, options: AgentProfileStoreOptions = {}) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.lockTimeoutMs = durationOption(options.lockTimeoutMs, 2_000, "lockTimeoutMs");
    this.lockRetryMs = durationOption(options.lockRetryMs, 10, "lockRetryMs");
    this.state = emptyState();
    this.initialize();
  }

  list(): AgentProfile[] {
    return this.reload().profiles.map(cloneProfile);
  }

  get(id: string): AgentProfile | undefined {
    const profile = this.reload().profiles.find((item) => item.id === id);
    return profile ? cloneProfile(profile) : undefined;
  }

  getRevision(id: string): AgentRevision | undefined {
    const revision = this.reload().agentRevisions.find((item) => item.id === id);
    return revision ? cloneRevision(revision) : undefined;
  }

  listRevisions(profileId: string): AgentRevision[] {
    return this.reload().agentRevisions
      .filter((revision) => revision.profileId === profileId)
      .sort((left, right) => left.revisionNumber - right.revisionNumber)
      .map(cloneRevision);
  }

  create(input: AgentProfileInput): AgentProfile {
    const parsed = agentProfileInputSchema.parse(input);
    return this.mutate((state) => {
      this.assertUniqueName(state.profiles, parsed.name);
      const now = this.clock().toISOString();
      const id = `custom-${this.idFactory()}`;
      const modelState = selectedModelState(parsed);
      const profile = agentProfileSchema.parse({
        ...parsed,
        ...modelState,
        id,
        providerConnection: parsed.providerConnection ?? officialCliProviderConnection(parsed.backend),
        latestRevisionId: agentRevisionIdFor(id, 1),
        revisionNumber: 1,
        createdAt: now,
        updatedAt: now,
      });
      const revision = revisionFromProfile(profile, now);
      return {
        state: {
          ...state,
          profiles: [...state.profiles, profile],
          agentRevisions: [...state.agentRevisions, revision],
        },
        result: cloneProfile(profile),
      };
    });
  }

  update(id: string, patch: z.input<typeof agentProfilePatchSchema>): AgentProfile {
    return this.mutate((state) => {
      const index = state.profiles.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`Agent profile not found: ${id}`);
      const current = state.profiles[index];
      const parsedPatch = agentProfilePatchSchema.parse(patch);
      if (parsedPatch.name !== undefined) this.assertUniqueName(state.profiles, parsedPatch.name, id);
      const now = this.clock().toISOString();
      const revisionNumber = current.revisionNumber + 1;
      const backend = parsedPatch.backend ?? current.backend;
      const model = parsedPatch.model ?? current.model;
      const modelState = selectedModelState({
        model,
        modelSource: parsedPatch.modelSource ?? current.modelSource,
        modelVerificationStatus: parsedPatch.modelVerificationStatus ?? current.modelVerificationStatus,
      });
      const profile = agentProfileSchema.parse({
        ...current,
        ...parsedPatch,
        ...(parsedPatch.autoModelPolicy === null ? { autoModelPolicy: undefined } : {}),
        ...modelState,
        providerConnection: parsedPatch.providerConnection
          ?? (backend === current.backend ? current.providerConnection : officialCliProviderConnection(backend)),
        latestRevisionId: agentRevisionIdFor(id, revisionNumber),
        revisionNumber,
        updatedAt: now,
      });
      const revision = revisionFromProfile(profile, now);
      return {
        state: {
          ...state,
          profiles: state.profiles.map((item, itemIndex) => itemIndex === index ? profile : item),
          agentRevisions: [...state.agentRevisions, revision],
        },
        result: cloneProfile(profile),
      };
    });
  }

  delete(id: string): void {
    this.mutate((state) => {
      const profiles = state.profiles.filter((item) => item.id !== id);
      if (profiles.length === state.profiles.length) throw new Error(`Agent profile not found: ${id}`);
      return { state: { ...state, profiles }, result: undefined };
    });
  }

  private initialize(): void {
    if (!existsSync(this.filePath)) return;
    const release = this.acquireLock();
    try {
      const loaded = this.readWithVersion();
      if (loaded.migrated) this.persist(loaded.state);
      this.state = loaded.state;
    } finally {
      release();
    }
  }

  private readWithVersion(): { state: PersistedAgentProfiles; migrated: boolean } {
    if (!existsSync(this.filePath)) return { state: emptyState(), migrated: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read Agent profiles at ${this.filePath}`, { cause: error });
    }
    try {
      if (typeof parsed === "object" && parsed !== null && "version" in parsed && parsed.version === 1) {
        return { state: migrateV1(persistedAgentProfilesV1Schema.parse(parsed)), migrated: true };
      }
      return { state: persistedAgentProfilesV2Schema.parse(parsed), migrated: false };
    } catch (error) {
      throw new Error(`Invalid Agent profile store at ${this.filePath}`, { cause: error });
    }
  }

  private reload(): PersistedAgentProfiles {
    const latest = this.readWithVersion().state;
    if (latest.storeRevision < this.state.storeRevision) {
      throw new Error(`Agent profile store revision moved backwards at ${this.filePath}`);
    }
    this.state = latest;
    return latest;
  }

  private assertUniqueName(profiles: AgentProfile[], name: string, exceptId?: string): void {
    const normalized = name.trim().toLocaleLowerCase();
    if (profiles.some((profile) => profile.id !== exceptId
      && profile.name.trim().toLocaleLowerCase() === normalized)) {
      throw new Error(`Agent profile name already exists: ${name.trim()}`);
    }
  }

  private mutate<Result>(
    apply: (state: PersistedAgentProfiles) => { state: PersistedAgentProfiles; result: Result },
  ): Result {
    const release = this.acquireLock();
    try {
      const latest = this.reload();
      const mutation = apply(latest);
      const next = persistedAgentProfilesV2Schema.parse({
        ...mutation.state,
        version: 2,
        storeRevision: latest.storeRevision + 1,
      });
      this.persist(next);
      this.state = next;
      return mutation.result;
    } finally {
      release();
    }
  }

  private persist(state: PersistedAgentProfiles): void {
    const parsed = persistedAgentProfilesV2Schema.parse(state);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const descriptor = openSync(temporaryPath, "wx", 0o600);
      try {
        writeFileSync(descriptor, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporaryPath, this.filePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  private acquireLock(): () => void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const startedAt = performance.now();
    const token = `${process.pid}:${randomUUID()}`;
    while (true) {
      let descriptor: number;
      try {
        descriptor = openSync(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") {
          throw new Error(`Unable to acquire Agent profile store lock at ${this.lockPath}`, { cause: error });
        }
        const elapsed = performance.now() - startedAt;
        if (elapsed >= this.lockTimeoutMs) {
          throw new Error(
            `Timed out acquiring Agent profile store lock at ${this.lockPath} after ${this.lockTimeoutMs}ms`,
            { cause: error },
          );
        }
        sleepSync(Math.min(this.lockRetryMs, this.lockTimeoutMs - elapsed));
        continue;
      }
      try {
        writeFileSync(descriptor, `${token}\n`, "utf8");
        fsyncSync(descriptor);
      } catch (error) {
        try {
          closeSync(descriptor);
        } finally {
          rmSync(this.lockPath, { force: true });
        }
        throw new Error(`Unable to initialize Agent profile store lock at ${this.lockPath}`, { cause: error });
      }
      return () => {
        try {
          closeSync(descriptor);
        } finally {
          let owner: string;
          try {
            owner = readFileSync(this.lockPath, "utf8");
          } catch (error) {
            if (errorCode(error) === "ENOENT") return;
            throw error;
          }
          if (owner !== `${token}\n`) {
            throw new Error(`Agent profile store lock ownership changed at ${this.lockPath}`);
          }
          rmSync(this.lockPath, { force: true });
        }
      };
    }
  }
}
