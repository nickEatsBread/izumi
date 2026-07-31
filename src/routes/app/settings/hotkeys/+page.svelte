<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { isAndroid } from '$lib/platform'
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw'
  import {
    HOTKEYS,
    conflictingHotkey,
    displayBinding,
    effectiveBinding,
    eventToBinding,
    isModifierOnly,
    type HotkeyId,
  } from '$lib/hotkeys'
  import { hotkeyBindings } from '$lib/settings/ui'

  let recording = $state<HotkeyId | null>(null)
  let conflict = $state('')

  const groups = $derived([...new Set(HOTKEYS.map((hotkey) => `${hotkey.scope}|${hotkey.group}`))])

  function capture(event: KeyboardEvent, id: HotkeyId) {
    event.preventDefault()
    event.stopPropagation()
    if (isModifierOnly(event)) return
    if (event.key === 'Escape') {
      recording = null
      conflict = ''
      return
    }
    const binding = eventToBinding(event)
    const other = conflictingHotkey(id, binding, $hotkeyBindings)
    if (other) {
      conflict = `${displayBinding(binding)} is already used by “${other.label}” in ${other.scope}.`
      return
    }
    $hotkeyBindings = { ...$hotkeyBindings, [id]: binding }
    recording = null
    conflict = ''
  }

  function reset(id: HotkeyId) {
    const next = { ...$hotkeyBindings }
    delete next[id]
    $hotkeyBindings = next
    conflict = ''
  }

  function resetAll() {
    $hotkeyBindings = {}
    recording = null
    conflict = ''
  }

  // The category is hidden from the settings list on Android (SettingsNav), so this only catches a
  // stale deep link / restored route — send it back to the list instead of rendering keyboard
  // bindings on a device that has no keyboard scope to bind into.
  onMount(() => { if ($isAndroid) void goto('/app/settings', { replaceState: true }) })
</script>

{#if !$isAndroid}
<div class="p-4 sm:p-8">
  <div class="mb-6 flex max-w-3xl items-start justify-between gap-4">
    <div>
      <h2 class="mb-1 text-xl font-black">Hotkeys</h2>
      <p class="text-sm text-muted-foreground">Click a binding, then press its replacement. Conflicting shortcuts are rejected within the same scope.</p>
    </div>
    <button data-focusable onclick={resetAll} class="flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-secondary">
      <RotateCcw size={15} /> Reset all
    </button>
  </div>

  {#if conflict}
    <div role="alert" class="mb-4 max-w-3xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{conflict}</div>
  {/if}

  <div class="max-w-3xl space-y-7">
    {#each groups as group}
      {@const [scope, label] = group.split('|')}
      <section>
        <h3 class="mb-2 font-black">{label} <span class="ml-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{scope}</span></h3>
        <div class="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {#each HOTKEYS.filter((hotkey) => `${hotkey.scope}|${hotkey.group}` === group) as hotkey (hotkey.id)}
            {@const custom = !!$hotkeyBindings[hotkey.id]}
            <div class="flex items-center gap-3 p-3">
              <div class="min-w-0 flex-1">
                <div class="font-bold">{hotkey.label}</div>
                <div class="text-xs text-muted-foreground">{hotkey.description}</div>
              </div>
              {#if custom}
                <button data-focusable aria-label={`Reset ${hotkey.label}`} onclick={() => reset(hotkey.id)} class="rounded p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><RotateCcw size={15} /></button>
              {/if}
              <button
                data-focusable
                onkeydown={(event) => recording === hotkey.id && capture(event, hotkey.id)}
                onclick={() => { recording = hotkey.id; conflict = '' }}
                class="min-w-24 rounded-md border px-3 py-2 font-mono text-xs font-bold {recording === hotkey.id ? 'border-theme bg-theme/10 text-theme' : 'border-border bg-secondary'}"
              >
                {recording === hotkey.id ? 'Press a key…' : displayBinding(effectiveBinding(hotkey.id, $hotkeyBindings))}
              </button>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>
{/if}
