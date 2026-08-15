import { describe, expect, it } from 'vitest'
import rawAnimation from './source-loader.json'
import { sourceLoaderMotion as motion } from './source-loader-motion'

type Keyframe = {
  t: number
  s: number[]
  e: number[]
  i: { x: number[]; y: number[] }
  o: { x: number[]; y: number[] }
}
type MotionAnimation = {
  fr: number; ip: number; op: number
  layers: [{
    ks: { p: { k: number[] }; o: { k: number } }
    masksProperties: [{ pt: { k: { v: [number, number][] } } }]
    shapes: [{ p: { k: Keyframe[] }; s: { k: Keyframe[] } }]
  }, {
    shapes: [{ s: { k: number[] } }]
  }]
}
const animation = rawAnimation as unknown as MotionAnimation

describe('source loader SVG transcription', () => {
  it('preserves the Lottie composition timing and position exactly', () => {
    const moving = animation.layers[0]
    const position = moving.shapes[0].p.k
    expect(motion.duration).toBe(`${(animation.op - animation.ip) / animation.fr}s`)
    expect(motion.positionKeyTimes).toBe(`0;${position[1].t / animation.op};1`)
    expect(motion.positionValues).toBe(
      `${moving.ks.p.k[0] + position[0].s[0]} ${moving.ks.p.k[1]};`
      + `${moving.ks.p.k[0] + position[0].e[0]} ${moving.ks.p.k[1]};`
      + `${moving.ks.p.k[0] + position[0].e[0]} ${moving.ks.p.k[1]}`,
    )
  })

  it('preserves the width easing and final one-frame hold', () => {
    const size = animation.layers[0].shapes[0].s.k
    expect(motion.sizeKeyTimes).toBe(`0;${size[1].t / animation.op};${size[2].t / animation.op};1`)
    expect(motion.widthValues).toBe(`${size[0].s[0]};${size[0].e[0]};${size[1].e[0]};${size[1].e[0]}`)
    expect(motion.halfWidthValues).toBe('-36;-82.5;-36;-36')
    expect(motion.sizeKeySplines).toBe(
      `${size[0].o.x[0]} ${size[0].o.y[0]} ${size[0].i.x[0]} ${size[0].i.y[0]};`
      + `${size[1].o.x[0]} ${size[1].o.y[0]} ${size[1].i.x[0]} ${size[1].i.y[0]};0 0 1 1`,
    )
  })

  it('preserves the composition geometry, mask and colors', () => {
    const [moving, background] = animation.layers
    const movingPosition = moving.ks.p.k
    const mask = moving.masksProperties[0].pt.k.v
    const vertices = mask.map(([x, y]) => [x + movingPosition[0]!, y + movingPosition[1]!])
    expect(motion.viewBox).toBe(`0 0 ${rawAnimation.w} ${rawAnimation.h}`)
    expect(vertices).toEqual([[669.953, 284], [129.938, 283.957], [129.938, 316.039], [669.953, 316.082]])
    expect(motion.track).toEqual({ x: 130, y: 295, width: 540, height: 10, fill: 'rgb(217,217,217)' })
    expect(motion.bar).toEqual({ fill: 'rgb(81,81,81)', opacity: moving.ks.o.k / 100 })
    expect(background.shapes[0].s.k).toEqual([motion.track.width, motion.track.height])
  })
})
