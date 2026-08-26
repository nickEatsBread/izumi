<script lang="ts">
  import type { Component, Snippet } from 'svelte'

  let {
    title,
    desc,
    icon: Icon,
    children,
    className = '',
  }: {
    title: string
    desc?: string
    icon?: Component
    children: Snippet
    className?: string
  } = $props()
</script>

<section class="mb-5 max-w-2xl {className}">
  <div class="mb-1.5 flex items-start gap-2 px-1">
    {#if Icon}<Icon size={15} class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />{/if}
    <div class="min-w-0">
      <h3 class="text-sm font-black leading-5">{title}</h3>
      {#if desc}<p class="text-[11px] leading-4 text-muted-foreground">{desc}</p>{/if}
    </div>
  </div>
  <!-- Keep overflow visible: rows can own dropdowns that need to escape the rounded group edge. -->
  <div class="relative divide-y divide-border/70 rounded-xl border border-border bg-card/25 [&>*:first-child]:rounded-t-[calc(0.75rem-1px)] [&>*:last-child]:rounded-b-[calc(0.75rem-1px)]">
    {@render children()}
  </div>
</section>
