<script lang="ts">
  import { goto } from '$app/navigation'
  import { themeSafeMode } from '$lib/themes/safe-mode'
</script>

{#if $themeSafeMode}
  <aside class="safe-mode" role="status" data-theme-protected>
    <p>Safe mode: theme styles are off for this session.</p>
    <div>
      <button type="button" data-focusable onclick={() => themeSafeMode.set(false)}>Turn back on</button>
      <button type="button" data-focusable onclick={() => void goto('/app/settings/themes')}>Open Themes</button>
    </div>
  </aside>
{/if}

<style>
  .safe-mode { position: fixed; z-index: 60; left: 50%; top: 12px; transform: translateX(-50%); display: flex; flex-wrap: wrap; align-items: center; gap: 12px; max-width: calc(100vw - 24px); padding: 10px 14px; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--card-foreground)); box-shadow: 0 8px 30px hsl(0 0% 0% / .35); font-size: 13px; }
  .safe-mode div { display: flex; gap: 8px; }
  .safe-mode button { min-height: 34px; padding: 6px 12px; border-radius: 8px; border: 1px solid hsl(var(--border)); font-weight: 800; font-size: 12px; }
  .safe-mode button:first-child { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: transparent; }
  .safe-mode button:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 3px; }
</style>
