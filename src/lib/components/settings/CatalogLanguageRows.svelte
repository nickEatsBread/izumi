<script lang="ts">
  import LanguageOrderRow from './LanguageOrderRow.svelte'
  import SettingsChoiceRow from './SettingsChoiceRow.svelte'
  import SettingsRow from './SettingsRow.svelte'
  import SettingsSwitch from './SettingsSwitch.svelte'
  import { extensionServiceSettings, type ServiceSettingsDocument, type ServiceSettingValue } from '$lib/extensions/manager'
  import { languageSectionFields, saveSourceLanguageSection } from '$lib/extensions/source-languages'
  import {
    catalogLanguages, languagesFor, sourceAccountLanguages, SUBTITLES_OFF,
    type LanguageCatalog, type LanguageKind,
  } from '$lib/settings/catalog-languages'
  import { preferredAudioLang, preferredSubLang } from '$lib/settings/ui'
  import { playbackLanguageName } from '$lib/shared/languages'

  // One catalog's languages. A source whose settings carry a Language section shows that section,
  // saved to its account; every other catalog keeps its own order here.
  let { catalog, name }: { catalog: LanguageCatalog; name: string } = $props()

  const packageId = $derived(catalog.startsWith('source:') ? catalog.slice('source:'.length) : undefined)
  let document = $state<ServiceSettingsDocument | null>(null)
  // A source's own section replaces izumi's rows, so neither shows until its settings have answered.
  let settled = $state(false)
  let saving = $state('')
  let error = $state('')

  $effect(() => {
    const id = packageId
    document = null
    settled = !id
    if (!id) return
    let live = true
    extensionServiceSettings(id)
      .then((next) => { if (live) document = next }, () => {})
      .finally(() => { if (live) settled = true })
    return () => { live = false }
  })

  const sectionFields = $derived(document ? languageSectionFields(document) : [])
  // Read every store the order depends on, so the summary follows a change made anywhere.
  const effective = $derived.by(() => {
    void $catalogLanguages; void $sourceAccountLanguages; void $preferredAudioLang; void $preferredSubLang
    return languagesFor(catalog)
  })
  const summary = (order: string[]) =>
    order.map((tag) => (tag === SUBTITLES_OFF ? 'Off' : playbackLanguageName(tag))).join(', then ')

  function setOrder(kind: LanguageKind, order: string[]) {
    catalogLanguages.update((all) => ({ ...all, [catalog]: { ...all[catalog], [kind]: order } }))
  }

  async function save(key: string, value: ServiceSettingValue) {
    if (!packageId || !document || saving) return
    saving = key
    error = ''
    try {
      document = await saveSourceLanguageSection(packageId, document, key, value)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      saving = ''
    }
  }
</script>

{#if !settled}
  <SettingsRow title={name} description="Reading this source's languages…" />
{:else if document && sectionFields.length}
  {#each sectionFields as field (field.key)}
    {#if field.type === 'select'}
      <SettingsChoiceRow
        title={`${name} · ${field.label}`}
        description={saving === field.key ? 'Saving to your account…' : field.description ?? `Saved to your ${name} account`}
        value={String(document.values[field.key] ?? '')}
        options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => save(field.key, value)}
        searchable={(field.options?.length ?? 0) > 8}
      />
    {:else if field.type === 'boolean'}
      {@const on = document.values[field.key] === true}
      <SettingsRow
        title={`${name} · ${field.label}`}
        description={field.description}
        onActivate={() => save(field.key, !on)}
        pressed={on}
      >
        {#snippet control()}
          <SettingsSwitch value={on} onToggle={() => save(field.key, !on)} label={field.label} interactive={false} />
        {/snippet}
      </SettingsRow>
    {/if}
  {/each}
  {#if error}<p role="alert" class="px-4 py-2 text-xs font-bold text-destructive">{error}</p>{/if}
{:else}
  <LanguageOrderRow
    title={`${name} audio`}
    description={`Plays ${summary(effective.audio)}`}
    settingKey={`catalog-languages-${catalog}-audio`}
    order={$catalogLanguages[catalog]?.audio ?? []}
    onChange={(order) => setOrder('audio', order)}
    unsetLabel="Same as default"
  />
  <LanguageOrderRow
    title={`${name} subtitles`}
    description={effective.subtitle[0] === SUBTITLES_OFF ? 'Subtitles off' : `Shows ${summary(effective.subtitle)}`}
    settingKey={`catalog-languages-${catalog}-subtitle`}
    order={$catalogLanguages[catalog]?.subtitle ?? []}
    onChange={(order) => setOrder('subtitle', order)}
    unsetLabel="Same as default"
    allowOff
  />
{/if}
