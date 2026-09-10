<script lang="ts">
  import { onDestroy } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import Cloud from '@lucide/svelte/icons/cloud'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Share2 from '@lucide/svelte/icons/share-2'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { PLAYBACK_LANGUAGES } from '$lib/shared/languages'
  import { m } from '$lib/paraglide/messages.js'
  import { providerList, accountInfo } from '$lib/stremio/debrid'
  import { debridKey, debridProvider, torrentPlaybackMode, type AudioLang, type SubLang } from '$lib/settings/ui'

  let {
    audioLanguage = $bindable(),
    subtitleLanguage = $bindable(),
    busy = $bindable(),
  }: { audioLanguage: AudioLang; subtitleLanguage: SubLang; busy: boolean } = $props()

  let showKey = $state(false)
  let checking = $state(false)
  let keyState = $state<'idle' | 'valid' | 'invalid'>('idle')
  let keyMessage = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Deliberately not $state: it orders overlapping checks, it is never rendered. */
  let generation = 0
  onDestroy(() => clearTimeout(timer))

  const providerOptions = providerList.map((provider) => ({ value: provider.id, label: provider.name }))

  /** Catch a mistyped key here rather than at the first play. A network failure is a warning, not
   * a block: the key is already saved either way. The key goes nowhere but this call. */
  async function validate() {
    const key = $debridKey.trim()
    if (!key) {
      keyState = 'idle'
      keyMessage = ''
      return
    }
    // Two checks can overlap when a slow one is still in flight as the key is edited again. Only
    // the newest may write the verdict, or a stale answer lands on top of a fresher one.
    const attempt = ++generation
    checking = true
    busy = true
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
      if (attempt === generation) {
        checking = false
        busy = false
      }
    }
  }

  /** Always debounced, blur included: blur lands on mousedown, so checking there and then would
   * flip `busy` — and disable the footer button being clicked — before the click arrived. */
  function scheduleValidate() {
    keyState = 'idle'
    keyMessage = ''
    clearTimeout(timer)
    timer = setTimeout(() => void validate(), 700)
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_playback_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_playback_body()}</p>

<div class="mt-7 grid gap-3 sm:grid-cols-2">
  <button type="button" data-focusable onclick={() => $torrentPlaybackMode = 'debrid'} aria-pressed={$torrentPlaybackMode === 'debrid'} class="setup-choice p-5 text-left {$torrentPlaybackMode === 'debrid' ? 'selected' : ''}">
    <Cloud size={25} class="text-muted-foreground" />
    <span class="mt-5 block text-lg font-semibold">{m.onboarding_playback_debrid()}</span>
    <span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_playback_debrid_body()}</span>
  </button>
  <button type="button" data-focusable onclick={() => $torrentPlaybackMode = 'direct'} aria-pressed={$torrentPlaybackMode === 'direct'} class="setup-choice p-5 text-left {$torrentPlaybackMode === 'direct' ? 'selected' : ''}">
    <Share2 size={25} class="text-muted-foreground" />
    <span class="mt-5 block text-lg font-semibold">{m.onboarding_playback_p2p()}</span>
    <span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_playback_p2p_body()}</span>
  </button>
</div>

{#if $torrentPlaybackMode === 'debrid'}
  <div class="mt-5 grid gap-4">
    <!-- A verdict belongs to the provider it was fetched from, so re-check instead of leaving a
         stale tick behind when the provider changes. -->
    <label class="grid gap-2 text-sm font-semibold">{m.onboarding_playback_provider()}
      <SelectMenu value={$debridProvider} onChange={(provider) => { $debridProvider = provider; scheduleValidate() }} ariaLabel={m.onboarding_playback_provider()} options={providerOptions} /></label>
    <div>
      <label for="setup-debrid-key" class="text-sm font-semibold">{m.onboarding_playback_key_label()}</label>
      <div class="relative mt-2">
        <input id="setup-debrid-key" data-focusable bind:value={$debridKey} oninput={scheduleValidate} onblur={scheduleValidate} type={showKey ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="setup-field pr-12 font-mono text-sm" />
        <button type="button" data-focusable onclick={() => showKey = !showKey} aria-label={showKey ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showKey}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
      </div>
      <p role="status" aria-live="polite" class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {#if checking}<LoaderCircle size={14} class="tile-spinner" />{m.onboarding_playback_key_checking()}
        {:else if keyState === 'valid'}<Check size={14} />{m.onboarding_playback_key_valid()}
        {:else if keyState === 'invalid'}{keyMessage || m.onboarding_playback_key_invalid()}
        {:else}{m.onboarding_playback_key_hint()}{/if}
      </p>
    </div>
  </div>
{/if}

<h2 class="mt-9 text-base font-semibold">{m.onboarding_preferences_title()}</h2>
<div class="mt-4 grid gap-4 sm:grid-cols-2">
  <label class="grid gap-2 text-sm font-semibold">{m.player_audio_language()}<SelectMenu bind:value={audioLanguage} ariaLabel={m.player_audio_language()} searchable options={PLAYBACK_LANGUAGES} /></label>
  <label class="grid gap-2 text-sm font-semibold">{m.player_subtitle_language()}<SelectMenu bind:value={subtitleLanguage} ariaLabel={m.player_subtitle_language()} searchable options={[...PLAYBACK_LANGUAGES.slice(0, 2), { value: 'none', label: m.cast_subtitles_off() }, ...PLAYBACK_LANGUAGES.slice(2)]} /></label>
</div>
