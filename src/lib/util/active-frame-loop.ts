type ScheduleFrame = (callback: FrameRequestCallback) => number
type CancelFrame = (handle: number) => void

/** A requestAnimationFrame loop that exists only while its caller has active work. */
export class ActiveFrameLoop {
  private frame: number | null = null

  constructor(
    private readonly step: () => boolean,
    private readonly schedule: ScheduleFrame = requestAnimationFrame,
    private readonly cancel: CancelFrame = cancelAnimationFrame,
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
