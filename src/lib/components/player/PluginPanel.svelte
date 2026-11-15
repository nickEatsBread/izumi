<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import ArrowUp from '@lucide/svelte/icons/arrow-up'
  import Languages from '@lucide/svelte/icons/languages'
  import Plus from '@lucide/svelte/icons/plus'
  import Search from '@lucide/svelte/icons/search'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import Square from '@lucide/svelte/icons/square'
  import Subtitles from '@lucide/svelte/icons/captions'
  import Timer from '@lucide/svelte/icons/timer'
  import Tv from '@lucide/svelte/icons/tv'
  import { nowPlayingMedia } from '$lib/player/session'
  import { openPluginPanel, pluginPanels, sendPluginEvent, type PanelIcon, type PluginRun } from '$lib/plugins/host'

  // A plugin's player panel, drawn the way Navigator's Ask panel is (components/navigator/focus.tsx,
  // focus-results.tsx, result-card.tsx, activity-status.tsx): the plugin sends only data, izumi draws it.
  let { run }: { run: PluginRun } = $props()
  let text = $state('')
  let field = $state<HTMLTextAreaElement | undefined>()
  let list = $state<HTMLDivElement | undefined>()
  const panel = $derived($pluginPanels[run.id] ?? { turns: [] })
  const busy = $derived(!!panel.activity)
  const poster = $derived($nowPlayingMedia?.media.coverImage?.large ?? $nowPlayingMedia?.media.coverImage?.medium)
  const icons: Record<PanelIcon, typeof Search> = { search: Search, subtitles: Subtitles, languages: Languages, tv: Tv, sparkles: Sparkles }

  // Navigator's motion: cubic-bezier(.23,1,.32,1), panel in 240 ms / out 180 ms over 24 px, cards
  // 180 ms over 10 px with a 50 ms stagger (max 150 ms), the activity pill 180 ms.
  function ease(t: number) {
    const x1 = 0.23, y1 = 1, x2 = 0.32, y2 = 1
    let u = t
    for (let i = 0; i < 8; i++) {
      const x = ((1 - 3 * x2 + 3 * x1) * u + (3 * x2 - 6 * x1)) * u * u + 3 * x1 * u - t
      const dx = (3 * (1 - 3 * x2 + 3 * x1) * u + 2 * (3 * x2 - 6 * x1)) * u + 3 * x1
      if (Math.abs(x) < 1e-5 || !dx) break
      u = Math.min(1, Math.max(0, u - x / dx))
    }
    return ((1 - 3 * y2 + 3 * y1) * u + (3 * y2 - 6 * y1)) * u * u + 3 * y1 * u
  }
  const rise = (_node: Element, { y = 24, duration = 240, delay = 0 } = {}) =>
    ({ delay, duration, easing: ease, css: (t: number, u: number) => `opacity:${t};transform:translateY(${u * y}px)` })
  const fadeIn = (_node: Element, { duration = 180 } = {}) => ({ duration, easing: ease, css: (t: number) => `opacity:${t}` })

  // Each pixel of the 3×3 loader lights up (col + |row - 1|) × 90 ms after the first.
  const pixelDelays = Array.from({ length: 9 }, (_, i) => ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90)

  $effect(() => { field?.focus() })
  $effect(() => {
    const close = () => openPluginPanel.set(null)
    window.addEventListener('player-menu-close', close)
    return () => window.removeEventListener('player-menu-close', close)
  })
  // Keep the newest step in view as the answer arrives.
  $effect(() => {
    void panel
    if (list) requestAnimationFrame(() => list && (list.scrollTop = list.scrollHeight))
  })
  // The composer grows with its text, up to min(8rem, 30dvh).
  $effect(() => {
    void text
    if (!field) return
    field.style.height = '0px'
    field.style.height = `${field.scrollHeight}px`
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    sendPluginEvent(run.id, 'prompt', { text: value.slice(0, 500) })
    text = ''
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); openPluginPanel.set(null); return }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    field?.form?.requestSubmit()
  }
</script>

{#snippet activity(label: string)}
  <span class="nav-activity" role="status" aria-busy="true">
    <span class="nav-pixels" aria-hidden="true">
      {#each pixelDelays as delay, i (i)}<span style:animation-delay="{delay}ms"></span>{/each}
    </span>
    <span class="nav-shimmer">{label}</span>
  </span>
{/snippet}

<div class="nav-ask pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4" data-part="player.menu" data-variant="plugin" data-plugin={run.id}>
  <div class="pointer-events-auto flex w-full max-w-xl flex-col items-center" in:rise out:rise={{ duration: 180 }}>
    {#if busy || panel.turns.length}
      <div class="mb-2 flex h-7 w-full items-center">
        {#if busy}
          <div class="nav-pill mr-auto" in:fadeIn out:fadeIn>{@render activity(panel.activity ?? '')}</div>
        {:else}
          <button type="button" data-focusable class="nav-pill nav-new ml-auto" in:fadeIn
                  onclick={() => sendPluginEvent(run.id, 'reset', {})}><Plus size={14} strokeWidth={2} aria-hidden="true" />New</button>
        {/if}
      </div>
    {/if}
    <section class="nav-panel w-full" class:nav-busy={busy} aria-label={run.panel?.label}>
      {#if run.state === 'failed'}
        <p class="nav-error">{run.name} stopped: {run.error}</p>
      {/if}
      {#if panel.turns.length}
        <div bind:this={list} class="nav-messages">
          {#each panel.turns as turn (turn.id)}
            <div class="space-y-0">
              <div class="nav-user" class:nav-user-short={turn.question.length <= 48 && !turn.question.includes('\n')} in:fadeIn>
                <p>{turn.question}</p>
              </div>
              <div class="mt-3">
                {#each turn.steps as step, s (s)}
                  {@const Icon = icons[step.icon ?? 'sparkles']}
                  <p class="nav-trace" class:nav-trace-error={step.state === 'error'} role="status" aria-busy={step.state === 'running'}>
                    <Icon size={16} strokeWidth={1.5} aria-hidden="true" class="shrink-0" /><span class="min-w-0 truncate">{step.label}</span>
                  </p>
                  {#if step.cards?.length}
                    <div class="flex w-full flex-col gap-0.5">
                      {#each step.cards as card, c (c)}
                        {@const CardIcon = card.icon ? icons[card.icon] : null}
                        {@const leading = (card.image === 'poster' && poster) || CardIcon}
                        <div in:rise={{ y: 10, duration: 180, delay: Math.min(c * 50, 150) }}>
                          <svelte:element this={card.id ? 'button' : 'div'} type={card.id ? 'button' : undefined} data-focusable={card.id ? '' : undefined}
                                          class="nav-card" class:nav-card-text={!leading} class:nav-card-interactive={!!card.id} class:nav-card-scene={!!card.quote}
                                          onclick={card.id ? () => sendPluginEvent(run.id, 'select', { id: card.id }) : undefined} role={card.id ? undefined : 'group'}>
                            {#if card.image === 'poster' && poster}
                              <img src={poster} alt="" aria-hidden="true" draggable="false" class="nav-card-image" />
                            {:else if CardIcon}
                              <span class="nav-card-leading" aria-hidden="true"><CardIcon size={16} /></span>
                            {/if}
                            <span class="nav-card-copy">
                              <span class="nav-card-title"><span class="nav-card-title-text">{card.title}</span>{#if card.id}<ArrowRight size={16} class="nav-card-arrow" aria-hidden="true" />{/if}</span>
                              {#if card.subtitle}<span class="nav-card-subtitle">{card.subtitle}</span>{/if}
                              {#if card.meta?.length}<span class="nav-card-metadata">{#each card.meta as meta, m (m)}<span class="nav-card-meta">{meta}</span>{/each}</span>{/if}
                              {#if card.quote}<span class="nav-card-body"><span class="nav-quote">“{card.quote}”</span></span>{/if}
                            </span>
                          </svelte:element>
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/each}
                {#if turn.text}<p class="nav-text">{turn.text}</p>{/if}
                {#if turn.seconds !== undefined}
                  <p class="nav-done"><Timer size={14} aria-hidden="true" />Done in {Math.max(1, Math.round(turn.seconds))}s</p>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
      <form class="relative" onsubmit={submit}>
        <div class="nav-input-group">
          <span class="nav-addon" aria-hidden="true"><Sparkles size={20} strokeWidth={1.5} /></span>
          <textarea bind:this={field} bind:value={text} rows="1" maxlength="500" data-focusable autocomplete="off"
                    aria-label={run.panel?.label} placeholder={run.panel?.placeholder} disabled={busy} onkeydown={onKey}
                    class="nav-composer"></textarea>
          <button type={busy ? 'button' : 'submit'} class="nav-send" aria-label={busy ? 'Stop response' : 'Send message'}
                  disabled={!busy && !text.trim()} onclick={busy ? () => sendPluginEvent(run.id, 'stop', {}) : undefined}>
            {#if busy}<Square size={16} strokeWidth={2} class="opacity-70" />{:else}<ArrowUp size={20} />{/if}
          </button>
        </div>
      </form>
    </section>
  </div>
</div>

<style>
  /* Navigator's dark tokens (app/globals.css .dark, arc/foundation.css). */
  .nav-ask {
    --nav-popover: oklch(0.205 0 0);
    --nav-foreground: oklch(0.985 0 0);
    --nav-muted: oklch(0.269 0 0);
    --nav-muted-foreground: oklch(0.708 0 0);
    --nav-border: oklch(1 0 0 / 10%);
    --nav-primary: oklch(0.70 0.12 183);
    --nav-destructive: oklch(0.704 0.191 22.216);
    --nav-radius: 0.625rem;
    --nav-ease: cubic-bezier(.23, 1, .32, 1);
    color: var(--nav-foreground);
  }
  .nav-pill {
    display: flex; height: 2rem; width: fit-content; align-items: center; border-radius: 9999px;
    border: 1px solid var(--nav-border); padding: 0 0.75rem;
    background: color-mix(in oklab, var(--nav-popover) 75%, transparent); backdrop-filter: blur(8px);
  }
  .nav-new { gap: 0.375rem; font-size: 0.875rem; line-height: 1.25rem; color: var(--nav-muted-foreground); transition: background-color 200ms ease-in-out, color 200ms ease-in-out; }
  .nav-new:hover { background: var(--nav-muted); color: var(--nav-foreground); }
  .nav-activity { display: flex; align-items: center; gap: 0.625rem; }
  .nav-pixels { display: grid; grid-template-columns: repeat(3, 4px); gap: 1.5px; }
  .nav-pixels > span { width: 4px; height: 4px; border-radius: 1px; background: var(--nav-foreground); opacity: 0.15; animation: nav-pixel-on 650ms ease-in-out infinite; }
  @keyframes nav-pixel-on { 0%, 100% { opacity: 0.15 } 18%, 42% { opacity: 1 } 62% { opacity: 0.15 } }
  .nav-shimmer {
    display: inline-block; min-width: 0; font-size: 0.875rem; line-height: 1.25rem; font-weight: 500; color: transparent;
    background-image: linear-gradient(90deg, var(--nav-muted-foreground) 35%, var(--nav-foreground) 50%, var(--nav-muted-foreground) 65%);
    background-size: 200% 100%; background-clip: text; -webkit-background-clip: text;
    animation: nav-shimmer 1.4s linear infinite;
  }
  @keyframes nav-shimmer { from { background-position: 150% center } to { background-position: -50% center } }
  /* Panel: rounded-xl, p-2, popover/75 over an 8px blur, ring-1 border, shadow-2xl primary/15. */
  .nav-panel {
    position: relative; border-radius: 0.75rem; padding: 0.5rem;
    background: color-mix(in oklab, var(--nav-popover) 75%, transparent); backdrop-filter: blur(8px);
    box-shadow: 0 0 0 1px var(--nav-border), 0 25px 50px -12px color-mix(in oklab, var(--nav-primary) 15%, transparent);
  }
  /* While a plugin works, a light travels around the panel's edge every 4 s, with a faint inner glow, the
     way Navigator's BorderBeam does. */
  @property --nav-beam-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
  .nav-busy::before {
    content: ''; position: absolute; inset: -1px; border-radius: inherit; padding: 1px; pointer-events: none;
    background: conic-gradient(from var(--nav-beam-angle), transparent 0deg, transparent 280deg, var(--nav-primary) 330deg, color-mix(in oklab, var(--nav-primary) 40%, white) 350deg, transparent 360deg);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;
    animation: nav-beam 4s linear infinite;
  }
  .nav-busy::after {
    content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    box-shadow: inset 0 0 9px 1px color-mix(in oklab, var(--nav-primary) 20%, transparent);
  }
  @keyframes nav-beam { to { --nav-beam-angle: 360deg } }
  .nav-messages {
    margin: 0 -0.5rem 0.75rem; max-height: 18rem; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
    padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 1rem;
  }
  @media (min-width: 40rem) { .nav-messages { max-height: min(26rem, calc(100dvh - 12rem)); } }
  .nav-user {
    margin-left: auto; width: fit-content; max-width: 80%; border-radius: 1rem; padding: 0.5rem 1rem;
    background: color-mix(in oklab, var(--nav-primary) 10%, transparent); color: var(--nav-primary); backdrop-filter: blur(8px);
  }
  .nav-user-short { border-radius: 9999px; }
  .nav-user p { margin: 0; font-size: 15px; line-height: 1.5rem; overflow-wrap: break-word; white-space: pre-wrap; }
  .nav-trace { display: flex; min-height: 1.75rem; align-items: center; gap: 0.5rem; padding: 0.25rem 0.5rem; margin: 0; font-size: 0.875rem; font-weight: 500; line-height: 1.4; color: var(--nav-muted-foreground); }
  .nav-trace-error { color: var(--nav-destructive); }
  .nav-text { margin: 0.5rem 0 0; padding: 0 0.5rem; font-size: 15px; line-height: 1.5rem; overflow-wrap: break-word; }
  .nav-done { margin: 0.5rem 0 0; display: flex; align-items: center; gap: 0.375rem; padding: 0 0.5rem; font-size: 0.8125rem; line-height: 1rem; color: var(--nav-muted-foreground); font-variant-numeric: tabular-nums; }
  .nav-error { margin: 0 0 0.5rem; padding: 0 0.5rem; font-size: 0.875rem; color: var(--nav-destructive); }
  /* Result card (result-card.module.css). */
  .nav-card { display: flex; width: 100%; min-width: 0; align-items: center; gap: 0.75rem; border: 0; border-radius: var(--nav-radius); padding: 0.375rem 0.5rem; background: transparent; color: var(--nav-foreground); font: inherit; font-size: 0.875rem; line-height: 1.5; text-align: start; }
  .nav-card-text { padding-inline-start: var(--nav-text-inset, 3.25rem); }
  .nav-card-scene { --nav-text-inset: 0.5rem; --nav-body-gap: 0.25rem; }
  .nav-card-interactive { cursor: pointer; transition: background-color 120ms ease, transform 150ms cubic-bezier(0.2, 0, 0, 1); }
  .nav-card-interactive:active { transform: scale(0.995); }
  .nav-card-interactive:hover, .nav-card-interactive:focus-visible { background: var(--nav-muted); }
  .nav-card-image { flex: none; width: 2rem; height: 3rem; object-fit: cover; border-radius: calc(var(--nav-radius) * 0.6); outline: 1px solid oklch(1 0 0 / 0.1); outline-offset: -1px; }
  .nav-card-leading { display: flex; flex: none; width: 2rem; height: 2rem; align-items: center; justify-content: center; border-radius: calc(var(--nav-radius) * 0.6); background: var(--nav-muted); color: var(--nav-muted-foreground); }
  .nav-card-copy { display: block; min-width: 0; flex: 1; }
  .nav-card-title { display: flex; min-width: 0; align-items: center; gap: 0.25rem; font-weight: 600; line-height: 1.4; }
  .nav-card-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-card-scene .nav-card-title-text { font-variant-numeric: tabular-nums; }
  :global(.nav-card-arrow) { flex: none; color: var(--nav-muted-foreground); opacity: 0; transition: opacity 120ms ease; }
  .nav-card-interactive:hover :global(.nav-card-arrow), .nav-card-interactive:focus-visible :global(.nav-card-arrow) { opacity: 1; }
  .nav-card-subtitle { display: block; margin-top: 0.125rem; color: var(--nav-muted-foreground); font-size: 0.8125rem; font-weight: 400; line-height: 1.4; overflow-wrap: anywhere; }
  .nav-card-metadata { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; column-gap: 0.375rem; row-gap: 0.125rem; margin-top: 0.125rem; }
  .nav-card-meta { color: var(--nav-muted-foreground); font-size: 0.75rem; font-weight: 400; line-height: 1.45; font-variant-numeric: tabular-nums; }
  .nav-card-meta + .nav-card-meta::before { content: '·'; margin-right: 0.375rem; }
  .nav-card-body { display: block; margin-top: var(--nav-body-gap, 0.5rem); }
  .nav-quote { display: block; color: var(--nav-muted-foreground); font-size: 0.875rem; font-weight: 400; line-height: 1.55; border-inline-start: 2px solid var(--nav-border); padding-inline-start: 0.375rem; max-width: 65ch; overflow-wrap: anywhere; text-wrap: pretty; }
  /* Composer (focus.tsx InputGroup + composer-input.tsx). */
  .nav-input-group { display: flex; min-height: 2.5rem; align-items: flex-end; border-radius: 0.5rem; padding: 3px 0; }
  .nav-addon { display: flex; flex-shrink: 0; align-self: flex-end; align-items: center; justify-content: center; padding: 0.375rem 0.625rem; color: var(--nav-muted-foreground); }
  .nav-composer {
    flex: 1; min-width: 0; min-height: 2rem; max-height: min(8rem, 30dvh); resize: none; overflow-y: auto; overscroll-behavior: contain;
    border: 0; outline: none; background: transparent; padding: 0.25rem 0 0.25rem 0.375rem; font-size: 1rem; line-height: 1.5rem; color: var(--nav-foreground);
  }
  .nav-composer::placeholder { color: var(--nav-muted-foreground); }
  .nav-send {
    display: grid; flex-shrink: 0; align-self: flex-end; place-items: center; width: 2rem; height: 2rem; margin-right: 0.25rem; border-radius: 10px;
    color: var(--nav-muted-foreground); transition: background-color 200ms ease-in-out, opacity 200ms ease-in-out;
  }
  .nav-send:hover:not(:disabled) { background: var(--nav-muted); }
  .nav-send:disabled { opacity: 0.52; cursor: not-allowed; }
  @media (prefers-reduced-motion: reduce) {
    .nav-pixels > span, .nav-busy::before { animation: none; }
    .nav-shimmer { animation: none; background-image: none; color: var(--nav-muted-foreground); }
  }
</style>
