<script lang="ts">
  import { onMount } from 'svelte'
  import { parseNode, resolveRow, resolveDetail, themeCoverage, templateOutline, type ThemePresentation, type RowPresentation, type ThemeNode, type TemplateOutline } from '$lib/themes/presentation'
  let { presentation = $bindable<ThemePresentation | undefined>() }: { presentation?: ThemePresentation } = $props()
  let scope = $state('chrome')
  let rows = $state<Array<{ id: string; title: string }>>([])
  let templateText = $state('')
  let templateError = $state('')
  let templateTarget = $state<'template' | 'rank' | 'card' | 'facts' | 'poster' | 'continue' | 'search'>('template')
  const hero = $derived(presentation?.hero ?? {})
  const row = $derived(resolveRow(presentation, scope === 'rows' ? '' : scope))
  const detail = $derived(resolveDetail(presentation))
  const coverage = $derived(themeCoverage(presentation))
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
  function setChrome<K extends 'density' | 'hideCardLabels' | 'trueBlack'>(key: K, next: ThemePresentation[K]) {
    presentation = { ...presentation, [key]: next }
  }
  function setDetail(patch: NonNullable<ThemePresentation['detail']>) {
    presentation = { ...presentation, detail: { ...presentation?.detail, ...patch, episodes: { ...presentation?.detail?.episodes, ...patch.episodes } } }
  }
  function setShell(patch: NonNullable<ThemePresentation['shell']>) {
    presentation = { ...presentation, shell: { ...presentation?.shell, ...patch } }
  }
  function setPlayer(patch: NonNullable<ThemePresentation['player']>) {
    presentation = { ...presentation, player: { ...presentation?.player, ...patch } }
  }
  function reset() {
    const next = structuredClone($state.snapshot(presentation) ?? {})
    if (scope === 'chrome') { delete next.density; delete next.hideCardLabels; delete next.trueBlack }
    else if (scope === 'hero') delete next.hero
    else if (scope === 'detail') delete next.detail
    else if (scope === 'shell') delete next.shell
    else if (scope === 'player') delete next.player
    else if (scope === 'cards') delete next.cards
    else if (scope === 'rows' && next.rows) delete next.rows.defaults
    else if (next.rows?.byId) delete next.rows.byId[scope]
    presentation = next; templateText = ''; templateError = ''
  }
  function currentTemplate(): ThemeNode | undefined {
    if (scope === 'hero') return hero[templateTarget === 'rank' ? 'rank' : 'template']
    if (scope === 'detail') return templateTarget === 'facts' ? presentation?.detail?.facts : detail.episodes?.card
    if (scope === 'cards') return presentation?.cards?.[templateTarget === 'continue' ? 'continue' : templateTarget === 'search' ? 'search' : 'poster']
    return row.card
  }
  function loadTemplate() {
    const node = currentTemplate()
    templateText = node ? JSON.stringify(node, null, 2) : ''; templateError = ''
  }
  function applyTemplate() {
    try {
      const interactive = scope === 'hero' && templateTarget !== 'rank'
      const node = templateText.trim() ? parseNode(JSON.parse(templateText), undefined, 0, interactive) : undefined
      if (scope === 'hero') setHero({ [templateTarget === 'rank' ? 'rank' : 'template']: node })
      else if (scope === 'detail' && templateTarget === 'facts') setDetail({ facts: node })
      else if (scope === 'detail') setDetail({ episodes: { card: node } })
      else if (scope === 'cards') presentation = { ...presentation, cards: { ...presentation?.cards, [templateTarget === 'continue' ? 'continue' : templateTarget === 'search' ? 'search' : 'poster']: node } }
      else setRow({ card: node })
      templateError = ''
    } catch (cause) { templateError = cause instanceof Error ? cause.message : 'Check the template JSON.' }
  }
  const outline = $derived.by((): TemplateOutline | undefined => {
    const node = currentTemplate()
    return node ? templateOutline(node) : undefined
  })
  const showTemplate = $derived(!['chrome', 'shell', 'player'].includes(scope))
</script>

{#snippet tree(item: TemplateOutline)}
  <li>
    <span class="node-type">{item.type}</span>
    {#if item.label}<span class="node-label">{item.label}</span>{/if}
    {#if item.children?.length}
      <ul>{@render treeList(item.children)}</ul>
    {/if}
  </li>
{/snippet}
{#snippet treeList(items: TemplateOutline[])}
  {#each items as item}{@render tree(item)}{/each}
{/snippet}

<section class="layout-editor">
  <h3>Layout & components</h3>
  <p class="help">Choose a surface. Changes appear live. Themes style chrome and templates; they do not reorder home rows, navigation destinations, or the episode list density setting.</p>
  {#if coverage.length}
    <p class="coverage" aria-label="Theme coverage">{#each coverage as area}<span>{area}</span>{/each}</p>
  {:else}
    <p class="coverage empty">No extra layout yet — appearance tokens still apply everywhere.</p>
  {/if}
  <label>Edit<select bind:value={scope} onchange={() => { templateText = ''; templateError = ''; templateTarget = scope === 'hero' ? 'template' : scope === 'cards' ? 'poster' : scope === 'detail' ? 'card' : 'card' }} data-focusable>
    <option value="chrome">Density & labels</option>
    <option value="shell">Navigation chrome</option>
    <option value="hero">Home hero</option>
    <option value="rows">All home rows</option>
    {#each rows as item}<option value={item.id}>{item.title}</option>{/each}
    <option value="cards">Card families</option>
    <option value="detail">Series page</option>
    <option value="player">Player seekbar</option>
  </select></label>
  <button class="text-button" data-focusable onclick={refreshRows}>Refresh rows on this page</button>

  {#if scope === 'chrome'}
    <label>Information density<select value={presentation?.density ?? 'comfortable'} onchange={event => setChrome('density', value(event) as ThemePresentation['density'])} data-focusable>
      <option value="compact">Compact</option>
      <option value="comfortable">Comfortable</option>
      <option value="large">Large</option>
    </select></label>
    <label class="toggle"><span>Hide poster titles</span><input type="checkbox" checked={!!presentation?.hideCardLabels} onchange={event => setChrome('hideCardLabels', event.currentTarget.checked)} data-focusable /></label>
    <label class="toggle"><span>True black canvas</span><input type="checkbox" checked={!!presentation?.trueBlack} onchange={event => setChrome('trueBlack', event.currentTarget.checked)} data-focusable /></label>
    <p class="help">True black only applies to dark palettes. Poster titles hide on media cards, including search tiles.</p>
  {:else if scope === 'shell'}
    <label>Navigation placement<select value={presentation?.shell?.nav ?? 'sidebar'} onchange={event => setShell({ nav: value(event) as NonNullable<ThemePresentation['shell']>['nav'] })} data-focusable>
      <option value="sidebar">Side rail</option>
      <option value="top">Top bar</option>
      <option value="bottom">Bottom bar</option>
    </select></label>
    <label class="toggle"><span>Compact chrome</span><input type="checkbox" checked={!!presentation?.shell?.compact} onchange={event => setShell({ compact: event.currentTarget.checked })} data-focusable /></label>
    <p class="help">Placement is ignored on phones, which keep the bottom bar. Destination order stays in Settings → Navigation.</p>
  {:else if scope === 'hero'}
    <label class="toggle"><span>Show hero</span><input type="checkbox" checked={!hero.hidden} onchange={event => setHero({ hidden: !event.currentTarget.checked })} data-focusable /></label>
    <label>Desktop height <output>{hero.height ?? 50}% of screen</output><input type="range" aria-label="Desktop hero height" min="24" max="75" value={hero.height ?? 50} oninput={event => setHero({ height: Number(value(event)) })} data-focusable /></label>
    <label>Mobile height <output>{hero.mobileHeight ?? 46}% of screen</output><input type="range" aria-label="Mobile hero height" min="24" max="75" value={hero.mobileHeight ?? 46} oninput={event => setHero({ mobileHeight: Number(value(event)) })} data-focusable /></label>
    <label class="toggle"><span>Rotate featured titles</span><input type="checkbox" checked={hero.rotate !== false} onchange={event => setHero({ rotate: event.currentTarget.checked })} data-focusable /></label>
    <label>Seconds per slide <output>{hero.interval ?? 15}s</output><input type="range" aria-label="Seconds per slide" min="5" max="60" value={hero.interval ?? 15} oninput={event => setHero({ interval: Number(value(event)) })} data-focusable /></label>
    <label class="toggle"><span>Show rank badge</span><input type="checkbox" checked={!hero.rankHidden} onchange={event => setHero({ rankHidden: !event.currentTarget.checked })} data-focusable /></label>
    <p class="help">Reduced motion takes priority over rotation. Custom hero templates can define their own metadata.</p>
  {:else if scope === 'detail'}
    <label>Page composition<select value={presentation?.detail?.layout ?? 'stack'} onchange={event => { const layout = value(event) as NonNullable<ThemePresentation['detail']>['layout']; setDetail({ layout, episodes: { placement: layout === 'split' ? 'right' : layout === 'overlay' ? 'below' : 'tab' } }) }} data-focusable>
      <option value="stack">Stacked (tabs)</option>
      <option value="split">Split (info + episode rail)</option>
      <option value="overlay">Overlay (title and play on the artwork)</option>
    </select></label>
    <label>Episode placement<select value={detail.episodes?.placement ?? 'tab'} onchange={event => setDetail({ episodes: { placement: value(event) as NonNullable<NonNullable<ThemePresentation['detail']>['episodes']>['placement'] } })} data-focusable>
      <option value="tab">Inside the Episodes tab</option>
      <option value="right">Right-hand rail</option>
      <option value="below">Below the series info</option>
    </select></label>
    <label>Episode arrangement<select value={detail.episodes?.arrangement ?? 'grid'} onchange={event => setDetail({ episodes: { arrangement: value(event) as 'list' | 'grid' } })} data-focusable>
      <option value="grid">Wrapping grid</option>
      <option value="list">One per row</option>
    </select></label>
    <label>Episode hover<select value={detail.episodes?.hover ?? 'none'} onchange={event => setDetail({ episodes: { hover: value(event) as 'scale' | 'none' } })} data-focusable>
      <option value="none">Subtle lift</option>
      <option value="scale">Grow on hover</option>
    </select></label>
    <label class="toggle"><span>Play and list actions before synopsis</span><input type="checkbox" checked={!!detail.actionsFirst} onchange={event => setDetail({ actionsFirst: event.currentTarget.checked })} data-focusable /></label>
    <label>Cover alignment<select value={detail.coverAlign ?? 'start'} onchange={event => setDetail({ coverAlign: value(event) as 'start' | 'end' })} data-focusable>
      <option value="start">Top</option>
      <option value="end">Bottom (next to title)</option>
    </select></label>
    <label>Play button<select value={detail.cta ?? 'default'} onchange={event => setDetail({ cta: value(event) as 'default' | 'large' })} data-focusable>
      <option value="default">Compact Play</option>
      <option value="large">Wide Watch Now</option>
    </select></label>
    <label class="toggle"><span>Show banner artwork</span><input type="checkbox" checked={!detail.bannerHidden} onchange={event => setDetail({ bannerHidden: !event.currentTarget.checked })} data-focusable /></label>
    <label>Poster width <output>{detail.posterWidth ?? 176}px</output><input type="range" aria-label="Poster width" min="96" max="360" value={detail.posterWidth ?? 176} oninput={event => setDetail({ posterWidth: Number(value(event)) })} data-focusable /></label>
    <p class="help">A right-hand rail becomes a list below the info column on narrow windows. Overlay paints title and Play on the banner and keeps episodes below. One-per-row arrangement stacks full-width episode tiles. Facts and episode-card templates are editable below. The cards / compact / grid control still belongs to Appearance.</p>
  {:else if scope === 'player'}
    <label>Seekbar thickness <output>{presentation?.player?.seekbarHeight ?? 4}px</output><input type="range" aria-label="Seekbar thickness" min="2" max="16" value={presentation?.player?.seekbarHeight ?? 4} oninput={event => setPlayer({ seekbarHeight: Number(value(event)) })} data-focusable /></label>
    <label>Seekbar color<select value={presentation?.player?.seekbarColor ?? 'foreground'} onchange={event => setPlayer({ seekbarColor: value(event) })} data-focusable>
      <option value="foreground">Text</option>
      <option value="theme">Brand accent</option>
      <option value="primary">Primary</option>
      <option value="card-foreground">Card text</option>
    </select></label>
    <p class="help">Skip rules, subtitle files and playback shortcuts stay in Settings. This only restyles the bar.</p>
  {:else if scope === 'cards'}
    <p class="help">Poster templates cover ordinary media tiles. Continue and search can override that family. Home row templates still win on their own row.</p>
  {:else}
    <label>Arrangement<select value={row.layout ?? 'carousel'} onchange={event => setRow({ layout: value(event) as RowPresentation['layout'] })} data-focusable><option value="carousel">Horizontal carousel</option><option value="grid">Wrapping grid</option></select></label>
    <label>Artwork shape<select value={row.aspect ?? 'poster'} onchange={event => setRow({ aspect: value(event) as RowPresentation['aspect'] })} data-focusable><option value="poster">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option></select></label>
    {#each [{ key: 'width', label: 'Card width', min: 96, max: 400, fallback: 152 }, { key: 'gap', label: 'Card spacing', min: 0, max: 48, fallback: 12 }, { key: 'spacing', label: 'Space below row', min: 0, max: 100, fallback: 32 }, { key: 'radius', label: 'Artwork corners', min: 0, max: 48, fallback: 6 }, { key: 'titleSize', label: 'Heading size', min: 12, max: 32, fallback: 18 }] as control}
      <label>{control.label} <output>{row[control.key as keyof RowPresentation] ?? control.fallback}px</output><input type="range" aria-label={control.label} min={control.min} max={control.max} value={Number(row[control.key as keyof RowPresentation] ?? control.fallback)} oninput={event => setRow({ [control.key]: Number(value(event)) })} data-focusable /></label>
    {/each}
    <p class="help">{scope === 'rows' ? 'Applies to all home rows unless a row has its own override.' : 'Only this row changes. Its identity stays the same when reordered.'} Custom card templates control their own artwork shape.</p>
    <a href="/app/settings/catalog/home" data-focusable>Arrange or hide home rows</a>
  {/if}

  {#if showTemplate}
  <details><summary data-focusable>Advanced component template</summary><p class="help">Edit the theme’s data-only layout. Leave empty to use the default component.</p>
    {#if scope === 'hero'}<label>Component<select bind:value={templateTarget} onchange={loadTemplate} data-focusable><option value="template">Entire hero</option><option value="rank">Rank badge</option></select></label>{/if}
    {#if scope === 'detail'}<label>Component<select bind:value={templateTarget} onchange={loadTemplate} data-focusable><option value="card">Episode card</option><option value="facts">Series facts</option></select></label>{/if}
    {#if scope === 'cards'}<label>Family<select bind:value={templateTarget} onchange={loadTemplate} data-focusable><option value="poster">Poster tiles</option><option value="continue">Continue watching</option><option value="search">Search results</option></select></label>{/if}
    {#if outline}
      <div class="inspector">
        <p class="help">Template outline</p>
        <ul class="tree">{@render tree(outline)}</ul>
      </div>
    {/if}
    <button class="text-button" data-focusable onclick={loadTemplate}>Load current template</button>
    <label>Template JSON<textarea bind:value={templateText} rows="10" spellcheck="false" data-focusable></textarea></label>
    {#if templateError}<p role="alert" class="help">{templateError}</p>{/if}<button class="text-button" data-focusable onclick={applyTemplate}>Apply template to draft</button>
  </details>
  {/if}
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
  .coverage { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .coverage span { border: 1px solid var(--editor-line); border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
  .coverage.empty { color: var(--editor-muted); font-size: 11px; }
  .inspector { margin-top: 12px; border: 1px solid var(--editor-line); border-radius: 6px; padding: 8px 10px; }
  .tree { margin: 4px 0 0; padding-left: 14px; font: 11px 'Geist Mono', monospace; }
  .tree ul { padding-left: 14px; }
  .node-type { font-weight: 700; }
  .node-label { margin-left: 6px; color: var(--editor-muted); }
</style>
