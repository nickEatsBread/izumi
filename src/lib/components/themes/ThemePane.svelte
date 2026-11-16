<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import Ellipsis from '@lucide/svelte/icons/ellipsis'
  import Palette from '@lucide/svelte/icons/palette'
  import PaletteHomePreview from '$lib/components/settings/PaletteHomePreview.svelte'
  import { SCREEN_LABELS, platformFor, platformLabel, shotsFor, type PreparedTheme, type ThemePlatform, type ThemeScreen } from '$lib/themes/packages'
  import { DEFAULT_THEME_KEY, type ThemeEntry } from '$lib/themes/store-shelves'
  import type { ThemeTokens } from '$lib/theme-tokens'

  // A theme's page: its screens big, on its own colour, then what it is and what you can do.
  // The page owns every action; this only lays them out.
  let { entry, prepared, tokens, device, storeName, busy, primary, canPreview, hint, message, startScreen, startPlatform, onback, onpreview, onmore }: {
    entry: ThemeEntry | null
    /** The checked package of the selection (a listing, an update, or a link or file import). */
    prepared: PreparedTheme | null
    tokens: ThemeTokens | undefined
    device: ThemePlatform
    storeName: string
    busy: boolean
    primary: { label: string; disabled: boolean; run: () => void }
    canPreview: boolean
    /** A standing note under the actions (an ID conflict, an API this client can't read). */
    hint: string
    message: { text: string; error: boolean } | null
    startScreen: ThemeScreen | null
    startPlatform: ThemePlatform | null
    /** Back to the gallery (also a controller's B). */
    onback: () => void
    onpreview: (screen: ThemeScreen) => void
    /** Present for installs: their other actions. */
    onmore?: () => void
  } = $props()

  const isDefault = $derived(entry?.key === DEFAULT_THEME_KEY)
  const release = $derived(entry?.listing?.release ?? prepared?.release)
  const pkg = $derived(prepared?.package ?? entry?.installed?.package)
  const name = $derived(isDefault ? 'Izumi default' : pkg?.name ?? release?.name ?? '')
  const author = $derived(isDefault ? 'izumi' : pkg?.author ?? release?.author ?? '')
  const description = $derived(isDefault ? 'The original appearance, always available. Your Appearance settings still apply.' : pkg?.description ?? release?.description ?? '')
  const platforms = $derived((['desktop', 'phone'] as const).filter((option) => release?.screenshots?.some((shot) => shot.platform === option)))
  // The switches belong to one selection: picking another theme starts from its defaults again.
  let pick = $state<{ key: string; platform?: ThemePlatform; screen?: ThemeScreen }>({ key: '' })
  const key = $derived(entry?.key ?? prepared?.package.id ?? '')
  const platform = $derived((pick.key === key ? pick.platform : undefined) ?? startPlatform ?? (release ? platformFor(release, device) : device))
  const shots = $derived(release ? shotsFor(release, platform) : [])
  const screen = $derived((pick.key === key ? pick.screen : undefined) ?? startScreen ?? 'home')
  const phone = $derived(platform === 'phone')
  const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`
  const version = $derived(pkg?.version ?? release?.version)
</script>

<section class="theme-pane" class:tinted={!!tokens} data-theme-pane data-nav-back-scope aria-busy={busy} aria-labelledby="theme-pane-title" style:--tint={tokens?.theme}>
  <button type="button" class="back" data-focusable data-nav-back onclick={onback}><ArrowLeft size={18} aria-hidden="true" /> All themes</button>
  {#if !isDefault && (shots.length > 1 && !phone || platforms.length > 1)}
    <div class="bar">
      {#if shots.length > 1 && !phone}
        <div class="switch" role="group" aria-label="Screen">{#each shots as shot (shot.url)}<button type="button" data-focusable aria-pressed={shot.screen === screen} onclick={() => pick = { key, platform, screen: shot.screen }}>{SCREEN_LABELS[shot.screen]}</button>{/each}</div>
      {/if}
      {#if platforms.length > 1}
        <div class="switch device" role="group" aria-label="Screenshots for">{#each platforms as option (option)}<button type="button" data-focusable aria-pressed={platform === option} onclick={() => pick = { key, platform: option, screen }}>{option === 'phone' ? 'Phone' : 'Desktop'}</button>{/each}</div>
      {/if}
    </div>
  {/if}
  <div class="stage" class:phone data-theme-viewer>
    {#if isDefault}<div class="live"><PaletteHomePreview preset="izumi" /></div>
    {:else if phone && shots.length}
      <div class="phones">{#each shots.slice(0, 3) as shot (shot.url)}<img src={shot.url} alt={`${name}: ${SCREEN_LABELS[shot.screen]}`} decoding="async" referrerpolicy="no-referrer" />{/each}</div>
    {:else if shots.length}
      <!-- Every screen is in place, so switching is a plain opacity crossfade with nothing to load. -->
      {#each shots as shot (shot.url)}<img class:on={shot.screen === screen} src={shot.url} alt={shot.screen === screen ? `${name}: ${SCREEN_LABELS[shot.screen]}` : ''} decoding="async" referrerpolicy="no-referrer" />{/each}
    {:else}
      <div class="swatch" style:background={tokens ? `hsl(${tokens.background})` : undefined}>{#if tokens}<i style:background={`hsl(${tokens.theme})`}></i>{:else}<Palette size={48} strokeWidth={1} aria-hidden="true" />{/if}</div>
    {/if}
  </div>
  <div class="head">
    <div class="who"><h3 id="theme-pane-title">{name}</h3>{#if author}<p>By {author}</p>{/if}</div>
    <div class="actions">
      <!-- aria-disabled, never disabled: Apply turning into Applied must not drop a controller's focus. -->
      {#if canPreview}<button type="button" class="control" data-focusable aria-disabled={busy || undefined} onclick={() => { if (!busy) onpreview(phone ? 'home' : screen) }}>Preview</button>{/if}
      <button type="button" class="control primary" data-focusable data-theme-primary data-nav-region-default aria-disabled={primary.disabled || undefined} onclick={() => { if (!primary.disabled) primary.run() }}>{primary.label}</button>
      {#if onmore}<button type="button" class="control icon" data-focusable aria-label={`More for ${name}`} onclick={onmore}><Ellipsis size={20} /></button>{/if}
    </div>
  </div>
  {#if message}<p role={message.error ? 'alert' : 'status'} class="message" class:error={message.error}>{message.text}</p>{/if}
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if description}<p class="description">{description}</p>{/if}
  {#if !isDefault && (release || version)}
    <dl class="facts">
      {#if release}<div><dt>Made for</dt><dd>{platformLabel(release.platforms)}</dd></div>{/if}
      {#if version}<div><dt>Version</dt><dd>{version}</dd></div>{/if}
      {#if release}<div><dt>Size</dt><dd>{size(release.bytes)}</dd></div>{/if}
      {#if storeName}<div><dt>Store</dt><dd>{storeName}</dd></div>{/if}
    </dl>
  {/if}
</section>

<style>
  /* The theme's own colour washes the pane; without one (before its package loads) it stays neutral. */
  .theme-pane { --wash: hsl(var(--foreground) / .045); display: flex; flex-direction: column; gap: .875rem; padding: 1rem; border-radius: 1.25rem; background: var(--wash); transition: background-color .35s ease; }
  .theme-pane.tinted { --wash: color-mix(in srgb, hsl(var(--tint)) 16%, hsl(var(--background))); }
  .back { display: inline-flex; align-self: flex-start; align-items: center; gap: .5rem; min-height: 2.75rem; font-size: .8125rem; font-weight: 800; }
  .bar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem; }
  .switch { display: flex; gap: .125rem; padding: .1875rem; border-radius: 999px; background: hsl(var(--background) / .55); }
  .switch button { min-height: 2rem; padding: 0 .875rem; border-radius: 999px; font-size: .75rem; font-weight: 800; color: hsl(var(--muted-foreground)); transition: background-color .15s ease, color .15s ease; }
  .switch button:hover { color: hsl(var(--foreground)); }
  .switch button[aria-pressed='true'] { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  /* The stage never grows taller than the window leaves, so the actions under it stay on screen. */
  .stage { position: relative; width: min(100%, calc((100dvh - 19rem) * 1.6)); align-self: center; aspect-ratio: 16 / 10; overflow: hidden; border-radius: .75rem; background: hsl(var(--background)); box-shadow: 0 .75rem 2.5rem hsl(0 0% 0% / .35), 0 0 0 1px hsl(var(--foreground) / .08); }
  .stage > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .3s ease; }
  .stage > img.on { opacity: 1; }
  .stage.phone { background: transparent; box-shadow: none; overflow: visible; }
  .phones { position: absolute; inset: 0; display: flex; justify-content: center; gap: 4%; }
  .phones img { height: 100%; width: auto; max-width: 31%; object-fit: cover; object-position: top; border-radius: .875rem; box-shadow: 0 .75rem 2rem hsl(0 0% 0% / .4), 0 0 0 .1875rem hsl(0 0% 8%); }
  .live, .swatch { position: absolute; inset: 0; display: grid; place-items: center; color: hsl(var(--muted-foreground)); }
  .swatch i { width: 30%; height: .5rem; border-radius: 999px; }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem 1rem; }
  .who { flex: 1; min-width: 10rem; }
  h3 { font-size: 1.625rem; font-weight: 900; letter-spacing: -.03em; line-height: 1.1; }
  .who p { margin-top: .25rem; font-size: .8125rem; color: hsl(var(--muted-foreground)); }
  .actions { display: flex; gap: .5rem; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 2.625rem; padding: 0 1.125rem; border-radius: 999px; font-size: .8125rem; font-weight: 800; white-space: nowrap; background: hsl(var(--foreground) / .1); transition: background-color .15s ease, filter .15s ease; }
  .control:not([aria-disabled='true']):hover { background: hsl(var(--foreground) / .16); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .control.primary:not([aria-disabled='true']):hover { background: hsl(var(--primary)); filter: brightness(1.1); }
  .control.icon { width: 2.625rem; padding: 0; }
  .control[aria-disabled='true'] { opacity: .5; cursor: default; }
  .description { font-size: .875rem; line-height: 1.6; color: hsl(var(--foreground) / .82); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
  .hint, .message { font-size: .8125rem; line-height: 1.5; color: hsl(var(--muted-foreground)); }
  .message { padding: .625rem .875rem; border-radius: .625rem; background: hsl(var(--background) / .55); color: hsl(var(--foreground)); }
  .message.error { box-shadow: inset .1875rem 0 0 hsl(var(--theme)); }
  .facts { display: flex; flex-wrap: wrap; gap: .5rem 1.75rem; }
  dt { font-size: .625rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: hsl(var(--muted-foreground)); }
  dd { margin-top: .125rem; font-size: .8125rem; font-weight: 700; }
  /* Phones: the stage takes the full width and the actions share a row. */
  @container (max-width: 40rem) {
    .theme-pane { padding: .75rem; border-radius: 1rem; }
    .stage { width: 100%; }
    .stage.phone { aspect-ratio: 4 / 3; }
    .actions { flex: 1 1 100%; }
    .actions .control:not(.icon) { flex: 1; }
  }
</style>
