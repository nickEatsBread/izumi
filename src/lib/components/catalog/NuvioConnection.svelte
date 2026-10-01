<script lang="ts">
  import { onDestroy } from 'svelte'
  import { nuvioClient, nuvioSession, type DeviceCode } from '$lib/nuvio/auth'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right'
  import Link from '@lucide/svelte/icons/link'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  let mode = $state<'device' | 'email'>('device')
  let registering = $state(false), notice = $state('')
  let code = $state<DeviceCode | null>(null)
  let busy = $state(false), email = $state(''), password = $state(''), error = $state('')
  let controller: AbortController | undefined
  function cancel() { controller?.abort(); controller = undefined; busy = false; code = null; password = '' }
  onDestroy(cancel)
  async function connect() {
    cancel(); error = ''; busy = true
    const abort = controller = new AbortController()
    try { await nuvioClient.connectDevice((value) => code = value, abort.signal) }
    catch (reason) { if (!abort.signal.aborted) { code = null; error = reason instanceof Error ? reason.message : 'Could not connect to Nuvio.' } }
    finally { if (controller === abort) busy = false }
  }
  async function signIn(event: SubmitEvent) {
    event.preventDefault(); error = ''; busy = true
    const abort = controller = new AbortController()
    try {
      if (registering) {
        const result = await nuvioClient.signUp(email, password, abort.signal)
        if (result === 'confirm-email') { notice = 'Check your email to confirm your Nuvio account, then sign in here.'; registering = false }
      } else { await nuvioClient.signIn(email, password, abort.signal); email = '' }
    }
    catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not sign in.' }
    finally { password = ''; if (controller === abort) busy = false }
  }
  async function visit(url: string) {
    try { await openUrl(url) } catch { window.open(url, '_blank', 'noopener,noreferrer') }
  }
</script>

{#if $nuvioSession}
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4 text-sm">
    <span class="flex min-w-0 flex-1 items-center gap-2"><span class="size-2 shrink-0 rounded-full bg-primary"></span><span class="truncate"><span class="hidden sm:inline">Connected to Nuvio · </span><span class="text-muted-foreground">{$nuvioSession.email || 'Nuvio connected'}</span></span></span>
    <button data-focusable onclick={() => { cancel(); nuvioClient.disconnect() }} class="min-h-10 rounded-md px-3 text-muted-foreground hover:bg-secondary hover:text-foreground">Disconnect</button>
  </div>
{:else}
  <section aria-labelledby="nuvio-connect-title" class="my-6 grid gap-8 rounded-2xl border border-border bg-secondary/25 p-6 sm:p-8 lg:grid-cols-[1fr_1fr] lg:gap-12">
    <div class="max-w-md self-center">
      <Link class="mb-5 size-7 text-primary" />
      <h2 id="nuvio-connect-title" class="text-2xl font-black tracking-tight">Your Nuvio world, in izumi.</h2>
      <p class="mt-3 leading-relaxed text-muted-foreground">Sign in to discover community collections, find artwork for your folders, and bring over collections from your Nuvio profiles.</p>
      <p class="mt-5 text-sm text-muted-foreground">Choose what to add. Your collections will appear on izumi’s Home screen.</p>
    </div>
    <div class="w-full max-w-md self-center justify-self-center">
      {#if mode === 'device'}
        {#if code}
          <p class="text-sm font-bold">Approve this device on Nuvio</p>
          <p class="mt-2 text-sm text-muted-foreground">Open Nuvio below and confirm this code. Return here after approving.</p>
          <p aria-label={`Sign-in code ${code.code}`} class="my-5 rounded-xl border border-border bg-background py-5 text-center font-mono text-3xl font-bold tracking-[0.15em]">{code.code}</p>
          <button data-focusable onclick={() => visit(code!.url)} class="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-bold text-primary-foreground">Open Nuvio to approve <ArrowUpRight class="size-4" /></button>
          <p role="status" class="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" />{code.completing ? 'Completing sign-in…' : 'Waiting for approval…'}</p>
          <button data-focusable onclick={cancel} class="mt-3 min-h-10 w-full rounded-lg text-sm hover:bg-secondary">Cancel sign-in</button>
        {:else}
          <button data-focusable disabled={busy} onclick={connect} class="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 font-bold text-primary-foreground disabled:opacity-50">{#if busy}<LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" />{/if}{busy ? 'Getting your code…' : 'Connect Nuvio account'}</button>
          <p class="mt-3 text-center text-xs leading-relaxed text-muted-foreground">Continue on nuvio.tv using a short device code.</p>
          <button data-focusable disabled={busy} onclick={() => { mode = 'email'; error = '' }} class="mt-3 min-h-10 w-full rounded-lg text-sm font-bold hover:bg-secondary">Use email and password</button>
        {/if}
      {:else}
        <form onsubmit={signIn} class="space-y-3">
          <label class="block text-sm font-bold">Nuvio email<input type="email" data-focusable autocomplete="username" required bind:value={email} disabled={busy} class="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 font-normal" /></label>
          <label class="block text-sm font-bold">Password<input type="password" data-focusable autocomplete={registering ? 'new-password' : 'current-password'} minlength={registering ? 6 : undefined} required bind:value={password} disabled={busy} class="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 font-normal" /></label>
          <button data-focusable disabled={busy} class="min-h-11 w-full rounded-lg bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50">{busy ? 'Connecting…' : registering ? 'Create Nuvio account' : 'Sign in to Nuvio'}</button>
          <button type="button" data-focusable disabled={busy} class="min-h-10 w-full rounded-lg text-sm font-bold hover:bg-secondary" onclick={() => { registering = !registering; password = ''; error = ''; notice = '' }}>{registering ? 'Already have an account? Sign in' : 'New to Nuvio? Create an account'}</button>
          <button type="button" data-focusable onclick={() => { cancel(); mode = 'device'; error = '' }} class="min-h-10 w-full rounded-lg text-sm font-bold hover:bg-secondary">Use a device code instead</button>
        </form>
      {/if}
      {#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
      {#if notice}<p role="status" class="mt-3 text-sm text-muted-foreground">{notice}</p>{/if}
      <button data-focusable onclick={() => visit('https://nuvio.tv/account')} class="mt-3 min-h-10 w-full text-center text-xs text-muted-foreground underline underline-offset-4">Create or manage a Nuvio account ↗</button>
    </div>
  </section>
{/if}
