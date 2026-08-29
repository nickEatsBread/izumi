<script lang="ts">
  import type { CatalogSelection } from '$lib/settings/catalog'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import Coffee from '@lucide/svelte/icons/coffee'

  let { platform }: { platform: CatalogSelection } = $props()
  let failedPlatform = $state<CatalogSelection | null>(null)
  const imageFailed = $derived(failedPlatform === platform)

  function showFallback() {
    // A CatalogPlatformLogo instance is reused as the user switches providers. Remembering one
    // generic failure hid every later logo (including bundled TMDB); scope it to the asset that
    // actually failed instead.
    failedPlatform = platform
  }
</script>

{#if platform === 'auto'}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#152232]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-[9px] font-black text-[#02a9ff]">AL</span>
    {:else}
      <img src="/brand/anilist.svg" alt="" class="absolute inset-1.5 size-7 object-contain" onerror={showFallback} />
    {/if}
    <span class="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-theme text-white shadow-md">
      <Sparkles size={9} strokeWidth={2.8} />
    </span>
  </span>
{:else if platform === 'anilist'}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#152232]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-[9px] font-black text-[#02a9ff]">AL</span>
    {:else}
      <img src="/brand/anilist.svg" alt="" class="absolute inset-1.5 size-7 object-contain" onerror={showFallback} />
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
  <span class="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#032541]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-[8px] font-black text-[#56c5c9]">TMDB</span>
    {:else}
      <img
        src="https://www.themoviedb.org/assets/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"
        alt=""
        class="absolute inset-0 size-10 object-cover"
        onerror={showFallback}
      />
    {/if}
  </span>
{:else if platform === 'jvm'}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#5c3624] text-[#f7d7aa]" aria-hidden="true">
    <Coffee size={24} strokeWidth={2.4} />
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
