import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const loader = read('./SourceLoader.svelte')
const feedback = read('../PlayFeedback.svelte')
const spinner = read('../Spinner.svelte')
const play = read('../../stremio/play.ts')

describe('connecting loader startup', () => {
  it('uses one compositor-driven loader before and after the lazy component swap', () => {
    for (const screen of [loader, feedback]) {
      expect(screen).toContain('<Spinner size="player" />')
      // Equal rows either side keep the ring on the screen's centre, where the player's ring appears.
      expect(screen).toContain('grid-rows-[1fr_auto_1fr]')
      expect(screen).toContain('data-part="play.loader.bar" class="row-start-2')
    }
    expect(spinner).not.toContain('<animate')
    expect(spinner).toContain('class="block shrink-0 animate-spin rounded-full will-change-transform')
  })

  it("opens an episode on the player's own loader, the ring alone on black, from the press", () => {
    // A "Connecting" screen with its own art, title and caption read as a stop on the way.
    const connecting = read('./SourceConnecting.svelte')
    const opening = connecting.slice(connecting.indexOf('data-variant="player"'))
    expect(opening).toContain('<div data-part="play.loader" class="grid place-items-center" aria-hidden="true"><Spinner size="player" /></div>')
    expect(opening).not.toContain('play.backdrop')
    expect(opening).not.toContain('<SourceLoader')
    expect(feedback).toContain("{#if variant === 'player'}")
    expect(read('../../../routes/app/+layout.svelte')).toContain(`<PlayFeedback variant="player" label={$connecting?.title ?? ''} />`)
  })

  it('commits the loader without charging playback two animation frames', () => {
    expect(play).toContain('async function commitConnectingLoader()')
    expect(play).toMatch(/connecting\.set\(\{[\s\S]{0,700}await commitConnectingLoader\(\)[\s\S]{0,100}if \(!stillOwnsPlayback\(\)\) return/)
    const helper = play.slice(
      play.indexOf('async function commitConnectingLoader()'),
      play.indexOf('function continueRememberedSource'),
    )
    expect(helper).not.toContain('requestAnimationFrame')
    expect(helper).not.toContain('setTimeout')
  })
})
