<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import Cloud from '@lucide/svelte/icons/cloud'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Share2 from '@lucide/svelte/icons/share-2'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { providerList, accountInfo } from '$lib/stremio/debrid'
  import { providerIcon } from '$lib/stremio/debrid/icons'
  import { debridKey, debridProvider, torrentPlaybackMode } from '$lib/settings/ui'

  /** How a torrent becomes a playable stream. `checking` is true while a debrid key is being
   *  verified; the sources screen folds it into the footer's busy state. */
  let { checking = $bindable(false) }: { checking?: boolean } = $props()

  let showKey = $state(false)
  let keyState = $state<'idle' | 'valid' | 'invalid'>('idle')
  let keyMessage = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Deliberately not $state: it orders overlapping checks, it is never rendered. */
  let generation = 0
  onDestroy(() => clearTimeout(timer))
  // Debrid without a key cannot play anything, so peer-to-peer is the working default. Someone who
  // already saved a debrid key keeps their choice.
  onMount(() => {
    if (!$debridKey.trim()) $torrentPlaybackMode = 'direct'
  })

  const providerOptions = providerList.map((provider) => ({ value: provider.id, label: provider.name, icon: providerIcon(provider.id) }))
  const debrid = $derived($torrentPlaybackMode === 'debrid')

  /** Catch a mistyped key here rather than at the first play. A network failure is a warning, not
   * a block: the key is already saved either way. The key goes nowhere but this call. */
  async function validate() {
    const key = $debridKey.trim()
    if (!key) {
      generation += 1
      checking = false
      keyState = 'idle'
      keyMessage = ''
      return
    }
    // Two checks can overlap when a slow one is still in flight as the key is edited again. Only
    // the newest may write the verdict, or a stale answer lands on top of a fresher one.
    const attempt = ++generation
    checking = true
    try {
      await accountInfo($debridProvider, key)
      if (attempt !== generation) return
      keyState = 'valid'
      keyMessage = ''
    } catch (cause) {
      if (attempt !== generation) return
      keyState = 'invalid'
      keyMessage = cause instanceof Error ? cause.message : m.onboarding_playback_key_invalid()
    } finally {
      if (attempt === generation) checking = false
    }
  }

  /** Always debounced, blur included: blur lands on mousedown, so checking there and then would
   * flip `checking` — and disable the footer button being clicked — before the click arrived. */
  function scheduleValidate() {
    keyState = 'idle'
    keyMessage = ''
    clearTimeout(timer)
    timer = setTimeout(() => void validate(), 700)
  }

  /** Peer-to-peer needs no key, so a pending or in-flight key check must not keep holding Next. */
  function chooseDirect() {
    clearTimeout(timer)
    generation += 1
    checking = false
    $torrentPlaybackMode = 'direct'
  }
</script>

<h2 id="setup-playback-title" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_playback_choice_title()}</h2>
<!-- A segmented control rather than two cards: it is one either-or setting, not two features. -->
<div role="group" aria-labelledby="setup-playback-title" class="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
  <button type="button" data-focusable onclick={chooseDirect} aria-pressed={!debrid} class="flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors {!debrid ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}"><Share2 size={16} class="shrink-0" /><span class="truncate">{m.onboarding_playback_p2p()}</span></button>
  <button type="button" data-focusable onclick={() => $torrentPlaybackMode = 'debrid'} aria-pressed={debrid} class="flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors {debrid ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}"><Cloud size={16} class="shrink-0" /><span class="truncate">{m.onboarding_playback_debrid()}</span></button>
</div>
<p class="mt-2 text-xs leading-relaxed text-muted-foreground">{debrid ? m.onboarding_playback_debrid_body() : m.onboarding_playback_p2p_body()}</p>

{#if debrid}
  <!-- A verdict belongs to the provider it was fetched from, so re-check instead of leaving a
       stale tick behind when the provider changes. -->
  <div class="mt-4 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
    <SelectMenu value={$debridProvider} onChange={(provider) => { $debridProvider = provider; scheduleValidate() }} ariaLabel={m.onboarding_playback_provider()} options={providerOptions} />
    <div class="relative">
      <input id="setup-debrid-key" data-focusable bind:value={$debridKey} oninput={scheduleValidate} onblur={scheduleValidate} type={showKey ? 'text' : 'password'} aria-label={m.onboarding_playback_key_label()} placeholder={m.onboarding_playback_key_label()} autocomplete="off" spellcheck="false" class="setup-field !min-h-10 py-2 pr-11 font-mono text-sm placeholder:font-sans" />
      <button type="button" data-focusable onclick={() => showKey = !showKey} aria-label={showKey ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-0.5 top-0.5 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showKey}<EyeOff size={16} />{:else}<Eye size={16} />{/if}</button>
    </div>
  </div>
  <p role="status" aria-live="polite" class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
    {#if checking}<LoaderCircle size={14} class="tile-spinner" />{m.onboarding_playback_key_checking()}
    {:else if keyState === 'valid'}<Check size={14} />{m.onboarding_playback_key_valid()}
    {:else if keyState === 'invalid'}{keyMessage || m.onboarding_playback_key_invalid()}
    {:else}{m.onboarding_playback_key_hint()}{/if}
  </p>
{/if}
