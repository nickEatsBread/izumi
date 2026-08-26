<script lang="ts">
  import type { CatalogSelection } from '$lib/settings/catalog'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'

  let { platform }: { platform: CatalogSelection } = $props()
  let imageFailed = $state(false)

  function showFallback() {
    imageFailed = true
  }
</script>

{#if platform === 'auto'}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#152232]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-[9px] font-black text-[#02a9ff]">AL</span>
    {:else}
      <img src="https://anilist.co/img/icons/icon.svg" alt="" class="absolute inset-1.5 size-7 object-contain" onerror={showFallback} />
    {/if}
    <span class="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-theme text-white ring-2 ring-background">
      <RefreshCw size={9} strokeWidth={3} />
    </span>
  </span>
{:else if platform === 'anilist'}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#152232]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-[9px] font-black text-[#02a9ff]">AL</span>
    {:else}
      <img src="https://anilist.co/img/icons/icon.svg" alt="" class="absolute inset-1.5 size-7 object-contain" onerror={showFallback} />
    {/if}
  </span>
{:else if platform === 'kitsu'}
  <span class="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#443544]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-sm font-black text-[#ff6d59]">K</span>
    {:else}
      <img
        src="https://avatars.githubusercontent.com/u/7648832?s=160&amp;v=4"
        alt=""
        class="absolute inset-0 size-10 object-cover"
        onerror={showFallback}
      />
    {/if}
  </span>
{:else if platform === 'tmdb'}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#032541]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-[8px] font-black text-[#56c5c9]">TMDB</span>
    {:else}
      <img src="/brand/tmdb.svg" alt="" class="w-9 object-contain" onerror={showFallback} />
    {/if}
  </span>
{:else}
  <span class="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#2a2843]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-sm font-black text-[#8d7dff]">S</span>
    {:else}
      <img src="https://www.stremio.com/website/favicon.ico" alt="" class="size-8 rounded-lg object-cover" onerror={showFallback} />
    {/if}
  </span>
{/if}
