# Steam Deck (WebKitGTK) fixes, 2026-10-25

The owner reported four problems with the desktop client on the Steam Deck in Game mode: D-pad moves
skip two items, Search is mis-scaled, everything flashes twice, and it behaves unlike Chromium. The
owner's Deck runs izumi 0.1.74 in Game mode with the Marquee theme. This note covers what was measured
on the Deck, what changed, and what is still open.

## Method

- Devel flatpak (Rust from 2026-10-08, devtools on, loads `http://localhost:1437`) on the Deck. The
  frontend comes from this worktree's vite on 3437 through `ssh -R 1437:127.0.0.1:3437`. Inspector:
  `ssh -L 9339` with `tmp/deck/wk.mjs`.
- The owner's theme state (`installed-themes-v1`, `theme-studio-themes-v1`, `theme-studio-active-v1`,
  `theme-preset`) was copied into the devel origin, with no credentials, so Marquee renders as it does
  for them.
- D-pad presses were injected through the real Tauri bus (`plugin:event|emit` `gamepad-input`). Screen
  recordings: x11grab at 60 fps (`tmp/deck/rec2.sh`). Flash frames found with `tmp/deck/flash.py`,
  per-frame state with `navtrace.js` and `scrolltrace.js`.
- Scratch scripts live in the gitignored `tmp/deck/`.

## Findings and fixes

### Flash twice on every route change (all themes)

`app.css` sets `scroll-behavior: smooth` on `html`. SvelteKit's `scrollTo(0, 0)` during navigation
therefore animated from the old page's offset. The trace showed the new page painted at y=588, then
540, then `restoreScroll` (two rAFs later) jumped to its stored position: two visible jumps.
Fix: `instantScrollUntil(navigation.complete)` in the app layout's `beforeNavigate`. Window scrolls
stay instant until the navigation settles, except for `#block` links, which keep SvelteKit's smooth
reveal. `restoreScroll` also restores in the same frame when the page is already long enough.
After the fix the first frame of the new page is already at its final position (trace: one frame,
y=0). Recordings of Home, Library and Schedule navigations show one change each.

### Blink at the end of CSS animations (host and themes)

On WebKitGTK 2.52, an element's compositor layer is dropped when its CSS animation ends, and a frame
can be presented before the page tiles repaint it (see `DECK_HERO_FLICKER.md`). Measured:
- Marquee's `mq-caption` (the caption under the focused card) blinked out for one frame about 210 ms
  after every left or right move, 3 of 3 moves.
- `.schedule-panel-in` and `.schedule-day-in` produced two separate blinks after the Schedule
  page's entrance.

Fix: `src/lib/motion/gm-css-motion.ts`. In Game mode, each CSS animation of `opacity` or
`transform` is taken over at `animationstart`: the CSSAnimation is cancelled and the same keyframes,
easing, delay and duration are replayed as per-frame inline styles. Nothing changes compositing
layers, so the motion is kept. While a replay runs, any transition the element declares for the
replayed property is held off, otherwise each frame's inline write would start a new transition.
After the fix: 0 flash frames in the caption, tile and full-frame regions over repeated runs. The
Schedule entrance is one fade with no blink.

The following stay CSS:
- infinite or repeating animations;
- `steps()` and `linear()` easings;
- rotation and skew;
- any other animated property;
- an element whose inline style a component already drives;
- a forwards fill that ends away from the element's own value.

CSS transitions also stay CSS: the focus-cover pop and the Marquee card width transitions were
measured without a blink, and replaying them would mean masking the stylesheet while focus moves.

### Focused tile blank for two frames (Marquee)

The tile's wide art loads while hidden (`opacity: 0` until focus). WebKit decodes an image only when
it first paints, and paints it blank until the decode finishes, so the newly focused tile showed
`#1f1f1f` for two frames.
Fix: in Game mode, `img.decode()` runs on every image that is hidden when it loads (layout effect).

### Search mis-scaled (TV surface, any theme with a grid keyboard)

Game mode is a TV surface (Theme API 6). Marquee's TV block sizes the grid keyboard as
`width: calc(var(--u) * 393)` with `--u: calc(100vw / 1920)`. At the Deck's 1024 CSS px that is
210 px, but `GridKeyboard.svelte` had fixed `repeat(6, 3.25rem)` columns (332 px), so the keys spilled
over the search field and the results.
Fix: the keyboard is `w-[20.75rem] grid-cols-6` (the same default size) and each key is
`h-[3.25rem]`, so a theme's width and key height are shared out instead of overflowing.
The Season, Year and Sort selects stay 44 px tall: that is the owner's Game-mode touch-target floor
(`data-touch-target`, decision 12).

### Held D-pad and triggers never repeated (all platforms)

`ActiveFrameLoop` stored `requestAnimationFrame` as a default parameter and called it as
`this.schedule(cb)`. WebKit threw "Can only call Window.requestAnimationFrame on instances of Window"
(Chromium threw "Illegal invocation"). Every held direction and trigger moved once and stopped.
The throw also aborted Tauri's listener loop for that press: a listener registered after nav's own
received the release but never the press. Fix: the defaults call the globals.

### Owner follow-up, same day

- **Left at a row's first card "went nowhere" (Marquee).** The d-pad fell back to a page-wide
  geometric search, which picked a card of another row that the anchored slide had moved off screen.
  The owner's own presses showed focus moving to such a card. Now a move past a row's end only
  crosses into a region beside the row (the side rail). A region crossed sideways must sit level with
  the focused card, so under a top bar Left stays on the card. Right from the hero's last button no
  longer drops into the row below.
- **Big gaps between rows (Marquee).** Template px were screen px while the stylesheet works on a
  1920-wide canvas (`--u`). The row caption's `minHeight: 120` reserved 120 CSS px on every row instead
  of 120 canvas px (64 px). On a TV surface, template lengths are now multiples of `--u`. Per-row
  pitch went from 494 to 438 CSS px; the empty band under a focused row's synopsis went from about
  160 to about 65 device px.
- **Physical D-pad presses.** `inputlog.py` recorded about 60 real presses. Each one was one hidraw
  change, one Steam virtual pad hat change, one Rust edge, one keydown and one focus move. There
  were no lizard-mode keys and press lengths were 90–200 ms. In this build the D-pad does not
  double-step.
- **"Pixelated" fonts.** Not found in gamescope captures:
  - Text renders with GNOME's slight hinting and grayscale AA (inside the sandbox: hinting slight,
    antialiasing grayscale, `10-sub-pixel-none.conf`).
  - De-promoting the composited page layer gave byte-identical text.
  - `text-rendering: geometricPrecision` gave byte-identical text.
  - Marquee's TV sizes are small on the Deck: the synopsis is 24u = 12.8 CSS px = 16 device px.
- **Compositing cost, not changed.** The fixed `-z-30` app background and `-z-20` theme backdrop
  make `<html>` composite (`negativeZIndexChildren`), and `main` composites above them (`overlap`).
  On Home that is two full-document layers of about 50 MB and 30 MB.

## D-pad moving two stops: still open

Injected presses (the same `gamepad-input` path the Rust reader uses) move exactly one stop on the
default theme and on Marquee: one keydown and one focus change per press, every time. The Rust
reader sees one pad, Steam's virtual X-Box 360 pad `event10`:
- hat axes only, no `BTN_DPAD_*`;
- gilrs default filters off;
- d-pad and stick merged in `Dirs`, so a duplicate edge from the same press collapses.

The lizard-mode keyboard (`event4`) exists. It would add trusted arrow keydowns if Steam left lizard
mode on.

What was not possible was a physical press. Ruled out so far:
- uinput injection: Steam grabs the uinput pad and its mirror delivered nothing;
- `/dev/uhid`: root only.

`tmp/deck/inputlog.py` runs on the Deck as the user unit `izinputlog` and writes `/tmp/izinput.log`
with timestamps. It records physical d-pad bits from hidraw, the Steam virtual pad's hat, and the
lizard keyboard's keys. With `IZUMI_GAMEPAD_LOG=1`, the embed log lists every Rust edge. A few real
presses decide between three causes:
- Steam doubling the edges;
- lizard-mode arrow keys arriving alongside the pad;
- press durations.

## Other WebKitGTK vs Chromium differences seen

- No CSS scroll anchoring by default. WebKitGTK 2.52 has the `CSSScrollAnchoringEnabled` feature;
  enabling it (Rust, `webkit_settings_set_feature_enabled`) would match Chromium when content above
  the viewport changes height. Needs a Rust build to verify.
- Rows scrolled back into view sometimes paint their art one or two frames late (decode on repaint).
  Not fixed.
- Programmatic smooth scrolls run at about 25–30 fps on the main thread while a row's art is
  decoding.

## Deck state left by this session

The devel build is current, with the flatpak override
`WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9339` and `IZUMI_GAMEPAD_LOG=1`. The user unit `izinputlog` is
running. To restore, run on the Deck:

```
flatpak kill com.nicho.izumi; flatpak make-current --user com.nicho.izumi stable
flatpak uninstall --user -y --noninteractive com.nicho.izumi//devel
flatpak override --user --reset com.nicho.izumi
systemctl --user stop izinputlog; rm -f /tmp/izinput.log ~/izumi-test/izumi-devel.flatpak
rm -f ~/.var/app/com.nicho.izumi/data/com.nicho.izumi/localstorage/http_localhost_1437.localstorage*
```
