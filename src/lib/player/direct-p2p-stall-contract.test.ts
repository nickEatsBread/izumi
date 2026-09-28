import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Normalized so the function-end markers below match a CRLF checkout too.
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const desktopPlayer = source('../../../src-tauri/src/player/mod.rs')
const desktopCommands = source('../../../src-tauri/src/lib.rs')
const directTorrent = source('../../../src-tauri/src/direct_torrent.rs')
const androidPlugin = source(
  '../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt',
)

/** One function's text, so ordering assertions cannot match code elsewhere in the file. */
function body(file: string, start: string, end: string): string {
  const from = file.indexOf(start)
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0)
  const to = file.indexOf(end, from + start.length)
  expect(to, `unterminated ${start}`).toBeGreaterThan(from)
  return file.slice(from, to)
}

/** Assert `first` appears in `text` and before `second`. */
function before(text: string, first: string, second: string) {
  const a = text.indexOf(first)
  const b = text.indexOf(second)
  expect(a, `missing ${first}`).toBeGreaterThanOrEqual(0)
  expect(b, `missing ${second}`).toBeGreaterThanOrEqual(0)
  expect(a, `${first} must come before ${second}`).toBeLessThan(b)
}

// Once a direct-P2P video plays, a starving swarm must stay a buffering state. mpv's read timeout
// plus FFmpeg's reconnect budget otherwise turn ~2 minutes of starvation into EOF, which the
// frontend reads as a truncated source: wrong-content penalty, cleared resume point, auto-advance
// on desktop and a source replacement on Android.
describe('direct P2P starvation stays buffering', () => {
  it('desktop opens only the torrent video without a read timeout', () => {
    const load = body(desktopPlayer, 'fn load_file(', '\n}\n')
    before(load, 'let network_timeout = network_timeout_for(url)', 'mpv.command("loadfile"')
    before(load, 'mpv.set_property("network-timeout", network_timeout)', 'mpv.command("loadfile"')
    before(load, 'sidecar_gate.begin_file(', 'mpv.command("loadfile"')
  })

  it('desktop restores the normal timeout at FileLoaded before any sidecar opens', () => {
    const loaded = body(desktopPlayer, 'Some(Ok(Event::FileLoaded)) => {', 'Some(Ok(Event::PropertyChange')
    before(loaded, '"network-timeout", NETWORK_TIMEOUT_SECONDS', 'sidecar_gate.file_loaded()')
    before(loaded, 'sidecar_gate.file_loaded()', 'attach_external_tracks(')
  })

  it('desktop runtime subtitles wait for that restore', () => {
    for (const command of [
      body(desktopCommands, 'async fn player_attach_subtitle_url(', '\n}\n'),
      body(directTorrent, 'pub async fn torrent_playback_add_subtitle(', '\n}\n'),
    ]) {
      before(command, 'player.sidecars_ready().await', 'player.add_subtitle_auto(')
    }
  })

  it('a closed player releases subtitles that were waiting for its video', () => {
    for (const teardown of [
      body(desktopPlayer, 'pub fn idle(&self)', '\n    }\n'),
      body(desktopPlayer, 'pub fn stop(&self)', '\n    }\n'),
    ]) {
      expect(teardown).toContain('self.sidecar_gate.begin_file(false)')
    }
  })

  it('Android opens only the torrent video without a read timeout', () => {
    const load = body(androidPlugin, 'private fun loadIntoCore(', '\n    }\n')
    before(load, 'isLocalTorrentStream(args.url)', 'm.command(arrayOf("loadfile"')
    before(load, 'setPropertyString("network-timeout"', 'm.command(arrayOf("loadfile"')
  })

  it('Android restores the normal timeout at FILE_LOADED before its sidecars', () => {
    const events = body(androidPlugin, 'override fun event(eventId: Int)', '\n    }\n')
    before(events, 'setPropertyString("network-timeout", NETWORK_TIMEOUT_SECONDS)', '"audio-add",')
    before(events, 'setPropertyString("network-timeout", NETWORK_TIMEOUT_SECONDS)', '"sub-add",')
    before(events, 'setPropertyString("network-timeout", NETWORK_TIMEOUT_SECONDS)', 'takeHeldSidecars(')
  })

  it('Android holds runtime sidecar loads until then', () => {
    const command = body(androidPlugin, 'fun command(invoke: Invoke)', '\n    }\n')
    before(command, 'holdSidecar(a.args)', 'mpv?.command(a.args)')
    expect(body(androidPlugin, 'private fun teardownCore(', '\n    }\n')).toContain('heldSidecars = null')
    expect(body(androidPlugin, 'private fun loadNativeMedia(', 'private fun releaseNativeMedia'))
      .toContain('heldSidecars = null')
  })

  it('Android native HDR route keeps retrying a starving torrent instead of failing over', () => {
    const load = body(androidPlugin, 'private fun loadNativeMedia(', 'private fun releaseNativeMedia')
    before(
      load,
      'if (isLocalTorrentStream(args.url))',
      'setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(Int.MAX_VALUE))',
    )
    before(
      load,
      'setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(Int.MAX_VALUE))',
      'mediaSourceFactory.createMediaSource(item)',
    )
  })
})
