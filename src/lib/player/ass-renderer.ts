import JASSUB from 'jassub'
// Explicit asset URLs: the library's own `new URL(..., import.meta.url)` lookups break once the dev
// server pre-bundles it.
import workerUrl from 'jassub/dist/worker/worker.js?worker&url'
import wasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url'
import wasmWorkerUrl from 'jassub/dist/wasm/jassub-worker.js?url'
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url'
import modernWasmWorkerUrl from 'jassub/dist/wasm/jassub-worker-modern.js?url'
import defaultFontUrl from 'jassub/dist/default.woff2?url'
import { assFontFamilies, fontsForFamilies, needsOwnFonts, type SubtitleFont } from './ass-subtitles'

/** The face libass uses when a script names a font nobody supplied (metric-compatible with Arial). */
const DEFAULT_FONT = 'liberation sans'
const EMPTY_SCRIPT = '[Script Info]\nScriptType: v4.00+\n'

/** libass (WebAssembly) drawing one ASS script at a time on a canvas laid over a video. */
export interface AssRenderer {
  readonly ready: Promise<void>
  /** Draw `content` (a track switch, or the same track restyled). False, and nothing drawn, when its
   *  fonts could not be fetched and the fallback face has no glyphs for its writing system. */
  setTrack(content: string): Promise<boolean>
  /** Seconds added to the video's clock before drawing: minus mpv's `sub-delay`. */
  setTimeOffset(seconds: number): Promise<void>
  destroy(): Promise<void>
}

const fetchFont = (url: string): Promise<Uint8Array | null> => fetch(url)
  .then((res) => (res.ok ? res.arrayBuffer() : null))
  .then((body) => (body ? new Uint8Array(body) : null))
  .catch(() => null)

/**
 * The renderer follows the video's own frame clock, so playback, seeks and rate changes need nothing
 * from the caller. Every face of the families a script names is loaded before it is drawn (a lazy
 * lookup only finds a family's regular and bold, so italics would be faked); any other listed font
 * is fetched the first time a line asks for it, and a font nobody lists is drawn in the fallback.
 */
export function createAssRenderer(video: HTMLVideoElement, fonts: SubtitleFont[], timeOffset: number): AssRenderer {
  const availableFonts: Record<string, string> = {}
  for (const font of fonts) availableFonts[font.family.toLowerCase()] = font.url
  const loaded = new Set<string>()
  const jassub = new JASSUB({
    video,
    subContent: EMPTY_SCRIPT,
    workerUrl,
    wasmUrl,
    wasmWorkerUrl,
    modernWasmUrl,
    modernWasmWorkerUrl,
    // The fallback is loaded up front: fetched lazily, a paused frame would stay blank.
    fonts: [defaultFontUrl],
    availableFonts,
    defaultFont: DEFAULT_FONT,
    // Only the source's fonts and the bundled fallback: no permission prompt, same faces everywhere.
    queryFonts: false,
    timeOffset,
  })
  // A paused video presents no new frame, so a new script or delay is drawn on request.
  const repaint = () => jassub.manualRender({
    mediaTime: video.currentTime,
    width: video.videoWidth,
    height: video.videoHeight,
    expectedDisplayTime: performance.now(),
  }, true)
  return {
    ready: jassub.ready,
    async setTrack(content) {
      await jassub.ready
      const wanted = fontsForFamilies(fonts, assFontFamilies(content)).map((font) => font.url).filter((url) => !loaded.has(url))
      const files = await Promise.all(wanted.map(fetchFont))
      const got: Uint8Array[] = []
      files.forEach((file, i) => {
        if (!file) return
        loaded.add(wanted[i]!)
        got.push(file)
      })
      if (got.length < wanted.length && needsOwnFonts(content)) return false
      if (got.length) await jassub.renderer.addFonts(got)
      await jassub.renderer.setTrack(content)
      await repaint()
      return true
    },
    async setTimeOffset(seconds) {
      jassub.timeOffset = seconds
      await jassub.ready
      await repaint()
    },
    destroy: () => jassub.destroy(),
  }
}
