// Renders the Steam library hero art into brand/steamgriddb/hero/.
//
// Steam paints the logo art (`<appid>_logo.png`) over the hero, so a hero must not contain the
// wordmark itself — the per-variant SteamGridDB heroes do, which put a logo on top of a logo.
// Everything here is backdrop only:
//
//   mixed / anime / films   a tilted wall of cover art, brightest through the middle and falling
//                           away to black at the edges. Covers come from the public catalogue API
//                           the app already reads, ordered by how many people track them; nothing
//                           about the selection is curated here, and each run picks up whatever
//                           that list says at the time.
//   plain                   no artwork at all: brand-blue field, one swell, some ripple echoes.
//
//   node scripts/gen-steam-hero.mjs                 # all of them
//   node scripts/gen-steam-hero.mjs plain anime     # just these
//   node scripts/gen-steam-hero.mjs mixed --faded   # also the per-cover treatment
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'brand/steamgriddb/hero')

// Steam's hero slot is 1920x620. The 2x is what a Deck's library page samples from; only the
// vector hero ships one, because a wall of photographic covers at 3840 wide is megabytes of
// repository for a backdrop that is dimmed to half visibility anyway.
const HERO_W = 1920
const HERO_H = 620
// Rendered at twice the output size and averaged down. resvg samples an image once per output
// pixel, so cover art laid on a 9-degree tilt came out visibly stepped along every edge.
const SUPERSAMPLE = 2

// The two public catalogues the app itself reads. Anime comes from one, everything else from the
// other; neither needs a key, and neither selection is curated here beyond "what is popular".
const ANIME_CATALOGUE = 'https://kitsu.io/api/edge/anime'
const CINEMETA = 'https://v3-cinemeta.strem.io'
const SHADE = '#05080F'

const render = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render()

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, data.length + 8)
  return out
}

/** Minimal RGBA PNG writer, so a downsampled buffer can go back out as a file. */
function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Average each SUPERSAMPLE x SUPERSAMPLE block down to one pixel. */
function downsample(pixels, width, height, factor) {
  const outW = Math.round(width / factor)
  const outH = Math.round(height / factor)
  const out = Buffer.alloc(outW * outH * 4)
  const samples = factor * factor
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * width
        for (let dx = 0; dx < factor; dx++) {
          const index = (row + x * factor + dx) * 4
          r += pixels[index]
          g += pixels[index + 1]
          b += pixels[index + 2]
          a += pixels[index + 3]
        }
      }
      const index = (y * outW + x) * 4
      out[index] = Math.round(r / samples)
      out[index + 1] = Math.round(g / samples)
      out[index + 2] = Math.round(b / samples)
      out[index + 3] = Math.round(a / samples)
    }
  }
  return { data: out, width: outW, height: outH }
}

const write = (name, png) => {
  writeFileSync(resolve(outDir, name), png)
  console.log(`${name}  ${(png.length / 1024).toFixed(0)} KB`)
}

function plain() {
  const svg = readFileSync(resolve(root, 'brand/svg/izumi-hero-plain.svg'), 'utf8')
  for (const width of [HERO_W, HERO_W * 2]) {
    write(`izumi-hero-plain-${width}x${Math.round((width * HERO_H) / HERO_W)}.png`, render(svg, width).asPng())
  }
}

/** Anime cover URLs, most-tracked first. Nothing here names a title. */
async function animeCovers(subtype, pages = 3, perPage = 20) {
  const found = []
  for (let page = 0; page < pages; page++) {
    const url = new URL(ANIME_CATALOGUE)
    url.searchParams.set('sort', '-userCount')
    url.searchParams.set('page[limit]', String(perPage))
    url.searchParams.set('page[offset]', String(page * perPage))
    if (subtype) url.searchParams.set('filter[subtype]', subtype)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`anime catalogue returned HTTP ${response.status}`)
    const body = await response.json()
    for (const entry of body.data ?? []) {
      // This wall ends up on a handheld in someone's living room, and the list it is built from is
      // ordered by popularity alone. Adult-rated cover art is not something to find out about later.
      if (/^(R18|18)$/i.test(entry.attributes?.ageRating ?? '')) continue
      const image = entry.attributes?.posterImage
      // `original` first: the wall downsamples, and a 284px source upscaled into a 536px tile is
      // exactly the mush this supersampling exists to avoid.
      const href = image?.original ?? image?.large ?? image?.medium
      if (href) found.push(href)
    }
  }
  return [...new Set(found)]
}

/** Film and live-action series covers. The anime catalogue only knows anime, so "films" built from
 *  it were just animated films — this is where actual cinema comes from. */
async function cinemetaCovers(type) {
  const found = []
  // Several catalogues, because a good half of any one of them is stored as WebP, which resvg
  // cannot decode — those are dropped on download and the wall needs the depth to absorb it.
  for (const catalogue of ['top', 'imdbRating', 'year']) {
    const response = await fetch(`${CINEMETA}/catalog/${type}/${catalogue}.json`)
    if (!response.ok) continue
    const body = await response.json()
    for (const meta of body.metas ?? []) {
      // The catalogue hands out the small poster; the medium one is the same image at a size the
      // wall does not have to invent detail for.
      if (meta.poster) found.push(String(meta.poster).replace('/poster/small/', '/poster/medium/'))
    }
  }
  return [...new Set(found)]
}

async function download(urls) {
  const images = []
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const body = Buffer.from(await response.arrayBuffer())
      // resvg decodes PNG and JPEG; anything else would silently render as a hole in the wall.
      const png = body[0] === 0x89 && body[1] === 0x50
      const jpeg = body[0] === 0xFF && body[1] === 0xD8
      if (!png && !jpeg) continue
      images.push(`data:image/${png ? 'png' : 'jpeg'};base64,${body.toString('base64')}`)
    } catch { /* a cover that will not download is simply one fewer in the wall */ }
  }
  return images
}

/** Interleave, so a mixed wall alternates rather than showing one kind then the other. */
function interleave(...lists) {
  const out = []
  for (let index = 0; index < Math.max(...lists.map((list) => list.length)); index++) {
    for (const list of lists) if (list[index]) out.push(list[index])
  }
  return out
}

function wall(images, style) {
  // Fixed seed: regenerating should refresh the covers, not reshuffle the whole composition.
  let seed = 20260912
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296

  const TILE_W = 268
  const TILE_H = 402
  const GAP = 16
  const COLUMNS = 11
  const ROWS = 4
  const spanW = COLUMNS * (TILE_W + GAP)
  const spanH = ROWS * (TILE_H + GAP)

  const ANGLE = -9
  const radians = (ANGLE * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  const tiles = []
  let index = 0
  for (let column = 0; column < COLUMNS; column++) {
    // Each column slides by its own amount, which is what stops the wall reading as a grid.
    const offset = (random() - 0.5) * (TILE_H + GAP) * 1.6
    for (let row = 0; row < ROWS; row++) {
      const x = column * (TILE_W + GAP) - spanW / 2
      const y = row * (TILE_H + GAP) - spanH / 2 + offset
      // Where this tile's middle lands on the canvas once the wall is tilted. The fade is per
      // poster, computed from that point — which is what makes it look like covers receding into
      // the dark rather than a grey sheet laid over a picture.
      const midX = x + TILE_W / 2
      const midY = y + TILE_H / 2
      const canvasX = midX * cos - midY * sin
      const canvasY = midX * sin + midY * cos
      const distance = Math.hypot(canvasX / (HERO_W * 0.46), canvasY / (HERO_H * 0.62))
      // Full brightness through the middle, gone by the time a tile is a canvas away.
      const fade = Math.min(1, Math.max(0, (distance - 0.34) / 0.78))
      tiles.push({
        x,
        y,
        shade: (fade * fade * 0.94).toFixed(3),
        href: images[index++ % images.length],
      })
    }
  }

  // Two resvg constraints shape this markup, both learned the hard way:
  //
  //  * No `opacity` attribute anywhere. `opacity` isolates the element into an offscreen layer, and
  //    this document composites those layers only partially: a group opacity on the wall returned a
  //    band of covers across the top with black underneath, and a flat 24% dim over the whole
  //    canvas was applied to the top 122 rows only, leaving a hard horizontal seam straight across
  //    the hero. `fill-opacity` and `stop-opacity` are per-paint, need no layer, and are exact.
  //  * No mask on the wall either, for the same reason.
  //
  // So the fade is painted, not composited: each tile gets its own shade over it, and the vignette
  // is a plain filled gradient.
  // `faded` shades each cover by where it sits, so the wall recedes cover by cover. `washed` leaves
  // every cover exactly as it is and lays one gradient over the lot — which is the simpler, more
  // natural read, because neighbouring covers never step against each other.
  const perTileShade = (tile) => style === 'faded'
    ? `<rect x="${tile.x.toFixed(1)}" y="${tile.y.toFixed(1)}" width="${TILE_W}" height="${TILE_H}" fill="${SHADE}" fill-opacity="${tile.shade}"/>`
    : ''

  const edge = style === 'faded'
    ? `<radialGradient id="edge" cx="0.5" cy="0.5" r="0.66">
      <stop offset="0" stop-color="${SHADE}" stop-opacity="0"/>
      <stop offset="0.62" stop-color="${SHADE}" stop-opacity="0.08"/>
      <stop offset="0.88" stop-color="${SHADE}" stop-opacity="0.52"/>
      <stop offset="1" stop-color="${SHADE}" stop-opacity="0.92"/>
    </radialGradient>`
    // One gradient does all the work: clear through the middle, closing to solid by the corners.
    : `<radialGradient id="edge" cx="0.5" cy="0.5" r="0.72">
      <stop offset="0" stop-color="${SHADE}" stop-opacity="0"/>
      <stop offset="0.38" stop-color="${SHADE}" stop-opacity="0.06"/>
      <stop offset="0.62" stop-color="${SHADE}" stop-opacity="0.38"/>
      <stop offset="0.82" stop-color="${SHADE}" stop-opacity="0.82"/>
      <stop offset="1" stop-color="${SHADE}" stop-opacity="1"/>
    </radialGradient>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${HERO_W} ${HERO_H}" width="${HERO_W}" height="${HERO_H}">
  <defs>
    <clipPath id="frame"><rect width="${HERO_W}" height="${HERO_H}"/></clipPath>
    ${edge}
    <!-- The wordmark lands here, and what is behind it is whatever cover happened to fall there. -->
    <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${SHADE}" stop-opacity="0.58"/>
      <stop offset="0.55" stop-color="${SHADE}" stop-opacity="0.3"/>
      <stop offset="1" stop-color="${SHADE}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="${HERO_W}" height="${HERO_H}" fill="${SHADE}"/>
    <g transform="translate(${HERO_W / 2} ${HERO_H / 2}) rotate(${ANGLE}) scale(1.02)">
      ${tiles.map((tile) => `<image href="${tile.href}" x="${tile.x.toFixed(1)}" y="${tile.y.toFixed(1)}" width="${TILE_W}" height="${TILE_H}" preserveAspectRatio="xMidYMid slice"/>${perTileShade(tile)}`).join('\n      ')}
    </g>
    <rect width="${HERO_W}" height="${HERO_H}" fill="${SHADE}" fill-opacity="${style === 'faded' ? 0.2 : 0.1}"/>
    <ellipse cx="${HERO_W / 2}" cy="${HERO_H / 2}" rx="${HERO_W * 0.34}" ry="${HERO_H * 0.42}" fill="url(#pool)"/>
    <rect width="${HERO_W}" height="${HERO_H}" fill="url(#edge)"/>
  </g>
</svg>`
}

async function carousel(name, images, style) {
  if (images.length < 24) throw new Error(`${name}: only ${images.length} covers downloaded; refusing to build a thin wall`)
  const rendered = render(wall(images, style), HERO_W * SUPERSAMPLE)
  const width = rendered.width
  const height = rendered.height
  const small = downsample(rendered.pixels, width, height, SUPERSAMPLE)
  const suffix = style === 'faded' ? '-faded' : ''
  write(`izumi-hero-${name}${suffix}-${small.width}x${small.height}.png`, encodePng(small.width, small.height, small.data))
}

const args = process.argv.slice(2)
// `--faded` keeps the earlier treatment — every cover shaded by where it sits — alongside the
// default, where the covers are untouched and one gradient sits over all of them.
const STYLES = args.includes('--faded') ? ['washed', 'faded'] : ['washed']
const wanted = args.filter((arg) => !arg.startsWith('--'))
const want = (name) => !wanted.length || wanted.includes(name)
mkdirSync(outDir, { recursive: true })

if (want('plain')) plain()

if (want('anime') || want('films') || want('mixed')) {
  const [anime, films, shows] = await Promise.all([
    animeCovers('TV').then(download),
    cinemetaCovers('movie').then(download),
    cinemetaCovers('series').then(download),
  ])
  console.log(`covers: ${anime.length} anime, ${films.length} films, ${shows.length} shows`)
  for (const style of STYLES) {
    if (want('anime')) await carousel('anime', anime, style)
    if (want('films')) await carousel('films', interleave(films, shows), style)
    // The app is anime-first but not anime-only, and this is the wall that says so.
    if (want('mixed')) await carousel('mixed', interleave(anime, films, shows), style)
  }
}
