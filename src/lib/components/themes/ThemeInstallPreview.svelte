<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { get } from 'svelte/store'
  import { themeInstallPreview, cancelThemePreview, installTheme, applyInstalledTheme } from '$lib/themes/installed'
  import { SCREEN_LABELS, shotsFor } from '$lib/themes/packages'
  import { PREVIEW_SCREENS, newestSeriesId, screenOf, screenRoute, themePageUrl } from '$lib/themes/preview-routes'
  import { stepOutOfPreview } from '$lib/themes/preview-transition'
  import { cwSnapshot } from '$lib/player/continue-watching'
  import { allStores } from '$lib/store/feeds'
  import { isMobile } from '$lib/platform'
  let error = $state('')
  let leaving = false
  // Resolved once per preview (this bar mounts with it): the Series stop is the newest Continue Watching title.
  const seriesId = newestSeriesId(get(cwSnapshot))
  const stops = PREVIEW_SCREENS.filter((screen) => screen !== 'series' || seriesId != null)
  const current = $derived(screenOf(page.url.pathname))
  function apply() {
    const prepared = $themeInstallPreview
    if (!prepared) return
    try { applyInstalledTheme(installTheme(prepared)); cancelThemePreview() }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not install this theme.' }
  }
  // Back to the theme page, shrinking this screen's screenshot into its viewer.
  function exit() {
    const prepared = $themeInstallPreview
    if (!prepared || leaving) return
    leaving = true
    const platform = $isMobile ? 'phone' : 'desktop'
    const shot = prepared.release ? shotsFor(prepared.release, platform).find((item) => item.screen === current) : undefined
    const storeId = $allStores.find((store) => store.url === prepared.origin)?.id
    void stepOutOfPreview(shot?.url ?? null, cancelThemePreview, themePageUrl(storeId, prepared.package.id, shot?.screen, platform), () => document.querySelector('[data-theme-viewer]'))
  }
</script>
{#if $themeInstallPreview}
  <aside class="theme-preview-bar" aria-label="Theme installation preview" data-theme-protected>
    <div class="who"><strong>Previewing {$themeInstallPreview.package.name}</strong><p>Your saved appearance is unchanged.</p>{#if error}<p role="alert">{error}</p>{/if}</div>
    <nav class="stops" aria-label="Preview screens">{#each stops as screen (screen)}<button type="button" data-focusable aria-current={current === screen ? 'page' : undefined} onclick={() => void goto(screenRoute(screen, seriesId))}>{SCREEN_LABELS[screen]}</button>{/each}</nav>
    <div class="actions"><button type="button" data-focusable onclick={exit}>Exit preview</button><button type="button" data-focusable class="apply" onclick={apply}>Install & apply</button></div>
  </aside>
{/if}
<style>
  /* Recovery control: it must stay readable while a previewed theme with unusable colours is applied,
     so it keeps the Theme Studio editor palette instead of the client's tokens. */
  .theme-preview-bar { --recovery-bg: #19191d; --recovery-fg: #f1f1f4; --recovery-muted: #a5a5af; --recovery-line: #34343d; --recovery-control: #26262d; --recovery-focus: #c8c8e0;
    --izumi-safe-focus-ring: 0 0 0 2px var(--recovery-bg), 0 0 0 5px var(--recovery-focus);
    position: fixed; z-index: 70; bottom: calc(1rem + env(safe-area-inset-bottom)); left: max(1rem, 5vw); right: max(1rem, 5vw); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 10px 10px 24px; border: 1px solid var(--recovery-line); border-radius: 999px; background: var(--recovery-bg); color: var(--recovery-fg); color-scheme: dark; font: 14px system-ui, sans-serif; box-shadow: 0 8px 32px #0005; }
  p { color: var(--recovery-muted); font-size: 12px; margin-top: 4px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button { min-height: 44px; padding: 10px 16px; border-radius: 999px; font-weight: 700; background: var(--recovery-control); }
  button.apply { background: var(--recovery-fg); color: var(--recovery-bg); }
  button:focus-visible { outline: 2px solid var(--recovery-focus); outline-offset: 3px; }
  .stops { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px; border-radius: 999px; background: var(--recovery-control); }
  .stops button { min-height: 36px; padding: 0 14px; background: transparent; color: var(--recovery-muted); }
  .stops button[aria-current='page'] { background: var(--recovery-fg); color: var(--recovery-bg); }
  @media(max-width: 640px) { .theme-preview-bar { bottom: calc(5rem + env(safe-area-inset-bottom)); border-radius: 16px; padding: 14px; } }
</style>
