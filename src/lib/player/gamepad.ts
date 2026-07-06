import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { RepeatTimer } from './repeat'

// Tunables (seconds + ms). Ramp/interval numbers govern how fast a held trigger scrubs;
// tune on-device if the fast end feels too slow/quick.
export const SEEK = {
  tap: 10,
  step: 5,
  initialDelay: 250,
  startInterval: 250,
  minInterval: 60,
  ramp: 1600,
} as const

export interface SeekDeps {
  getPos: () => number
  getDur: () => number
  seek: (absTime: number) => void
  beginScrub: (t: number) => void
  moveScrub: (t: number) => void
  endScrub: () => void
  onActivity: () => void
}

const clamp = (t: number, dur: number) => Math.max(0, Math.min(dur, t))

// One trigger (dir = -1 rewind / +1 forward). Fed one frame at a time.
export class TriggerScrubber {
  private timer = new RepeatTimer({
    initialDelay: SEEK.initialDelay,
    startInterval: SEEK.startInterval,
    minInterval: SEEK.minInterval,
    ramp: SEEK.ramp,
  })
  private wasPressed = false
  private scrubbing = false
  private preview = 0

  constructor(private dir: 1 | -1, private d: SeekDeps) {}

  update(pressed: boolean, now: number): void {
    if (pressed && !this.wasPressed) {
      this.timer.press(now)
      this.scrubbing = false
    } else if (pressed && this.wasPressed) {
      if (this.timer.tick(now)) {
        if (!this.scrubbing) {
          this.scrubbing = true
          this.preview = this.d.getPos()
          this.d.onActivity()
          this.d.beginScrub(this.preview)
        }
        this.preview = clamp(this.preview + SEEK.step * this.dir, this.d.getDur())
        this.d.moveScrub(this.preview)
      }
    } else if (!pressed && this.wasPressed) {
      if (this.scrubbing) {
        this.d.endScrub()
      } else {
        this.d.onActivity()
        this.d.seek(clamp(this.d.getPos() + SEEK.tap * this.dir, this.d.getDur()))
      }
      this.scrubbing = false
      this.timer.release()
    }
    this.wasPressed = pressed
  }
}

const TRIGGER_ON = 0.3 // analog trigger considered "pressed" above this value

// Start polling the Deck triggers and driving seek/scrub. Returns a stop function.
// `debug` logs gamepad connect + first presses so we can confirm input reaches the webview.
export function startGamepadSeek(d: SeekDeps, debug = false): () => void {
  const l2 = new TriggerScrubber(-1, d)
  const r2 = new TriggerScrubber(+1, d)
  let raf = 0
  let loggedPad = false

  const pressedVal = (b: GamepadButton | undefined) =>
    !!b && (b.pressed || b.value > TRIGGER_ON)

  const loop = () => {
    const pads = navigator.getGamepads?.() ?? []
    for (const pad of pads) {
      if (!pad) continue
      if (debug && !loggedPad) { loggedPad = true; console.log('[gp] pad:', pad.id, 'buttons:', pad.buttons.length) }
      const now = performance.now()
      const L = pressedVal(pad.buttons[6])
      const R = pressedVal(pad.buttons[7])
      if (debug && (L || R)) console.log('[gp] L2', L, 'R2', R)
      l2.update(L, now)
      r2.update(R, now)
      break // first connected pad only
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => cancelAnimationFrame(raf)
}

// Steam Deck path: the webview's Gamepad API doesn't see the Deck controller, so the Rust
// backend reads it via evdev and emits `gamepad-trigger` = [l2, r2] booleans. We feed those
// into the same TriggerScrubbers, driven by a rAF loop (so the accelerating hold-scrub still
// ticks). Returns a stop function. Used in Game mode instead of startGamepadSeek.
export function startNativeGamepadSeek(d: SeekDeps): () => void {
  const l2 = new TriggerScrubber(-1, d)
  const r2 = new TriggerScrubber(+1, d)
  const held = { L: false, R: false }
  let raf = 0
  let unlisten: (() => void) | null = null

  invoke('gamepad_start').catch(() => {})
  listen<[boolean, boolean]>('gamepad-trigger', (e) => {
    held.L = e.payload[0]
    held.R = e.payload[1]
  }).then((u) => { unlisten = u })

  const loop = () => {
    const now = performance.now()
    l2.update(held.L, now)
    r2.update(held.R, now)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return () => {
    cancelAnimationFrame(raf)
    unlisten?.()
    invoke('gamepad_stop').catch(() => {})
  }
}
