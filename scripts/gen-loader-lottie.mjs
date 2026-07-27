// Generates the source-resolve loader animation: paper lanterns drifting on water, each carrying
// one of the user's configured addon icons.
//
// Written as a generator rather than a hand-edited blob so the motion stays tweakable — the raw
// Lottie JSON is thousands of numbers and nobody can review a diff of it. Run:
//   node scripts/gen-loader-lottie.mjs
//
// The lantern cargo slots are IMAGE layers on purpose. lottie-web renders those as <image> nodes,
// so the player component can swap their href for real addon logos at runtime; the placeholder
// baked in here is a 1x1 transparent pixel.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const W = 480
const H = 260
const FR = 60
const TOTAL = 240 // 4s loop

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const st = (k) => ({ a: 0, k })
/** Eased keyframes. Same easing everywhere — this is ambient motion, not choreography. */
const kf = (frames) => ({
  a: 1,
  k: frames.map((f, i) =>
    i === frames.length - 1
      ? { t: f.t, s: f.s }
      : { t: f.t, s: f.s, i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } }),
})

const tr = ({ p, a = [0, 0, 0], s = [100, 100, 100], r = 0, o = 100 }) => ({
  o: typeof o === 'object' ? o : st(o),
  r: typeof r === 'object' ? r : st(r),
  p: typeof p === 'object' && p.a !== undefined ? p : st(p),
  a: st(a),
  s: typeof s === 'object' && s.a !== undefined ? s : st(s),
})

const shapeLayer = (ind, nm, ks, shapes) =>
  ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks, ao: 0, shapes, ip: 0, op: TOTAL, st: 0, bm: 0 })

const imageLayer = (ind, nm, refId, ks) =>
  ({ ddd: 0, ind, ty: 2, nm, refId, sr: 1, ks, ao: 0, ip: 0, op: TOTAL, st: 0, bm: 0 })

const fill = (rgb, opacity = 100) =>
  ({ ty: 'fl', c: st([...rgb, 1]), o: st(opacity), r: 1, bm: 0, nm: 'fill', hd: false })

const group = (items, transform = {}) =>
  ({ ty: 'gr', nm: 'g', hd: false, it: [...items, { ty: 'tr', ...tr({ p: [0, 0], ...transform }) }] })

/** One seamless wave band: a closed path two canvas-widths wide, translated by exactly two of its
 *  own periods over the loop, so the wrap point is invisible. */
function waveBand(ind, { y, amp, opacity, rgb, speed }) {
  const HALF = 120
  const spanPts = (2 * W) / HALF // 8 half-periods across 960px
  const v = []
  const i = []
  const o = []
  for (let k = 0; k <= spanPts; k++) {
    v.push([k * HALF, k % 2 === 0 ? 0 : amp * 2])
    i.push([-40, 0])
    o.push([40, 0])
  }
  // Close the shape well below the canvas so the fill reads as a body of water, not a ribbon.
  v.push([2 * W, H]); i.push([0, 0]); o.push([0, 0])
  v.push([0, H]); i.push([0, 0]); o.push([0, 0])

  const path = { ty: 'sh', ind: 0, ix: 1, nm: 'wave', hd: false, ks: st({ i, o, v, c: true }) }
  return shapeLayer(
    ind,
    `wave-${ind}`,
    tr({
      p: kf([{ t: 0, s: [0, y, 0] }, { t: TOTAL / speed, s: [-2 * HALF * 2, y, 0] }]),
      o: st(opacity),
    }),
    [group([path, fill(rgb)])],
  )
}

/** A lantern: soft glow, paper body, and the cargo slot the addon icon is painted into. */
function lantern(indBase, refId, { x, y, drift, phase, scale }) {
  const bob = (base) => kf([
    { t: 0, s: [x, base, 0] },
    { t: TOTAL * 0.25, s: [x + drift * 0.5, base - 7, 0] },
    { t: TOTAL * 0.5, s: [x + drift, base, 0] },
    { t: TOTAL * 0.75, s: [x + drift * 0.5, base + 5, 0] },
    { t: TOTAL, s: [x, base, 0] },
  ])
  const sway = kf([
    { t: 0, s: [-3] },
    { t: TOTAL * 0.33, s: [3] },
    { t: TOTAL * 0.66, s: [-2] },
    { t: TOTAL, s: [-3] },
  ])
  // Phase the two halves apart so the lanterns never bob in lockstep.
  const shift = (frames) => frames

  const glow = group([
    { ty: 'el', d: 1, s: st([88, 88]), p: st([0, 0]), nm: 'glow', hd: false },
    fill([1, 0.78, 0.45], 16),
  ])
  const body = group([
    { ty: 'rc', d: 1, s: st([44, 52]), p: st([0, 0]), r: st(12), nm: 'body', hd: false },
    fill([1, 0.86, 0.62], 92),
  ])
  const cap = group([
    { ty: 'rc', d: 1, s: st([52, 7]), p: st([0, -28]), r: st(3), nm: 'cap', hd: false },
    fill([0.16, 0.13, 0.2], 85),
  ])

  const ks = tr({ p: bob(y), r: sway, s: st([scale, scale, 100]), o: st(100) })
  return [
    shapeLayer(indBase, `lantern-${indBase}`, ks, shift([glow, body, cap])),
    // Cargo rides the identical transform, drawn above the paper.
    imageLayer(indBase + 1, `cargo-${indBase}`, refId, tr({
      p: bob(y),
      r: sway,
      s: st([scale * 0.3, scale * 0.3, 100]),
      a: st([48, 48, 0]),
    })),
  ]
}

const LANTERNS = [
  { x: 108, y: 118, drift: 16, phase: 0, scale: 96 },
  { x: 240, y: 104, drift: -14, phase: 80, scale: 112 },
  { x: 368, y: 122, drift: 12, phase: 160, scale: 88 },
]

const assets = LANTERNS.map((_, n) => ({ id: `cargo${n}`, w: 96, h: 96, u: '', p: PIXEL, e: 1 }))

const layers = []
let ind = 1
for (const [n, l] of LANTERNS.entries()) {
  layers.push(...lantern(ind, `cargo${n}`, l))
  ind += 2
}
// Water sits in FRONT of the lanterns' lower halves, so they read as floating in it.
layers.push(waveBand(ind++, { y: 150, amp: 7, opacity: 34, rgb: [0.42, 0.68, 0.95], speed: 1 }))
layers.push(waveBand(ind++, { y: 168, amp: 9, opacity: 26, rgb: [0.30, 0.52, 0.88], speed: 1.6 }))
layers.push(waveBand(ind++, { y: 186, amp: 6, opacity: 20, rgb: [0.22, 0.38, 0.72], speed: 2.4 }))

const animation = {
  v: '5.7.4',
  fr: FR,
  ip: 0,
  op: TOTAL,
  w: W,
  h: H,
  nm: 'izumi-source-loader',
  ddd: 0,
  assets,
  layers,
  markers: [],
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'components', 'player', 'source-loader.json')
writeFileSync(out, JSON.stringify(animation))
console.log(`wrote ${out} (${JSON.stringify(animation).length} bytes, ${layers.length} layers)`)
