import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const trailer = readFileSync(fileURLToPath(new URL('./YoutubeTrailer.svelte', import.meta.url)), 'utf8')
const dialog = readFileSync(fileURLToPath(new URL('./TrailerDialog.svelte', import.meta.url)), 'utf8')

describe('hover trailer keyboard mute', () => {
  it('lets the active preview own M without interfering with text input', () => {
    expect(trailer).toContain('const key = e.key.toLowerCase()')
    expect(trailer).toContain("if (key === 'm') toggleMute()")
    expect(trailer).toContain("target.closest('input, textarea, select, [contenteditable=\"true\"]')")
    expect(trailer).toContain("window.addEventListener('keydown', onKey, true)")
    expect(trailer).toContain('activeKeyboardTrailers[activeKeyboardTrailers.length - 1] !== keyboardOwner')
  })

  it('sends the audio command synchronously from the user gesture', () => {
    expect(trailer).toContain("if (playing) send($trailerMuted ? 'mute' : 'unMute')")
    expect(trailer).toContain('onclick={(e) => { e.stopPropagation(); toggleMute() }}')
  })

  it('promotes a playing hover trailer into the app-level dialog with T', () => {
    expect(trailer).toContain("(key !== 'm' && key !== 't')")
    expect(trailer).toContain("if (key === 't' && !playing) return")
    expect(trailer).toContain("send('mute')")
    expect(trailer).toContain('openTrailerPopup(id, title)')
  })

  it('routes both trailer surfaces through the macOS-compatible embed source', () => {
    expect(trailer).toContain("youtubeEmbedSource(videoId, { controls: false, muted: true })")
    expect(dialog).toContain("youtubeEmbedSource(popup.id, { controls: true, muted: false })")
    expect(trailer).not.toContain('credentialless')
    expect(trailer).toContain("json.event === 'onError'")
  })
})
