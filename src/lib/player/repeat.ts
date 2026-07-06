export interface RepeatConfig {
  initialDelay: number
  startInterval: number
  minInterval: number
  ramp: number
}

// Accelerating repeat: silent until initialDelay, then fires at startInterval, easing
// linearly down to minInterval across `ramp` ms of continued holding.
export class RepeatTimer {
  private heldSince: number | null = null
  private lastFire = 0
  constructor(private cfg: RepeatConfig) {}

  press(now: number): void {
    this.heldSince = now
    this.lastFire = now
  }

  release(): void {
    this.heldSince = null
  }

  private intervalAt(now: number): number {
    const held = now - (this.heldSince ?? now)
    const elapsed = Math.max(0, held - this.cfg.initialDelay)
    const f = Math.min(1, elapsed / this.cfg.ramp)
    return this.cfg.startInterval + (this.cfg.minInterval - this.cfg.startInterval) * f
  }

  tick(now: number): boolean {
    if (this.heldSince === null) return false
    if (now - this.heldSince < this.cfg.initialDelay) return false
    if (now - this.lastFire >= this.intervalAt(now) - 1e-6) {
      this.lastFire = now
      return true
    }
    return false
  }
}
