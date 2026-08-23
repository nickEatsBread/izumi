import { idle } from './idle'

type BootTask = {
  key: string
  readyAt: number
  promoted: boolean
  run: () => void | Promise<void>
  resolve: () => void
}

/** One-at-a-time post-boot work. Delays are minimums; promotion makes user-needed work next. */
export class BootWorkQueue {
  private static readonly ACTIVITY_GRACE_MS = 900
  private readonly startedAt = Date.now()
  private tasks: BootTask[] = []
  private running = false
  private lastActivityAt = Number.NEGATIVE_INFINITY
  private lastActivityArmAt = Number.NEGATIVE_INFINITY
  private timer: ReturnType<typeof setTimeout> | undefined
  private idleHandle: { cancel: () => void } | undefined

  constructor() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const noteActivity = () => {
      const now = Date.now()
      this.lastActivityAt = now
      // Wheel can arrive at display refresh rate. Updating the grace timestamp is cheap; timer
      // cancellation/recreation only needs to happen a few times a second.
      if (now - this.lastActivityArmAt < 120) return
      this.lastActivityArmAt = now
      // Re-arm so a fallback timer on WebKitGTK cannot fire in the middle of active scrolling.
      this.arm(true)
    }
    // Input already tells us the user is active. Listening to programmatic `scroll` as well made
    // every controller reveal re-arm timers during the animation and added work to each frame.
    for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
      window.addEventListener(event, noteActivity, { capture: true, passive: true })
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.arm(true))
    }
  }

  schedule(key: string, run: () => void | Promise<void>, delayMs: number): Promise<void> {
    const existing = this.tasks.find((task) => task.key === key)
    if (existing) return Promise.resolve()
    const promise = new Promise<void>((resolve) => {
      this.tasks.push({ key, run, resolve, readyAt: this.startedAt + Math.max(0, delayMs), promoted: false })
    })
    // A newly registered task may have an earlier minimum than the timer already armed.
    this.arm(true)
    return promise
  }

  promote(key: string): void {
    const task = this.tasks.find((candidate) => candidate.key === key)
    if (!task) return
    task.promoted = true
    task.readyAt = Date.now()
    this.arm(true)
  }

  private next(): BootTask | undefined {
    return [...this.tasks].sort((a, b) =>
      Number(b.promoted) - Number(a.promoted) || a.readyAt - b.readyAt)[0]
  }

  private arm(rearm = false): void {
    if (this.running) return
    if (rearm) {
      if (this.timer) clearTimeout(this.timer)
      this.idleHandle?.cancel()
      this.timer = undefined
      this.idleHandle = undefined
    } else if (this.timer || this.idleHandle) return
    const task = this.next()
    if (!task) return
    const wait = Math.max(0, task.readyAt - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.idleHandle = idle(() => {
        this.idleHandle = undefined
        void this.runNext()
      }, task.promoted ? 0 : 250)
    }, wait)
  }

  private async runNext(): Promise<void> {
    if (this.running) return
    const task = this.next()
    if (!task || task.readyAt > Date.now()) { this.arm(); return }
    if (!task.promoted) {
      const now = Date.now()
      const recentlyActive = now - this.lastActivityAt < BootWorkQueue.ACTIVITY_GRACE_MS
      const hidden = typeof document !== 'undefined' && document.hidden
      if (hidden || recentlyActive) {
        task.readyAt = hidden
          ? now + 5000
          : Math.max(task.readyAt, this.lastActivityAt + BootWorkQueue.ACTIVITY_GRACE_MS)
        this.arm()
        return
      }
    }
    this.tasks = this.tasks.filter((candidate) => candidate !== task)
    this.running = true
    try { await task.run() } catch { /* warm work is best-effort */ }
    finally {
      this.running = false
      task.resolve()
      this.arm()
    }
  }
}

const bootWork = new BootWorkQueue()

export const scheduleBootWork = (key: string, run: () => void | Promise<void>, delayMs: number) =>
  bootWork.schedule(key, run, delayMs)

export const promoteBootWork = (key: string) => bootWork.promote(key)
