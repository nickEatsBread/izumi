<script lang="ts">
  import { nodeStyle, visibleNode, displayText, type ThemeNode, type DisplayModel, type ThemeAction, type ThemeIcon } from '$lib/themes/presentation'
  import TrendingUp from '@lucide/svelte/icons/trending-up'
  import Tv from '@lucide/svelte/icons/tv'
  import Clapperboard from '@lucide/svelte/icons/clapperboard'
  import Users from '@lucide/svelte/icons/users'
  import Building2 from '@lucide/svelte/icons/building-2'
  import CalendarDays from '@lucide/svelte/icons/calendar-days'
  import MonitorPlay from '@lucide/svelte/icons/monitor-play'
  import Library from '@lucide/svelte/icons/library'
  import Globe from '@lucide/svelte/icons/globe'
  import Timer from '@lucide/svelte/icons/timer'
  import Play from '@lucide/svelte/icons/play'
  let { node, model, actions = {}, eager = false, titleHeading = false }: { node: ThemeNode; model: DisplayModel; actions?: Partial<Record<ThemeAction, () => void>>; eager?: boolean; titleHeading?: boolean } = $props()
  const labels: Record<ThemeAction, string> = { play: 'Watch', details: 'Details', favorite: 'Favorite', previous: 'Previous slide', next: 'Next slide', list: 'Add to list', trailer: 'Trailer', share: 'Share' }
  const icons: Record<ThemeIcon, typeof TrendingUp> = {
    score: TrendingUp, format: Tv, episodes: Clapperboard, reviews: Users, studio: Building2,
    season: CalendarDays, status: MonitorPlay, source: Library, country: Globe, duration: Timer,
  }
</script>

{#snippet renderNode(item: ThemeNode)}
  {#if visibleNode(item, model)}
    {#if item.type === 'text'}
      <svelte:element this={titleHeading && item.field === 'title' ? 'h1' : 'span'} style={nodeStyle(item)} class="theme-text" data-part={item.part}>{item.field ? displayText(item.field, model) : item.text ?? ''}</svelte:element>
    {:else if item.type === 'artwork'}
      {@const src = model[item.artwork ?? 'poster']}
      <div class="theme-artwork" class:theme-artwork-fallback={!src} style={nodeStyle(item)} data-part={item.part}>
        {#if src}<img src={String(src)} alt="" draggable="false" loading={eager ? 'eager' : 'lazy'} decoding="async" class="duration-150 ease-out transition-transform group-hover:scale-105" />{/if}
      </div>
    {:else if item.type === 'action'}
      {#if item.action && actions[item.action]}<button type="button" data-focusable class="theme-action" style={nodeStyle(item)} data-part={item.part} onclick={actions[item.action]}>{#if item.action === 'play'}<Play size={16} fill="currentColor" />{/if}{item.text || labels[item.action]}</button>{/if}
    {:else if item.type === 'icon' && item.icon}
      {@const Icon = icons[item.icon]}
      <span class="theme-icon" style={nodeStyle(item)} data-part={item.part} aria-hidden="true"><Icon size={Number(item.style?.fontSize) || 18} /></span>
    {:else if item.type === 'meter' && item.field}
      {@const amount = model[item.field]}
      <div class="theme-meter" style={nodeStyle(item)} data-part={item.part} role="presentation">
        <span style:width={`${typeof amount === 'number' ? Math.max(0, Math.min(100, amount)) : 0}%`}></span>
      </div>
    {:else}
      <div style={nodeStyle(item)} data-part={item.part} class:theme-overlay={item.type === 'overlay'} class:theme-nowrap={item.type === 'row' && item.style?.wrap === 'nowrap'}>
        {#each item.children ?? [] as child}{@render renderNode(child)}{/each}
      </div>
    {/if}
  {/if}
{/snippet}
<div class="theme-template">{@render renderNode(node)}</div>

<style>
  .theme-template { position: relative; isolation: isolate; min-width: 0; width: 100%; }
  .theme-overlay { overflow: hidden; }
  .theme-overlay > :global(*) { grid-area: 1 / 1; }
  .theme-overlay > :global(*:not(.theme-artwork)) { z-index: 2; }
  .theme-artwork { overflow: hidden; min-width: 0; }
  .theme-artwork > img { display: block; width: 100%; height: 100%; object-fit: inherit; }
  .theme-artwork-fallback { background: hsl(var(--muted)); }
  .theme-text { min-width: 0; overflow-wrap: break-word; }
  .theme-nowrap > :global(*) { flex-shrink: 0; }
  .theme-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: currentColor; }
  .theme-meter { overflow: hidden; border-radius: 99px; background: hsl(var(--muted)); }
  .theme-meter > span { display: block; height: 100%; min-height: inherit; background: hsl(var(--theme)); }
  .theme-action { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 6px 16px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-radius: var(--radius); font-weight: 700; }
  .theme-action:focus-visible { outline: 3px solid hsl(var(--ring)); outline-offset: 3px; }
  .theme-action:hover { filter: brightness(1.12); }
</style>
