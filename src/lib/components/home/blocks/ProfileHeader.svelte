<script lang="ts">
  import { anilistUser } from '$lib/anilist/account'
  import type { BlockDestination, ProfileHeaderBlock } from '$lib/home/blocks'
  import { loadAniListProfile, localProfile, profileButtonArt, type ProfileSummary } from '$lib/home/profile'
  import { localLibrary } from '$lib/library/local-lists'
  import { continueWatching } from '$lib/player/continue-watching'
  import { localHistory } from '$lib/player/history'
  import { HOME_META, NAV_META } from '$lib/settings/nav'
  import { anilistUserName } from '$lib/trackers/config'

  // The viewer's profile: tracker banner, avatar, name and watch stats, with shortcut buttons. Without
  // a tracker name it summarises this device's watch history instead.
  let { block }: { block: ProfileHeaderBlock } = $props()

  const userName = $derived($anilistUserName || $anilistUser)
  let remote = $state<ProfileSummary | null>(null)

  $effect(() => {
    const name = userName
    remote = null
    if (!name) return
    let cancelled = false
    loadAniListProfile(name).then((summary) => { if (!cancelled) remote = summary }).catch(() => {})
    return () => { cancelled = true }
  })

  const summary = $derived(remote ?? localProfile($localHistory))
  const initial = $derived(summary.name.trim().charAt(0).toUpperCase() || '?')
  const href = (to: BlockDestination) => (to === 'home' ? HOME_META.href : NAV_META[to].href)
  const plural = (n: number, noun: string) => `${noun}${n === 1 ? '' : 's'}`
  // Buttons with `art` take the viewer's titles in order (Continue Watching, then the library, newest
  // first). Only a block that asks for art reads those stores.
  const artSlots = $derived.by(() => {
    let next = 0
    return block.buttons.map((button) => (button.art ? next++ : -1))
  })
  const artCount = $derived(artSlots.filter((slot) => slot >= 0).length)
  const buttonArt = $derived(artCount ? profileButtonArt(
    $continueWatching.map((entry) => entry.media),
    Object.values($localLibrary.entries ?? {}).sort((a, b) => b.updatedAt - a.updatedAt || a.media.id - b.media.id).map((entry) => entry.media),
    artCount,
  ) : [])
</script>

<section data-block data-slot="block.profile-header" class="mb-8 px-4 sm:px-8">
  <div class="relative overflow-hidden rounded-2xl bg-card">
    {#if summary.banner}
      <img data-part="block.banner" src={summary.banner} alt="" loading="lazy" decoding="async" draggable="false" class="absolute inset-0 size-full object-cover" />
    {/if}
    <div data-part="block.scrim" class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10"></div>
    <div data-part="block.profile" class="relative flex items-end gap-4 px-5 pb-4 pt-20">
      {#if summary.avatar}
        <img data-part="block.avatar" src={summary.avatar} alt="" draggable="false" class="size-16 shrink-0 rounded-full border-2 border-white/80 object-cover" />
      {:else}
        <span data-part="block.avatar" aria-hidden="true" class="grid size-16 shrink-0 place-items-center rounded-full border-2 border-white/60 bg-white/10 text-2xl font-black text-white">{initial}</span>
      {/if}
      <div class="min-w-0 flex-1 text-white">
        <p data-part="block.name" class="truncate text-xl font-black">{summary.name}</p>
        <!-- Each stat is its own part so a theme can stack or reorder them; izumi keeps them on one
             line, the later stat's ::before drawing the dot between. -->
        <div class="text-sm text-white/80">{@render stat('episodes', summary.episodes, 'episode', 'inline')}{@render stat('titles', summary.titles, 'title', "inline before:content-['_·_']")}</div>
      </div>
    </div>
    {#if block.buttons.length}
      <div data-nav-row class="relative flex flex-wrap gap-2 px-5 pb-5">
        {#each block.buttons as button, index (button.to + button.label)}
          {@const art = artSlots[index] >= 0 ? buttonArt[artSlots[index]] : undefined}
          <a data-part="button" data-variant="secondary" data-dest={button.to} data-focusable href={href(button.to)}
            class="rounded-md bg-white/15 px-4 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/25 {art ? 'relative overflow-hidden' : ''}">{#if art}<img data-part="block.button.art" src={art} alt="" loading="lazy" decoding="async" draggable="false" class="absolute inset-0 size-full object-cover" /><span class="relative">{button.label}</span>{:else}{button.label}{/if}</a>
        {/each}
      </div>
    {/if}
  </div>
</section>

{#snippet stat(key: 'episodes' | 'titles', n: number, noun: string, classes: string)}
  <p data-part="block.stat" data-key={key} class={classes}><span data-part="block.stat.value">{n.toLocaleString()}</span> <span data-part="block.stat.label">{plural(n, noun)}</span></p>
{/snippet}
