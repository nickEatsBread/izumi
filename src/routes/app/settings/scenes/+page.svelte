<script lang="ts">
  import { playEpisode, type PlayState } from '$lib/stremio/play'
  import { mediaHref } from '$lib/anilist/media'
  import {
    clearSceneBookmarks,
    removeSceneBookmark,
    sceneBookmarks,
    updateSceneBookmark,
    type SceneBookmark,
  } from '$lib/player/scene-bookmarks'
  import Bookmark from '@lucide/svelte/icons/bookmark'
  import Play from '@lucide/svelte/icons/play'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import X from '@lucide/svelte/icons/x'

  let confirmClear = $state(false)
  let message = $state('')
  let activeId = $state('')

  const time = (seconds: number) => {
    const value = Math.max(0, Math.floor(seconds || 0))
    const hours = Math.floor(value / 3600)
    const minutes = Math.floor((value % 3600) / 60)
    const rest = value % 60
    return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${String(rest).padStart(2, '0')}`
  }
  const date = (value: number) => new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const title = (scene: SceneBookmark) => scene.media.title?.userPreferred
    || scene.media.title?.english
    || scene.media.title?.romaji
    || 'Untitled'
  const art = (scene: SceneBookmark) => scene.media.coverImage?.extraLarge
    || scene.media.coverImage?.large
    || scene.media.coverImage?.medium

  function resume(scene: SceneBookmark) {
    activeId = scene.id
    message = ''
    void playEpisode(scene.media, scene.episode, (state: PlayState) => {
      if (state.status === 'error') message = state.message || 'Could not resume this scene.'
      if (state.status !== 'resolving') activeId = ''
    }, { startSeconds: scene.position, autoplay: true })
  }

  function clearAll() {
    if (!confirmClear) {
      confirmClear = true
      setTimeout(() => (confirmClear = false), 4000)
      return
    }
    clearSceneBookmarks()
    confirmClear = false
    message = 'Scene bookmarks cleared.'
  }
</script>

<div class="p-4 sm:p-8">
  <div class="mb-5 flex max-w-4xl items-start justify-between gap-4">
    <div>
      <h2 class="mb-1 text-xl font-black">Scene bookmarks</h2>
      <p class="max-w-2xl text-sm text-muted-foreground">
        Keep an exact moment, its subtitle line, and your own note. Resuming resolves a fresh source
        and starts at the saved timestamp.
      </p>
    </div>
    {#if $sceneBookmarks.length}
      <button data-focusable onclick={clearAll}
        class="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors {confirmClear ? 'bg-destructive text-white' : 'text-destructive hover:bg-destructive/10'}">
        <Trash2 size={14} /> {confirmClear ? 'Confirm clear' : 'Clear all'}
      </button>
    {/if}
  </div>

  {#if message}<p role="status" class="mb-4 max-w-4xl rounded-lg bg-secondary px-3 py-2 text-sm text-theme">{message}</p>{/if}

  {#if !$sceneBookmarks.length}
    <div class="grid max-w-2xl place-items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span class="mb-3 grid size-12 place-items-center rounded-full bg-theme/10 text-theme"><Bookmark size={23} /></span>
      <h3 class="font-black">No scenes saved yet</h3>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">Use the bookmark button or the “Save scene bookmark” player shortcut while an episode is playing.</p>
    </div>
  {:else}
    <ul class="grid max-w-5xl gap-3 lg:grid-cols-2">
      {#each $sceneBookmarks as scene (scene.id)}
        <li class="flex min-w-0 gap-3 rounded-2xl border border-border bg-secondary/20 p-3">
          {#if art(scene)}
            <img src={art(scene)} alt="" loading="lazy" decoding="async" class="h-32 w-24 shrink-0 rounded-xl object-cover" />
          {:else}
            <span class="grid h-32 w-24 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground"><Bookmark size={22} /></span>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <a href={mediaHref(scene.media)} data-focusable class="block truncate font-black hover:text-theme">{title(scene)}</a>
                <p class="text-xs text-muted-foreground">
                  {scene.episode != null ? `Episode ${scene.episode} · ` : ''}{time(scene.position)} · {date(scene.createdAt)}
                </p>
              </div>
              <button data-focusable onclick={() => removeSceneBookmark(scene.id)} aria-label="Remove scene bookmark" title="Remove"
                class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive">
                <X size={15} />
              </button>
            </div>

            {#if scene.quote}
              <blockquote class="mt-2 line-clamp-2 border-l-2 border-theme/50 pl-2 text-xs italic text-foreground/80">“{scene.quote}”</blockquote>
            {/if}

            <input
              value={scene.note}
              maxlength="2000"
              placeholder="Add a note…"
              aria-label={`Note for ${title(scene)} at ${time(scene.position)}`}
              onchange={(event) => updateSceneBookmark(scene.id, { note: event.currentTarget.value })}
              class="mt-2 w-full rounded-lg bg-input px-2.5 py-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-theme"
            />
            <button data-focusable onclick={() => resume(scene)} disabled={activeId === scene.id}
              class="mt-2 flex items-center gap-1.5 rounded-lg bg-theme px-3 py-2 text-xs font-black text-white disabled:opacity-50">
              <Play size={14} fill="currentColor" /> {activeId === scene.id ? 'Resolving…' : `Resume at ${time(scene.position)}`}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
