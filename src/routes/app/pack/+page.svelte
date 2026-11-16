<script lang="ts">
  // izumi://pack?url=…, Settings > Store > Add pack, and the Deck installer all land here.
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { get } from 'svelte/store'
  import PackFlow from '$lib/components/packs/PackFlow.svelte'
  import { finishOnboarding, onboardingComplete } from '$lib/settings/onboarding'

  const url = $derived(page.url.searchParams.get('url') ?? '')
  // Captured once: setting the pack up finishes onboarding, which must not change where Not now goes.
  const firstRun = !get(onboardingComplete)

  function finish() {
    if (firstRun) finishOnboarding()
    void goto('/app/home', { replaceState: true })
  }

  function cancel() {
    // During first-run setup, Not now returns to the normal setup screens.
    void goto(firstRun ? '/app/home' : '/app/settings/store', { replaceState: true })
  }
</script>

{#if url}
  {#key url}<PackFlow {url} onfinish={finish} oncancel={cancel} />{/key}
{/if}
