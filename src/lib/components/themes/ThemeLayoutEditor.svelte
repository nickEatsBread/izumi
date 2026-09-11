<script lang="ts">
  import { onMount } from 'svelte'
  import { parseNode, resolveRow, type ThemePresentation, type RowPresentation } from '$lib/themes/presentation'
  let { presentation = $bindable<ThemePresentation | undefined>() }: { presentation?: ThemePresentation } = $props()
  let scope = $state('hero')
  let rows = $state<Array<{ id: string; title: string }>>([])
  let templateText = $state('')
  let templateError = $state('')
  let templateTarget = $state<'template' | 'rank' | 'card'>('template')
  const hero = $derived(presentation?.hero ?? {})
  const row = $derived(resolveRow(presentation, scope === 'rows' ? '' : scope))
  const value = (event: Event) => (event.currentTarget as HTMLInputElement).value
  function refreshRows() {
    rows = [...document.querySelectorAll<HTMLElement>('[data-theme-row]')].map(element => ({ id: element.dataset.themeRow!, title: element.dataset.themeRowTitle || element.dataset.themeRow! })).filter((row, i, all) => all.findIndex(other => other.id === row.id) === i)
  }
  onMount(refreshRows)
  function setHero(patch: NonNullable<ThemePresentation['hero']>) { presentation = { ...presentation, hero: { ...hero, ...patch } } }
  function setRow(patch: RowPresentation) {
    const rows = presentation?.rows ?? {}
    presentation = { ...presentation, rows: scope === 'rows' ? { ...rows, defaults: { ...rows.defaults, ...patch } } : { ...rows, byId: { ...rows.byId, [scope]: { ...rows.byId?.[scope], ...patch } } } }
  }
  function reset() {
    const next = structuredClone($state.snapshot(presentation) ?? {})
    if (scope === 'hero') delete next.hero
    else if (scope === 'rows' && next.rows) delete next.rows.defaults
    else if (next.rows?.byId) delete next.rows.byId[scope]
    presentation = next; templateText = ''; templateError = ''
  }
  function loadTemplate() {
    const node = scope === 'hero' ? hero[templateTarget === 'rank' ? 'rank' : 'template'] : row.card
    templateText = node ? JSON.stringify(node, null, 2) : ''; templateError = ''
  }
  function applyTemplate() {
    try {
      const node = templateText.trim() ? parseNode(JSON.parse(templateText), undefined, 0, scope === 'hero' && templateTarget !== 'rank') : undefined
      if (scope === 'hero') setHero({ [templateTarget === 'rank' ? 'rank' : 'template']: node })
      else setRow({ card: node })
      templateError = ''
    } catch (cause) { templateError = cause instanceof Error ? cause.message : 'Check the template JSON.' }
  }
</script>

<section class="layout-editor">
  <h3>Layout & components</h3><p class="help">Choose a part of the page. Your changes appear live.</p>
  <label>Edit<select bind:value={scope} onchange={() => { templateText = ''; templateError = ''; templateTarget = scope === 'hero' ? 'template' : 'card' }} data-focusable><option value="hero">Home hero</option><option value="rows">All home rows</option>{#each rows as item}<option value={item.id}>{item.title}</option>{/each}</select></label>
  <button class="text-button" data-focusable onclick={refreshRows}>Refresh rows on this page</button>
  {#if scope === 'hero'}
    <label class="toggle"><span>Show hero</span><input type="checkbox" checked={!hero.hidden} onchange={event => setHero({ hidden: !event.currentTarget.checked })} data-focusable /></label>
    <label>Desktop height <output>{hero.height ?? 50}% of screen</output><input type="range" aria-label="Desktop hero height" min="24" max="75" value={hero.height ?? 50} oninput={event => setHero({ height: Number(value(event)) })} data-focusable /></label>
    <label>Mobile height <output>{hero.mobileHeight ?? 46}% of screen</output><input type="range" aria-label="Mobile hero height" min="24" max="75" value={hero.mobileHeight ?? 46} oninput={event => setHero({ mobileHeight: Number(value(event)) })} data-focusable /></label>
    <label class="toggle"><span>Rotate featured titles</span><input type="checkbox" checked={hero.rotate !== false} onchange={event => setHero({ rotate: event.currentTarget.checked })} data-focusable /></label>
    <label>Seconds per slide <output>{hero.interval ?? 15}s</output><input type="range" aria-label="Seconds per slide" min="5" max="60" value={hero.interval ?? 15} oninput={event => setHero({ interval: Number(value(event)) })} data-focusable /></label>
    <label class="toggle"><span>Show rank badge</span><input type="checkbox" checked={!hero.rankHidden} onchange={event => setHero({ rankHidden: !event.currentTarget.checked })} data-focusable /></label>
    <p class="help">Reduced motion takes priority over rotation. Custom hero templates can define their own metadata.</p>
  {:else}
    <label>Arrangement<select value={row.layout ?? 'carousel'} onchange={event => setRow({ layout: value(event) as RowPresentation['layout'] })} data-focusable><option value="carousel">Horizontal carousel</option><option value="grid">Wrapping grid</option></select></label>
    <label>Artwork shape<select value={row.aspect ?? 'poster'} onchange={event => setRow({ aspect: value(event) as RowPresentation['aspect'] })} data-focusable><option value="poster">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option></select></label>
    {#each [{ key: 'width', label: 'Card width', min: 96, max: 400, fallback: 152 }, { key: 'gap', label: 'Card spacing', min: 0, max: 48, fallback: 12 }, { key: 'spacing', label: 'Space below row', min: 0, max: 100, fallback: 32 }, { key: 'radius', label: 'Artwork corners', min: 0, max: 48, fallback: 6 }, { key: 'titleSize', label: 'Heading size', min: 12, max: 32, fallback: 18 }] as control}
      <label>{control.label} <output>{row[control.key as keyof RowPresentation] ?? control.fallback}px</output><input type="range" aria-label={control.label} min={control.min} max={control.max} value={Number(row[control.key as keyof RowPresentation] ?? control.fallback)} oninput={event => setRow({ [control.key]: Number(value(event)) })} data-focusable /></label>
    {/each}
    <p class="help">{scope === 'rows' ? 'Applies to all home rows unless a row has its own override.' : 'Only this row changes. Its identity stays the same when reordered.'} Custom card templates control their own artwork shape.</p>
    <a href="/app/settings/catalog/home" data-focusable>Arrange or hide home rows</a>
  {/if}
  <details><summary data-focusable>Advanced component template</summary><p class="help">Edit the theme’s data-only layout. Leave empty to use the default component.</p>
    {#if scope === 'hero'}<label>Component<select bind:value={templateTarget} onchange={loadTemplate} data-focusable><option value="template">Entire hero</option><option value="rank">Rank badge</option></select></label>{/if}
    <button class="text-button" data-focusable onclick={loadTemplate}>Load current template</button>
    <label>Template JSON<textarea bind:value={templateText} rows="10" spellcheck="false" data-focusable></textarea></label>
    {#if templateError}<p role="alert" class="help">{templateError}</p>{/if}<button class="text-button" data-focusable onclick={applyTemplate}>Apply template to draft</button>
  </details>
  <button class="text-button" data-focusable onclick={reset}>Reset this section to inherited layout</button>
  <a href="/app/settings/themes" data-focusable>Browse installable themes</a>
</section>

<style>
  .layout-editor { padding: 20px; color: var(--editor-fg); }
  h3 { font-size: 15px; font-weight: 800; }
  label { display: block; margin-top: 18px; font-size: 12px; font-weight: 700; }
  select, textarea { display: block; width: 100%; margin-top: 7px; background: var(--editor-control); color: var(--editor-fg); border: 1px solid var(--editor-line); border-radius: 6px; padding: 9px; }
  textarea { font: 11px 'Geist Mono', monospace; resize: vertical; }
  input[type='range'] { display: block; width: 100%; height: 30px; accent-color: var(--editor-accent); }
  .toggle { display: flex; justify-content: space-between; align-items: center; min-height: 36px; }
  input[type='checkbox'] { width: 18px; height: 18px; accent-color: var(--editor-accent); }
  output { float: right; color: var(--editor-muted); font-weight: 400; }
  .help { font-size: 11px; color: var(--editor-muted); line-height: 1.6; margin-top: 10px; }
  .text-button, a { display: block; padding: 9px 0; min-height: 36px; font-size: 12px; text-align: start; text-decoration: underline; text-underline-offset: 4px; }
  details { margin: 20px 0; padding-top: 16px; border-top: 1px solid var(--editor-line); }
  summary { font-size: 12px; font-weight: 700; cursor: pointer; }
  :is(button, input, select, textarea, summary, a):focus-visible { outline: 2px solid var(--editor-focus); outline-offset: 3px; }
</style>
