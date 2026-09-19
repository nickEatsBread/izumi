# Example theme packages

Installable Theme API 1 JSON for Settings → Themes → Import file (or Add from link once published). Each package is a complete appearance: tokens, chrome and optional templates.

These are original izumi designs. They chase looks that show up often in living-room clients, compact library managers and community CSS snippets (hidden heroes, true-black canvases, landscape resume cards, split series pages). They are not ports of another client's format.

## Packages

| Package | Intent |
| --- | --- |
| [Tidal](izumi.tidal.json) | Near-black ocean canvas, blue accent, landscape resume cards, split series page with a right-hand episode rail. |
| [Ember](izumi.ember.json) | Warm crimson canvas and tinted cards, red accent, landscape resume art, same split episode rail. |
| [Kindling](izumi.kindling.json) | Compact true-black library, razor red accent, hidden hero, wrapping poster grid, dense side rail. |
| [Ledger](izumi.ledger.json) | Teal media-server library, hidden home hero and series banner, wrapping poster grid. Continue Watching stays a landscape carousel. |
| [Halo](izumi.halo.json) | Frosted aurora glass, top navigation bar, large landscape tiles, split series page. |
| [Orchid](izumi.orchid.json) | Violet living-room canvas, mesh backdrop, titles over posters, split episode rail. |

## How to install

Settings → Themes → Import file, then choose one of the JSON files in this folder. Preview before installing.

## What translated well

- Palettes (near-black, true black, warm crimson, teal, violet, icy glass).
- Hiding the home hero and series banner (the usual “hide the banner” snippet).
- Landscape resume cards vs portrait posters.
- Compact wrapping grids vs spacious carousels.
- Split series pages with a right-hand episode rail.
- Top vs side vs bottom chrome (phones keep the bottom bar).
- Seekbar colour and thickness.

## What did not

- **Arbitrary CSS / selectors.** Snippet catalogues that hide one DOM node, replace a logo, or restyle a hover tray have no equivalent. Izumi only hides surfaces that have slots (`hero.hidden`, `detail.bannerHidden`, `hideCardLabels`).
- **Plugins and effects.** Snow overlays, custom CSS managers and executable UI plugins stay out of the format.
- **Gradients as the accent.** A package has one `theme` token, not a three-stop custom gradient.
- **Native liquid glass.** `glassBlur` plus an aurora/mesh backdrop is the closest chrome; it is not a platform tab bar.
- **Extra fonts and wallpapers.** Four font stacks, no remote image packs.
- **Hover, focus and loading trees.** Templates are one tree. The host still owns focus rings and motion preferences.
- **User-owned layout.** Home row order, nav destinations, episode cards/compact/grid, skip rules and subtitle files are not overwritten.

Cinema, Ink and Meridian remain the catalog examples for rank treatment, hidden-hero grids and editorial light layouts.
