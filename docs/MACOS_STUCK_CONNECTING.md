# macOS: playback stuck on "Connecting"

## Symptom

On macOS the full-screen loader stayed on **Connecting** (series title, the chosen file name,
Cancel) forever. No error, no video.

The file name on that screen does not mean the source resolved. `playStream` shows the addon's
`behaviorHints.filename` as soon as a source is chosen. The screen clears only when `playStream`
leaves the `resolving` state, which on desktop happens right after `invoke('player_embed')`
resolves.

## Reproduction

There was no Mac on hand, so this was reproduced on GitHub-hosted macOS runners (macOS 15 and
macOS 26, Apple Silicon, no GPU) with a throwaway harness on `chore/macos-playback-repro`. The
harness:

- builds the real app against Homebrew libmpv, the same library the release bundles;
- calls `playStream` against a loopback range server;
- reports every stage over HTTP, so logging keeps going even when Tauri IPC is stuck;
- takes `sample` stack captures and screenshots.

The runners have no GPU, so the harness branch falls back to a software OpenGL pixel format.
Shipped builds still require an accelerated format.

- HTTP sources (H.264 and HEVC 10-bit, first play and core reuse) played normally on both
  versions.
- A direct-P2P test torrent (Creative Commons film with sidecar subtitle files) found no peers on
  the macOS 26 runner. While it sat there, the **AppKit main thread was blocked for 123 s**.
  `close_player` timed out, and the next play stayed on Connecting until the main thread came
  back (`player embed accepted {"durationMs":25000}`).
- A deterministic version of the same thing also reproduces it: play a file, attach a subtitle
  URL whose server accepts the connection and never answers, then start another play.

## Root cause

The `sample` stacks taken during the stall show:

- **A tokio thread** is in `torrent_playback_add_subtitle` → `PlayerHandle::add_subtitle` →
  `Mpv::command("sub-add")` → `mp_waiter_wait`. It holds `PlayerHandle`'s mpv mutex.
- **mpv's worker thread** is in `mp_add_external_file`, reading the subtitle, which has no
  pieces yet. The core thread is idle, so mpv itself would answer other calls.
- **The main thread** is in the sync command `player_get_property`, waiting for that mutex.

A URL `sub-add` only returns when its read ends. For a normal URL that is mpv's 30 s network
timeout times FFmpeg's reconnects, about two minutes. For a torrent piece nobody seeds, it may
never end.

Sync Tauri commands run on the main thread, and on macOS every IPC request is dispatched there
too (`WKURLSchemeHandler`). So one stalled sidecar subtitle stopped all IPC, including the next
play's `player_embed`, while the Connecting screen kept spinning.

The same path serves online and debrid subtitles (`player_attach_subtitle_url`), so any slow
subtitle server could freeze the app in the same way.

## Fix

`PlayerHandle` keeps the core as `Arc<Mpv>`. `add_subtitle_with_flag` clones it and releases the
lock before `sub-add`, then runs the read on the blocking pool so it cannot tie up an async
worker either.

Checked with a ctypes probe against libmpv 0.37: during a stalled URL `sub-add`, `get_property`
on the same handle returns in 0.0 s. So releasing izumi's lock is enough; no change in mpv is
needed.

## Verification

- `player::tests::a_stalled_subtitle_add_leaves_the_player_lock_free` drives a real libmpv core
  and a server that never answers. Without the fix it fails: "a player command waited 2.8 s
  behind a stalled subtitle read". With the fix it passes.
- The macOS runner harness was re-run with and without the fix (see the PR for the numbers).

## Not verified

- The owner's exact source and Mac: real GPU, their add-ons, their torrent or debrid link.
- Runtime `sub-add`s queued at FileLoaded (`attach_external_tracks`) run on the event-loop
  client, not under this lock. They can still delay player events while a sidecar stalls, but
  they cannot freeze IPC.
