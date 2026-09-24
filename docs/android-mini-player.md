# Android in-app mini-player: motion model

Implementation notes for the portrait collapse/expand gesture in `AndroidPlayer.svelte`. The pure
maths lives in `src/lib/player/mini-player.ts` (tested in `mini-player.test.ts`); the component
only wires pointer events, the native surface and the docked layout to it.

## What was wrong before

- Progress was `dy / clamp(0.75 × playerHeight, 140, 280)`, so ~170px of finger moved the video
  ~630px diagonally into a corner and then pinned it there. The video was never under the finger.
- The gesture was recognised at 18px without re-basing, so the first frame jumped ~10%.
- Release ran a fixed 240ms `easeOutCubic` regardless of how the finger was moving.
- On commit the component navigated to Home *during* the animation: a second page swap, and a
  heavy page mount on the same thread that was driving the animation frames.
- The docked state was a floating 160px thumbnail with its own CSS geometry, which disagreed with
  the animation target by the native bottom inset, so the hand-over snapped. It had no gestures:
  tapping the video did nothing, and nothing but the title button expanded it.
- Nothing reserved space for it, and the bottom navigation kept auto-hiding underneath it.

## The model now

The video is a sheet the finger holds, as in YouTube:

- **Travel** is the distance the video's *centre* has to move from the resting portrait band to
  the dock (`miniPullTravel`). Progress is `(dy − slop) / travel`, so the centre follows the finger
  1:1 for the whole trip and starts from where the finger is.
- **Transform** (`miniPullTransform`) is a centre-pivot scale + translate, matching the native
  container's pivot. Both rects are 16:9, so one uniform scale keeps the video inside its frame.
- **The watch page** (`AndroidPreparingPlayer`) travels with the video's bottom edge
  (`miniDetailsShift`) and fades out over the first ~40% of the trip, revealing the route
  underneath *through* it. The route is whatever the viewer came from; there is no navigation.
- **Release** hands the lift-off velocity (zeroed if the finger rested first) to a near-critically
  damped spring (`stepSpring`, stiffness 320 / damping 34, ≤8ms sub-steps). A fling in either
  direction wins outright; a slow release commits past 35% (`miniPullOutcome`).
- **Docking** computes the dock rect once (`miniDockGeometry`, from `env(safe-area-inset-bottom)`
  exposed as `--safe-area-inset-bottom`) and, when the spring settles, inline-styles the frame with
  those same numbers before the one native layout write. The transform's last frame and the settled
  layout are the same pixels.
- **The docked bar** is full width, on the bottom navigation: `[video][title · episode][⏯][✕]` with
  a playhead hairline. Swipe up expands (the same sheet in reverse), swipe down dismisses, tap
  expands. `<main>` reserves the bar's height and `BottomNav` stops auto-hiding while it is up.
- **Expanding** first does one native `viewport` write that carries a starting transform
  (`ViewportArgs.scale/translateX/translateY`, new), so the surface returns to its full portrait
  layout while still *looking* docked, then the spring runs 1 → 0. Without that the surface flashed
  full-size for the frame between the layout write and the first gesture transform.
- The portrait chevron now minimizes (YouTube's rule); stopping is the bar's ✕.

## Native side

`mpv_viewport` accepts an optional starting transform (identity by default, so the old "settle
resets to identity" contract holds). `mpv_transform` is unchanged. Per-frame `time-pos` forwarding
to the WebView is throttled to ~4 Hz while the clock advances smoothly (any jump is forwarded at
once) and `demuxer-cache-time` to ~1 Hz; `MediaController` keeps its own unthrottled feed.

## Episode handover

Going from one episode to the next used to hide the whole player shell (`display:none`) the moment
the next episode started resolving. That never hid the native surface behind the transparent page:
the outgoing episode kept playing with no controls for the whole resolve, and the shell then popped
back over a black surface, because the resolve flow reports "playing" when `loadfile` is queued,
seconds before a frame exists.

- The shell now stays up for a handover (the connecting rail, or an automatic picker that draws
  only its rail) and hides only under a real choice screen, the debrid caching screen, comments
  and PiP. `AndroidPlayer` derives `handover` from that and covers the video rectangle with an
  opaque veil (artwork, gradient, spinner); the rails keep the words and the cancel button.
- The outgoing file is paused at once; a cancelled resolve resumes it. The settings sheet, the
  subtitle editor and a GIF recording are closed, since they describe the file going away.
- The veil holds until the replacement's first frame (`firstFrameSeen` after the load id changed),
  with a 20s cap, and the controls are shown when it lifts.
- Next pressed while paused stays paused: `mpvLoad` seeds both optimistic resets from the load's
  autoplay intent, since a core that is already paused emits no pause change for the new file.
- In-place advances (next, previous, auto-advance, and the watch page's own Previous/Next and
  episode rows while the title is playing) pass `keepMini`, so a docked mini-player stays docked
  and changes episode under the bar. A play from browse still opens the full page.
- A hidden binge picker no longer auto-commits the top row while the remembered release may still
  arrive (`continuationOpen`); it waits for that row or for every source to settle.
- The core sets `keep-open`, so a file that ends holds its last frame instead of going black.
