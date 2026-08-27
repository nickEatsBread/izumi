<script lang="ts">
  export type TrackerProvider = 'anilist' | 'mal' | 'kitsu' | 'simkl'

  let { provider }: { provider: TrackerProvider } = $props()
  let imageFailed = $state(false)
</script>

{#if provider === 'anilist'}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#152232]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-sm font-black text-[#02a9ff]">A</span>
    {:else}
      <img
        src="https://anilist.co/img/icons/icon.svg"
        alt=""
        class="size-7 object-contain"
        onerror={() => (imageFailed = true)}
      />
    {/if}
  </span>
{:else if provider === 'mal'}
  <span class="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#2f52a2]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-[10px] font-black tracking-[-0.04em] text-white">MAL</span>
    {:else}
      <img
        src="/brand/myanimelist.svg"
        alt=""
        class="size-8 object-contain"
        onerror={() => (imageFailed = true)}
      />
    {/if}
  </span>
{:else if provider === 'kitsu'}
  <span class="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#443544]" aria-hidden="true">
    {#if imageFailed}
      <span class="text-sm font-black text-[#ff6d59]">K</span>
    {:else}
      <img
        src="https://avatars.githubusercontent.com/u/7648832?s=160&amp;v=4"
        alt=""
        class="size-10 object-cover"
        onerror={() => (imageFailed = true)}
      />
    {/if}
  </span>
{:else if provider === 'simkl'}
  <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-[#171717] ring-1 ring-inset ring-white/10" aria-hidden="true">
    <span class="text-[10px] font-black tracking-[-0.04em] text-[#ff5b45]">SIMKL</span>
  </span>
{/if}
