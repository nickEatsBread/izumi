import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('app-level trailer dialog', () => {
  it('is app-owned, lazily mounted after first use, and reused by series-page trailer actions', () => {
    const layout = read('../../../routes/app/+layout.svelte')
    expect(layout).toContain("const loadTrailerDialog = () => import('$lib/components/cards/TrailerDialog.svelte')")
    expect(layout).toContain('{#if trailerDialogMounted}<Lazy load={loadTrailerDialog} />{/if}')
    expect(read('../detail/AnimeDetail.svelte')).toContain('openTrailerPopup(m.trailer!.id!, title(m))')
  })

  it('supports backdrop, close-button, and Escape dismissal', () => {
    const dialog = read('./TrailerDialog.svelte')
    expect(dialog).toContain("e.key === 'Escape'")
    expect(dialog).toContain('if (e.target === e.currentTarget) closeTrailerPopup()')
    expect(dialog).toContain('onclick={closeTrailerPopup}')
  })
})
