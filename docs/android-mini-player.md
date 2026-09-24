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
