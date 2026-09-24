# Steam Deck featured-banner flicker

Diagnosis and fix notes for the random blink when stepping through the Home featured banner in
Game mode (L1/R1, auto-advance, or a touch swipe). Code audit against v0.1.68; the fix lands in
`Hero.svelte`, `hero-slides.ts` and `app.css`. Hardware confirmation on a Deck is still the
authority for this class of bug, so the section at the end lists what to look at.

## What was happening

Two independent things fired on every slide change, and each one could paint a wrong frame.

1. **Undecoded artwork.** The slide is keyed on the media id, so a step tore down the old `<img>`
   and mounted a new one. Until that image reported `load`, the slide showed the muted skeleton,
   then popped to the image. Whether that pop was visible depended on what WebKit's memory cache
   still held: a banner that was hot painted in the same frame, one that had been evicted spent a
   few frames as a grey block first. On the Deck (a zoomed 1280×800 page, iGPU decode, no
   compositor promotion) it was several frames, and the cache is small, so the pop looked random.

2. **Entrance tweens on promoted layers.** `hero-slide-in` (translate + scale + opacity) and
   `hero-copy-in` promoted the artwork and the copy block to compositor layers for 480/360 ms.
   Game mode zooms the page natively, and as `app.css` already records for `will-change`,
   promoted layers there rasterise at 1x contents scale with grayscale anti-aliasing and snap
   crisp the moment the layer is dropped. The title and synopsis therefore rendered soft for
   a third of a second and then blinked sharp on every step. The same mechanism made each
   cover's 150 ms fade-in pop as rows loaded, and the `scrolled` opacity transition on the
   hero root promoted the whole banner on every scroll edge.

## What changed

- **Decode before commit.** `createSlideScheduler` (`hero-slides.ts`) decodes a slide's artwork
  off-DOM with `Image.decode()` and commits the index only once its pixels are ready, with a
  900 ms deadline so a slow network still steps (with the skeleton, as before). Ready artwork
  settles `loadedArtworkId` before the swap, so the first paint of a new slide is the image.
  Decoded images are pinned in a small map so the cache keeps the bitmap the `<img>` reuses.
  Rapid presses chain from the pending slide. Neighbouring slides are warmed 400 ms after each
  settle, so the next L1/R1 is instant.
- **No entrance tweens in Game mode.** `html.gamemode` drops `hero-slide-in`, `hero-copy-in`,
  `detail-hero-reveal`, the artwork opacity transition and the hero root's scroll fade. The
  resting opacity is declared statically so the artwork still rests at 0.7. This matches the
  existing "calm and instant" rule for row entrances (`.gamemode .load-in`).
- **Rotation progress bar.** The 15 s `scaleX` tween kept an accelerated animation running for
  the whole interval, which keeps WebKit compositing a full frame at the panel rate while Home
  sits idle. Game mode now fills the bar in 24 width steps: one small main-thread repaint every
  ~0.6 s, and every frame in between is free.
- **Browse images appear in place.** `html.gamemode main img { transition: none; animation:
  none }` removes the per-card fade-in and the shared banner fade, which were the same
  soft-then-snap pop at card scale.

## What to check on a Deck

- Step through the banner with L1/R1 quickly and slowly: the artwork and title should swap in
  one frame with no grey block and no soft-to-sharp blink. Auto-advance should behave the same.
- Scroll Home down and back: the banner dims without a blink.
- Idle on Home with `mangohud`/`gamescope --stats`: GPU activity while nothing moves should be
  near zero between the progress bar's steps.
- Desktop and phone keep their entrance animations; only `html.gamemode` changes.

WebKitGTK 2.54 deprecates the `ON_DEMAND` hardware-acceleration policy (it now behaves like
`ALWAYS`). The Flatpak still requests `ON_DEMAND` on the GNOME 50 runtime; when the runtime
moves to 2.54 the request is a no-op, and the changes above do not depend on it either way.
