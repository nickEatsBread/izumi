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

## Shared limitations

Theme API 1 is data-only. Packages cannot ship arbitrary CSS, HTML, JavaScript, remote wallpapers, extra fonts, or hover/focus/loading template variants. Player skip rules, subtitle files, home-row order and navigation destinations stay with the user.

A right-hand episode rail becomes a list under the series info on narrow windows. Episode templates cannot nest play buttons; the host card owns playback. Poster titles still hide only through `hideCardLabels`, not per-row CSS.

Community snippet catalogues for other apps are mostly “hide this banner” or “replace this logo”. Izumi can hide the home hero and series banner. It cannot retarget a third-party selector, swap the wordmark, or run a plugin.
