// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cubicBezier, parseEasing, parseTransform, sampleTakeover, startGmCssMotion, transitionsWithout, type TakeoverFrame } from './gm-css-motion'

const ctx = { rem: 16, em: 20, width: 200, height: 100 }

describe('parseEasing', () => {
  it('replays the CSS keywords and cubic-bezier(), and refuses steps()', () => {
    expect(parseEasing('linear')!(0.3)).toBeCloseTo(0.3)
    expect(parseEasing(undefined)!(0.3)).toBeCloseTo(0.3)
    expect(parseEasing('ease-out')!(0.5)).toBeCloseTo(cubicBezier(0, 0, 0.58, 1)(0.5))
    const curve = parseEasing('cubic-bezier(0.22, 1, 0.36, 1)')!
    expect(curve(0)).toBe(0)
    expect(curve(1)).toBe(1)
    expect(curve(0.25)).toBeGreaterThan(0.6)
    expect(parseEasing('steps(8, end)')).toBeNull()
    expect(parseEasing('linear(0, 0.5, 1)')).toBeNull()
  })

  it('solves the curve for x, so ease-in-out is symmetric', () => {
    const curve = parseEasing('ease-in-out')!
    expect(curve(0.5)).toBeCloseTo(0.5, 4)
    expect(curve(0.2) + curve(0.8)).toBeCloseTo(1, 4)
  })
})

describe('parseTransform', () => {
  it('folds translations and scales into one scale-and-translate, in list order', () => {
    expect(parseTransform('none', ctx)).toEqual([1, 1, 0, 0])
    expect(parseTransform('translate3d(0px, 0.65rem, 0px)', ctx)).toEqual([1, 1, 0, 10.4])
    expect(parseTransform('matrix(1.04, 0, 0, 1.04, 0, 0)', ctx)).toEqual([1.04, 1.04, 0, 0])
    expect(parseTransform('translateY(8px) scale(0.95)', ctx)).toEqual([0.95, 0.95, 0, 8])
    expect(parseTransform('scale(2) translateX(10px)', ctx)).toEqual([2, 2, 20, 0])
    expect(parseTransform('translateX(50%) translateY(1em)', ctx)).toEqual([1, 1, 100, 20])
    expect(parseTransform('matrix3d(1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1, 0, 4, 6, 0, 1)', ctx)).toEqual([1.5, 1.5, 4, 6])
  })

  it('leaves rotation, skew and depth to CSS', () => {
    expect(parseTransform('rotate(10deg)', ctx)).toBeNull()
    expect(parseTransform('matrix(1, 0.2, 0, 1, 0, 0)', ctx)).toBeNull()
    expect(parseTransform('translate3d(0px, 0px, 5px)', ctx)).toBeNull()
    expect(parseTransform('translateX(calc(10px + 1vw))', ctx)).toBeNull()
  })
})

describe('sampleTakeover', () => {
  const linear = (t: number) => t
  it('interpolates within the keyframe segment, with that segment easing', () => {
    const frames: TakeoverFrame[] = [
      { offset: 0, easing: linear, opacity: 0, transform: [1, 1, 0, 20] },
      { offset: 0.5, easing: (t) => t * t, opacity: 0.5, transform: [1, 1, 0, 10] },
      { offset: 1, easing: linear, opacity: 1, transform: [1, 1, 0, 0] },
    ]
    expect(sampleTakeover(frames, 0.25)).toEqual({ opacity: 0.25, transform: [1, 1, 0, 15] })
    expect(sampleTakeover(frames, 0.75).opacity).toBeCloseTo(0.625)
    expect(sampleTakeover(frames, 1)).toEqual({ opacity: 1, transform: [1, 1, 0, 0] })
  })
})

type Frame = FrameRequestCallback
let frames: Frame[]
let now: number

function fakeAnimation(over: { timing?: Partial<EffectTiming>; keyframes?: ComputedKeyframe[]; name?: string; transition?: string }) {
  const timing: EffectTiming = { delay: 0, direction: 'normal', duration: 200, easing: 'linear', fill: 'none', iterations: 1, ...over.timing }
  return {
    effect: { getTiming: () => timing, getKeyframes: () => over.keyframes ?? [] },
    playbackRate: 1,
    timeline: document.timeline,
    currentTime: 0,
    animationName: over.name,
    transitionProperty: over.transition,
    cancel: vi.fn(),
    play: vi.fn(),
  }
}

const fade = (opacity: [string, string]): ComputedKeyframe[] => [
  { offset: 0, computedOffset: 0, easing: 'linear', composite: 'auto', opacity: opacity[0] },
  { offset: 1, computedOffset: 1, easing: 'linear', composite: 'auto', opacity: opacity[1] },
]

function start(el: HTMLElement, anim: ReturnType<typeof fakeAnimation>, type: 'animationstart' | 'transitionrun') {
  ;(el as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [anim]
  const event = new Event(type, { bubbles: true })
  Object.assign(event, type === 'animationstart' ? { animationName: anim.animationName, pseudoElement: '' } : { propertyName: anim.transitionProperty, pseudoElement: '' })
  el.dispatchEvent(event)
}

const step = (ms: number) => {
  now += ms
  const due = frames
  frames = []
  for (const frame of due) frame(now)
}

let stop: () => void
beforeEach(() => {
  frames = []
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: Frame) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  stop = startGmCssMotion(document)
})
afterEach(() => {
  stop()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('startGmCssMotion', () => {
  it('cancels a CSS fade and plays it from script, then hands back and reports the end', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const anim = fakeAnimation({ name: 'caption-in', keyframes: fade(['0', '1']) })
    const ended = vi.fn()
    el.addEventListener('animationend', ended)
    start(el, anim, 'animationstart')

    expect(anim.cancel).toHaveBeenCalledOnce()
    expect(el.style.opacity).toBe('0')
    step(100)
    expect(el.style.opacity).toBe('0.5')
    step(100)
    expect(el.style.opacity).toBe('')
    expect(ended).toHaveBeenCalledOnce()
  })

  it('writes a scale-and-translate matrix for transform motion', () => {
    const el = document.body.appendChild(document.createElement('div'))
    start(el, fakeAnimation({
      name: 'pop',
      keyframes: [
        { offset: 0, computedOffset: 0, easing: 'linear', composite: 'auto', transform: 'none' },
        { offset: 1, computedOffset: 1, easing: 'linear', composite: 'auto', transform: 'matrix(1.04, 0, 0, 1.04, 0, 0)' },
      ],
    }), 'animationstart')
    step(100)
    expect(el.style.transform).toBe('matrix(1.02, 0, 0, 1.02, 0, 0)')
  })

  it('leaves to CSS what it cannot replay exactly', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const cases = [
      fakeAnimation({ name: 'pulse', keyframes: fade(['1', '0.5']), timing: { iterations: Infinity } }),
      fakeAnimation({ name: 'tick', keyframes: fade(['0', '1']), timing: { easing: 'steps(4, end)' } }),
      fakeAnimation({ name: 'spin', keyframes: [
        { offset: 0, computedOffset: 0, easing: 'linear', composite: 'auto', transform: 'rotate(0deg)' },
        { offset: 1, computedOffset: 1, easing: 'linear', composite: 'auto', transform: 'rotate(90deg)' },
      ] }),
      fakeAnimation({ name: 'grow', keyframes: [
        { offset: 0, computedOffset: 0, easing: 'linear', composite: 'auto', width: '10px' },
        { offset: 1, computedOffset: 1, easing: 'linear', composite: 'auto', width: '20px' },
      ] }),
    ]
    for (const anim of cases) start(el, anim, 'animationstart')
    for (const anim of cases) expect(anim.cancel).not.toHaveBeenCalled()
    expect(el.style.opacity).toBe('')
  })

  it('gives a forwards fill that ends away from the element’s own value back to CSS', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const anim = fakeAnimation({ name: 'fade-out', keyframes: fade(['1', '0']), timing: { fill: 'forwards' } })
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ opacity: '1', transform: 'none', fontSize: '16px' } as CSSStyleDeclaration)
    start(el, anim, 'animationstart')

    expect(anim.cancel).toHaveBeenCalledOnce()
    expect(anim.play).toHaveBeenCalledOnce()
    expect(el.style.opacity).toBe('')
  })

  it('does not replay motion a component drives through inline styles', () => {
    const el = document.body.appendChild(document.createElement('div'))
    el.style.opacity = '0.4'
    const anim = fakeAnimation({ name: 'dim', keyframes: fade(['1', '0.4']) })
    start(el, anim, 'animationstart')
    expect(anim.cancel).not.toHaveBeenCalled()
  })

  it('leaves CSS transitions to CSS', () => {
    const el = document.body.appendChild(document.createElement('div'))
    const anim = fakeAnimation({ transition: 'opacity', keyframes: fade(['0', '1']) })
    start(el, anim, 'transitionrun')
    expect(anim.cancel).not.toHaveBeenCalled()
  })

  it('holds off the element’s own transition for a replayed property, and gives it back after', () => {
    const el = document.body.appendChild(document.createElement('div'))
    el.style.transition = 'opacity 0.2s ease, color 0.3s linear'
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      opacity: '1', transform: 'none', fontSize: '16px',
      transitionProperty: 'opacity, color', transitionDuration: '0.2s, 0.3s', transitionTimingFunction: 'ease, linear', transitionDelay: '0s, 0s',
    } as CSSStyleDeclaration)
    start(el, fakeAnimation({ name: 'fade', keyframes: fade(['0', '1']) }), 'animationstart')
    expect(el.style.transition).toBe('color 0.3s linear 0s')
    step(200)
    expect(el.style.transition).toBe('opacity 0.2s ease, color 0.3s linear')
  })
})

describe('transitionsWithout', () => {
  const style = (transitionProperty: string, transitionDuration = '0.2s', transitionTimingFunction = 'ease', transitionDelay = '0s') =>
    ({ transitionProperty, transitionDuration, transitionTimingFunction, transitionDelay })
  it('keeps the other transitions with their own timing, by position', () => {
    expect(transitionsWithout(style('transform, box-shadow', '80ms, 120ms', 'cubic-bezier(0.22, 1, 0.36, 1), ease'), ['transform']))
      .toBe('box-shadow 120ms ease 0s')
    expect(transitionsWithout(style('opacity'), ['opacity'])).toBe('none')
    expect(transitionsWithout(style('all'), ['opacity'])).toBe('none')
    expect(transitionsWithout(style('color, background-color'), ['opacity'])).toBeNull()
  })
})
