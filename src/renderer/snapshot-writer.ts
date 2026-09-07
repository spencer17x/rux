// Coalesce frequent updates while keeping writes ordered and bounding save latency.
export class SnapshotWriter<T> {
  private pending: { value: T } | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | undefined;

  constructor(private save: (value: T) => Promise<unknown>, private onError: (error: unknown) => void, private delay = 250, private maxWait = 1000) {}

  schedule(value: T): void {
    this.pending = { value };
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.flush(), this.delay);
    this.deadline ??= setTimeout(() => void this.flush(), this.maxWait);
  }

  flush(): Promise<void> {
    clearTimeout(this.debounce);
    clearTimeout(this.deadline);
    this.debounce = this.deadline = undefined;
    if (this.writing) return this.writing.then(() => this.flush());
    const snapshot = this.pending;
    if (!snapshot) return Promise.resolve();
    this.pending = undefined;
    this.writing = Promise.resolve().then(() => this.save(snapshot.value)).then(() => {}, (error) => {
      // Retain failed data for retry, but never replace a newer queued snapshot.
      this.pending ??= snapshot;
      this.onError(error);
    }).finally(() => { this.writing = undefined; });
    return this.writing;
  }
}
