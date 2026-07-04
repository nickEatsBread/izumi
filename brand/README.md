# Izumi — brand assets

**Izumi** (泉, "spring / source") — a home for anime clients that stream from many sources.
The mark is a single drop curling into a whirlpool: one source, many streams.

## Palette

| Token | Hex | Use |
|---|---|---|
| Aqua | `#5CEAD8` | gradient start |
| Sky | `#1FA6F0` | gradient mid |
| Indigo | `#4E63F5` | gradient end |
| Ink | `#14233F` | wordmark / mono on light |
| Night | `#0E1524` | app background, dark surfaces |
| Paper | `#F4F8FF` | wordmark / mono on dark |

Brand gradient: `linear-gradient(135deg, #5CEAD8 0%, #1FA6F0 55%, #4E63F5 100%)`

## Typeface

Wordmark is **Poppins SemiBold (600)**, converted to outlines — the SVGs need no fonts installed.
For UI/body text, Poppins pairs cleanly.

## Files

`svg/` — vector masters (scalable, self-contained)
- `izumi-lockup-color-dark.svg` / `-light.svg` — horizontal logo for dark / light backgrounds
- `izumi-lockup-mono-white.svg` / `-ink.svg` — single-colour horizontal logo
- `izumi-stacked-color-dark.svg` / `-light.svg` — mark-over-wordmark
- `izumi-mark-color.svg`, `-mono-ink.svg`, `-mono-white.svg` — symbol only
- `izumi-wordmark-ink.svg`, `-white.svg` — wordmark only
- `izumi-app-icon.svg` (night tile + gradient mark), `izumi-app-icon-alt.svg` (gradient tile + white mark)

`png/` — raster exports (transparent unless noted): marks (256/512/1024), app icons (180/256/512/1024), lockups (1600w), social OG (1200×630).

`favicon/` — `favicon.ico` (16/32/48) plus PNGs.

## Usage

- **Clearspace:** keep padding around the logo at least equal to the height of the wordmark's "i" dot.
- **Minimum size:** mark ≥ 16px; horizontal lockup ≥ 90px wide.
- **Do** use the mark alone as app icon, avatar, and loading state.
- **Don't** recolour the gradient, stretch, rotate, add shadows, or place the color lockup on a busy photo — use a mono version instead.
