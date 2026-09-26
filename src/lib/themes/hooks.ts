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
export type ThemeHookGroup = 'brand' | 'shell' | 'home' | 'blocks' | 'cards' | 'detail' | 'episodes' | 'watch' | 'pages' | 'primitives'

export const THEME_HOOKS: Partial<Record<ThemeHookGroup, ThemeHook[]>> = {
  brand: [
    { name: 'brand', kind: 'slot', description: "The izumi wordmark: the rail's home link, the catalog switcher's brand trigger, and the onboarding and profile wordmark." },
    { name: 'brand.mark', kind: 'part', description: 'The logo mark.' },
    { name: 'brand.text', kind: 'part', description: 'The text wordmark (presentation.brand "text", and the expanded side rail).' },
    { name: 'brand.char', kind: 'part', description: 'One letter of "izumi"; style runs of letters with :nth-child().' },
  ],
  shell: [
    { name: 'page', kind: 'slot', description: 'The routed page content (the app <main>).' },
    { name: 'nav.side', kind: 'slot', description: 'The side navigation rail.' },
    { name: 'nav.top', kind: 'slot', description: 'The top navigation bar (shell.nav "top").' },
    { name: 'nav.bottom', kind: 'slot', description: 'The bottom tab bar (phones, or shell.nav "bottom").' },
    { name: 'nav.item', kind: 'part', description: 'A navigation destination link.', states: ['data-active'] },
    { name: 'nav.item.icon', kind: 'part', description: 'The icon of a navigation destination.' },
    { name: 'nav.item.label', kind: 'part', description: 'The label of a navigation destination.' },
    { name: 'search.field', kind: 'part', description: 'The global search input.' },
  ],
  home: [
    { name: 'home', kind: 'slot', description: 'The Home page.', states: ['data-variant'] },
    { name: 'home.hero', kind: 'slot', description: 'The featured banner on Home.', states: ['data-variant'] },
    { name: 'hero.slide', kind: 'part', description: 'The current slide (the artwork layer).' },
    { name: 'hero.art', kind: 'part', description: 'The slide artwork image.' },
    { name: 'hero.scrim', kind: 'part', description: 'A gradient over the artwork.' },
    { name: 'hero.logo', kind: 'part', description: 'The title logo, when the show has one.' },
    { name: 'hero.title', kind: 'part', description: 'The text title, when there is no logo.' },
    { name: 'hero.meta', kind: 'part', description: 'The facts line (format, episodes, score, status).' },
    { name: 'hero.synopsis', kind: 'part', description: 'The description (desktop).' },
    { name: 'hero.actions', kind: 'part', description: 'The Watch, Details and Favorite buttons.' },
    { name: 'hero.indicator', kind: 'part', description: 'The slide marker row.', states: ['data-variant'] },
    { name: 'hero.dot', kind: 'part', description: 'One slide marker.', states: ['data-active'] },
    { name: 'hero.counter', kind: 'part', description: 'The "n / N" counter (indicator style "counter").' },
    { name: 'row', kind: 'slot', description: 'A titled row or grid of cards, on Home and elsewhere. Home rows carry their stable id and role.', states: ['data-row', 'data-role', 'data-layout'] },
    { name: 'row.header', kind: 'part', description: 'The row heading bar.' },
    { name: 'row.title', kind: 'part', description: 'The row title.' },
    { name: 'row.more', kind: 'part', description: "The row's view-more link." },
    { name: 'row.track', kind: 'part', description: 'The scrolling track or grid holding the cards.' },
  ],
  blocks: [
    { name: 'home.main', kind: 'slot', description: 'The main column of Home.' },
    { name: 'home.aside', kind: 'slot', description: 'The side column of Home, holding blocks placed in the aside.' },
    { name: 'pagination', kind: 'part', description: 'Page controls under a block: numbered pages or a Load more button.' },
    { name: 'page-number', kind: 'part', description: 'One numbered page button.', states: ['data-active'] },
    { name: 'block.title', kind: 'part', description: 'A block heading.' },
    { name: 'block.genre-chips', kind: 'slot', description: 'Genre shortcuts: an All chip and one chip per genre (each a `chip`).' },
    { name: 'block.latest-episodes', kind: 'slot', description: 'Newly aired episodes as a grid of stills. Items reuse `episode.still`, `episode.number`, `card.title` and `card.meta`.' },
    { name: 'block.item', kind: 'part', description: 'One entry in a block (an episode, a poster or a ranked title).' },
    { name: 'block.tabbed-grid', kind: 'slot', description: 'A tab strip (`tabs`) over a poster grid; each poster is a `block.item` holding a `card`.' },
    { name: 'block.ranked-list', kind: 'slot', description: 'A numbered top list; each entry is a `block.item` with `card.art`, `card.title` and `card.meta`.' },
    { name: 'block.rank', kind: 'part', description: 'The rank number of a ranked-list entry.' },
  ],
  cards: [
    { name: 'card', kind: 'part', description: 'A media card: poster, search, continue or preview.', states: ['data-family'] },
    { name: 'card.art', kind: 'part', description: 'The card artwork frame.' },
    { name: 'card.title', kind: 'part', description: 'The card title.' },
    { name: 'card.meta', kind: 'part', description: 'The line under the title (season, format, source, episode).' },
    { name: 'card.badge', kind: 'part', description: 'The label on the artwork (for example "Episode 5").' },
    { name: 'card.score', kind: 'part', description: 'The score badge.' },
    { name: 'card.progress', kind: 'part', description: 'The watch-progress track; the fill is its child.' },
    { name: 'card.episode', kind: 'part', description: 'The episode number on resume cards.' },
    { name: 'card.overlay', kind: 'part', description: 'The hover or play overlay on the artwork.' },
  ],
  detail: [
    { name: 'detail', kind: 'slot', description: 'The series page.', states: ['data-layout', 'data-variant'] },
    { name: 'detail.banner', kind: 'slot', description: 'The artwork area at the top of the series page.' },
    { name: 'detail.poster', kind: 'part', description: 'The cover image.' },
    { name: 'detail.title', kind: 'part', description: 'The title.' },
    { name: 'detail.alt-title', kind: 'part', description: 'The native or romaji title.' },
    { name: 'detail.meta', kind: 'part', description: 'The facts line.' },
    { name: 'detail.facts', kind: 'part', description: 'The theme facts template (desktop stack and split).' },
    { name: 'fact', kind: 'part', description: 'One entry of the details grid.' },
    { name: 'fact.label', kind: 'part', description: 'A details entry label.' },
    { name: 'fact.value', kind: 'part', description: 'A details entry value.' },
    { name: 'detail.genres', kind: 'part', description: 'The genre chips (phone).' },
    { name: 'detail.synopsis', kind: 'part', description: 'The description.' },
    { name: 'detail.actions', kind: 'part', description: 'The action buttons row.' },
    { name: 'detail.list-button', kind: 'part', description: 'The tracker list-status button.' },
    { name: 'detail.countdown', kind: 'part', description: 'The next-episode airing status.' },
    { name: 'detail.episodes', kind: 'slot', description: 'The episode list.' },
    { name: 'detail.relations', kind: 'slot', description: 'Related titles.' },
    { name: 'detail.characters', kind: 'slot', description: 'Characters and voice actors.' },
  ],
  episodes: [
    { name: 'episode', kind: 'part', description: 'One episode: a card, a thumbnail row, a compact row or a number tile.', states: ['data-variant'] },
    { name: 'episode.still', kind: 'part', description: 'The episode thumbnail.' },
    { name: 'episode.number', kind: 'part', description: 'The episode number.' },
    { name: 'episode.title', kind: 'part', description: 'The episode title.' },
  ],
  watch: [
    { name: 'watch', kind: 'slot', description: 'The player area.', states: ['data-layout'] },
    { name: 'watch.stage', kind: 'slot', description: 'The video frame. It and its ancestors never paint a background: the video is drawn behind the page.' },
    { name: 'watch.rail', kind: 'slot', description: 'The rail beside or below a docked player.' },
    { name: 'watch.episodes', kind: 'slot', description: 'The docked episode list or grid.', states: ['data-variant'] },
    { name: 'watch.servers', kind: 'part', description: 'The server switcher.' },
    { name: 'watch.comments', kind: 'slot', description: 'The episode discussion (inline under a docked player, or the sheet).', states: ['data-variant'] },
    { name: 'player.controls', kind: 'slot', description: 'The player controls layer.' },
    { name: 'player.seekbar', kind: 'part', description: 'The seek bar.' },
    { name: 'player.title', kind: 'part', description: 'The playing title.' },
  ],
  pages: [
    { name: 'search', kind: 'slot', description: 'The search page.', states: ['data-variant'] },
    { name: 'search.filters', kind: 'part', description: 'The search filter bar.' },
    { name: 'search.results', kind: 'slot', description: 'The search results.' },
    { name: 'schedule', kind: 'slot', description: 'The airing schedule page.' },
    { name: 'schedule.day', kind: 'part', description: 'One day of airings: a day of the week agenda, or the selected day.' },
    { name: 'schedule.item', kind: 'part', description: 'One airing entry.' },
    { name: 'library', kind: 'slot', description: 'The library page.' },
    { name: 'library.tabs', kind: 'part', description: 'The library section tabs.' },
    { name: 'library.grid', kind: 'slot', description: 'The library card grid.' },
  ],
  primitives: [
    { name: 'button', kind: 'part', description: 'A button.', states: ['data-variant'] },
    { name: 'chip', kind: 'part', description: 'A chip or pill (genre, filter, scope).', states: ['data-active'] },
    { name: 'input', kind: 'part', description: 'A text input.' },
    { name: 'badge', kind: 'part', description: 'A small label on an item (for example an episode rating).' },
    { name: 'tabs', kind: 'part', description: 'A tab strip.', states: ['data-variant'] },
    { name: 'tab', kind: 'part', description: 'One tab.', states: ['data-active'] },
  ],
}
