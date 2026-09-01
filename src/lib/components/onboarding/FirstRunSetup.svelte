<script lang="ts">
  import { goto } from '$app/navigation'
  import Check from '@lucide/svelte/icons/check'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import { addonUrls } from '$lib/stremio/sources'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { fetchExtensionInfo } from '$lib/extensions/manager'
  import { debridKey, extensionUrls, preferredAudioLang, preferredSubLang } from '$lib/settings/ui'
  import { anilistToken, kitsuToken, malToken, simklToken } from '$lib/trackers/config'
  import { finishOnboarding, onboardingComplete } from '$lib/settings/onboarding'
  import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime.js'
  import { m } from '$lib/paraglide/messages.js'

  let step = $state(0)
  let locale = $state(getLocale())
  let sourceHealth = $state<'empty' | 'checking' | 'ready' | 'error'>('empty')
  const sourceConfigured = $derived($addonUrls.length > 0 || $extensionUrls.length > 0)
  const trackerReady = $derived(Boolean($anilistToken || $malToken || $kitsuToken || $simklToken))
  const debridReady = $derived(Boolean($debridKey))

  function done() { finishOnboarding() }
  function changeLocale(next: Locale) {
    locale = next
    setLocale(next)
  }
  async function checkSources(addons: string[], extensions: string[]) {
    if (!addons.length && !extensions.length) { sourceHealth = 'empty'; return }
    sourceHealth = 'checking'
    const checks = await Promise.all([
      ...addons.map(async (url) => Boolean(await fetchManifest(url))),
      ...extensions.map(async (url) => {
        const info = await fetchExtensionInfo(url)
        return info.configs.length > 0 || Boolean(info.packages?.length)
      }),
    ])
    sourceHealth = checks.some(Boolean) ? 'ready' : 'error'
  }
  $effect(() => {
    if (step === 2) void checkSources([...$addonUrls], [...$extensionUrls])
  })
  async function openSettings(path: string) {
    finishOnboarding()
    await goto(path)
  }
</script>

{#if !$onboardingComplete}
  <div role="dialog" aria-modal="true" aria-labelledby="setup-title" class="fixed inset-0 z-[90] grid place-items-end bg-black/75 sm:place-items-center sm:p-6">
    <div class="w-full max-w-xl rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-3xl sm:p-7">
      <div class="mb-6 flex gap-2" aria-label={`Step ${step + 1} of 3`}>
        {#each [0, 1, 2] as item}
          <span class="h-1.5 flex-1 rounded-full {item <= step ? 'bg-theme' : 'bg-muted'}"></span>
        {/each}
      </div>

      {#if step === 0}
        <p class="text-xs font-black uppercase tracking-[0.18em] text-theme">Izumi</p>
        <h1 id="setup-title" class="mt-1 text-2xl font-black">{m.onboarding_welcome_title()}</h1>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_welcome_body()}</p>
        <div class="mt-6 grid grid-cols-2 gap-2">
          <button data-focusable onclick={() => changeLocale('en')} aria-pressed={locale === 'en'} class="rounded-xl border p-3 text-left font-bold {locale === 'en' ? 'border-theme bg-theme/10' : 'border-border'}">English</button>
          <button data-focusable onclick={() => changeLocale('ja')} aria-pressed={locale === 'ja'} class="rounded-xl border p-3 text-left font-bold {locale === 'ja' ? 'border-theme bg-theme/10' : 'border-border'}">日本語</button>
        </div>
      {:else if step === 1}
        <h1 id="setup-title" class="text-2xl font-black">{m.onboarding_preferences_title()}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{m.onboarding_preferences_body()}</p>
        <div class="mt-6 grid gap-4 sm:grid-cols-2">
          <label class="grid gap-2 text-sm font-bold">
            {m.player_audio_language()}
            <select data-focusable bind:value={$preferredAudioLang} class="h-11 rounded-xl bg-input px-3 font-semibold">
              <option value="jpn">Japanese</option><option value="eng">English</option>
            </select>
          </label>
          <label class="grid gap-2 text-sm font-bold">
            {m.player_subtitle_language()}
            <select data-focusable bind:value={$preferredSubLang} class="h-11 rounded-xl bg-input px-3 font-semibold">
              <option value="eng">English</option><option value="jpn">日本語</option><option value="none">{m.cast_subtitles_off()}</option>
            </select>
          </label>
        </div>
      {:else}
        <h1 id="setup-title" class="text-2xl font-black">{m.onboarding_connections_title()}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{m.onboarding_connections_body()}</p>
        <div class="mt-5 space-y-2">
          <div class="flex items-center gap-3 rounded-xl border border-border p-3">
            <span class="grid size-8 place-items-center rounded-full {sourceHealth === 'ready' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}"><Check size={17} /></span>
            <span class="min-w-0 flex-1"><span class="block font-bold">{m.onboarding_sources()}</span><span class="block text-xs text-muted-foreground">{sourceHealth === 'checking' ? m.onboarding_checking() : sourceHealth === 'ready' ? m.onboarding_ready() : sourceHealth === 'error' ? m.onboarding_source_unavailable() : m.onboarding_needs_source()}</span></span>
            {#if !sourceConfigured || sourceHealth === 'error'}<button data-focusable onclick={() => openSettings('/app/settings/sources')} class="rounded-lg bg-secondary px-3 py-2 text-xs font-bold">{m.onboarding_open_sources()}</button>{/if}
          </div>
          {#each [[m.onboarding_tracker(), trackerReady], [m.onboarding_debrid(), debridReady]] as item}
            <div class="flex items-center gap-3 rounded-xl border border-border p-3">
              <span class="grid size-8 place-items-center rounded-full {item[1] ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'}"><Check size={17} /></span>
              <span class="min-w-0 flex-1"><span class="block font-bold">{item[0]}</span><span class="block text-xs text-muted-foreground">{item[1] ? m.onboarding_ready() : m.onboarding_optional()}</span></span>
              {#if !item[1]}<button data-focusable onclick={() => openSettings('/app/settings/accounts')} class="rounded-lg bg-secondary px-3 py-2 text-xs font-bold">{m.onboarding_open_accounts()}</button>{/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-7 flex items-center gap-2">
        {#if step === 0}<button data-focusable onclick={done} class="mr-auto h-11 rounded-xl px-3 text-sm font-bold text-muted-foreground hover:bg-secondary">{m.onboarding_skip()}</button>
        {:else}<button data-focusable onclick={() => step--} class="mr-auto h-11 rounded-xl px-3 text-sm font-bold hover:bg-secondary"><ChevronLeft size={17} class="mr-1 inline" />{m.onboarding_back()}</button>{/if}
        {#if step < 2}<button data-focusable onclick={() => step++} class="h-11 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground">{m.onboarding_next()}<ChevronRight size={17} class="ml-1 inline" /></button>
        {:else}<button data-focusable onclick={done} class="h-11 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground">{m.onboarding_finish()}</button>{/if}
      </div>
    </div>
  </div>
{/if}
