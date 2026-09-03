<script lang="ts">
  import Cast from '@lucide/svelte/icons/cast'
  import { companionLinkState } from '$lib/companion/client'

  let { floating = false }: { floating?: boolean } = $props()
  const label = $derived($companionLinkState.active
    ? `Communicating with ${$companionLinkState.connected === 1 ? 'linked TV' : `${$companionLinkState.connected} linked TVs`}`
    : `${$companionLinkState.connected === 1 ? 'TV' : `${$companionLinkState.connected} TVs`} linked`)
</script>

{#if $companionLinkState.connected > 0}
  <div
    role="status"
    aria-label={label}
    title={label}
    class="pointer-events-none grid size-8 place-items-center text-muted-foreground transition-colors duration-200
      {$companionLinkState.active ? 'text-theme' : ''}
      {floating ? 'rounded-lg border border-white/10 bg-background/90 shadow-lg backdrop-blur' : ''}"
  >
    <span class="relative grid size-5 place-items-center" aria-hidden="true">
      <Cast size={16} strokeWidth={2} />
      {#if $companionLinkState.active}
        <i class="tv-wave tv-wave-one"></i>
        <i class="tv-wave tv-wave-two"></i>
        <i class="absolute bottom-[3px] left-[3px] size-1 rounded-full bg-current animate-pulse"></i>
      {/if}
    </span>
  </div>
{/if}

<style>
  .tv-wave {
    position: absolute;
    bottom: 3px;
    left: 3px;
    width: 4px;
    height: 4px;
    border: 1px solid currentColor;
    border-radius: 999px;
    opacity: 0;
    animation: tv-link-wave 1.35s cubic-bezier(.2, .75, .25, 1) infinite;
  }
  .tv-wave-two { animation-delay: .45s; }
  @keyframes tv-link-wave {
    0% { opacity: .8; transform: scale(.65); }
    75%, 100% { opacity: 0; transform: scale(3.6); }
  }
  @media (prefers-reduced-motion: reduce) {
    .tv-wave { animation: none; opacity: .55; transform: scale(2.4); }
  }
</style>
