<script lang="ts">
  import {
    preferredAudioLang, preferredSubLang, titleLanguage, providerAudio, providerLanguages, downloadAudio,
    extensionUrls, disabledPlugins,
  } from '$lib/settings/ui'
  import { fetchExtensionInfo, installedExtensionPackages } from '$lib/extensions/manager'
  import { langName } from '$lib/player/track-label'
  import { SOURCE_LANGUAGES } from '$lib/stremio/sublang'
  import { storedOrder, type LanguageCatalog } from '$lib/settings/catalog-languages'
  import { catalogProviders } from '$lib/settings/catalog'
  import { sourceCatalogs, sourceSelection } from '$lib/catalog/source-catalogs'
  import LanguageOrderRow from '$lib/components/settings/LanguageOrderRow.svelte'
  import CatalogLanguageRows from '$lib/components/settings/CatalogLanguageRows.svelte'
  import MultiSelect from '$lib/components/search/MultiSelect.svelte'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime.js'

  const locale = getLocale()
  const changeLocale = (value: string) => setLocale(value as Locale)

  // The global rows store an order as comma-separated codes; empty is Automatic.
  const joined = (order: string[]) => (order.length ? order.join(',') : 'auto')
  // Each catalog the user can play from: the anime catalog behind any anime platform, TMDB and
  // Stremio when enabled, and every source catalog.
  const languageCatalogs = $derived<Array<{ catalog: LanguageCatalog; name: string }>>([
    ...($catalogProviders.some((provider) => ['auto', 'anilist', 'kitsu', 'jvm'].includes(provider)) ? [{ catalog: 'anime' as const, name: 'Anime' }] : []),
    ...($catalogProviders.includes('tmdb') ? [{ catalog: 'tmdb' as const, name: 'TMDB' }] : []),
    ...($catalogProviders.includes('stremio') ? [{ catalog: 'stremio' as const, name: 'Stremio add-ons' }] : []),
    ...$sourceCatalogs.filter((source) => !$disabledPlugins.includes(source.packageId))
      .map((source) => ({ catalog: sourceSelection(source.packageId), name: source.name })),
  ])

  const langLabel = (code: string) => langName(code) ?? code.toUpperCase()
  // Languages the added sources declare sort first. They never limit the list: a source may declare
  // none, and a language can be picked before adding a source that serves it.
  let declaredLangs = $state<string[]>([])
  $effect(() => {
    let stale = false
    void Promise.all([
      installedExtensionPackages(),
      ...$extensionUrls.map((url) => fetchExtensionInfo(url).catch(() => null)),
    ]).then(([installed, ...infos]) => {
      if (stale) return
      declaredLangs = [...new Set([
        ...infos.flatMap((info) => info?.configs ?? []).map((config) => config.lang),
        ...installed.map((extension) => extension.lang),
      ].filter((lang): lang is string => !!lang))]
    })
    return () => { stale = true }
  })
  const langOptions = $derived([...SOURCE_LANGUAGES].sort((a, b) =>
    Number(!declaredLangs.includes(a)) - Number(!declaredLangs.includes(b)) || langLabel(a).localeCompare(langLabel(b))))
  // Empty = every language, matching the resolver's "no allowlist means all" rule.
  const allLangs = $derived($providerLanguages.length === 0)
</script>

<SettingsSection section="languages">
  <SettingsSubcategory id="app">
    <SettingsChoiceRow settingKey="app-language" title={m.settings_language()} description={m.settings_language_hint()} value={locale} onChange={changeLocale} options={[
      { value: 'en', label: m.language_english() }, { value: 'ja', label: m.language_japanese() },
    ]} />
    <SettingsChoiceRow settingKey="title-language" title="Title language" description="Romaji or English titles, falling back when a title has only one." value={$titleLanguage} onChange={(value) => ($titleLanguage = value as typeof $titleLanguage)} options={[
      { value: 'romaji', label: 'Romaji' },
      { value: 'english', label: 'English' },
    ]} />
  </SettingsSubcategory>

  <SettingsSubcategory id="playback">
    <LanguageOrderRow settingKey="audio-language" title={m.player_audio_language()} description="For every catalog without its own order" order={storedOrder($preferredAudioLang) ?? []} onChange={(order) => ($preferredAudioLang = joined(order))} unsetLabel="Automatic" />
    <LanguageOrderRow settingKey="subtitle-language" title={m.player_subtitle_language()} description="Automatic: English for anime, your system language elsewhere" order={storedOrder($preferredSubLang) ?? []} onChange={(order) => ($preferredSubLang = joined(order))} unsetLabel="Automatic" allowOff />
  </SettingsSubcategory>

  <SettingsSubcategory id="catalogs">
    {#each languageCatalogs as entry (entry.catalog)}
      <CatalogLanguageRows catalog={entry.catalog} name={entry.name} />
    {/each}
  </SettingsSubcategory>

  <SettingsSubcategory id="sources">
    <SettingsChoiceRow
      settingKey="sub-or-dub-results"
      title="Sub or dub results"
      description={$providerAudio === 'both' ? 'Both are offered when a source carries them, each labelled SUB or DUB.' : `Only ${$providerAudio === 'dub' ? 'dubbed' : 'subbed'} results are requested from community sources.`}
      learnMore="Limits the audio variants requested from community sources. With one variant chosen, sources that carry nothing else are skipped entirely, which also makes the search faster."
      value={$providerAudio}
      onChange={(value) => ($providerAudio = value as typeof $providerAudio)}
      options={[
        { value: 'both', label: 'Subbed and dubbed' },
        { value: 'sub', label: 'Subbed only' },
        { value: 'dub', label: 'Dubbed only' },
      ]}
    />
    <SettingsRow
      settingKey="source-languages"
      title="Source languages"
      description={allLangs ? 'Every language is searched.' : `Only ${$providerLanguages.map(langLabel).join(', ')} ${$providerLanguages.length === 1 ? 'is' : 'are'} searched.`}
      learnMore="Pick one or more to narrow the search: sources serving other languages are then not queried at all, which also speeds up the source list. Sources that don't declare a language are always included."
      controlLayout="stack"
    >
      {#snippet control()}
        {#if !allLangs}
          <button type="button" data-focusable onclick={() => ($providerLanguages = [])} class="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-accent">Clear (all languages)</button>
        {/if}
        <MultiSelect label="Languages" options={langOptions} selected={$providerLanguages} labelOf={langLabel} onchange={(value) => ($providerLanguages = value)} />
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>

  <SettingsSubcategory id="downloads">
    <SettingsChoiceRow settingKey="download-audio" title="Download audio" description="Used by manual and automatic downloads." learnMore="Falls back to the best available match when no exact match exists." value={$downloadAudio} onChange={(value) => ($downloadAudio = value as typeof $downloadAudio)} options={[
      { value: 'sub', label: 'Sub' }, { value: 'dub', label: 'Dub' }, { value: 'any', label: 'Any' },
    ]} />
  </SettingsSubcategory>
</SettingsSection>
