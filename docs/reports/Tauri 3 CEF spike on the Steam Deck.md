# Tauri 3 CEF spike on the Steam Deck: go, with three conditions

The throwaway spike described in [Chromium paths for the Linux client](Chromium%20paths%20for%20the%20Linux%20client.md) ran on the Deck on 2026-11-13.

**What it is.**
- Tauri 3.0.0-alpha.6 with tauri-runtime-cef 3.0.0-alpha.7 (CEF 154.0.34), in offscreen mode, with the #16189 patch applied.
- One X11 child window inside the Tauri window carries an EGL context.
- libmpv's render API draws the video into it: a 1080p23.976 H.264 file decoded with VA-API. CEF's GPU frames are imported as DMA-BUFs and blended on top.
- It loads izumi's production UI from `feat/packs` 4305b170 with the Crunchy Deck 2.0.16 theme. That branch is needed because Crunchy Deck uses Theme API 7, and `main` stops at 6.
- izumi's own commands are stubbed. The player commands are the exception and drive a real libmpv.
- It runs in Game mode from its own Steam shortcut, without Flatpak.

**Results.** The design works on the Deck, and on most measures it is ahead of today's WebKitGTK build.
- Video and UI reach gamescope as one window.
- CEF hands over hardware frames on radeonsi, and importing each one costs 0.4 ms.
- Over 5 minutes of controls waking, hiding and scrubbing, mpv dropped and delayed no frames, the same as bare mpv.
- Every scrolling and focus probe that took 28–50 ms per frame on WebKitGTK ran at the frame cap.
- Style recalculation costs about 2.5 times less per element.

**The three conditions** concern how the port is built, not Chromium itself:

1. The compositor must render and swap on its own thread, and must not use Mesa's async present (`vblank_mode=0`). Both alternatives failed on the Deck (see below).
2. izumi's Home keeps a renderer busy even when idle, at about 40% of a core. The WebKit build's figure on the owner's Home was similar once Xwayland is counted. It is a UI fix, but G4's idle budget cannot pass until it is done.
3. Input needs host work izumi already has or can copy, and the owner verified the result on the Deck:
   - the D-pad read as hat axes;
   - the touch-mode keepalive;
   - CEF page focus kept, or no focus ring is drawn.

## Gate results

| Gate | Pass condition | Measured on the Deck | Result |
|---|---|---|---|
| G1 Presentation | One window with video and UI, in Game mode and Desktop mode | Game mode: gamescope shows the single toplevel (`GAMESCOPE_FOCUSED_WINDOW` is the spike) with VA-API video, izumi's player controls and Home composited. Desktop mode: a normal decorated window under kwin_x11 with video and controls. This Deck's Desktop session is X11; Plasma on Wayland was not tested. No `STEAM_GAME` workaround was needed | **Pass** |
| G2 GPU path | Non-black DMA-BUFs on radeonsi; hardware GPU process | Every paint arrived through `on_accelerated_paint`: 0 CPU paints and 0 import failures across all runs. Format AR24 1280×800, 1 plane, modifier `DRM_FORMAT_MOD_INVALID`. Screenshots of the composited window show the full UI; the sampled centre pixels are the theme's near-black background, (24, 17, 13), not zero. Import plus copy took p50 0.40 ms, p90 0.47 ms. The GPU process runs ANGLE OpenGL ES 3.2 on Mesa 26.1.2 radeonsi (vangogh), with GPU compositing and rasterization on and SwiftShader not loaded. The app set `--use-angle=gl-egl` itself in a release build: it reaches Chromium's child processes even though process command-line switches are ignored | **Pass** |
| G3 Smoothness | Controls fade and scrub over playback; `frame-drop-count` and `vo-delayed-frame-count` no worse than bare mpv over 5 min | Spike: 29 wake/hide cycles and 14 seek-bar drags in 5 min gave 0 dropped, 0 decoder-dropped and 0 delayed frames, polled every 250 ms because mpv resets these counters on every seek. Composite p50/p90 1.1/1.4 ms, swap 0.17/0.22 ms. Bare mpv (same libmpv 0.37, OSC, the same seeks over IPC): 0/0/0 | **Pass** |
| G4 Cost | Idle under 5% of a core; UI-hidden playback within 10 points of bare mpv; PSS and power within a ceiling over today's build | Static page: 1.1% of a core for the whole CEF tree (WebKit build: 1.4%). Playback with the UI hidden: 7.4% (bare mpv 6.6%, WebKit build 10.5%). PSS 816–859 MB (WebKit build 793–1,042 MB). APU power 2.03 W static and 3.08 W during playback (WebKit build 2.21 W and 3.07 W). Idle on Home: 40% of a core, which is izumi's own animations | **Pass for the runtime; Home idle fails on both engines** |
| G5 Input | Touch, pointer, keyboard, Steam floating keyboard and gamepad, with no focus loss | Pointer: clicks, hovers and seek-bar drags all work. Keyboard: arrow keys move focus and text reaches fields. Steam floating keyboard: izumi's own focus handler opens it, and the owner saw it over the search field. Touch: with gamescope's default the touchscreen acts as a mouse (a cursor, and swipes don't scroll). With izumi's `STEAM_TOUCH_CLICK_MODE=4` keepalive the spike gets real touch (301 events in one swipe test), forwarded with CEF's `send_touch_event`; taps open titles. Gamepad: the owner's D-pad and A presses moved focus and opened a title (76 `gamepad-input` events). The focus ring only appears once CEF's page focus is kept (see below). Finger swipes scroll rows with no cursor, but felt laggy until izumi's WebKit-era row driver was switched off (see below); the left stick navigates once mapped as izumi maps it. On the final build the owner checked swipe feel, the ring with the real D-pad, the left stick, and input after opening and closing the Steam menu, and called it good | **Pass (owner-verified on the final build)** |
| G6 UI engine | Home restyle and scroll smoothness at least match WebKitGTK | Every frame-time probe runs at the frame cap: script `scrollTo` on a row 17/17 ms (WebKitGTK 33), focus moves 17 (WebKitGTK ~28), held D-pad glide 17/17 (WebKitGTK ~50), window scroll 17 (WebKitGTK 17). A 60 fps capture of the row scroll showed 182 of 182 frames changing. Restyle: 31 ms show and 59 ms custom-property on 1,833 elements, against WebKitGTK's 101 ms and 144 ms on 2,327 elements measured the same day (113 ms on 2026-10-29) | **Pass** |

### G4 detail

CPU is a percentage of one core, summed over the whole process tree that Steam launched. Power is the APU's own sensor (amdgpu hwmon `power1_average`). The Deck stayed on its charger the whole time, so battery draw could not be read.

| Run | App CPU | gamescope | Xwayland | PSS | APU power |
|---|---|---|---|---|---|
| Spike, Settings (static) | 1.1% | 0.8% | 0.1% | 816 MB | 2.03 W |
| WebKit build, Settings (static) | 1.4% | 1.1% | 0.4% | 845 MB | 2.21 W |
| Spike, Home idle (AniList Home) | 40.0% | 2.7% | 1.7% | 847 MB | 3.10 W |
| WebKit build, Home idle (owner's Crunchyroll Home) | 22.2% | 5.1% | 13.4% | 793 MB | 3.45 W |
| Spike, playback with UI hidden | 7.4% | 2.6% | 1.5% | 837 MB | 3.08 W |
| WebKit build, playback with UI hidden (`gpu-next`) | 10.5% | 2.8% | 1.3% | 1,042 MB | 3.07 W |
| Bare mpv, playback | 6.6% | 3.0% | 1.1% | 114 MB | 2.91 W |
| Spike, G3 run (controls and scrubs) | 9.9% | 2.9% | 1.7% | 859 MB | 3.18 W |
| Bare mpv, G3 run (OSC and seeks) | 6.6% | 2.9% | 1.2% | 132 MB | 2.94 W |

The Home idle cost has two sources, both in izumi rather than in either engine:
- The Hero progress bar runs a `requestAnimationFrame` loop every frame and repaints its gradient as it grows: about 30 paints a second at a 60 fps frame rate.
- Twelve `skeleton-swipe` shimmer animations keep running on cards scrolled out of view.

Per-thread sampling puts the load in the page, not in CEF:

| Thread | Home idle, 60 fps | Home idle, 90 fps | Settings, 90 fps |
|---|---|---|---|
| Renderer main | 18% | 36.5% | 1.0% |
| Renderer compositor | 4.6% | 9.9% | — |
| GPU process | ~9% | 11.1% | 0.1% |
| Browser main thread | 3.0% | 3.5% | 0.6% |
| Compositor render thread | 1.2% | 1.0% | — |

Three conclusions follow:
- The browser main thread stays low, so the #16189 pump spin is gone.
- The GPU process is idle on a static page, so there is no begin-frame ticking with nothing to draw.
- The renderer is doing Home's own work, and that work scales with the frame rate. On Home the WebKit build also costs 13.4% of a core in Xwayland, against 1.7% for the spike. Its Home was the owner's Crunchyroll screen, not the spike's AniList one, so the two Home rows are not a like-for-like comparison. The static-page and playback rows are.

## Animations with and without izumi's Game-mode code paths

The owner judged the motion on the Deck by eye and accepted it: clicks, focus moves and screen-to-screen changes feel right. The numbers below are what was recorded before that call, and no more animation work was done. The run that matters is **Game mode off**, plain Chromium with no WebKit workarounds. Game mode on is today's app, kept for comparison.

This section was requested after the owner saw the spike under WSLg. WSLg is not representative: it renders with llvmpipe in software, and CEF's default windowless frame rate is 30. On the Deck these runs used CEF at 90 fps, matching the 89.9 Hz panel, and every paint came through `on_accelerated_paint` (0 CPU paints). They were captured with `x11grab`: 60 fps captures plus one 90 fps capture. "Static" counts repeated frames inside each motion burst.

"Game mode on" is izumi's code as it runs on the Deck today. "Game mode off" answers `player_is_game_mode` false, which gives the plain Chromium code paths without izumi's WebKit workarounds. That also switches izumi to its desktop layout: 1280×800, with titlebar buttons.

| Animation | Game mode on | Game mode off |
|---|---|---|
| Home banner cross-fade (3 fades, about 0.6 s each) | p50/p90 16.7/16.7 ms; 4 static of 120 frames; 34 paints/s | p50/p90 16.7/16.7 ms; 9 static of 107; 93 paints/s |
| Card focus move and scale (8 D-pad steps) | p50/p90 16.7/16.7 ms, max 67; 19 static of 175 | p50/p90 16.7/33.3 ms, max 50; 16 static of 150 |
| Player controls show and hide | No fade: the controls appear in one frame and vanish in one | No fade: the same |
| Banner at a 90 fps capture (Game mode on) | p50/p90 11.1/22.2 ms; 36 static of 114 frames: about 60 distinct frames a second against the 90 requested | Not captured |

The static frames in the card moves fall in the ease-out tails, where a step is smaller than the detector's threshold. The 60 fps captures cannot show more than 60, so the banner was also captured at 90 fps: the cross-fade reached the screen at about 60 frames a second even though CEF was asked for 90 and the panel runs at 89.9 Hz. The spike did not find which stage holds it at 60, whether the renderer, CEF's frame scheduling or the render thread's vsync-paced swap. That is the first thing to profile if 90 Hz UI motion matters. With Crunchy Deck 2.0.16, izumi shows and hides the player controls with no transition in either mode, so there is no fade to measure. Not investigated: why Game mode on paints 34 times a second during the banner and Game mode off 93 times. On this evidence izumi's plain code paths animate as well as its Game-mode ones under Chromium, and the compositor replaces the snapshot path. The owner's goal of one UI without Game-mode special cases holds on the Deck.

## Two visual issues the owner spotted

Both were checked against today's shipped WebKit izumi (devel build, Game mode) on the same pages.

- **Series page, the Oldest/Newest control and the round search and download buttons look out of place.** This is a real gap in the Crunchy Deck theme, not a spike artifact. WebKit izumi draws the same controls with the same styling under the season chips (`episodes.sort`, `episodes.search` and `episodes.download`). In the spike they look the same with Game mode on or off.
- **Categories has no background.** This is a spike artifact. The backdrop is a genre image that appears when a chip takes focus, and only a source catalog supplies those images (`sourceGenreImages` in `src/lib/catalog/browse-fetch.ts`). On the owner's Crunchyroll catalog, WebKit izumi shows one as soon as a chip is focused. The spike runs on the AniList catalog, which has no genre images.

## Game mode stays a layout and input concept

Today one `gameMode` store drives two unrelated things:
- **the handheld/TV surface**: the `gamemode` class, `data-surface="tv"`, the theme's `tv` block (Crunchy Deck scales `--cd` by 1.2 there), button hints, controller navigation, and the Deck page zoom;
- **the WebKitGTK workarounds**: script-driven motion, the row touch driver, and the snapshot and native-HUD player path.

The port should keep the first and delete only the second. Splitting the store into a "handheld/TV surface" flag and a "WebKit compositor workarounds" flag (which then goes away) belongs on the port's work list. Answering `player_is_game_mode` false in the spike showed why: it turns off the TV surface along with the workarounds, so izumi falls back to its desktop layout (1280×800, titlebar buttons).

## Phase 2: Flatpak

The spike was then packaged as `com.nicho.izumi.cefspike` and installed for the user beside `com.nicho.izumi`, with its own Steam shortcut and its own data under `~/.var/app`. It uses izumi's GNOME 50 runtime and permissions:
- `--socket=x11`, `--device=dri` and `--device=all`;
- pulseaudio;
- Steam's directories, for the floating keyboard.

**What the package contains.**
- **CEF sandbox:** zypak v2025.09, as on Flathub's Tauri-CEF app. The launcher sets `ZYPAK_CEF_LIBRARY_PATH` to `libcef.so` and runs the spike through `zypak-wrapper`. zypak's default spawn strategy worked, so `ZYPAK_ZYGOTE_STRATEGY_SPAWN=0` was not needed.
- **Desktop file:** `%u` and `StartupWMClass=cef-spike`. The spike sets that `WM_CLASS` on its window itself, working around #16474.
- **Build:** the spike binary and CEF were built outside the sandbox and copied in, with only the en-US locale. libmpv (mpv 0.41, X11 on, PipeWire off), libplacebo, libass and libXpresent came from izumi's own devel build on the same runtime, which uses identical module definitions. So only zypak compiled.
- **Build cost on the 16 GB laptop:** `--jobs=2` under a 2 GB cap, peak host commit 37.85 GB, with no watchdog stop.

| Check | Result |
|---|---|
| Install size | 112 MB download (the bundle); 336.9 MB installed. The GNOME 50 runtime is shared with izumi and was already on the Deck. izumi's own app is 75 MB installed. |
| Start from Steam, first launch after install | After the Steam launch call: launcher at 1.47 s, `main` at 1.64 s, first frame on screen 2.53 s, first UI frame from CEF 2.90 s. Home's rows were there by 14.2 s; that includes AniList fetches and polling that began late, so it is an upper bound. There was no blank-window stall. On a later launch the owner started from the Steam library, the first UI frame came 1.17 s after the launcher started, against 1.43 s on the first launch. |
| Chromium sandbox | zypak's spawn strategy is active. The renderers run under a zygote that zypak started through flatpak-spawn, which gives them their own pid and network namespaces. Every process has a seccomp filter. No `--no-sandbox` or `--disable-gpu-sandbox` switch is set. Chromium still reports the **GPU process** as `sandboxed: false`, exactly as in the unpackaged spike: CEF's GPU-process sandbox is off either way, so Flatpak's container is that process's only boundary. |
| VA-API in the sandbox | `hwdec-current: vaapi` on the runtime's Mesa 26.2.5, with 0 dropped and 0 delayed frames. Player controls composite over the video as before. |
| Cost with the UI hidden | 9.6% of a core, PSS 843 MB, APU 3.25 W, against 7.4% unpackaged. The extra is mostly the libmpv/PulseAudio threads (`core`, `threaded-ml`). |
| Input plumbing | The Steam floating keyboard call returns true through steamclient. The touch-mode keepalive holds `STEAM_TOUCH_CLICK_MODE=4`. gilrs sees the Steam Virtual Gamepad. `WM_CLASS` is `cef-spike`. Confirmed by the owner on the packaged build: it launches from Steam, the D-pad moves focus across Home, Search, a title page and Categories, and the focus ring shows (`:focus-visible` matched). The counters recorded 872 touch events and 228 gamepad events. **Pending** a hands-on check on this build: (1) whether finger swipes scroll natively, (2) the left stick (the counters do not separate it from the D-pad), (3) Steam's keyboard appearing over the search field (the call returns true from inside the sandbox), and (4) the D-pad after opening and closing the Steam menu. All four passed on the unpackaged build. |

## What the port has to carry from the spike

- **A render thread.** The first build rendered on CEF's UI thread, which is also the GLib loop. With synchronized swaps, `eglSwapBuffers` blocked it for about 14 ms per present.
- **No async present.** `vblank_mode=0` removed that wait, but once mpv started, Mesa's DRI3 swap waited forever for XWayland to hand a buffer back (`loader_dri3_swap_buffers_msc` → `xcb_wait_for_special_event`). A backtrace taken with SIGUSR2 shows it, since ptrace is off on the Deck. The visible symptom was that any IPC call needing the UI thread hung once playback started; the spike's stats call was the first to hang. That is a hang of the whole UI, not just of the stats call.
- **What the spike ended up with.** A render thread owns the window surface and the mpv render context. The UI thread only imports each DMA-BUF into one of three shared textures, with GPU fences in both directions.
- **mpv's render API through `libmpv2-sys`.** `libmpv2` 6.0's `render()` cannot pass `BLOCK_FOR_TARGET_TIME=0`. With the default, every render call waits for mpv's VO thread; with it off, the render thread never waits on mpv.
- **One render context per mpv core.** A second request fails. In the spike, that failure replaced the working context and the video went black.
- **A capability file.** Without `core:default`, every one of izumi's `listen()` calls is refused by the ACL, and the player never leaves its loading ring.
- **Input plumbing that offscreen mode leaves to the app:**
  - **D-pad as hat axes.** Steam's virtual gamepad reports the D-pad as hat axes, so read it as izumi's `gamepad_linux.rs` does (gilrs with default filters off, `AxisChanged(DPadX/DPadY)`). The spike's first reader only took D-pad buttons and saw no D-pad at all.
  - **Touch mode.** Write `STEAM_TOUCH_CLICK_MODE=4` on the XWayland root and keep re-writing it (izumi's `linux_x11.rs` keepalive, never mid-gesture). Forward the resulting touches with `send_touch_event`, not as mouse events.
  - **Touch sample delivery.** GTK 4 merges touch updates into one event per frame and keeps the rest as history, which winit-gtk4's `EventControllerLegacy` handler does not read. Chromium therefore gets at most one touch sample per frame from the window layer. The spike adds no smoothing of its own: samples go to `send_touch_event` unrounded.
  - **Page focus.** Keep CEF's page focus with `BrowserHost::set_focus`, on load and on window focus. An offscreen page that lost focus reports `document.hasFocus()` false, so `:focus-visible` never matches even with izumi's `focus({focusVisible:true})`, and no ring is drawn.
- **Set the windowless frame rate.** CEF's default is 30; the spike set it to the panel's 90. Page zoom works through `BrowserHost::set_zoom_level` (1.2^level), which is how `set_webview_zoom` maps.
- **Size.** `libcef.so` is 1.39 GB as downloaded and 260 MB stripped. The CEF runtime files total 375 MB, or about 330 MB without non-English locales. The spike binary, with the UI embedded, is 16 MB stripped.
- **Build.** `download-cef` 3.0.0 cannot read CEF's index any more: `index.json` is larger than ureq's 10 MB default body limit. The spike vendored it with a higher limit.
- **What the port deletes as well as the Linux player files.** The owner's direction is plain CSS transitions and animations and native scrolling, with no Game-mode forks. The WebKit motion workarounds go with them:
  - `src/lib/motion/gm-motion.ts`, the script-driven Game-mode motion (85 lines);
  - the `--izumi-focus` tween and `fadeOnLoad` in `src/lib/motion/tween.ts`;
  - the held-D-pad `chaseScroll` and the eased `scrollByExact` in `src/lib/nav/anchor.ts` and `src/lib/nav/index.ts`;
  - the native Game-mode HUD `src-tauri/src/player/gm_osd.rs` (2,053 lines on `feat/packs`);
  - the Game-mode row touch driver `gameModeCarouselTouch` in `src/lib/nav/actions.ts`, which sets `scrollLeft` from `pointermove`, cancels `touchmove` and runs its own rAF momentum;
  - the `overflow: hidden` pins that it needs in `src/app.css`: `.gamemode [data-carousel-scroller]` and the `(hover: hover) and (pointer: fine)` rule.

  - the scripted D-pad scrolling in `src/lib/nav/index.ts` and `src/lib/nav/anchor.ts`: `revealFocused`, `scrollByExact`, `revealAnchored`, `animateScroll` (rAF easing) and the held-repeat `chaseScroll` spring. Crunchy Deck reveals focus with one native call (`linux-crunchyroll` `src/lib/input/navigate.ts`): `scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })`, plus a smooth `scrollTo({ top: 0 })` of the nearest scroll container for banner controls, with `[data-focusable] { scroll-margin: 1.5rem }`. The spike's copy of the UI now does exactly that. `windowless_frame_rate` 90 stays: it is CEF's paint rate, not scroll code.

  The owner found finger swipes on rows visibly laggy with that driver in place. That is main-thread JavaScript standing in for Chromium's compositor scrolling and fling. With both switched off in the spike's copy of the UI (the izumi repo is unchanged), rows are `overflow-x: auto` with `touch-action: auto`, and Chromium scrolls and flings them itself.
- **Seen on the Deck, still open:**
  - `WM_CLASS` is empty (#16474).
  - The GPU process reports `sandboxed: false`.
  - `document.hasFocus()` stays false in offscreen mode, even while a field takes keystrokes.

## Not measured

- Battery draw: the Deck stayed on its charger. APU power stands in for it.
- Plasma on Wayland.
- `<select>` and other popup widgets, which the spike does not draw.
- Cold-start time.
- The CPU-paint fallback, which G2 never needed.

The G6 probes ran on the "This Season" row because a fresh profile has no Continue Watching row. The spike's Home had 1,833 elements, against 2,327 on the owner's Home in the WebKit build.

## Next

Phase 2 (Flatpak) can start, with the compositor design above as the template. The only gate that failed is the Home idle budget. Fixing it is izumi UI work, for example animating the Hero progress bar with a transform instead of repainting a gradient every frame, and stopping the shimmer on cards that are off screen. That is worth doing on WebKitGTK today too. It is not a reason to choose another shell.
