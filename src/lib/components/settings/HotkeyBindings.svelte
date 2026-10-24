<script lang="ts">
  import { isMacOS } from '$lib/platform'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
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

  // Keyboard rebinding for Playback › Controls. The page renders it only off Android, which has no
  // keyboard scope to bind into, and outside Game mode, where the controller has its own map.
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
    const other = conflictingHotkey(id, binding, $hotkeyBindings, $isMacOS)
    if (other) {
      conflict = `${displayBinding(binding, $isMacOS)} is already used by “${other.label}” in ${other.scope}.`
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
</script>

<div data-setting-key="hotkeys">
  <div class="mb-3 flex items-center justify-between gap-4 px-1">
    <p class="text-xs text-muted-foreground">Click a binding, then press the new key. Clashes in the same scope are rejected.</p>
    <button type="button" data-focusable onclick={resetAll} class="flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-secondary">
      <RotateCcw size={15} /> Reset all
    </button>
  </div>

  {#if conflict}
    <div role="alert" class="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{conflict}</div>
  {/if}

  <div class="space-y-5">
    {#each groups as group}
      {@const [scope, label] = group.split('|')}
      <section>
        <h4 class="mb-2 px-1 text-sm font-black">{label} <span class="ml-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{scope}</span></h4>
        <div class="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {#each HOTKEYS.filter((hotkey) => `${hotkey.scope}|${hotkey.group}` === group) as hotkey (hotkey.id)}
            {@const custom = !!$hotkeyBindings[hotkey.id]}
            <div class="flex items-center gap-3 p-3">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-bold">{hotkey.label}</div>
                <div class="text-xs text-muted-foreground">{hotkey.description}</div>
              </div>
              {#if custom}
                <button type="button" data-focusable aria-label={`Reset ${hotkey.label}`} onclick={() => reset(hotkey.id)} class="rounded p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><RotateCcw size={15} /></button>
              {/if}
              <button
                type="button"
                data-focusable
                data-nav-escape-local={recording === hotkey.id ? '' : undefined}
                onkeydown={(event) => recording === hotkey.id && capture(event, hotkey.id)}
                onclick={() => { recording = hotkey.id; conflict = '' }}
                class="min-w-24 rounded-md border px-3 py-2 font-mono text-xs font-bold {recording === hotkey.id ? 'border-theme bg-theme/10 text-theme' : 'border-border bg-secondary'}"
              >
                {recording === hotkey.id ? 'Press a key…' : displayBinding(effectiveBinding(hotkey.id, $hotkeyBindings, $isMacOS), $isMacOS)}
              </button>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>
