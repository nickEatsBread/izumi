<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { nuvioCloud, sameCloudValue, type CloudBlob, type JsonRecord } from '$lib/nuvio/cloud'
  import { localCloudSettings, importCloudSettings, transferSettingKeys } from '$lib/nuvio/transfer'
  import { gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'
  let { profileId, kind }: { profileId: number; kind: 'settings' | 'home' } = $props()
  let platform = $state('izumi'), baseline = $state.raw<CloudBlob>({ value: {} }), draft = $state<JsonRecord>({})
  let loading = $state(true), busy = $state(false), error = $state(''), notice = $state(''), advanced = $state(false), json = $state(''), key = $state('')
  let review: HTMLDialogElement
  const abort = new AbortController()
  // Controller-only stops on the review list: text a d-pad can walk, out of the mouse/touch order.
  const stops = $derived($gameMode || $controllerMode)
  const changed = $derived(!sameCloudValue(draft, baseline.value))
  const label = (key: string) => key.replace(/[-_]/g, ' ').replace(/\bv\d+\b/g, '').trim()
  const transferable = $derived(Object.keys(draft).filter((key) => transferSettingKeys(kind).includes(key)))
  onMount(() => { void load() }); onDestroy(() => abort.abort())
  async function run(work: () => Promise<void>) { busy = true; error = ''; notice = ''; try { await work() } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not update preferences.' } finally { if (!abort.signal.aborted) busy = false } }
  async function load() { loading = true; advanced = false; await run(async () => { const value = await nuvioCloud.blob(kind, profileId, platform, abort.signal); if (!abort.signal.aborted) { baseline = value; draft = structuredClone(value.value) as JsonRecord } }); if (!abort.signal.aborted) loading = false }
  function applyJson() { try { const parsed = JSON.parse(json); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Use a JSON object.'); draft = parsed; advanced = false; error = '' } catch (reason) { error = reason instanceof Error ? reason.message : 'Invalid JSON.' } }
  function capture() { draft = { ...draft, ...localCloudSettings(kind) }; notice = 'Your izumi preferences are in the draft. Review them below, then save to Nuvio.' }
</script>

<div class="nv-toolbar"><div><h3 class="text-lg font-extrabold">{kind === 'home' ? 'Home layout' : 'Preferences'}</h3><p class="nv-help mt-1">Each client keeps its own settings in Nuvio. Choose which client’s document to manage.</p></div><button data-focusable class="nv-btn" disabled={busy} onclick={load}>Reload document</button></div>
<label class="nv-label mb-5 max-w-xs">Client<select data-focusable class="nv-input" bind:value={platform} disabled={busy} onchange={load}><option value="izumi">izumi</option><option value="tv">Nuvio TV</option><option value="mobile">Nuvio Mobile</option><option value="desktop">Nuvio Desktop</option></select></label>
{#if error}<p class="nv-error" role="alert">{error}</p>{/if}{#if notice}<p class="nv-notice" role="status">{notice}</p>{/if}
{#if loading}<p class="nv-empty" role="status">Loading preferences…</p>{:else}
  <fieldset disabled={busy}>
    {#if platform === 'izumi'}<div class="mb-5 flex flex-wrap gap-2"><button data-focusable class="nv-btn" onclick={capture}>Use this device’s {kind === 'home' ? 'Home layout' : 'preferences'}</button><button data-focusable class="nv-btn" disabled={!transferable.length} onclick={() => review.showModal()}>Apply to this device…</button></div><p class="nv-help mb-5 text-xs">Only izumi’s portable preferences are transferred. Account credentials and device paths are excluded.</p>{:else}<p class="nv-help mb-5">These values belong to the selected Nuvio client. Unknown fields are preserved when saving.</p>{/if}
    {#each Object.entries(draft) as [name, value]}
      <div class="nv-row flex-wrap"><div class="min-w-0 flex-1"><label class="nv-label capitalize" for={`nv-setting-${name}`}>{label(name)}</label><p class="nv-help mt-1 break-all text-xs">{name}</p></div><div class="w-full min-w-0 sm:w-1/2">{#if typeof value === 'boolean'}<input data-focusable id={`nv-setting-${name}`} aria-label={label(name)} type="checkbox" checked={value} onchange={(event) => draft = { ...draft, [name]: event.currentTarget.checked }} />{:else if typeof value === 'number'}<input id={`nv-setting-${name}`} class="nv-input" type="number" data-focusable value={value} oninput={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) draft = { ...draft, [name]: next } }} />{:else if typeof value === 'string'}<input id={`nv-setting-${name}`} class="nv-input" data-focusable value={value} oninput={(event) => draft = { ...draft, [name]: event.currentTarget.value }} />{:else}<p id={`nv-setting-${name}`} class="nv-help truncate font-mono text-xs">{JSON.stringify(value)}</p><button data-focusable class="mt-1 min-h-10 text-xs font-bold underline underline-offset-4" onclick={() => { json = JSON.stringify(draft, null, 2); advanced = true }}>Edit structured value</button>{/if}</div></div>
    {/each}
    {#if !Object.keys(draft).length}<p class="nv-empty">No preferences saved for this client yet.</p>{/if}
    <div class="mt-5 flex flex-wrap gap-2"><button data-focusable class="nv-btn" onclick={() => { json = JSON.stringify(draft, null, 2); advanced = !advanced }}>Advanced JSON editor</button><button data-focusable class="nv-btn nv-primary" disabled={!changed || advanced} onclick={() => run(async () => { await nuvioCloud.saveBlob(kind, profileId, $state.snapshot(draft), baseline, platform, abort.signal); if (!abort.signal.aborted) { await load(); notice = 'Preferences saved to Nuvio.' } })}>{busy ? 'Saving…' : 'Save document to Nuvio'}</button>{#if changed}<span class="nv-help self-center">Unsaved changes</span>{/if}</div>
    {#if advanced}<div class="nv-panel mt-5"><label class="nv-label">Complete settings document<textarea class="nv-input min-h-80 font-mono text-xs" data-focusable spellcheck="false" bind:value={json}></textarea></label><p class="nv-help mt-2 text-xs">Adding or removing fields here changes the complete document for {platform}.</p><button data-focusable class="nv-btn mt-3" onclick={applyJson}>Apply JSON to draft</button></div>{/if}
  </fieldset>
{/if}
<dialog class="nv-dialog" bind:this={review} aria-labelledby="nv-settings-review"><h3 class="text-xl font-black" id="nv-settings-review">Apply preferences to this device</h3><p class="nv-help mt-3">Replace these {transferable.length} local preferences with the reviewed values. Other preferences stay as they are.</p><ul data-nav-scroll-container class="my-5 max-h-60 overflow-y-auto space-y-2 text-sm">{#each transferable as key}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><li class="capitalize" data-focusable={stops ? '' : undefined} tabindex={stops ? 0 : undefined}>{label(key)}</li>{/each}</ul><div class="flex flex-wrap gap-2"><button data-focusable class="nv-btn nv-primary" onclick={() => { try { const count = importCloudSettings(kind, $state.snapshot(draft)); notice = `${count} preferences applied to this device.`; review.close() } catch (reason) { error = reason instanceof Error ? reason.message : 'Could not apply preferences.'; review.close() } }}>Apply reviewed preferences</button><button data-focusable class="nv-btn" onclick={() => review.close()}>Cancel</button></div></dialog>
