<script lang="ts">
  import { goto } from '$app/navigation'
  import { themeInstallPreview, cancelThemePreview, installTheme, applyInstalledTheme } from '$lib/themes/installed'
  let error = $state('')
  function apply() {
    const prepared = $themeInstallPreview
    if (!prepared) return
    try { applyInstalledTheme(installTheme(prepared)); cancelThemePreview() }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not install this theme.' }
  }
  function cancel() { cancelThemePreview(); void goto('/app/settings/themes') }
</script>
{#if $themeInstallPreview}
  <aside class="theme-preview-bar" aria-label="Theme installation preview">
    <div><strong>Previewing {$themeInstallPreview.package.name}</strong><p>Your saved appearance is unchanged.</p>{#if error}<p role="alert">{error}</p>{/if}</div>
    <div class="actions"><button type="button" data-focusable onclick={cancel}>Cancel preview</button><button type="button" data-focusable class="apply" onclick={apply}>Install & apply</button></div>
  </aside>
{/if}
<style>
  /* Recovery control: it must stay readable while a previewed theme with unusable colours is applied,
     so it keeps the Theme Studio editor palette instead of the client's tokens. */
  .theme-preview-bar { --recovery-bg: #19191d; --recovery-fg: #f1f1f4; --recovery-muted: #a5a5af; --recovery-line: #34343d; --recovery-control: #26262d; --recovery-focus: #c8c8e0;
    position: fixed; z-index: 70; bottom: calc(1rem + env(safe-area-inset-bottom)); left: max(1rem, 5vw); right: max(1rem, 5vw); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border: 1px solid var(--recovery-line); border-radius: 12px; background: var(--recovery-bg); color: var(--recovery-fg); color-scheme: dark; font: 14px system-ui, sans-serif; box-shadow: 0 8px 32px #0005; }
  p { color: var(--recovery-muted); font-size: 12px; margin-top: 4px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button { min-height: 44px; padding: 10px 16px; border-radius: 8px; font-weight: 700; background: var(--recovery-control); }
  button.apply { background: var(--recovery-fg); color: var(--recovery-bg); }
  button:focus-visible { outline: 2px solid var(--recovery-focus); outline-offset: 3px; }
  @media(max-width: 640px) { .theme-preview-bar { bottom: calc(5rem + env(safe-area-inset-bottom)); } }
</style>
