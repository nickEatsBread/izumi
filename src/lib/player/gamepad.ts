import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { RepeatTimer } from './repeat'
import { ActiveFrameLoop } from '$lib/util/active-frame-loop'

// Tunables (seconds + ms). Ramp/interval numbers govern how fast a held trigger scrubs;
// tune on-device if the fast end feels too slow/quick.
export const SEEK = {
  tap: 10,
  step: 5,
  initialDelay: 200,
  startInterval: 200,
  minInterval: 60,
  ramp: 1600,
} as const

// Digital D-pad input should start repeating sooner than an analogue trigger. More importantly,
// separate presses share their requested target for a short burst: mpv may emit an older
// time-pos while an exact seek is settling, and rebasing the next press on that event made the
// second/third press appear delayed or move the bar backwards.
export const DPAD_SEEK = {
  initialDelay: 120,
  startInterval: 100,
  minInterval: 45,
  ramp: 900,
  chainMs: 800,
} as const

export interface DpadSeekChain {
  target: number
  updatedAt: number
}

/** One logical press per physical button cycle, with a short bounce guard for Steam's duplicate
 * virtual-controller edges. Used by View/Select so one press cannot close then reopen comments. */
export class ButtonPressLatch {
  private held = false
  private lastAccepted = -Infinity

  constructor(private readonly bounceMs = 350) {}

  update(pressed: boolean, now: number): boolean {
    if (!pressed) {
      this.held = false
      return false
    }
    if (this.held || now - this.lastAccepted < this.bounceMs) return false
    this.held = true
    this.lastAccepted = now
    return true
  }
}

export interface SeekDeps {
  getPos: () => number
  getDur: () => number
  seek: (absTime: number, source: 'trigger' | 'dpad') => void
  beginScrub: (t: number, source: 'trigger' | 'dpad') => void
  moveScrub: (t: number) => void
  endScrub: () => void
  onActivity: () => void
  /** When true, left/right (and the triggers) are ignored — comments/menus own the pad. */
  blocked?: () => boolean
}

const clamp = (t: number, dur: number) =>
  Number.isFinite(dur) && dur > 0
    ? Math.max(0, Math.min(dur, t))
    : Math.max(0, t)

// One trigger (dir = -1 rewind / +1 forward). Fed one frame at a time.
export class TriggerScrubber {
  private timer: RepeatTimer
  private wasPressed = false
  private scrubbing = false
  private preview = 0
  private tapFired = false

  constructor(
    private dir: 1 | -1,
    private d: SeekDeps,
    private source: 'trigger' | 'dpad' = 'trigger',
    private dpadChain: DpadSeekChain = { target: 0, updatedAt: Number.NEGATIVE_INFINITY },
  ) {
    const timing = source === 'dpad' ? DPAD_SEEK : SEEK
    this.timer = new RepeatTimer(timing)
  }

  update(pressed: boolean, now: number): void {
    if (pressed && !this.wasPressed) {
      this.timer.press(now)
      this.scrubbing = false
      this.tapFired = false
      // Triggers intentionally reveal the controls so a hold gesture has immediate feedback.
      // D-pad taps are quiet seeks: they must not bring the whole player chrome back on screen.
      if (this.source === 'trigger') this.d.onActivity()
      // D-pad seeking is digital and should update on press, like Leanback. Triggers retain the
      // release-to-tap distinction so a trigger hold can become a scrub without a surprise jump.
      if (this.source === 'dpad') {
        const base = now - this.dpadChain.updatedAt <= DPAD_SEEK.chainMs
          ? this.dpadChain.target
          : this.d.getPos()
        this.preview = clamp(base + SEEK.tap * this.dir, this.d.getDur())
        this.dpadChain.target = this.preview
        this.dpadChain.updatedAt = now
        this.d.seek(this.preview, this.source)
        this.tapFired = true
      }
    } else if (pressed && this.wasPressed) {
      if (this.timer.tick(now)) {
        if (!this.scrubbing) {
          this.scrubbing = true
          this.preview = this.source === 'dpad' && now - this.dpadChain.updatedAt <= DPAD_SEEK.chainMs
            ? this.dpadChain.target
            : this.d.getPos()
          if (this.source === 'trigger') this.d.onActivity()
          this.d.beginScrub(this.preview, this.source)
        }
        this.preview = clamp(this.preview + SEEK.step * this.dir, this.d.getDur())
        if (this.source === 'dpad') {
          this.dpadChain.target = this.preview
          this.dpadChain.updatedAt = now
        }
        this.d.moveScrub(this.preview)
      }
    } else if (!pressed && this.wasPressed) {
      if (this.scrubbing) {
        this.d.endScrub()
      } else if (!this.tapFired) {
        this.d.seek(clamp(this.d.getPos() + SEEK.tap * this.dir, this.d.getDur()), this.source)
      }
      this.scrubbing = false
      this.tapFired = false
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
// backend reads it via evdev and emits `gamepad-input` = { name, pressed }. We pick out l2/r2
// and feed the TriggerScrubbers, driven by a rAF loop (so the accelerating hold-scrub still
// ticks). The reader itself is started app-wide (see nav/gamepad.ts + the app layout); this
// only subscribes. Returns a stop function. Used in Game mode.
export function startNativeGamepadSeek(d: SeekDeps): () => void {
  const l2 = new TriggerScrubber(-1, d)
  const r2 = new TriggerScrubber(+1, d)
  const dpadChain: DpadSeekChain = { target: 0, updatedAt: Number.NEGATIVE_INFINITY }
  const dpadLeft = new TriggerScrubber(-1, d, 'dpad', dpadChain)
  const dpadRight = new TriggerScrubber(+1, d, 'dpad', dpadChain)
  const held = { L: false, R: false, left: false, right: false }
  let unlisten: (() => void) | null = null
  let disposed = false

  invoke('gamepad_start').catch(() => {})

  const anyHeld = () => held.L || held.R || held.left || held.right
  const tick = () => {
    const now = performance.now()
    if (d.blocked?.()) {
      l2.update(false, now)
      r2.update(false, now)
      dpadLeft.update(false, now)
      dpadRight.update(false, now)
      return false
    }
    l2.update(held.L, now)
    r2.update(held.R, now)
    dpadLeft.update(held.left, now)
    dpadRight.update(held.right, now)
    return anyHeld()
  }
  const repeatLoop = new ActiveFrameLoop(tick)

  listen<{ name: string; pressed: boolean }>('gamepad-input', (e) => {
    if (e.payload.name === 'l2') held.L = e.payload.pressed
    else if (e.payload.name === 'r2') held.R = e.payload.pressed
    else if (e.payload.name === 'left') held.left = e.payload.pressed
    else if (e.payload.name === 'right') held.right = e.payload.pressed
    else return
    tick()
    if (anyHeld()) repeatLoop.start()
    else repeatLoop.stop()
  }).then(async (u) => {
    if (disposed) { u(); return }
    unlisten = u
    try {
      const state = await invoke<{ l2: boolean; r2: boolean }>('gamepad_trigger_state')
      if (!disposed) {
        held.L = state.l2
        held.R = state.r2
        tick()
        if (held.L || held.R) repeatLoop.start()
      }
    } catch { /* best effort: live events will still update state */ }
  })

  return () => {
    disposed = true
    repeatLoop.stop()
    unlisten?.()
  }
}
