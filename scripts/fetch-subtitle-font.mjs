// Stage izumi's subtitle font as an Android asset for the embedded libmpv player.
//
// Android ships no Nunito, and libass can only load a real font file — the app's own webfont copy
// (@fontsource-variable/nunito) is woff2, which FreeType on this build will not open. mpv is pointed
// at the staged directory via `sub-fonts-dir` (see MpvPlugin.prepareFontsDir), which is ADDITIVE:
// the device's own families still resolve on top of it.
//
// Fetched at build time rather than committed, so the repo stays binary-free. Nunito is SIL OFL 1.1
// (see THIRD-PARTY-NOTICES.md); the OFL text is fetched alongside it and shipped in the same folder.
//
//   node scripts/fetch-subtitle-font.mjs
//
// Idempotent: an already-staged font of a plausible size is left alone.

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, 'src-tauri', 'tauri-plugin-mpv', 'android', 'src', 'main', 'assets', 'fonts')

// Upstream Google Fonts, the canonical OFL source. The variable font's default instance is
// Regular (wght 400), which is what subtitles render at.
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/Nunito%5Bwght%5D.ttf'
const LICENSE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt'
const FONT_FILE = 'Nunito.ttf'
// Nunito's variable TTF is ~400 KB. Anything far below that is an error page, not a font.
const MIN_BYTES = 100_000

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function download(url, min) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < min) throw new Error(`${url} -> only ${bytes.length} bytes`)
  return bytes
}

const fontPath = join(assets, FONT_FILE)
if ((await fileSize(fontPath)) >= MIN_BYTES) {
  console.log(`subtitle font already staged: ${fontPath}`)
  process.exit(0)
}

await mkdir(assets, { recursive: true })
const font = await download(FONT_URL, MIN_BYTES)
// A TrueType file starts with the 0x00010000 sfnt version tag; `ttcf`/`OTTO` are the other valid
// sfnt headers. Anything else means we saved a redirect page under a .ttf name.
const tag = font.subarray(0, 4)
const sfnt = tag.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) ||
  tag.toString('latin1') === 'ttcf' ||
  tag.toString('latin1') === 'OTTO' ||
  tag.toString('latin1') === 'true'
if (!sfnt) throw new Error(`downloaded ${FONT_FILE} is not an sfnt font (header ${tag.toString('hex')})`)
await writeFile(fontPath, font)

const licensePath = join(assets, 'Nunito-OFL.txt')
if (!(await fileSize(licensePath))) {
  await writeFile(licensePath, await download(LICENSE_URL, 1_000))
}
// Sanity check the pair actually landed.
if (!(await readFile(licensePath, 'utf8')).includes('SIL OPEN FONT LICENSE')) {
  throw new Error('staged Nunito licence does not look like the OFL')
}
console.log(`staged ${FONT_FILE} (${font.length} bytes) in ${assets}`)
