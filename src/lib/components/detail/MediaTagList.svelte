<script lang="ts">
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import { detailTags, isSpoilerTag } from '$lib/anilist/detail-tags'
  import type { MediaTag } from '$lib/anilist/types'

  let {
    tags,
    limit = 18,
    sortByRank = false,
    showRank = false,
  }: {
    tags: MediaTag[]
    limit?: number
    sortByRank?: boolean
    showRank?: boolean
  } = $props()

  let revealed = $state<Set<string>>(new Set())
  const displayed = $derived(detailTags(tags, limit, sortByRank))
  // A detail route can replace its media without remounting this child. Never carry a reveal from
  // one title to another just because both titles happen to use the same spoiler-tag name.
  $effect(() => {
    void tags
    revealed = new Set()
  })

  function toggle(name: string) {
    const next = new Set(revealed)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    revealed = next
  }
</script>

<div class="flex flex-wrap gap-2">
  {#each displayed as tag (tag.name)}
    {#if isSpoilerTag(tag)}
      <button
        type="button"
        data-focusable
        aria-label={revealed.has(tag.name) ? `Hide spoiler tag ${tag.name}` : 'Reveal spoiler tag'}
        aria-pressed={revealed.has(tag.name)}
        onclick={() => toggle(tag.name)}
        class="group relative inline-flex min-h-7 items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent active:bg-accent {revealed.has(tag.name) ? 'border-transparent bg-secondary/55 text-foreground/80' : 'border-border/70 bg-secondary/45 text-muted-foreground'}"
      >
        {#if revealed.has(tag.name)}
          {tag.name}{showRank && tag.rank ? ` · ${tag.rank}%` : ''}
        {:else}
          <!-- Keep the real label under the same soft 6px veil used for larger spoiler content.
               A tiny checker pattern gives short tag names enough texture to read as intentionally
               obscured rather than disabled, without exposing the letters underneath. -->
          <span
            aria-hidden="true"
            class="spoiler-pixels pointer-events-none absolute inset-0 rounded-full opacity-60 transition-opacity duration-150 group-hover:opacity-15 group-focus-visible:opacity-15"
          ></span>
          <span
            aria-hidden="true"
            class="pointer-events-none select-none whitespace-nowrap blur-[6px] opacity-75 transition-opacity duration-150 group-hover:opacity-15 group-focus-visible:opacity-15"
          >
            {tag.name}{showRank && tag.rank ? ` · ${tag.rank}%` : ''}
          </span>
          <span
            aria-hidden="true"
            class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[0.65rem] font-bold text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <EyeOff size={13} /> Spoiler tag · reveal
          </span>
        {/if}
      </button>
    {:else}
      <span class="rounded-full bg-secondary/55 px-3 py-1.5 text-xs font-semibold text-foreground/80">
        {tag.name}{showRank && tag.rank ? ` · ${tag.rank}%` : ''}
      </span>
    {/if}
  {/each}
</div>

<style>
  .spoiler-pixels {
    background-image:
      linear-gradient(90deg, hsl(var(--muted-foreground) / 0.16) 50%, transparent 50%),
      linear-gradient(hsl(var(--muted-foreground) / 0.12) 50%, transparent 50%);
    background-size: 5px 5px;
  }
</style>
