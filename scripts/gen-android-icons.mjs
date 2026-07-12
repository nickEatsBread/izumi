// Generates Android launcher PNGs from the izumi brand SVGs into src-tauri/icons/android/.
// Adaptive foreground = mark on transparency, sized into the 108dp safe zone.
// Legacy square/round = full app icon (dark bg) at 48dp densities.
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_DARK = '#0E1524'
const OUT = resolve(root, 'src-tauri/icons/android')

// Density suffix -> multiplier (mdpi = 1x)
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

// Pull the <defs>+<path> body out of a brand mark/app-icon svg (strip the outer <svg>).
function innerSvg(file) {
  const txt = readFileSync(resolve(root, file), 'utf8')
  return txt.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

const markInner = innerSvg('static/brand/izumi-mark-color.svg') // 100x100 viewBox
const appIcon = readFileSync(resolve(root, 'static/brand/izumi-app-icon.svg'), 'utf8') // 1024 viewBox

// Adaptive FOREGROUND: 108-unit transparent canvas, mark centered at ~44% (48/108).
const foregroundSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">` +
  `<g transform="translate(30,30) scale(0.48)">${markInner}</g></svg>`

// Legacy ROUND: circular brand-dark field + mark (mirrors app-icon's 1024 transform).
const roundSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
  `<circle cx="512" cy="512" r="512" fill="${BRAND_DARK}"/>` +
  `<g transform="translate(194.56,194.56) scale(6.34880)">${markInner}</g></svg>`

function renderPng(svg, px) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: px }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng()
}

function write(dir, name, buf) {
  const d = resolve(OUT, dir)
  mkdirSync(d, { recursive: true })
  writeFileSync(resolve(d, name), buf)
  console.log('wrote', dir + '/' + name, buf.length, 'bytes')
}

for (const [dpi, mul] of Object.entries(DENSITIES)) {
  const fgPx = Math.round(108 * mul)
  const legacyPx = Math.round(48 * mul)
  write(`mipmap-${dpi}`, 'ic_launcher_foreground.png', renderPng(foregroundSvg, fgPx))
  write(`mipmap-${dpi}`, 'ic_launcher.png', renderPng(appIcon, legacyPx))
  write(`mipmap-${dpi}`, 'ic_launcher_round.png', renderPng(roundSvg, legacyPx))
}
console.log('done')
