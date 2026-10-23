<script lang="ts">
  import { untrack } from 'svelte'
  import { get } from 'svelte/store'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ThemeShots from './ThemeShots.svelte'
  import { isMobile } from '$lib/platform'
  import { SCREEN_LABELS, platformFor, platformLabel, shotsFor, type PreparedTheme, type ThemePlatform, type ThemeRelease, type ThemeScreen } from '$lib/themes/packages'

  let { release, prepared, storeName, busy, canInstall, installLabel, locked, conflict, startScreen, startPlatform, onback, oninstall, onpreview }: {
    release: ThemeRelease | null
    prepared: PreparedTheme | null
    storeName: string
    busy: boolean
    canInstall: boolean
    installLabel: string
    /** A Theme Studio draft is open: nothing may be previewed or applied. */
    locked: boolean
    /** The same theme ID is installed from another source. */
    conflict: boolean
    startScreen: ThemeScreen | null
    startPlatform: ThemePlatform | null
    onback: () => void
    oninstall: () => void
    onpreview: (screen: ThemeScreen, from: HTMLImageElement | null) => void
  } = $props()

  const name = $derived(prepared?.package.name ?? release?.name ?? '')
  const author = $derived(prepared?.package.author ?? release?.author ?? '')
  const description = $derived(prepared?.package.description ?? release?.description ?? '')
  const version = $derived(prepared?.package.version ?? release?.version ?? '')
  // Only offer a platform switch when the listing really has screenshots for more than one.
  const platforms = $derived((['desktop', 'phone'] as const).filter((option) => release?.screenshots?.some((shot) => shot.platform === option)))
  // Seeded once from the URL (a preview returning to this page; the page re-keys this component per
  // theme); the switch and thumbnails own them after.
  const initialPlatform = untrack(() => startPlatform ?? (release ? platformFor(release, get(isMobile) ? 'phone' : 'desktop') : 'desktop'))
  let platform = $state<ThemePlatform>(initialPlatform)
  const shots = $derived(release ? shotsFor(release, platform) : [])
  let index = $state(untrack(() => Math.max(0, release && startScreen ? shotsFor(release, initialPlatform).findIndex((shot) => shot.screen === startScreen) : 0)))
  let viewer = $state<HTMLElement>()
  // The theme's own colours once its package is loaded; validated HSL tokens, so safe inline.
  const tokens = $derived(prepared?.package.design.tokens)
  const swatch = $derived(tokens ? `linear-gradient(135deg, hsl(${tokens.theme}), hsl(${tokens.background}))` : 'hsl(var(--muted))')
  const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`
</script>

<section class="theme-detail" aria-busy={busy} data-nav-back-scope>
  <button type="button" class="back" data-focusable data-nav-back disabled={busy} onclick={onback}><ArrowLeft size={16} /> Themes</button>
  <header>
    <span class="icon" style:background={swatch} aria-hidden="true"></span>
    <div class="heading"><h3>{name}</h3><p>{author}{#if release?.tags.length} · {release.tags.join(' · ')}{/if}</p></div>
    {#if prepared}
      <div class="actions">
        <button type="button" class="control" data-focusable disabled={locked || !canInstall} onclick={() => onpreview(shots[index]?.screen ?? 'home', viewer?.querySelector('img') ?? null)}>Preview</button>
        <button type="button" class="control primary" data-focusable disabled={locked || !canInstall} onclick={oninstall}>{installLabel}</button>
      </div>
    {:else if busy}<p role="status" class="checking">Checking theme package…</p>{/if}
  </header>
  {#if conflict}<p class="hint">A theme with this ID is already installed from a different source. Remove it there before installing this one.</p>{/if}
  {#if platforms.length > 1}
    <div class="switch" role="group" aria-label="Screenshots for">{#each platforms as option (option)}<button type="button" data-focusable aria-pressed={platform === option} onclick={() => { platform = option; index = 0 }}>{option === 'phone' ? 'Phone' : 'Desktop'}</button>{/each}</div>
  {/if}
  <div class="viewer" bind:this={viewer} data-theme-viewer><ThemeShots {shots} {name} bind:index phone={platform === 'phone'} chrome={false} /></div>
  {#if shots.length > 1}
    <div class="thumbs" data-nav-row><div class="thumb-track" data-nav-row-items data-nav-scroll-x>
      {#each shots as shot, i (shot.url)}
        <button type="button" class="thumb" data-focusable aria-pressed={i === index} onclick={() => { index = i }} onfocus={() => { index = i }}>
          <img src={shot.url} alt="" loading="lazy" referrerpolicy="no-referrer" class:phone={platform === 'phone'} />
          <span>{SCREEN_LABELS[shot.screen]}</span>
        </button>
      {/each}
    </div></div>
  {/if}
  <div class="body">
    <p class="description">{description}</p>
    <dl class="info">
      <div><dt>Version</dt><dd>{version}</dd></div>
      {#if release}<div><dt>Size</dt><dd>{size(release.bytes)}</dd></div>{/if}
      <div><dt>Made for</dt><dd>{platformLabel(release?.platforms)}</dd></div>
      {#if storeName}<div><dt>Store</dt><dd>{storeName}</dd></div>{/if}
      <div><dt>Theme API</dt><dd>{prepared?.package.themeApi ?? release?.themeApi}</dd></div>
    </dl>
  </div>
  {#if prepared && !conflict}<p class="hint">You can edit this theme in Theme Studio after installing it.</p>{/if}
</section>

<style>
  .back { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: 6px 0 12px; font-size: 12px; font-weight: 800; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
  .icon { width: 64px; height: 64px; border-radius: 16px; flex: none; box-shadow: inset 0 0 0 1px hsl(var(--foreground) / .1); }
  .heading { flex: 1; min-width: 180px; }
  h3 { font-size: clamp(24px, 3vw, 32px); font-weight: 900; letter-spacing: -.03em; }
  .heading p, .checking, .hint, dt { color: hsl(var(--muted-foreground)); font-size: 12px; }
  .actions, .switch { display: flex; flex-wrap: wrap; gap: 8px; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 9px 18px; border-radius: 999px; font-size: 12px; font-weight: 800; background: hsl(var(--foreground) / .08); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .control:disabled { opacity: .45; cursor: not-allowed; }
  .switch { margin: 20px 0 10px; padding: 3px; width: fit-content; border-radius: 999px; background: hsl(var(--muted)); }
  .switch button { min-height: 32px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 800; color: hsl(var(--muted-foreground)); }
  .switch button[aria-pressed='true'] { background: hsl(var(--background)); color: hsl(var(--foreground)); }
  .viewer { margin-top: 16px; border-radius: 14px; overflow: hidden; }
  .switch + .viewer { margin-top: 0; }
  .thumb-track { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(120px, 180px); gap: 8px; overflow-x: auto; padding: 10px 2px 6px; }
  .thumb { display: flex; flex-direction: column; gap: 6px; font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-align: start; }
  .thumb img { aspect-ratio: 16 / 10; width: 100%; object-fit: cover; border-radius: 8px; background: hsl(var(--muted)); outline: 2px solid transparent; outline-offset: 2px; }
  .thumb img.phone { object-fit: contain; }
  .thumb[aria-pressed='true'] { color: hsl(var(--foreground)); }
  .thumb[aria-pressed='true'] img { outline-color: hsl(var(--foreground)); }
  .body { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(200px, 1fr); gap: 28px; margin-top: 20px; }
  .description { font-size: 14px; line-height: 1.7; color: hsl(var(--muted-foreground)); }
  .info { display: grid; gap: 10px; align-content: start; }
  .info div { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid hsl(var(--border)); }
  dd { font-size: 12px; font-weight: 700; text-align: end; }
  .hint { margin-top: 14px; line-height: 1.6; }
  @media (max-width: 760px) { .body { grid-template-columns: 1fr; } }
</style>
