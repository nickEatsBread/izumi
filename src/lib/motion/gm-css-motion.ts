// Game mode (WebKitGTK 2.52 under gamescope): a CSS animation of `opacity` or `transform` runs on
// a compositor layer that WebKit drops when it ends, and a frame can go out before the page tiles
// hold the element again, so it blinks once as it settles. Measured on the Deck: a theme's caption under
// the focused card blinked out for a frame at the end of every move, and the Schedule panels blinked after
// their entrance. Script-driven motion does not blink (gm-motion.ts), but host components and theme
// stylesheets declare CSS motion. So in Game mode each such animation is taken over as it starts and the
// same keyframes, timing and easing are played as per-frame inline styles: the motion stays, and the
// element never changes compositing layers. Anything this cannot replay exactly (rotation, steps(),
// repeats, other properties) is left to CSS.

export type Easing = (t: number) => number
/** A transform made only of scales and translations: [scaleX, scaleY, translateX, translateY] in px. */
export type ScaleTranslate = [number, number, number, number]
type Prop = 'opacity' | 'transform'

/** What a transform length is relative to, for one element. */
export interface LengthContext { rem: number; em: number; width: number; height: number }

export interface TakeoverFrame { offset: number; easing: Easing; opacity?: number; transform?: ScaleTranslate }

const MAX_DURATION_MS = 2000
const META_KEYS = new Set(['offset', 'computedOffset', 'easing', 'composite'])

/** CSS cubic-bezier(): solves x(u) = t for u by Newton's method with a bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const curve = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3
  const slope = (a: number, b: number, u: number) => 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u
  return (t) => {
    if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1
    let u = t
    for (let i = 0; i < 8; i++) {
      const error = curve(x1, x2, u) - t
      const d = slope(x1, x2, u)
      if (Math.abs(error) < 1e-6) return curve(y1, y2, u)
      if (Math.abs(d) < 1e-6) break
      u -= error / d
    }
    let lo = 0
    let hi = 1
    u = t
    for (let i = 0; i < 40 && hi - lo > 1e-7; i++) {
      if (curve(x1, x2, u) < t) lo = u
      else hi = u
      u = (lo + hi) / 2
    }
    return curve(y1, y2, u)
  }
}

const EASINGS: Record<string, Easing> = {
  linear: (t) => t,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1),
}

/** A CSS easing as a function; null for one this does not replay (steps(), linear() stops). */
export function parseEasing(value: string | undefined): Easing | null {
  const text = (value ?? 'linear').trim()
  if (EASINGS[text]) return EASINGS[text]
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(text)
  if (!bezier) return null
  const points = bezier[1].split(',').map(Number)
  return points.length === 4 && points.every(Number.isFinite) ? cubicBezier(points[0], points[1], points[2], points[3]) : null
}

function length(token: string, axis: 'x' | 'y', ctx: LengthContext): number | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)(px|rem|em|%)?$/.exec(token.trim())
  if (!match) return null
  const n = Number(match[1])
  switch (match[2]) {
    case 'px': return n
    case 'rem': return n * ctx.rem
    case 'em': return n * ctx.em
    case '%': return (n / 100) * (axis === 'x' ? ctx.width : ctx.height)
    default: return n === 0 ? 0 : null
  }
}

/** A transform list of translations and scales (what entrance motion and focus pops use) as one
 *  ScaleTranslate; null for anything else (rotation, skew, depth, perspective), which stays CSS. */
export function parseTransform(value: string, ctx: LengthContext): ScaleTranslate | null {
  const text = value.trim()
  if (text === 'none' || text === '') return [1, 1, 0, 0]
  let [sx, sy, tx, ty] = [1, 1, 0, 0]
  const apply = (fsx: number, fsy: number, ftx: number, fty: number) => {
    // The list multiplies left to right, so each function applies inside the ones before it.
    tx += sx * ftx
    ty += sy * fty
    sx *= fsx
    sy *= fsy
  }
  const functions = /([a-zA-Z0-9]+)\(([^)]*)\)\s*/gy
  let match: RegExpExecArray | null
  let consumed = 0
  while ((match = functions.exec(text))) {
    consumed = functions.lastIndex
    const args = match[2].split(',').map((arg) => arg.trim())
    const num = (i: number) => Number(args[i])
    const len = (i: number, axis: 'x' | 'y') => length(args[i] ?? '0', axis, ctx)
    switch (match[1]) {
      case 'translate': case 'translateX': case 'translateY': case 'translate3d': {
        if (match[1] === 'translate3d' && len(2, 'x') !== 0) return null
        const x = match[1] === 'translateY' ? 0 : len(0, 'x')
        const y = match[1] === 'translateX' ? 0 : match[1] === 'translateY' ? len(0, 'y') : len(1, 'y')
        if (x === null || y === null) return null
        apply(1, 1, x, y)
        break
      }
      case 'scale': case 'scaleX': case 'scaleY': case 'scale3d': {
        const x = match[1] === 'scaleY' ? 1 : num(0)
        const y = match[1] === 'scaleX' ? 1 : match[1] === 'scaleY' ? num(0) : args.length > 1 ? num(1) : num(0)
        if (!Number.isFinite(x) || !Number.isFinite(y) || (match[1] === 'scale3d' && num(2) !== 1)) return null
        apply(x, y, 0, 0)
        break
      }
      case 'matrix': {
        const m = args.map(Number)
        if (m.length !== 6 || !m.every(Number.isFinite) || m[1] !== 0 || m[2] !== 0) return null
        apply(m[0], m[3], m[4], m[5])
        break
      }
      case 'matrix3d': {
        const m = args.map(Number)
        const flat = [1, 2, 3, 4, 6, 7, 8, 9, 11, 14]
        if (m.length !== 16 || !m.every(Number.isFinite) || flat.some((i) => m[i] !== 0) || m[10] !== 1 || m[15] !== 1) return null
        apply(m[0], m[5], m[12], m[13])
        break
      }
      default: return null
    }
  }
  return consumed === text.length ? [sx, sy, tx, ty] : null
}

/** The animated values at overall progress `p` (0..1, after the effect's own easing). */
export function sampleTakeover(frames: readonly TakeoverFrame[], p: number): { opacity?: number; transform?: ScaleTranslate } {
  let i = 0
  while (i < frames.length - 2 && p > frames[i + 1].offset) i++
  const a = frames[i]
  const b = frames[Math.min(i + 1, frames.length - 1)]
  const span = b.offset - a.offset
  const q = span > 0 ? a.easing(Math.min(1, Math.max(0, (p - a.offset) / span))) : 1
  const mix = (x: number, y: number) => x + (y - x) * q
  const out: { opacity?: number; transform?: ScaleTranslate } = {}
  if (a.opacity !== undefined && b.opacity !== undefined) out.opacity = mix(a.opacity, b.opacity)
  if (a.transform && b.transform) out.transform = a.transform.map((v, j) => mix(v, b.transform![j])) as ScaleTranslate
  return out
}

const round = (v: number) => Math.round(v * 10000) / 10000
const matrixCss = ([sx, sy, tx, ty]: ScaleTranslate) => `matrix(${round(sx)}, 0, 0, ${round(sy)}, ${round(tx)}, ${round(ty)})`
const sameValue = (prop: Prop, a: number | ScaleTranslate | undefined, b: number | ScaleTranslate | undefined) =>
  prop === 'opacity'
    ? Math.abs((a as number) - (b as number)) < 1e-3
    : (a as ScaleTranslate).every((v, i) => Math.abs(v - (b as ScaleTranslate)[i]) < 1e-3)

interface Takeover { end: (finished: boolean) => void }

/** Split a computed CSS list on its top-level commas (a cubic-bezier() keeps its own). */
export function splitCssList(value: string): string[] {
  const items: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')') depth--
    else if (value[i] === ',' && depth === 0) {
      items.push(value.slice(from, i).trim())
      from = i + 1
    }
  }
  items.push(value.slice(from).trim())
  return items.filter(Boolean)
}

type TransitionStyle = Pick<CSSStyleDeclaration, 'transitionProperty' | 'transitionDuration' | 'transitionTimingFunction' | 'transitionDelay'>

/** The element's transitions without `props`, as one `transition` value; null when it declares none of
 *  them. Every replayed frame is an inline style change, so a transition declared for a replayed
 *  property would otherwise start again on each frame. shortcut: `all` goes with them, so the element's
 *  other properties change at once while a replay runs (a few hundred ms at most). */
export function transitionsWithout(style: TransitionStyle, props: readonly string[]): string | null {
  const names = splitCssList(style.transitionProperty || '')
  if (!names.some((name) => name === 'all' || props.includes(name))) return null
  const at = (list: string[], i: number, fallback: string) => (list.length ? list[i % list.length] : fallback)
  const durations = splitCssList(style.transitionDuration || '')
  const timings = splitCssList(style.transitionTimingFunction || '')
  const delays = splitCssList(style.transitionDelay || '')
  const kept = names
    .map((name, i) => ({ name, i }))
    .filter(({ name }) => name !== 'all' && name !== 'none' && !props.includes(name))
    .map(({ name, i }) => `${name} ${at(durations, i, '0s')} ${at(timings, i, 'ease')} ${at(delays, i, '0s')}`)
  return kept.length ? kept.join(', ') : 'none'
}

/** Start taking over CSS animations in `doc` (Game mode only). Returns the stop function. CSS
 *  transitions stay CSS: the focus pop and the other transitions were measured on the Deck without a
 *  blink, and replaying them would mask the stylesheet while focus moves on. */
export function startGmCssMotion(doc: Document = document): () => void {
  const owners = new WeakMap<HTMLElement, Map<Prop, Takeover>>()
  const running = new Set<Takeover>()

  function takeOver(el: HTMLElement, anim: Animation, name: string): void {
    const effect = anim.effect as KeyframeEffect | null
    if (!effect || anim.playbackRate !== 1 || anim.timeline !== doc.timeline) return
    const timing = effect.getTiming()
    const duration = Number(timing.duration)
    const delay = timing.delay ?? 0
    if (timing.iterations !== 1 || (timing.direction ?? 'normal') !== 'normal' || !(duration >= 1) || duration > MAX_DURATION_MS) return
    const outer = parseEasing(timing.easing)
    const keyframes = effect.getKeyframes()
    const props = new Set<string>()
    for (const keyframe of keyframes) {
      for (const key of Object.keys(keyframe)) if (!META_KEYS.has(key)) props.add(key)
      if (keyframe.composite && keyframe.composite !== 'auto' && keyframe.composite !== 'replace') return
    }
    if (!outer || keyframes.length < 2 || !props.size || ![...props].every((p) => p === 'opacity' || p === 'transform')) return
    // An element a component styles inline (script motion of its own) stays CSS: a replay would fight
    // that component's writes.
    if ([...props].some((p) => el.style.getPropertyValue(p) && !owners.get(el)?.has(p as Prop))) return
    const view = doc.defaultView
    if (!view) return
    // Read only for a transform: an opacity fade needs no style or layout reads.
    const ctx: LengthContext = props.has('transform')
      ? {
        rem: parseFloat(view.getComputedStyle(doc.documentElement).fontSize) || 16,
        em: parseFloat(view.getComputedStyle(el).fontSize) || 16,
        width: el.offsetWidth,
        height: el.offsetHeight,
      }
      : { rem: 16, em: 16, width: 0, height: 0 }
    const frames: TakeoverFrame[] = []
    for (const keyframe of keyframes) {
      const easing = parseEasing(keyframe.easing)
      if (!easing) return
      const frame: TakeoverFrame = { offset: Number(keyframe.computedOffset ?? keyframe.offset), easing }
      if (keyframe.opacity != null) frame.opacity = Number(keyframe.opacity)
      if (keyframe.transform != null) {
        const parsed = parseTransform(String(keyframe.transform), ctx)
        if (!parsed) return
        frame.transform = parsed
      }
      if (frame.opacity !== undefined && !Number.isFinite(frame.opacity)) return
      frames.push(frame)
    }
    const propList = [...props] as Prop[]
    const startedAt = performance.now() - Number(anim.currentTime ?? 0)
    const restart = () => {
      anim.play()
      anim.currentTime = performance.now() - startedAt
    }
    anim.cancel()
    // The element's own value with the animation gone fills any keyframe that leaves a property out.
    const base = view.getComputedStyle(el)
    const baseValues: Partial<Record<Prop, number | ScaleTranslate>> = {}
    for (const prop of propList) {
      const value = prop === 'opacity' ? Number(base.opacity) : parseTransform(base.transform, ctx)
      if (value === null || (prop === 'opacity' && !Number.isFinite(value))) return restart()
      baseValues[prop] = value
      for (const frame of frames) if (frame[prop] === undefined) (frame as unknown as Record<Prop, unknown>)[prop] = value
    }
    // A forwards fill that does not end on the element's own value (a fade-out that stays hidden) needs
    // CSS to keep holding it, so it goes back to CSS rather than snapping back when the replay ends.
    const fill = timing.fill ?? 'auto'
    if ((fill === 'forwards' || fill === 'both') && propList.some((p) => !sameValue(p, frames[frames.length - 1][p], baseValues[p]))) {
      return restart()
    }

    const owned = owners.get(el) ?? new Map<Prop, Takeover>()
    owners.set(el, owned)
    for (const prop of propList) owned.get(prop)?.end(false)
    // The animated properties come first and `transition` last, so ending restores them in one task
    // and the hand-back starts no transition of its own.
    const saved = [...propList, 'transition'].map((prop) => [prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)] as const)
    const held = transitionsWithout(base, propList)
    if (held !== null) el.style.setProperty('transition', held)
    let frame = 0
    const write = (now: number): boolean => {
      const local = Math.max(0, now - startedAt - delay)
      const values = sampleTakeover(frames, outer(Math.min(1, local / duration)))
      if (values.opacity !== undefined) el.style.opacity = String(round(values.opacity))
      if (values.transform) el.style.transform = matrixCss(values.transform)
      return local >= duration
    }
    const takeover: Takeover = {
      end(finished) {
        if (!running.delete(takeover)) return
        cancelAnimationFrame(frame)
        for (const [prop, value, priority] of saved) {
          if (value) el.style.setProperty(prop, value, priority)
          else el.style.removeProperty(prop)
          if (owned.get(prop as Prop) === takeover) owned.delete(prop as Prop)
        }
        // Listeners that wait for the animation to finish (a ripple removing itself) still hear it.
        if (finished && el.isConnected) {
          const init = { bubbles: true, elapsedTime: duration / 1000 }
          el.dispatchEvent(typeof AnimationEvent === 'function' ? new AnimationEvent('animationend', { ...init, animationName: name }) : new Event('animationend', init))
        }
      },
    }
    for (const prop of propList) owned.set(prop, takeover)
    running.add(takeover)
    write(performance.now())
    const step = (now: number) => {
      if (!el.isConnected) return takeover.end(false)
      if (write(now)) return takeover.end(true)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  const onAnimationStart = (event: AnimationEvent) => {
    const el = event.target
    // A pseudo-element has no inline style to write. The player's chrome is snapshotted into mpv on its
    // own schedule and runs its own Game-mode motion.
    if (!(el instanceof HTMLElement) || event.pseudoElement || el.closest('.izumi-player-root')) return
    const anim = el.getAnimations().find((a) => (a as CSSAnimation).animationName === event.animationName)
    if (anim) takeOver(el, anim, event.animationName)
  }
  doc.addEventListener('animationstart', onAnimationStart, true)
  return () => {
    doc.removeEventListener('animationstart', onAnimationStart, true)
    for (const takeover of [...running]) takeover.end(false)
  }
}
