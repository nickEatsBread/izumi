# Navigator-style player, the player-look hook and AI "jump to a moment"

Status: player changes, the player-look hook (Theme API 7), the Navigator look theme, the plugin runtime
(beta) and the jump-to-a-moment plugin are built; see "Plugin runtime as built" at the end.

Reference: Navigator's source (GPL-3.0, like izumi), read from `components/ui/media-player.tsx`,
`components/global-media-player.tsx`, `components/player-mobile.css`, `components/arc/foundation.css`,
`components/player-video-fit.tsx`, `desktop/src/player.rs`, `app/tools/subtitles.ts` and
`docs/ask-navigator-evaluation.md`.

## Player changes (every izumi user, desktop)

| Behaviour | Navigator's value | izumi before | izumi now |
|---|---|---|---|
| Idle hide while playing | 3000 ms after the last move; re-checked every 1000 ms while the pointer rests on a control, a menu is open or a drag is held | 3500 ms, hid even with the pointer on a control | Navigator's rule (Game mode keeps 3.5 s) |
| Pointer leaves the player or the window | hides at once unless paused, a menu is open, a drag is held or keyboard focus is in the controls | stayed up for 3.5 s; a move over the sidebar brought it back | Navigator's rule; the titlebar over the video counts as the player |
| Fade | opacity 200 ms `cubic-bezier(.23,1,.32,1)`, 100 ms with reduced motion | none (the bar was mounted and unmounted) | the same fade both ways; the bar unmounts after it |
| Video framing | Fit (`keepaspect=yes`, `panscan=0`), Fill / crop (`panscan=1`), Stretch (`keepaspect=no`) | Best fit and Fill only; Stretch missing | all three, in the player menu and in Settings → Playback → Video framing |
| Seek drag | the played range follows the pointer; one seek on release | only a faint preview bar followed (hidden under the fill when dragging back) | the played fill follows both ways; one seek on release |
| Volume drag | pointer-captured slider (mouse and touch) | mouse drag worked; a finger jumped to the touch point and then ignored the drag | pointer-captured for every pointer type; stays open while focused |
| Back | 36 px circle, 20 px arrow, no label, 16 px from the left, hover lighter on 120 ms ease-out | "← Back" pill, 64 px from the left on Windows and Linux (it always cleared the titlebar's GIF slot, which is empty unless a GIF records) | 36 px `#1a1a1a` circle, 20 px white arrow, no label, 16 px from the left (64 px only while a GIF records, and on macOS beside the traffic lights) |

Tested in an isolated client with real anime (Iron Wok Jan! episode 11, a 1080p MKV with ASS subtitles),
using trusted CDP mouse and touch input and PrintWindow captures:

- the controls hid 3025 ms after the last move;
- the fade-out read 0.66, 0.23, 0.13, 0.017 and 0.003 opacity at 17, 49, 65, 116 and 149 ms, then unmounted
  at about 210 ms;
- leaving the window hid the bar within 60 ms while playing; paused, it stayed;
- resting on Play kept the bar up past 4.5 s;
- a mouse drag from 60 % back to 20 % showed the fill at 50.1, 40.1, 30.1 and 20.2 %. Before the fix the fill
  stayed at 22 %. The release landed at 284.3 s against 283.1 s expected;
- a touch drag of the seek bar tracked the same way. A touch drag of the volume read 78, 52 and 26 for 60, 40
  and 20 % (before the fix it stuck at 114);
- mpv read `keepaspect yes, panscan 0` for Best fit, `yes, 1` for Fill and `no, 0` for Stretch, and the
  captures show the matching letterbox, side crop and stretched picture.

### Default bar buttons (desktop, no theme)

Back (top left). Over the bar: the title and "Episode n / total". The seek bar. Left: Previous episode, Play
or Pause, Next episode, the time ("10:40 / 23:35") and the current chapter's title when there is one.
Right: Volume (its slider opens on hover or focus), Playback options (gear), Discussion, Audio, subtitles
and server, Cast, Screenshot, Miniplayer, Full screen. Episodes is off by default.

Settings → Playback → Player buttons hides or shows Previous and next episode, Discussion, Episodes, Cast,
Screenshot and Miniplayer. That setting and the right-click menu came with PRs #166 and #169; #169 merged
into the settings branch after it had already landed, and #177 brought both back to `main`. Both work on
`main`. Right-clicking the video opens Play or Pause, Previous episode, Next episode, Episodes, Speed,
Audio and subtitles, Cast, Screenshot, Miniplayer, Full screen and Show stats.

### Choosing the look

Navigator lets its users change the subtitle text (size, weight, colour, outline, position, with a
preview) and the video framing, and its player bar always shows the framing button. izumi already had
more on the subtitle side (Settings → Subtitles: font, size, colours, outline, shadow, position, saved
styles), so the built-in additions are the Video framing choice in Settings and Stretch. The rest of the
player's look is chosen with a theme (next section), which users install from the store.

## Player-look hook: Theme API 7

Themes already restyle and reorder the player with `design.css` and the `player.*` hooks. API 7 adds the
two pieces a stylesheet cannot draw (see `docs/THEMES.md`, "Theme API 7"):

- `player.buttons` takes `fit`: a framing button that cycles Best fit, Fill and Stretch (Navigator's
  Scan, Crop and RectangleHorizontal icons);
- `player.endTime: true`: "Ends at 9:41 PM" on the title line, in Navigator's wording and 12-hour clock.

`feat/packs` also defines a Theme API 7 (`player.trackButtons`, `player.rating`, drawer navigation). Neither
has shipped, so when both land API 7 is the union; the merge only conflicts on the version lists.

## Navigator look (store theme)

`izumi.navigator` 1.0.0 (themeApi 7) in the izumi-themes catalog. It uses Navigator's neutral near-black
palette (oklch 19 % background, 96 % foreground, 26 % hover) and its player values. The title is 30 px
semibold, line-height 1.3, tracking -0.01em. The meta line is 14 px white/60. The shade runs from black/80 to
transparent. The seek bar is a 9 px pill clipped to 6 px that opens to 9 px while dragging, over 100 ms. Track,
buffer and played are white/20, white/30 and white. Buttons are 36 px ghost buttons with a 12 px radius,
16 px icons and an oklch 26 % hover. Play and Volume are 32 px. There is a "Next episode" text button, and
the time is 14 px white/80. Left: Play, Next episode, -10, +10, Volume, time. Right: Audio and subtitles,
framing, settings, miniplayer, full screen. It hides what Navigator does not have (Previous, Discussion,
Cast, Screenshot); those stay in the right-click menu. Differences that remain: Navigator's font (Sunghyun
Sans) is not bundled, so it uses Inter; the volume track keeps the system grey; izumi has one button for
audio and subtitles where Navigator has two.

## AI "jump to a moment" plugin: design

The viewer types a description ("the part where he tastes the soup") and the player seeks there.

### Where the text comes from

1. **The episode's own text subtitles** (ASS, SRT or WebVTT: embedded, the addon's or one added in the
   player). These are the only evidence of when something happens. A closed-caption or SDH track is
   preferred when there is one, because its sound cues ("[door slams]") cover moments without dialogue.
2. **An online subtitle** when the stream has no text track: the existing OpenSubtitles, SubDL and Jimaku
   search, aligned to the audio by the existing Automatic sync, then indexed the same way.
3. **Episode metadata** (title, synopsis) as context only, never as a timestamp.

The plugin never sees the video, the stream URL, headers or debrid keys.

### Anime with no usable subtitles

Picture-based tracks (PGS, VobSub) carry no text. If no text track exists and no online one is found, the
plugin says so ("This episode has no text subtitles to search") and offers the subtitle search. No
guessing. A later, opt-in option is local speech-to-text: a downloaded module through the existing modules
framework, run on the device, so audio never leaves it. It is not in v1: it is a large download and slow
on the Deck.

### Model provider and key

The viewer chooses. There is no default endpoint. Settings ask for:

- an endpoint in the OpenAI-compatible chat-completions format, which covers most hosted providers and
  local servers (Ollama, LM Studio, llama.cpp);
- a model name;
- an API key, stored as a plugin secret that only this plugin reads and that backups without secrets leave
  out.

A local endpoint needs no key and sends nothing off the machine.

### Privacy

Each question sends the endpoint the question, the series and episode title, and the subtitle lines
(numbered, without file names or URLs). Nothing else is sent. The first use names the endpoint's host and
asks once. Answers and indexes are cached per subtitle track on the device, so asking again does not
resend the track. A local model sends nothing out.

### Cost

Episode 11 of Iron Wok Jan! (23:35) has 355 English cues and about 3,300 words: about 4,500–8,000 input
tokens with numbering and markup. One question with the whole track costs that plus about 300 tokens of
instructions and 100 of output. At an illustrative $0.15 per million input tokens that is about $0.001; at
$3 per million, about $0.03.

To keep it lower:

- a local keyword and fuzzy pre-filter sends only the best-matching windows (±5 cues around each hit, the
  way Navigator samples), about 1–2k tokens;
- the whole track goes only when the filter finds nothing;
- a repeat question hits the cache.

The viewer pays their provider directly; izumi pays nothing.

### Limitations people raised, and the design's answer

Sources: the Reddit thread (only part of it could be read: reddit.com blocks automated reads, and a search
tool returned five of its 23 comments) and Navigator's own evaluation (`docs/ask-navigator-evaluation.md`).

| Limitation | Answer |
|---|---|
| Silent or purely visual moments ("he walks through the rain") have no dialogue to match | Prefer SDH or CC tracks for sound cues; say plainly when a moment cannot be found; do not invent one. Frame captioning from the trickplay thumbnails is a possible later opt-in |
| Dialogue-rich scenes work best (the author) | State it in the panel's hint text |
| Use SDH subtitles for more detail (a commenter) | Track choice prefers SDH or CC (see above) |
| Wrong occurrence: recaps, flashbacks, a repeated catchphrase (Navigator's evaluation) | Return up to three candidates with the quoted line and time; the best is preselected and a click seeks; the prompt ranks the main event above recaps |
| Model-invented timestamps | The model returns cue numbers in a fixed JSON shape; izumi maps them to times. A number that does not exist is discarded |
| Latency (Navigator measured 11–56 s with web search and episode discovery) | v1 searches only the playing episode: one call, a few seconds, with a progress state and Cancel |
| Results are probabilistic | Abstain when nothing matches ("No match in this episode's dialogue") |
| Subtitle timing off from the video | Apply the viewer's subtitle delay; external tracks are aligned by Automatic sync; seek 2 s before the cue so the line is heard |
| Spoilers when jumping forward | A "Only what I've watched" toggle limits the search to cues before the furthest point reached |
| Different language for question and subtitles | Multilingual models handle it; the viewer's subtitle language is preferred |
| Subtitle files written to steer the model (prompt injection) | Subtitle text is sent as quoted data; the output schema only allows cue numbers and a short reason |
| API errors, quotas | 401 and 429 are shown as such, with the provider's name |

### How it fits the plugin system

The approved plugin design (`docs/superpowers/specs/2026-09-25-plugins-stores-packs-design.md`, §7, not in
git) has the needed pieces: a sandboxed iframe and Worker runtime, `player.control` (seek), a
`player.panel` slot and `network` grants through `plugin_fetch`. None of the Phase 2 runtime exists yet on
`main` or `feat/packs`. The plugin needs three things beyond that design:

- a `player.subtitles` scope: the active text track as `[{ start, end, text }]`, plus the list of tracks;
- a network grant taken from a setting (the endpoint the viewer types), not a fixed domain list;
- for local models, an exception to `plugin_fetch`'s refusal of loopback and private addresses, limited to
  that one configured endpoint.

## Decisions for the owner

1. **Runtime.** Build the minimal Phase 2 runtime now (sandbox, RPC, `player.control`,
   `player.subtitles`, `player.panel`, `plugin_fetch`), with the AI plugin as its first plugin? Or ship "Jump
   to a moment" as a built-in, off-by-default player feature with the same settings, and move it to a
   plugin when Phase 2 lands?
2. **Endpoint grant.** Allow a plugin's network grant to come from an endpoint the viewer types?
3. **Local models.** Allow loopback for that one endpoint?
4. **New scope.** Add the `player.subtitles` scope?

## Plugin runtime as built (2026-11-15)

The owner chose to build the runtime. The plugin cannot work without decisions 2 and 4, so both are in.
Decision 3 is in only for the one endpoint the viewer types.

- **Package.** `plugin.json` (app, kind `plugin`, schemaVersion 1, pluginApi 1, id, name, version, author,
  description, `main` path and SHA-256, permissions, settings, optional `panel`) plus one `main.js` ES
  module: `export default { activate(izumi) { … } }`. `node scripts/plugins/pin-main.mjs <folder>` writes
  the hash. Files under `plugins/` are kept LF so the hash survives a Windows checkout.
- **Scopes.**
  - `network`: listed https domains, plus the host of a `url` setting (`fromSetting`). Local and private
    addresses are refused, except that endpoint, which may use http only when it is on this computer.
  - `player.events`: what is playing, position, duration and pause.
  - `player.subtitles`: the selected text track as cues, shifted by the viewer's subtitle delay.
  - `player.control`: seek.
  - `player.panel`: a prompt, a status line and up to 20 results, all drawn by izumi.

  Always available: settings (secrets in `plugin-secret-<id>`, which key-policy classes as a secret),
  5 MB of storage, and a log.
- **Sandbox.** Each plugin runs in a hidden `<iframe sandbox="allow-scripts">` srcdoc. Its CSP is
  `default-src 'none'; script-src 'sha256-<bootstrap>' blob:; worker-src blob:`, so it can make no
  connections. The bootstrap starts a classic Worker, which imports the plugin module from a blob. A
  module Worker cannot start from a blob in an opaque origin on WebView2. izumi is reached only through a
  MessagePort. A heartbeat stops a plugin that stops answering.
- **Conformance probe.** It runs before any plugin starts, and all checks must be blocked:
  - frame: parent, localStorage, indexedDB, cookie, fetch, the IPC fetch, an IPC invoke, `chrome.webview`;
  - worker: fetch, XHR, WebSocket, remote import, indexedDB, caches, IPC globals, the IPC fetch.
- **WebView2 finding.** Tauri's `__TAURI_INTERNALS__` and `ipc` are present (and non-configurable) inside the
  sandboxed frame, contrary to the spec's main-frame-only assumption. Tauri ignores them there: an invoke
  gets no answer, and a `set volume` from the frame changed nothing. Plugin code never runs in the frame;
  the Worker has neither global.
- **Settings → Sources and store → Plugins (beta).** It has:
  - the beta switch, off by default;
  - install from an https `plugin.json` URL, or from files;
  - a permission review before install;
  - per-plugin settings, a log and removal.
- **The player panel copies Navigator's Ask panel** (`components/navigator/focus.tsx`, `focus-results.tsx`,
  `result-card.tsx`, `activity-status.tsx`), with Navigator's dark tokens and motion:
  - it sits centred at the bottom of the video, up to 36 rem wide;
  - above it are the activity pill (a 3×3 pixel loader on a 650 ms cycle, plus text with a 1.4 s shimmer) and
    a New pill;
  - while the plugin works, a beam travels around the panel's border every 4 s;
  - the viewer's question is a teal bubble;
  - steps read "Found the title", "Loaded subtitles", "Finding the scene in the dialogue" and "Found the scene";
  - result cards rise 10 px over 180 ms, 50 ms apart: cover, subtitle track with its line count, and "At 0:16"
    with the quote;
  - each answer ends with "Done in Ns";
  - the composer grows with its text, and its send arrow becomes a stop square while busy.

  Plugins send only data (turns, steps and cards); izumi draws them. An image is only ever the playing
  title's cover, filled in by izumi, so a plugin cannot load a URL to track the viewer. The beam is drawn
  in CSS, because Navigator's BorderBeam is a React package. Navigator's Ship icon is its own logo;
  plugins get Sparkles.
- **Jump to a moment** (`plugins/jump-to-moment`). It needs four settings: the model address, the model,
  an optional key, and "Only search what I've watched". To answer a question it:
  1. keeps the lines around keyword hits (±5 lines, top 12 hits), or all lines when nothing matches;
  2. asks for up to three line numbers as JSON;
  3. drops numbers it did not send;
  4. seeks 2 s before the best line, and lists the others;
  5. caches answers per episode, track and question.
- **Tested in the real client** with a local stand-in for a chat API (no real model fits in this laptop's
  free memory):
  - the probe passed every check;
  - the plugin started in its sandbox, read 98 pre-filtered lines of an external SRT, and sent only the
    title, episode, question and lines;
  - it sought to the returned line in 620 ms;
  - with the embedded track selected, it explained it cannot read it.
  
  A real model's answer quality is not measured here.
- **Not in v1:**
  - reading subtitle tracks embedded in the video file (needs a Matroska text-track reader in Rust);
  - store listings for plugins (the store branch lists sources, themes and packs);
  - automatic updates and pending-permission review on update;
  - DNS-level private-address checks (the guard reads the URL's host; Rust follows redirects);
  - the other spec slots and scopes.
