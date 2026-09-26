/** The documented styling hooks theme stylesheets may target (docs/THEMES.md "Styling hooks").
 *  A `slot` is a page region (`data-slot`), a `part` a component (`data-part`). Renaming or
 *  removing one breaks published themes; hooks.test.ts keeps this list and the markup in step.
 *  In markup, write hook names as string literals — `data-part="card"` or
 *  `data-slot={top ? 'nav.top' : 'nav.side'}` — and never put any other quoted string inside a
 *  `data-slot`/`data-part` expression: the test reads every quoted literal there as a hook name. */
export interface ThemeHook {
  name: string
  kind: 'slot' | 'part'
  description: string
  /** State attributes rendered alongside, e.g. `data-active`. */
  states?: string[]
}
export type ThemeHookGroup = 'brand' | 'shell' | 'home' | 'cards' | 'detail' | 'episodes' | 'watch' | 'pages' | 'primitives'

export const THEME_HOOKS: Partial<Record<ThemeHookGroup, ThemeHook[]>> = {
  brand: [
    { name: 'brand', kind: 'slot', description: "The izumi wordmark: the rail's home link, the catalog switcher's brand trigger, and the onboarding and profile wordmark." },
    { name: 'brand.mark', kind: 'part', description: 'The logo mark.' },
    { name: 'brand.text', kind: 'part', description: 'The text wordmark (presentation.brand "text", and the expanded side rail).' },
    { name: 'brand.char', kind: 'part', description: 'One letter of "izumi"; style runs of letters with :nth-child().' },
  ],
}
