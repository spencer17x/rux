import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const localProductEventKinds = [
  "cli-detection",
  "run-succeeded",
  "run-failed",
  "restart-recovery",
  "session-imported",
  "session-import-deduplicated",
  "session-continued",
  "task-branched",
  "error-recovery-attempted",
  "error-recovered",
] as const;
export type LocalProductEventKind = (typeof localProductEventKinds)[number];

type LocalProductEvent = {
  id: string;
  kind: LocalProductEventKind;
  occurredAt: string;
  subjectHash?: string;
  engine?: "codex" | "claude-code" | "rux-native" | "mock";
  mode?: "view" | "continue" | "handoff";
  count?: number;
};
type StoredState = { version: 1; events: LocalProductEvent[] };

export type LocalProductEventSummary = {
  storage: "main-local-only";
  totalEvents: number;
  firstEventAt?: string;
  lastEventAt?: string;
  firstSuccessfulRunAt?: string;
  counts: Record<LocalProductEventKind, number>;
};

const emptyCounts = (): Record<LocalProductEventKind, number> => Object.fromEntries(localProductEventKinds.map((kind) => [kind, 0])) as Record<LocalProductEventKind, number>;

export class LocalProductEventStore {
  readonly #filePath: string;
  #state: StoredState;
  #loadError: Error | undefined;

  constructor(filePath: string) {
    this.#filePath = filePath;
    this.#state = this.#load();
  }

  record(kind: LocalProductEventKind, dimensions: Omit<LocalProductEvent, "id" | "kind" | "occurredAt"> = {}): void {
    if (this.#loadError) throw this.#loadError;
    if (!localProductEventKinds.includes(kind)) throw new Error("Unsupported local product event");
    const event: LocalProductEvent = { id: randomUUID(), kind, occurredAt: new Date().toISOString(), ...dimensions };
    this.#state.events = [...this.#state.events.slice(-9_999), event];
    this.#persist();
  }

  has(kind: LocalProductEventKind, subjectHash: string): boolean {
    return this.#state.events.some((event) => event.kind === kind && event.subjectHash === subjectHash);
  }

  summary(): LocalProductEventSummary {
    if (this.#loadError) throw this.#loadError;
    const counts = emptyCounts();
    for (const event of this.#state.events) counts[event.kind] += event.count ?? 1;
    return {
      storage: "main-local-only",
      totalEvents: this.#state.events.length,
      ...(this.#state.events[0] ? { firstEventAt: this.#state.events[0].occurredAt } : {}),
      ...(this.#state.events.at(-1) ? { lastEventAt: this.#state.events.at(-1)!.occurredAt } : {}),
      ...(this.#state.events.find((event) => event.kind === "run-succeeded") ? { firstSuccessfulRunAt: this.#state.events.find((event) => event.kind === "run-succeeded")!.occurredAt } : {}),
      counts,
    };
  }

  #load(): StoredState {
    try {
      const parsed = JSON.parse(readFileSync(this.#filePath, "utf8")) as StoredState;
      if (parsed.version !== 1 || !Array.isArray(parsed.events)) throw new Error(`Unsupported local product event store version: ${String(parsed?.version ?? "missing")}`);
      return { version: 1, events: parsed.events.filter((event) => event && localProductEventKinds.includes(event.kind)).slice(-10_000) };
    } catch (error) {
      try {
        readFileSync(this.#filePath, "utf8");
        this.#loadError = new Error(`Local product event store is unreadable and was preserved: ${error instanceof Error ? error.message : String(error)}`);
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT") this.#loadError = new Error(`Local product event store cannot be read: ${String(readError)}`);
      }
      return { version: 1, events: [] };
    }
  }

  #persist(): void {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.#filePath);
  }
}
