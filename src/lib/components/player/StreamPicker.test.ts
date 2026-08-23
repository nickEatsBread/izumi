import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./StreamPicker.svelte', import.meta.url)), 'utf8')

describe('mobile source picker layout', () => {
  it('is a full-screen dialog on mobile, a centred card everywhere else', () => {
    expect(source).toContain("$isMobile ? 'sp-mobile h-full w-full' : 'max-h-[85vh] w-full max-w-3xl")
    // 85vh + a floating card is the desktop shape; mobile must not inherit either.
    expect(source).toContain("{$isMobile ? '' : 'place-items-center p-4'}")
  })

  it('clears the Android system bars and a landscape display cutout', () => {
    expect(source).toContain('env(safe-area-inset-top)')
    expect(source).toContain('env(safe-area-inset-bottom)')
    expect(source).toContain('env(safe-area-inset-left)')
    expect(source).toContain('env(safe-area-inset-right)')
  })

  it('compacts the chrome on a short viewport (opened from the player, in landscape)', () => {
    expect(source).toContain('@media (max-height: 560px)')
    expect(source).toContain(':global(.sp-mobile .sp-cover) { display: none; }')
  })

  it('replaces the wrapping checkbox bar with one uniform scrolling chip strip', () => {
    expect(source).toContain('sp-chips flex items-center gap-2 overflow-x-auto')
    expect(source).toContain("const CHIP = 'flex h-9 shrink-0 items-center")
    // The toggles are pressed-state buttons now, not 13px checkboxes.
    expect(source).toContain('aria-pressed={$showDeadSources}')
    expect(source).toContain('aria-pressed={$fullStreamDescription}')
  })

  it('states the cache tier in words, since a tooltip is unreachable on touch', () => {
    expect(source).toContain('{g.i} {g.w}')
    expect(source).toContain("w: directP2p ? 'Direct P2P' : 'Will download'")
  })

  it('keeps the copy action out of the row body and off the thumb path', () => {
    expect(source).toContain('border-l border-border/60')
    // A <button> nested inside a role="button" row was also ambiguous to a screen reader.
    expect(source).toContain('The row body and the copy action are SIBLINGS')
  })

  it('gives Android Back an entry of its own to pop', () => {
    expect(source).toContain("pushState('', { sourcePicker: true })")
    expect(source).toContain("window.addEventListener('popstate', onPop)")
    // Guarded on a primitive: `pick` is a new object per progressive stream update, so depending
    // on it would push one history entry per addon that lands.
    expect(source).toContain('const backTrapOpen = $derived($isMobile && !!pick && !pick.hidden)')
  })

  it('uses pointer and controller focus time to prefetch the targeted source metadata', () => {
    expect(source).toContain("prefetchSourceMetadata(info.stream, 'targeted')")
    expect(source).toContain('onpointerenter={() => targetSource(info)}')
    expect(source).toContain('onfocus={() => focusSource(info)}')
    expect(source).toContain('if ($gameMode) bumpPlayerOverlay()')
  })

  it('focuses a playable source on every Game-mode picker opening', () => {
    expect(source).toContain('let pickerFocusReady = false')
    expect(source).toContain("trap.querySelector<HTMLElement>('[data-source-row]')")
    expect(source).toContain('bind:this={pickerTrap}')
    expect(source).toContain('setTimeout(focusFirst, 80)')
    expect(source).toContain('data-source-row')
    expect(source).toContain('focus-visible:shadow-[inset_0_0_0_2px_white]')
    expect(source).toContain('{#if !$gameMode}')
    expect(source).not.toContain('let focusedBest = false')
  })

  it('keeps instant automatic selection out of the source-list dialog', () => {
    expect(source).toContain('{#if $isAndroid && autoImmediate && !playbackError}')
    expect(source).not.toContain('<AndroidPreparingPlayer')
    expect(source).toContain('<AndroidConnectionStatus')
    expect(source).not.toContain('class="android-prepare fixed inset-x-4')
  })
})
