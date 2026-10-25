type ScheduleFrame = (callback: FrameRequestCallback) => number
type CancelFrame = (handle: number) => void

/** A requestAnimationFrame loop that exists only while its caller has active work. */
export class ActiveFrameLoop {
  private frame: number | null = null

  // The defaults call the globals rather than storing them: `this.schedule(cb)` on a stored
  // requestAnimationFrame calls it on this object, which WebKit and Chromium reject ("Can only call
  // Window.requestAnimationFrame on instances of Window"), so a held D-pad never repeated.
  constructor(
    private readonly step: () => boolean,
    private readonly schedule: ScheduleFrame = (callback) => requestAnimationFrame(callback),
    private readonly cancel: CancelFrame = (handle) => cancelAnimationFrame(handle),
  ) {}

  private readonly tick: FrameRequestCallback = () => {
    this.frame = null
    if (this.step()) this.frame = this.schedule(this.tick)
  }

  start(): void {
    if (this.frame == null) this.frame = this.schedule(this.tick)
  }

  stop(): void {
    if (this.frame == null) return
    this.cancel(this.frame)
    this.frame = null
  }
}
