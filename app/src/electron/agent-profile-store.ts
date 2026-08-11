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
  type AgentProfile,
  type AgentProfileInput,
} from "../shared/protocol.ts";

const persistedAgentProfilesSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  profiles: z.array(agentProfileSchema),
}).strict();

type AgentProfileStoreOptions = {
  clock?: () => Date;
  idFactory?: () => string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
};

type PersistedAgentProfiles = z.output<typeof persistedAgentProfilesSchema>;

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
    skillIds: [...profile.skillIds],
    toolIds: [...profile.toolIds],
  };
}

/**
 * Owns non-secret custom Agent profiles.
 *
 * Profiles compose an installed, trusted backend with user instructions and
 * policy. They deliberately cannot contain tokens, credential paths, or an
 * arbitrary executable. Authentication and process discovery remain owned by
 * the official backend adapters.
 */
export class AgentProfileStore {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private state: PersistedAgentProfiles;

  constructor(
    filePath: string,
    options: AgentProfileStoreOptions = {},
  ) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.lockTimeoutMs = durationOption(options.lockTimeoutMs, 2_000, "lockTimeoutMs");
    this.lockRetryMs = durationOption(options.lockRetryMs, 10, "lockRetryMs");
    this.state = this.read();
  }

  list(): AgentProfile[] {
    return this.reload().profiles.map(cloneProfile);
  }

  get(id: string): AgentProfile | undefined {
    const profile = this.reload().profiles.find((item) => item.id === id);
    return profile ? cloneProfile(profile) : undefined;
  }

  create(input: AgentProfileInput): AgentProfile {
    const parsed = agentProfileInputSchema.parse(input);
    return this.mutate((profiles) => {
      this.assertUniqueName(profiles, parsed.name);
      const now = this.clock().toISOString();
      const profile = agentProfileSchema.parse({
        ...parsed,
        id: `custom-${this.idFactory()}`,
        createdAt: now,
        updatedAt: now,
      });
      return {
        profiles: [...profiles, profile],
        result: cloneProfile(profile),
      };
    });
  }

  update(id: string, patch: z.input<typeof agentProfilePatchSchema>): AgentProfile {
    return this.mutate((profiles) => {
      const index = profiles.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`Agent profile not found: ${id}`);
      const parsedPatch = agentProfilePatchSchema.parse(patch);
      if (parsedPatch.name !== undefined) {
        this.assertUniqueName(profiles, parsedPatch.name, id);
      }
      const profile = agentProfileSchema.parse({
        ...profiles[index],
        ...parsedPatch,
        updatedAt: this.clock().toISOString(),
      });
      return {
        profiles: profiles.map((item, itemIndex) => itemIndex === index ? profile : item),
        result: cloneProfile(profile),
      };
    });
  }

  delete(id: string): void {
    this.mutate((profiles) => {
      const next = profiles.filter((item) => item.id !== id);
      if (next.length === profiles.length) throw new Error(`Agent profile not found: ${id}`);
      return { profiles: next, result: undefined };
    });
  }

  private read(): PersistedAgentProfiles {
    if (!existsSync(this.filePath)) return { version: 1, revision: 0, profiles: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read Agent profiles at ${this.filePath}`, { cause: error });
    }
    try {
      return persistedAgentProfilesSchema.parse(parsed);
    } catch (error) {
      throw new Error(`Invalid Agent profile store at ${this.filePath}`, { cause: error });
    }
  }

  private reload(): PersistedAgentProfiles {
    const latest = this.read();
    if (latest.revision < this.state.revision) {
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
    apply: (profiles: AgentProfile[]) => { profiles: AgentProfile[]; result: Result },
  ): Result {
    // The sibling lock serializes Desktop and TUI writers. Reloading only after
    // acquisition makes the mutation operate on the preceding writer's revision.
    const release = this.acquireLock();
    try {
      const latest = this.reload();
      const mutation = apply(latest.profiles);
      const next = persistedAgentProfilesSchema.parse({
        version: 1,
        revision: latest.revision + 1,
        profiles: mutation.profiles,
      });
      this.persist(next);
      this.state = next;
      return mutation.result;
    } finally {
      release();
    }
  }

  private persist(state: PersistedAgentProfiles): void {
    const parsed = persistedAgentProfilesSchema.parse(state);
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
          throw new Error(`Unable to acquire Agent profile store lock at ${this.lockPath}`, {
            cause: error,
          });
        }
        const elapsed = performance.now() - startedAt;
        if (elapsed >= this.lockTimeoutMs) {
          // Never reap an unowned lock: a timeout is safer than allowing two
          // processes to enter the read-modify-write section concurrently.
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
        throw new Error(`Unable to initialize Agent profile store lock at ${this.lockPath}`, {
          cause: error,
        });
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
