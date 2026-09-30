<script lang="ts">
  import Wordmark from '$lib/components/Wordmark.svelte'
  import { tick } from 'svelte'
  import { goto } from '$app/navigation'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import X from '@lucide/svelte/icons/x'
  import { profileAvatarUrl } from '$lib/profiles/avatars'
  import { activateProfile, activeProfileId, activeProfileLocked, profiles, profileSwitcherOpen, unlockActiveProfile, type IzumiProfile } from '$lib/profiles/store'

  let pending = $state<IzumiProfile | null>(null)
  let pin = $state('')
  let error = $state('')
  let busy = $state(false)
  let panel = $state<HTMLElement>()
  let pinInput = $state<HTMLInputElement>()
  const visible = $derived($profileSwitcherOpen || $activeProfileLocked)

  $effect(() => {
    if (!visible) { pending = null; pin = ''; error = ''; return }
    const previous = document.activeElement as HTMLElement | null
    void tick().then(() => panel?.querySelector<HTMLElement>('[data-profile-choice]')?.focus())
    return () => previous?.focus()
  })
  async function choose(profile: IzumiProfile) {
    if (busy) return
    error = ''
    if (profile.id === $activeProfileId && !$activeProfileLocked) { $profileSwitcherOpen = false; return }
    if (profile.pin) {
      pending = profile; pin = ''
      await tick(); pinInput?.focus(); return
    }
    busy = true
    try { await activateProfile(profile.id) } finally { busy = false }
  }
  async function submitPin() {
    if (!pending || busy) return
    busy = true; error = ''
    try {
      const ok = pending.id === $activeProfileId ? await unlockActiveProfile(pin) : await activateProfile(pending.id, pin)
      if (!ok) { error = 'That PIN didn’t match. Try again.'; pin = ''; pinInput?.focus() }
      else { $profileSwitcherOpen = false; pending = null }
    } catch { error = 'Could not unlock this profile. Please try again.' }
    finally { busy = false }
  }
  function back() {
    if (busy) return
    if (pending) { pending = null; pin = ''; error = ''; void tick().then(() => panel?.querySelector<HTMLElement>('[data-profile-choice]')?.focus()) }
    else if (!$activeProfileLocked) $profileSwitcherOpen = false
  }
  function keydown(event: KeyboardEvent) {
    if (!visible) return
    if (event.key === 'Escape') { event.preventDefault(); back() }
    if (event.key === 'Tab' && panel) {
      const buttons = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }
</script>

<svelte:window onkeydown={keydown} />
{#if visible}
  <div bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="profile-heading" tabindex="-1" data-nav-trap data-nav-escape data-nav-scroll-container data-nav-back-exit={$activeProfileLocked && !pending ? '' : undefined} class="fixed inset-0 z-[90] flex flex-col overflow-y-auto bg-background px-6 py-12">
    {#if !$activeProfileLocked}<button type="button" data-focusable onclick={back} aria-label="Close profiles" class="absolute right-6 top-10 grid size-12 place-items-center rounded-full text-muted-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-theme"><X size={22} /></button>{/if}
    <div class="m-auto w-full max-w-5xl py-12 text-center">
      <div class="mb-8"><Wordmark /></div>
      <h1 id="profile-heading" class="text-3xl font-bold tracking-tight sm:text-5xl">{pending ? 'Hello, ' + pending.name : 'Who’s watching?'}</h1>
      {#if pending}
        <img src={profileAvatarUrl(pending.avatar, pending.color)} alt="" class="mx-auto mt-9 size-28 rounded-3xl" />
        <form onsubmit={(event) => { event.preventDefault(); void submitPin() }} class="mx-auto mt-7 max-w-xs">
          <label for="profile-pin" class="mb-4 block text-muted-foreground">Enter your profile PIN</label>
          <input id="profile-pin" type="password" bind:this={pinInput} bind:value={pin} data-focusable inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" autocomplete="off" class="h-14 w-full rounded-xl bg-secondary text-center font-mono text-2xl tracking-[0.5em] outline-none focus:ring-2 focus:ring-theme" />
          {#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
          <button type="submit" data-focusable disabled={pin.length < 4 || busy} class="mt-5 min-h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-40">{busy ? 'Checking…' : 'Continue'}</button>
          <button type="button" data-focusable onclick={back} class="mt-3 min-h-12 px-5 text-muted-foreground hover:text-foreground">Choose another profile</button>
        </form>
      {:else}
        <div class="mx-auto mt-12 flex max-w-4xl flex-wrap justify-center gap-x-7 gap-y-8 sm:gap-x-9">
          {#each $profiles as profile (profile.id)}
            <button type="button" data-profile-choice data-focusable disabled={busy} onclick={() => choose(profile)} class="group w-28 outline-none sm:w-36">
              <img src={profileAvatarUrl(profile.avatar, profile.color)} alt="" class="aspect-square w-full rounded-3xl ring-offset-4 ring-offset-background transition duration-150 group-hover:scale-105 group-hover:ring-2 group-hover:ring-foreground group-focus-visible:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-foreground" />
              <span class="mt-5 block truncate text-lg text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">{profile.name}</span>
              {#if profile.pin}<LockKeyhole size={15} class="mx-auto mt-2 text-muted-foreground" />{/if}
            </button>
          {/each}
        </div>
        {#if !$activeProfileLocked}<button type="button" data-focusable onclick={() => { $profileSwitcherOpen = false; void goto('/app/settings/profiles') }} class="mt-14 min-h-12 rounded-lg border border-border px-7 text-base text-muted-foreground transition hover:border-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-theme">Manage profiles</button>{/if}
      {/if}
    </div>
  </div>
{/if}
