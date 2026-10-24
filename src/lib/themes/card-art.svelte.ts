import { untrack } from 'svelte'
import type { Media } from '$lib/anilist/types'
import { offscreenDistance } from '$lib/util/near-viewport'
import type { ThemeNode } from './presentation'
import { artNeeds, queueTitleArt, templateNeeds, titleExtrasKey, type TitleExtra, type TitleExtras } from './title-extras'

/** API 6: the key art, logo and HD poster a card's template binds, loaded once the card nears the
 *  screen through the shared lookup queue (nearest the screen first, nothing for a card that is gone).
 *  Call it while the card initialises, and put `gate` on the card's root as
 *  `use:nearViewport={card.wanted.size ? card.gate : undefined}`: a card whose template binds no
 *  artwork registers no gate and does no lookups. Spread `art` last into the card's display model. */
export function useCardArt(template: () => ThemeNode | undefined, media: () => Media, node: () => HTMLElement | undefined) {
  const wanted = $derived.by((): ReadonlySet<TitleExtra> => { const t = template(); return t ? artNeeds(templateNeeds(t)) : new Set() })
  let near = $state(false)
  const gate = { onEnter: () => { near = true }, observeParent: false }
  let art = $state<TitleExtras>({})
  // Keyed on the title, not the record object: a title delivered again as a new object (Continue
  // Watching repaints its snapshot, then reconciles) keeps the art on screen instead of reloading it.
  const key = $derived(wanted.size ? titleExtrasKey(media()) : '')
  let loadedKey = ''
  $effect(() => {
    const current = key
    const needs = wanted
    if (!near || !needs.size) return
    const target = untrack(media)
    if (loadedKey && current !== loadedKey) art = {}
    loadedKey = current
    let live = true
    void queueTitleArt(target, needs, { alive: () => live, distance: () => offscreenDistance(node()) }).then((extras) => { if (live) art = extras }, () => {})
    return () => { live = false }
  })
  return { get wanted() { return wanted }, gate, get art() { return art } }
}
