<script lang="ts">
  import Wordmark from '$lib/components/Wordmark.svelte'
  import { tick } from 'svelte'
  import { goto } from '$app/navigation'
  import { previousPath } from '$lib/navigation/history-trail'
  import { markBackPending } from '$lib/nav/nav-state'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import Pencil from '@lucide/svelte/icons/pencil'
  import Plus from '@lucide/svelte/icons/plus'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import Check from '@lucide/svelte/icons/check'
  import { profileSyncError } from '$lib/sync/client'
  import { PROFILE_AVATARS, profileAvatarUrl, validAvatar, type ProfileAvatarId } from '$lib/profiles/avatars'
  import { DEFAULT_PROFILE_ID, PROFILE_COLORS, activeProfileId, createProfile, deleteProfile, disableProfiles, pinLockSeconds, pinThrottleMessage, profiles, profilesEnabled, setProfilePin, updateProfile, verifyPinThrottled, type IzumiProfile, type ProfileRatingLimit } from '$lib/profiles/store'

  type Screen = 'overview' | 'edit' | 'avatars' | 'delete' | 'gate' | 'disable'
  let screen = $state<Screen>('overview')
  let editing = $state<IzumiProfile | null>(null)
  let name = $state('')
  let color = $state<string>(PROFILE_COLORS[0])
  let avatar = $state<ProfileAvatarId>('fox')
  let ratingLimit = $state<ProfileRatingLimit>(18)
  let allowAdult = $state(false)
  let currentPin = $state('')
  let newPin = $state('')
  let confirmPin = $state('')
  let removeLock = $state(false)
  let error = $state('')
  let notice = $state('')
  let busy = $state(false)
  let managementAuthorized = $state(false)
  let mainPin = $state('')
  let panel = $state<HTMLElement>()
  const main = $derived($profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID)!)
  const title = $derived(screen === 'avatars' ? 'Choose an avatar' : screen === 'delete' ? 'Delete profile?' : screen === 'disable' ? 'Turn off profiles?' : screen === 'gate' ? 'Manage profiles' : screen === 'edit' ? editing ? 'Edit profile' : 'Add profile' : $profilesEnabled ? 'Manage profiles' : 'Make room for everyone')

  // Screens with a PIN field or a PIN-checked action: the countdown shows only there. Deleting or
  // turning off without a PIN is never throttled, so those screens show no countdown.
  const pinEntry = $derived(
    screen === 'gate' || (screen === 'delete' && !!editing?.pin) || (screen === 'disable' && !!main.pin)
      || (screen === 'edit' && !!editing?.pin && !(editing.id === main.id && managementAuthorized)),
  )

  async function focusScreen() {
    await tick()
    panel?.querySelector<HTMLElement>('input, button[data-first]')?.focus()
  }
  function begin(profile: IzumiProfile | null) {
    editing = profile
    name = profile?.name === 'Main profile' && !$profilesEnabled ? '' : profile?.name ?? ''
    color = profile?.color ?? PROFILE_COLORS[$profiles.length % PROFILE_COLORS.length]
    avatar = validAvatar(profile?.avatar ?? PROFILE_AVATARS[$profiles.length % PROFILE_AVATARS.length])
    ratingLimit = profile?.ratingLimit ?? 12
    allowAdult = profile?.allowAdult ?? false
    currentPin = newPin = confirmPin = error = ''
    removeLock = false
    screen = main.pin && !managementAuthorized ? 'gate' : 'edit'
    void focusScreen()
  }
  async function authorizeManagement() {
    if (busy) return
    busy = true
    try {
      const verdict = await verifyPinThrottled(main, mainPin)
      if (!verdict.ok) { error = verdict.reason === 'throttled' ? '' : 'That PIN didn’t match.'; mainPin = ''; void focusScreen(); return }
      managementAuthorized = true
      if (editing?.id === main.id) currentPin = mainPin
      mainPin = ''; error = ''; screen = 'edit'; void focusScreen()
    } catch { error = 'Could not verify your PIN. Please try again.' }
    finally { busy = false }
  }
  function back() {
    if (busy) return
    error = ''
    if (screen === 'avatars' || screen === 'delete') screen = 'edit'
    else if (screen !== 'overview') { screen = 'overview'; currentPin = newPin = confirmPin = mainPin = '' }
    else leave()
  }
  // Leave the household screen the way it was entered (Accounts, the profile switcher, the Settings
  // rail): back through history when the previous page is where it came from, so Back and Done
  // never stack a second copy of that page; with no known origin, up to Settings, replacing this entry.
  function leave() {
    const from = previousPath()
    markBackPending()
    if (from !== null && !from.startsWith('/app/settings/profiles')) history.back()
    else void goto('/app/settings', { replaceState: true })
  }
  async function authorizedTarget() {
    if (!editing?.pin || (editing.id === main.id && managementAuthorized)) return true
    const verdict = await verifyPinThrottled(editing, currentPin)
    if (verdict.ok) return true
    error = verdict.reason === 'throttled' ? '' : 'Enter this profile’s current PIN to make changes.'
    return false
  }
  async function save() {
    if (busy) return
    error = ''
    if (!name.trim()) { error = 'Give this profile a name.'; return }
    if (newPin && (!/^\d{4,6}$/.test(newPin) || newPin !== confirmPin)) { error = 'Enter the same 4–6 digit PIN in both fields.'; return }
    busy = true
    try {
      if (!(await authorizedTarget())) return
      const input = { name, color, avatar, ratingLimit, allowAdult }
      const id = editing?.id ?? createProfile(input)
      if (editing) updateProfile(id, input)
      if (newPin) await setProfilePin(id, newPin)
      else if (removeLock) await setProfilePin(id, null)
      notice = editing ? 'Profile saved.' : 'Profile created.'
      screen = 'overview'; currentPin = newPin = confirmPin = ''
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save this profile.' }
    finally { busy = false }
  }
  async function remove() {
    if (!editing || busy) return
    busy = true; error = ''
    try {
      if (!(await deleteProfile(editing.id, currentPin))) { error = 'Check the profile PIN. Switch away from this profile before deleting it.'; return }
      notice = 'Profile and its on-device data deleted.'
      screen = 'overview'; editing = null
    } catch { error = 'Could not delete this profile.' }
    finally { busy = false }
  }
  async function turnOff() {
    if (busy) return
    busy = true; error = ''
    try { if (!(await disableProfiles(mainPin))) { error = 'That main profile PIN didn’t match.'; mainPin = ''; void focusScreen() } }
    catch { error = 'Could not turn off profiles.' }
    finally { busy = false }
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); back() } }} />
<section bind:this={panel} class="profile-manager fixed inset-0 z-[85] overflow-y-auto bg-background px-6 pb-16 pt-12 sm:px-12" data-nav-trap data-nav-escape data-nav-scroll-container aria-labelledby="manage-heading">
  <button type="button" data-focusable onclick={back} aria-label="Back" class="back-button"><ArrowLeft size={24} /></button>
  <div class:overview={screen === 'overview'} class="profile-content">
    <header>
      <div class="wordmark"><Wordmark /></div>
      <h1 id="manage-heading">{title}</h1>
      {#if screen === 'overview' && !$profilesEnabled}
        <p class="intro">A space for each person, with their own watchlist, history and account connections. Profiles are optional. Your existing library stays with you.</p>
      {/if}
    </header>
    {#if notice && screen === 'overview'}<p role="status" class="notice">{notice}</p>{/if}
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    {#if pinEntry && $pinLockSeconds > 0}<p role="timer" data-pin-countdown class="error">{pinThrottleMessage($pinLockSeconds)}</p>{/if}
    {#if $profileSyncError}<p role="status" class="error">{$profileSyncError} <a href="/app/settings/sync" data-focusable class="underline">Sync settings</a></p>{/if}

    {#if screen === 'overview'}
      {#if $profilesEnabled}
        <div class="profile-grid">
          {#each $profiles as profile (profile.id)}
            <button type="button" data-focusable data-first onclick={() => begin(profile)} class="portrait-button" aria-label={'Edit ' + profile.name}>
              <span class="portrait"><img src={profileAvatarUrl(profile.avatar, profile.color)} alt="" /><span class="edit-badge"><Pencil size={18} /></span></span>
              <span class="profile-name">{profile.name}</span>
              {#if profile.pin}<LockKeyhole size={15} class="mx-auto mt-2 text-muted-foreground" />{/if}
            </button>
          {/each}
          {#if $profiles.length < 8}<button type="button" data-focusable onclick={() => begin(null)} class="portrait-button"><span class="portrait add"><Plus size={40} /></span><span class="profile-name">Add profile</span></button>{/if}
        </div>
        <div class="overview-actions"><button type="button" data-focusable class="primary" onclick={leave}>Done</button><button type="button" data-focusable class="quiet" onclick={() => { screen = 'disable'; mainPin = ''; error = ''; void focusScreen() }}>Turn off profiles</button></div>
      {:else}
        <div class="welcome-portraits" aria-hidden="true">{#each ['fox', 'bear', 'owl'] as face, index}<img src={profileAvatarUrl(face, PROFILE_COLORS[index])} alt="" />{/each}</div>
        <button type="button" data-focusable data-first class="primary" onclick={() => begin(main)}>Set up profiles</button>
        <p class="footnote">Nothing changes until you save your first profile.</p>
      {/if}
    {:else if screen === 'gate'}
      <form onsubmit={(event) => { event.preventDefault(); void authorizeManagement() }} class="pin-form">
        <img src={profileAvatarUrl(main.avatar, main.color)} alt="" class="pin-avatar" />
        <label for="management-pin">Enter {main.name}’s PIN to manage this household.</label>
        <input id="management-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" bind:value={mainPin} data-focusable />
        <button type="submit" disabled={busy || mainPin.length < 4 || $pinLockSeconds > 0} data-focusable class="primary">{busy ? 'Checking…' : 'Continue'}</button>
      </form>
    {:else if screen === 'avatars'}
      <p class="intro">Choose a character, then make it your own with a colour.</p>
      <div class="avatar-grid">{#each PROFILE_AVATARS as choice}<button type="button" data-focusable aria-label={choice} aria-pressed={avatar === choice} class:chosen={avatar === choice} onclick={() => { avatar = choice; screen = 'edit' }}><img src={profileAvatarUrl(choice, color)} alt="" /><span>{choice}</span></button>{/each}</div>
    {:else if screen === 'delete'}
      <div class="confirmation">
        <img src={profileAvatarUrl(avatar, color)} alt="" />
        <p>Delete <strong>{editing?.name}</strong> and their on-device history, watchlist and connections? This can’t be undone. Other profiles won’t be affected.</p>
      </div>
      <div class="form-actions"><button type="button" data-focusable data-first class="primary" onclick={back}>Keep profile</button><button type="button" data-focusable class="danger" disabled={busy || (!!editing?.pin && $pinLockSeconds > 0)} onclick={remove}>{busy ? 'Deleting…' : 'Delete profile'}</button></div>
    {:else if screen === 'disable'}
      <p class="intro">Return to {main.name} and the normal account button. Your other profiles and their data are kept, ready to use again.</p>
      <form onsubmit={(event) => { event.preventDefault(); void turnOff() }} class="pin-form">
        {#if main.pin}<label for="disable-pin">Main profile PIN</label><input id="disable-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" bind:value={mainPin} data-focusable />{/if}
        <button type="submit" data-focusable data-first disabled={busy || (!!main.pin && $pinLockSeconds > 0)} class="primary">Turn off profiles</button>
      </form>
    {:else}
      <form onsubmit={(event) => { event.preventDefault(); void save() }} class="edit-form">
        <div class="identity-row">
          <button type="button" data-focusable onclick={() => { screen = 'avatars'; void focusScreen() }} class="edit-avatar" aria-label="Choose an avatar"><img src={profileAvatarUrl(avatar, color)} alt="" /><span><Pencil size={16} /> Change</span></button>
          <div class="identity-fields"><label for="profile-name">Profile name</label><input id="profile-name" bind:value={name} maxlength="32" autocomplete="off" placeholder="Your name" data-focusable />
            <fieldset><legend>Colour</legend><div class="colours">{#each PROFILE_COLORS as choice}<button type="button" data-focusable aria-label={'Use colour ' + choice} aria-pressed={color === choice} onclick={() => color = choice} style:background={choice}>{#if color === choice}<Check size={18} />{/if}</button>{/each}</div></fieldset>
          </div>
        </div>
        <section class="form-section"><h2>Viewing restrictions</h2><label for="rating-limit">Maximum content age</label><select id="rating-limit" bind:value={ratingLimit} data-focusable><option value={7}>7 and under</option><option value={12}>12 and under</option><option value={16}>16 and under</option><option value={18}>18 and under</option></select>
          <label class="check-row"><input type="checkbox" bind:checked={allowAdult} disabled={ratingLimit !== 18} data-focusable />Allow explicitly marked adult titles</label>
          <p class="hint">Titles with recognised ratings above this limit are blocked. Unrated titles can still appear.</p>
        </section>
        <section class="form-section"><h2>Profile lock</h2>
          <p class="hint">{editing?.id === DEFAULT_PROFILE_ID ? 'A PIN on the main profile also protects household management.' : 'Require a PIN before opening this profile.'}</p>
          {#if editing?.pin && !(editing.id === main.id && managementAuthorized)}<label for="current-pin">Current PIN</label><input id="current-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" bind:value={currentPin} data-focusable />{/if}
          <div class="pin-fields"><label>New PIN (optional)<input type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" bind:value={newPin} data-focusable /></label><label>Confirm PIN<input type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" bind:value={confirmPin} data-focusable /></label></div>
          {#if editing?.pin}<label class="check-row"><input type="checkbox" bind:checked={removeLock} data-focusable />Remove existing PIN on save</label>{/if}
          <p class="hint">Use 4–6 digits. This is a household lock, not encryption of this device.</p>
        </section>
        <div class="form-actions"><button type="submit" disabled={busy} data-focusable class="primary">{busy ? 'Saving…' : !$profilesEnabled ? 'Enable profiles' : 'Save'}</button><button type="button" data-focusable class="quiet" onclick={back}>Cancel</button>
          {#if editing && editing.id !== DEFAULT_PROFILE_ID}<button type="button" disabled={editing.id === $activeProfileId || busy} data-focusable class="danger ml-auto" onclick={async () => { if (await authorizedTarget()) { screen = 'delete'; void focusScreen() } }}>Delete profile</button>{/if}
        </div>
        {#if editing?.id === $activeProfileId && editing.id !== DEFAULT_PROFILE_ID}<p class="hint">Switch to another profile before deleting this one.</p>{/if}
      </form>
    {/if}
  </div>
</section>

<style>
  .profile-manager { color: hsl(var(--foreground)); }
  .back-button { position: absolute; top: 3rem; left: 2rem; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; }
  .profile-content { width: 100%; max-width: 660px; margin: 4rem auto 0; }
  .profile-content.overview { max-width: 1100px; margin-top: clamp(5rem, 16vh, 12rem); text-align: center; }
  .wordmark { color: hsl(var(--muted-foreground)); font-size: 20px; font-weight: 900; margin-bottom: 24px; }
  h1 { font-size: clamp(30px, 4vw, 48px); line-height: 1.15; font-weight: 700; letter-spacing: -.035em; }
  .intro { max-width: 530px; color: hsl(var(--muted-foreground)); line-height: 1.7; margin: 24px auto; }
  .profile-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 36px; margin: 56px auto 48px; max-width: 920px; }
  .portrait-button { width: 140px; background: none; border: none; }
  .portrait { display: block; position: relative; width: 100%; aspect-ratio: 1; border-radius: 24px; }
  .portrait img { width: 100%; border-radius: inherit; }
  .portrait-button:hover .portrait, .portrait-button:focus-visible .portrait { outline: 3px solid currentColor; outline-offset: 5px; }
  .profile-name { display: block; margin-top: 20px; font-size: 18px; color: hsl(var(--muted-foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edit-badge { position: absolute; bottom: -5px; right: -5px; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: hsl(var(--foreground)); color: hsl(var(--background)); border: 3px solid hsl(var(--background)); }
  .add { display: grid; place-items: center; background: hsl(var(--secondary)); color: hsl(var(--muted-foreground)); }
  .overview-actions { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .welcome-portraits { display: flex; justify-content: center; gap: 22px; margin: 40px 0; }
  .welcome-portraits img { width: min(24vw, 120px); border-radius: 24px; }
  .primary, .quiet, .danger { min-height: 48px; border-radius: 8px; padding: 12px 24px; font-size: 15px; font-weight: 700; }
  .primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .quiet { color: hsl(var(--muted-foreground)); }
  .danger { color: hsl(var(--destructive)); }
  button:hover { filter: brightness(1.1); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid hsl(var(--theme)); outline-offset: 4px; }
  button:disabled { opacity: .4; cursor: not-allowed; }
  .footnote, .hint { color: hsl(var(--muted-foreground)); font-size: 13px; line-height: 1.6; margin-top: 14px; }
  .edit-form { margin-top: 36px; }
  .identity-row { display: flex; align-items: flex-start; gap: 28px; }
  .edit-avatar { width: 120px; flex-shrink: 0; }
  .edit-avatar img { width: 100%; border-radius: 24px; }
  .edit-avatar span { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; font-size: 13px; }
  .identity-fields { flex: 1; min-width: 0; }
  label, legend { display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  input:not([type=checkbox]), select { display: block; width: 100%; min-height: 48px; border-radius: 8px; padding: 10px 14px; background: hsl(var(--secondary)); font-size: 16px; margin-top: 8px; }
  fieldset { margin-top: 22px; }
  .colours { display: flex; flex-wrap: wrap; gap: 10px; }
  .colours button { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: white; }
  .form-section { border-top: 1px solid hsl(var(--border)); margin-top: 28px; padding-top: 24px; }
  h2 { font-size: 20px; font-weight: 700; margin-bottom: 18px; }
  .check-row { display: flex; align-items: center; gap: 10px; margin-top: 20px; line-height: 1.5; }
  .check-row input { width: 20px; height: 20px; accent-color: hsl(var(--primary)); flex-shrink: 0; }
  .pin-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
  .form-actions { display: flex; flex-wrap: wrap; gap: 10px; border-top: 1px solid hsl(var(--border)); margin-top: 28px; padding-top: 24px; }
  .pin-form { max-width: 340px; display: grid; gap: 18px; margin: 32px auto; text-align: center; }
  .pin-avatar { width: 110px; margin: 0 auto 12px; }
  .pin-form input { text-align: center; letter-spacing: .5em; font-size: 24px; }
  .avatar-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 32px; }
  .avatar-grid button { border-radius: 24px; padding: 5px; }
  .avatar-grid button.chosen { outline: 3px solid hsl(var(--foreground)); }
  .avatar-grid img { width: 100%; }
  .avatar-grid span { display: block; text-transform: capitalize; padding: 12px 0 4px; color: hsl(var(--muted-foreground)); }
  .confirmation { display: flex; gap: 28px; align-items: center; margin: 36px 0; line-height: 1.7; }
  .confirmation img { width: 110px; flex-shrink: 0; }
  .error { color: hsl(var(--destructive)); margin-top: 20px; }
  .notice { color: hsl(var(--muted-foreground)); margin-top: 20px; }
  @media(max-width: 600px) { .profile-content { margin-top: 4rem; } .portrait-button { width: 108px; } .profile-grid { gap: 24px; } .identity-row { gap: 18px; } .edit-avatar { width: 88px; } .avatar-grid { grid-template-columns: repeat(3, 1fr); gap: 15px; } .pin-fields { grid-template-columns: 1fr; } }
  @media(prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
