<script lang="ts">
  // "Who's watching?": the source's own profiles as avatars, as its handheld app asks at launch. Opened
  // once a session on a source's screen when the account has more than one, and from the drawer.
  // Choosing one switches the source and goes Home, which reads that profile's rows.
  import { goto } from '$app/navigation'
  import { forgetSourceAddon, isSourceSelection, sourcePackageOf } from '$lib/catalog/source-catalogs'
  import { extensionServiceSettings, saveExtensionServiceSettings } from '$lib/extensions/manager'
  import { profileChoice, sourceProfiles, type SourceProfile, type SourceProfiles } from '$lib/extensions/source-profiles'
  import { focusOnMount } from '$lib/nav'
  import { catalogProvider } from '$lib/settings/catalog'
  import { heroMedia } from '$lib/stores/hero'
  import Spinner from '$lib/components/Spinner.svelte'

  heroMedia.set(null)
  let found = $state.raw<{ packageId: string; profiles: SourceProfiles } | null>(null)
  let error = $state('')
  let saving = $state('')
  $effect(() => {
    const selection = $catalogProvider
    error = ''
    if (!isSourceSelection(selection)) return
    const packageId = sourcePackageOf(selection)
    let live = true
    extensionServiceSettings(packageId)
      .then((document) => {
        if (!live) return
        const profiles = sourceProfiles(document)
        if (profiles) found = { packageId, profiles }
        else void goto('/app/home', { replaceState: true })
      })
      .catch((reason) => { if (live) error = reason instanceof Error ? reason.message : String(reason) })
    return () => { live = false }
  })

  async function choose(profile: SourceProfile) {
    if (!found || saving) return
    if (!profile.current) {
      saving = profile.id
      try {
        await saveExtensionServiceSettings(found.packageId, profileChoice(found.profiles.field, profile.id))
        // Home reads the source afresh for the new profile's rows.
        forgetSourceAddon(found.packageId)
        window.dispatchEvent(new Event('source-profile-changed'))
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason)
        saving = ''
        return
      }
    }
    void goto('/app/home', { replaceState: true })
  }
  const focusIf = (node: HTMLElement, on: boolean) => { if (on) focusOnMount(node) }
</script>

<div data-slot="source.profiles" class="grid min-h-screen place-items-center px-6 py-10">
  <div class="flex flex-col items-center">
    <h1 data-part="source.profiles.title" class="mb-10 text-3xl font-black">Who's watching?</h1>
    {#if error}
      <p data-part="source.profiles.error" class="text-sm text-muted-foreground">{error}</p>
    {:else if !found}
      <Spinner size="lg" label="Loading profiles" />
    {:else}
      <div data-part="source.profiles.list" role="list" class="flex flex-wrap justify-center gap-8">
        {#each found.profiles.profiles as profile, index (profile.id)}
          <button type="button" role="listitem" data-part="source.profile" data-focusable data-state={profile.current ? 'current' : undefined}
                  use:focusIf={found.profiles.profiles.some((item) => item.current) ? profile.current : index === 0}
                  aria-busy={saving === profile.id || undefined} onclick={() => void choose(profile)}
                  class="group flex w-32 flex-col items-center gap-3 rounded-xl p-2 outline-none">
            <span data-part="source.profile.avatar" class="relative grid size-28 place-items-center overflow-hidden rounded-full bg-secondary ring-2 ring-transparent transition group-hover:ring-foreground/40 group-focus-visible:ring-primary">
              {#if profile.image}<img src={profile.image} alt="" class="size-full object-cover" />{:else}<span class="text-3xl font-black">{profile.name.slice(0, 1)}</span>{/if}
              {#if saving === profile.id}<span class="absolute inset-0 grid place-items-center bg-black/60"><Spinner size="md" /></span>{/if}
            </span>
            <span data-part="source.profile.name" class="max-w-full truncate text-sm font-bold">{profile.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
