<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import Controls from '$lib/components/player/Controls.svelte'
  // Route-local stylesheet: forces this window transparent (see the file).
  import './transparent.css'

  let title = $state('')
  let pos = $state(0)
  let dur = $state(0)
  let paused = $state(false)
  let visible = $state(true)
  let hideT: ReturnType<typeof setTimeout>

  // Show controls, then auto-hide after 3s of inactivity.
  function poke() {
    visible = true
    clearTimeout(hideT)
    hideT = setTimeout(() => (visible = false), 3000)
  }

  // Run an mpv command, then re-read `pause` so the play/pause glyph stays in
  // sync (mpv doesn't push a `pause` event through our progress channel).
  async function cmd(name: string, args: string[] = []) {
    try {
      await invoke('player_command', { name, args })
      const p = await invoke<string>('player_get_property', { name: 'pause' })
      paused = p === 'yes' || p === 'true'
    }
    catch (e) {
      console.warn('player_command failed', name, args, e)
    }
  }

  onMount(() => {
    // The global app.css paints html/body opaque; force this window transparent
    // both here and via the route <style> below so mpv shows through.
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'

    const un1 = listen<[number, number]>('player-progress', (e) => {
      pos = e.payload[0]
      dur = e.payload[1]
    })
    const un2 = listen<string>('now-playing', (e) => (title = e.payload))
    poke()
    return () => {
      un1.then((f) => f())
      un2.then((f) => f())
      clearTimeout(hideT)
    }
  })
</script>

<svelte:window
  onmousemove={poke}
  onkeydown={(e) => {
    poke()
    if (e.key === 'Escape') invoke('close_player')
    else if (e.key === ' ' || e.key === 'k') cmd('cycle', ['pause'])
    else if (e.key === 'ArrowLeft') cmd('seek', ['-10'])
    else if (e.key === 'ArrowRight') cmd('seek', ['10'])
  }}
/>

<!-- Full-screen transparent video surface. Clicking it toggles pause (like
     izumi / most players); the control bar stops propagation. -->
<div
  class="fixed inset-0 cursor-none"
  class:cursor-auto={visible}
  onclick={() => cmd('cycle', ['pause'])}
  role="presentation"
>
  {#if visible}
    <Controls {title} {pos} {dur} {paused} {cmd} onclose={() => invoke('close_player')} />
  {/if}
</div>
