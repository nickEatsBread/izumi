<script lang="ts">
  export type TrackerProvider = 'anilist' | 'mal' | 'kitsu' | 'simkl'

  let { provider, compact = false }: { provider: TrackerProvider; compact?: boolean } = $props()
  let imageFailed = $state(false)
</script>

{#if provider === 'anilist'}
  <span class="relative grid shrink-0 place-items-center bg-[#152232] {compact ? 'size-6 rounded-md' : 'size-10 rounded-xl'}" aria-hidden="true">
    {#if imageFailed}
      <span class="font-black text-[#02a9ff] {compact ? 'text-[10px]' : 'text-sm'}">A</span>
    {:else}
      <img
        src="https://anilist.co/img/icons/icon.svg"
        alt=""
        class="object-contain {compact ? 'size-4' : 'size-7'}"
        onerror={() => (imageFailed = true)}
      />
    {/if}
  </span>
{:else if provider === 'mal'}
  <span class="relative grid shrink-0 place-items-center overflow-hidden bg-[#2f52a2] {compact ? 'size-6 rounded-md' : 'size-10 rounded-xl'}" aria-hidden="true">
    {#if imageFailed}
      <span class="font-black tracking-[-0.04em] text-white {compact ? 'text-[7px]' : 'text-[10px]'}">MAL</span>
    {:else}
      <img
        src="/brand/myanimelist.svg"
        alt=""
        class="object-contain {compact ? 'size-5' : 'size-8'}"
        onerror={() => (imageFailed = true)}
      />
    {/if}
  </span>
{:else if provider === 'kitsu'}
  <span class="relative grid shrink-0 place-items-center overflow-hidden bg-[#443544] {compact ? 'size-6 rounded-md' : 'size-10 rounded-xl'}" aria-hidden="true">
    {#if imageFailed}
      <span class="font-black text-[#ff6d59] {compact ? 'text-[10px]' : 'text-sm'}">K</span>
    {:else}
      <img
        src="https://avatars.githubusercontent.com/u/7648832?s=160&amp;v=4"
        alt=""
        class="object-cover {compact ? 'size-6' : 'size-10'}"
        onerror={() => (imageFailed = true)}
      />
    {/if}
  </span>
{:else if provider === 'simkl'}
  <span class="grid shrink-0 place-items-center bg-[#171717] ring-1 ring-inset ring-white/10 {compact ? 'size-6 rounded-md' : 'size-10 rounded-xl'}" aria-hidden="true">
    {#if compact}
      {#if imageFailed}
        <span class="text-[10px] font-black text-[#ff5b45]">S</span>
      {:else}
        <img src="https://simkl.com/favicon.ico" alt="" class="size-4 object-contain" onerror={() => (imageFailed = true)} />
      {/if}
    {:else}
      <span class="text-[10px] font-black tracking-[-0.04em] text-[#ff5b45]">SIMKL</span>
    {/if}
  </span>
{/if}
