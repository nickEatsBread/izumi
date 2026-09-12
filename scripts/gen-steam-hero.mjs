// Renders the plain Steam library hero from brand/svg/izumi-hero-plain.svg.
//
// Steam paints the logo art (`<appid>_logo.png`) over the hero, so the hero must not contain the
// wordmark itself — the per-variant SteamGridDB heroes do, which put a logo on top of a logo on
// every Deck that installed through the installer. This one is backdrop only.
//
//   node scripts/gen-steam-hero.mjs
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'brand/svg/izumi-hero-plain.svg')
const outDir = resolve(root, 'brand/steamgriddb/hero')

// Steam's hero slot is 1920x620; the 2x is what a Deck's library page actually samples from.
const SIZES = [1920, 3840]

const svg = readFileSync(source, 'utf8')
mkdirSync(outDir, { recursive: true })

for (const width of SIZES) {
  const height = Math.round((width * 620) / 1920)
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()
  const file = resolve(outDir, `izumi-hero-plain-${width}x${height}.png`)
  writeFileSync(file, png)
  console.log(`${width}x${height}  ${(png.length / 1024).toFixed(0)} KB  ${file}`)
}
