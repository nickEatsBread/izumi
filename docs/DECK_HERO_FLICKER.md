# Steam Deck featured-banner flicker

Notes on the random blink when stepping through the Home featured banner in Game mode (L1/R1,
auto-advance or a touch swipe), and why the banner animates again. The fix lives in `Hero.svelte`
and `hero-slides.ts`. The diagnosis below comes from the WebKitGTK 2.52 sources and release notes;
hardware confirmation on a Deck is still the authority for this class of bug, so the last section
lists what to look at.

## When it started

The slide, title and progress-bar animations were unchanged from late August on. The blink arrived
with v0.1.61, when the Flatpak moved to the GNOME 50 runtime and so from WebKitGTK 2.50 to 2.52.

## What was happening

Two independent things fired on a slide change, and each could paint a wrong frame.

1. **Undecoded artwork.** The slide is keyed on the media id, so a step tore down the old `<img>`
   and mounted a new one. Until that image reported `load`, the slide showed the muted skeleton,
   then popped to the image, and the late image faded in on its own opacity transition. Whether
   that happened depended on what WebKit's memory cache still held, so it looked random.

2. **Layers dropped under 2.52's composition scheduling.** A transform or opacity tween lifts its
   element onto a compositor layer for the tween only. When the tween ends WebKit drops the layer
   and repaints its pixels into the page's tiles. 2.52 "improved composition scheduling to avoid
   blocking waiting for tile painting", so a frame can be composited after the layer is gone but
   before that repaint lands: the banner, its title or the bar is missing for a frame. Whether the
   repaint wins depends on timing, so the blink was random. The overlap rules made it worse. The
   scrims, copy, rank badge and slide markers sit over the artwork, so they were composited only
   while the artwork layer existed and were handed back with it.

   Ending the keyframes on `translate3d(0, 0, 0)` did not keep the layer. WebKit blends transform
   functions with their shared primitive type, and `translate3d` with `z = 0` has a 2D primitive,
   so the filled end value is a plain 2D translate that no longer requires compositing
   (`TranslateTransformFunction::blend`, `Blending<TransformList>::blend`).

Not the cause: the `OnDemand` hardware-acceleration policy. On GTK, entering accelerated compositing
sets `forceCompositingMode`, so the page never leaves it once the first layer appears
(`DrawingAreaCoordinatedGraphics::enterAcceleratedCompositingMode`). The page is not switching modes.

## The first fix (v0.1.69) and its cost

v0.1.69 added the decode-before-commit scheduler and removed every hero tween in Game mode. It also
filled the rotation bar in 24 width steps and let browse images appear without a fade. The blink
stopped, but the banner lost its slide motion on L1/R1 and auto-advance, and the bar visibly
ticked across.

## What changed now

- **Decode before commit (kept).** `createSlideScheduler` decodes a slide's artwork off-DOM with
  `Image.decode()` and commits the index only once its pixels are ready, with a 900 ms deadline so a
  slow network still steps. Ready artwork settles `loadedArtworkId` before the swap, so the first
  paint of a new slide is the image. Decoded images are pinned so the cache keeps them, rapid presses
  chain from the pending slide, and the neighbouring slides are warmed 400 ms after each settle.
- **Home slides animate again, on element-lifetime layers.** The Home slide
  (`.hero-carousel-slide`), its copy and the rotation bar keep their tweens in Game mode, each on a
  layer that lives exactly as long as its element. A static `transform: translateZ(0)` is 3D by
  function type, so WebKit composites the element from creation until removal. The keyframes
  animate `translate`, `scale` and `opacity` and never `transform`, which would override the anchor.
  A layer created with its element and destroyed with it never hands pixels back to the page, so
  there is no repaint to race. The incoming slide starts at opacity 0, so even a late first raster
  is invisible.
- **The rotation bar fills continuously again.** It is the compositor animation from before
  v0.1.69, so the compositor produces frames while the bar runs, as it did through v0.1.68. 2.52
  skips composition for animated layers that are not visible, so scrolling the banner away stops
  that work.
- **Still static in Game mode:**
  - a detail banner's entrance (a single slide, with nothing to animate between);
  - artwork that arrives after the decode deadline;
  - the dim when Home scrolls;
  - browse image fades (`html.gamemode main img`).

  Each of these would hand its layer back when it ends. A card grid cannot afford a permanent layer
  per cover.

## What to check on a Deck

- Step through the banner with L1/R1, quickly and slowly, in both directions, then let it
  auto-advance. The new slide should slide and fade in from the side you moved towards, with no
  blink at the start or end of the motion and no grey skeleton frame.
- The active marker's bar should fill smoothly for the whole interval.
- Scroll Home down and back: the banner dims without a blink.
- Open a series: its banner appears in place.
- Desktop and phone keep their original animations; only `html.gamemode` changes.

Re-check the banner on the Deck after any runtime bump. Composition scheduling is exactly what
changed between 2.50 and 2.52, and it can change again.
