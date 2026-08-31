<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import { get } from 'svelte/store'
  import { acceptCompanionPlayRequest, pairedCompanions } from '$lib/companion/client'
  import { normalizeCloudflareEndpoint, readCloudflareCompanionRequest } from '$lib/sync/cloudflare'

  let error = $state('')

  onMount(() => {
    void (async () => {
      try {
        const worker = normalizeCloudflareEndpoint(page.url.searchParams.get('worker') ?? '')
        const pairingId = page.url.searchParams.get('pairing') ?? ''
        const requestId = page.url.searchParams.get('request') ?? ''
        const device = get(pairedCompanions).find((candidate) => candidate.cloudflare?.pairingId === pairingId)
        if (!device?.cloudflare || normalizeCloudflareEndpoint(device.cloudflare.endpoint) !== worker) {
          throw new Error('This request does not belong to a TV paired with this phone.')
        }
        const request = await readCloudflareCompanionRequest(pairingId, requestId, device.credential)
        const path = acceptCompanionPlayRequest(request.media, device, {
          pairingId: request.pairingId,
          requestId: request.requestId,
          expiresAt: request.expiresAt,
        })
        await goto(path, { replaceState: true })
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason)
      }
    })()
  })
</script>

<svelte:head><title>TV request · Izumi</title></svelte:head>

<div class="mx-auto grid min-h-[70vh] max-w-lg place-items-center px-4 py-12">
  <section class="w-full rounded-2xl border border-border bg-card p-7 text-center shadow-xl">
    {#if error}
      <p class="text-xs font-black uppercase tracking-[.18em] text-destructive">Izumi Companion</p>
      <h1 class="mt-2 text-2xl font-black">Couldn’t open this TV request</h1>
      <p class="mt-4 text-sm leading-6 text-muted-foreground">{error}</p>
      <button type="button" class="mt-6 min-h-12 rounded-xl bg-secondary px-5 font-bold" onclick={() => goto('/app/home')}>Return home</button>
    {:else}
      <LoaderCircle class="mx-auto animate-spin text-primary" size={34} />
      <h1 class="mt-5 text-2xl font-black">Opening your TV request</h1>
      <p class="mt-2 text-sm text-muted-foreground">Authenticating it with your private Worker…</p>
    {/if}
  </section>
</div>
