<script lang="ts">
  import { nodeStyle, visibleNode, displayText, type ThemeNode, type DisplayModel, type ThemeAction } from '$lib/themes/presentation'
  let { node, model, actions = {}, eager = false, titleHeading = false }: { node: ThemeNode; model: DisplayModel; actions?: Partial<Record<ThemeAction, () => void>>; eager?: boolean; titleHeading?: boolean } = $props()
  const labels: Record<ThemeAction, string> = { play: 'Watch', details: 'Details', favorite: 'Favorite', previous: 'Previous slide', next: 'Next slide' }
</script>

{#snippet renderNode(item: ThemeNode)}
  {#if visibleNode(item, model)}
    {#if item.type === 'text'}
      <svelte:element this={titleHeading && item.field === 'title' ? 'h1' : 'span'} style={nodeStyle(item)} class="theme-text">{item.field ? displayText(item.field, model) : item.text ?? ''}</svelte:element>
    {:else if item.type === 'artwork'}
      {#if model[item.artwork ?? 'poster']}<img src={String(model[item.artwork ?? 'poster'])} alt="" draggable="false" loading={eager ? 'eager' : 'lazy'} decoding="async" style={nodeStyle(item)} />{/if}
    {:else if item.type === 'action'}
      {#if item.action && actions[item.action]}<button type="button" data-focusable class="theme-action" style={nodeStyle(item)} onclick={actions[item.action]}>{item.text || labels[item.action]}</button>{/if}
    {:else}
      <div style={nodeStyle(item)} class:theme-overlay={item.type === 'overlay'}>
        {#each item.children ?? [] as child}{@render renderNode(child)}{/each}
      </div>
    {/if}
  {/if}
{/snippet}
<div class="theme-template">{@render renderNode(node)}</div>

<style>
  .theme-template { position: relative; isolation: isolate; overflow: hidden; min-width: 0; }
  .theme-overlay > :global(*) { grid-area: 1 / 1; }
  .theme-text { display: block; overflow-wrap: anywhere; white-space: pre-line; }
  .theme-action { min-height: 44px; min-width: 44px; padding: 10px 18px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-radius: var(--radius); font-weight: 800; }
  .theme-action:focus-visible { outline: 3px solid hsl(var(--ring)); outline-offset: 3px; }
  .theme-action:hover { filter: brightness(1.12); }
</style>
