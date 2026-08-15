interface SourceHealth {
  latencyMs: number
  failures: number
}

interface QueuedSource<T> {
  key: string
  sequence: number
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const UNKNOWN_SOURCE_SCORE_MS = 5_000
const FAILURE_PENALTY_MS = 15_000

/** Keep broad extension repositories from monopolising the shared native HTTP pool. Two slots suit
 *  low-core Android devices; Deck-class hardware gets three; larger desktops can use four. */
export function adaptiveSourceConcurrency(hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 8): number {
  if (hardwareConcurrency <= 4) return 2
  if (hardwareConcurrency <= 8) return 3
  return 4
}

/** A session-only source queue. Stable ordering is retained for unseen sources; later resolves put
 *  responsive sources first and failed/slow ones later without ever suppressing a source. */
export class SourceScheduler {
  private active = 0
  private sequence = 0
  private pumpScheduled = false
  private readonly queue: QueuedSource<unknown>[] = []
  private readonly health = new Map<string, SourceHealth>()

  constructor(
    private readonly concurrency: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        key,
        sequence: this.sequence++,
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.schedulePump()
    })
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return
    this.pumpScheduled = true
    queueMicrotask(() => {
      this.pumpScheduled = false
      this.pump()
    })
  }

  private score(key: string): number {
    const health = this.health.get(key)
    if (!health) return UNKNOWN_SOURCE_SCORE_MS
    return health.latencyMs + health.failures * FAILURE_PENALTY_MS
  }

  private record(key: string, durationMs: number, failed: boolean): void {
    const previous = this.health.get(key)
    this.health.set(key, {
      latencyMs: previous ? previous.latencyMs * 0.7 + durationMs * 0.3 : durationMs,
      failures: failed ? Math.min(3, (previous?.failures ?? 0) + 1) : Math.max(0, (previous?.failures ?? 0) - 1),
    })
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      this.queue.sort((a, b) => this.score(a.key) - this.score(b.key) || a.sequence - b.sequence)
      const queued = this.queue.shift()!
      this.active += 1
      const startedAt = this.now()
      Promise.resolve()
        .then(queued.task)
        .then((value) => {
          this.record(queued.key, this.now() - startedAt, false)
          queued.resolve(value)
        }, (error) => {
          this.record(queued.key, this.now() - startedAt, true)
          queued.reject(error)
        })
        .finally(() => {
          this.active -= 1
          this.schedulePump()
        })
    }
  }
}

export const extensionSourceScheduler = new SourceScheduler(adaptiveSourceConcurrency())
