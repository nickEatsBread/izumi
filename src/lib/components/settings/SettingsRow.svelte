<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as h from '$lib/haptics'
  import { ripple } from '$lib/actions/ripple'

  let {
    title,
    description,
    leading,
    meta,
    control,
    children,
    settingKey,
    expanded = true,
    controlLayout = 'inline',
    size = 'default',
    onActivate,
    pressed,
  }: {
    title: string
    description?: string
    leading?: Snippet
    meta?: Snippet
    control?: Snippet
    children?: Snippet
    settingKey?: string
    expanded?: boolean
    controlLayout?: 'inline' | 'stack'
    size?: 'default' | 'lg'
    onActivate?: () => void
    pressed?: boolean
  } = $props()
  const large = $derived(size === 'lg')
</script>

{#snippet header()}
  <div class="flex gap-3 {large ? 'min-h-12' : 'min-h-9'} {controlLayout === 'stack' ? 'flex-col items-stretch sm:flex-row sm:items-center' : 'items-center'}">
    {#if leading}<span class="shrink-0">{@render leading()}</span>{/if}
    <div class="min-w-0 flex-1">
      <div class="font-bold leading-5 {large ? 'text-base' : 'text-sm'}">{title}</div>
      {#if meta}
        <div class="mt-0.5 leading-4 text-muted-foreground {large ? 'text-xs' : 'text-[11px]'}">{@render meta()}</div>
      {:else if description}
        <p class="mt-0.5 leading-4 text-muted-foreground {large ? 'text-xs' : 'text-[11px]'}">{description}</p>
      {/if}
    </div>
    {#if control}
      <div class="flex items-center gap-1.5 {controlLayout === 'stack' ? 'w-full justify-end sm:w-auto sm:shrink-0' : 'shrink-0'}">
        {@render control()}
      </div>
    {/if}
  </div>
{/snippet}

{#if onActivate}
  <div data-setting-key={settingKey}>
    <button
      type="button"
      data-focusable
      use:ripple
      aria-pressed={pressed}
      aria-expanded={children ? expanded : undefined}
      onclick={() => { h.tap(); onActivate() }}
      class="ripple-host block w-full text-left transition-colors active:bg-secondary sm:hover:bg-secondary/70
        {large ? 'px-3.5 py-3.5' : 'px-3 py-2.5'}
        {children && expanded ? 'rounded-t-[inherit]' : 'rounded-[inherit]'}"
    >
      {@render header()}
    </button>
    {#if children && expanded}
      <div class="mx-3 mb-2.5 border-t border-border/70 pt-3">{@render children()}</div>
    {/if}
  </div>
{:else}
  <div data-setting-key={settingKey} class="{large ? 'px-3.5 py-3.5' : 'px-3 py-2.5'}">
    {@render header()}
    {#if children && expanded}
      <div class="mt-2.5 border-t border-border/70 pt-3">{@render children()}</div>
    {/if}
  </div>
{/if}
