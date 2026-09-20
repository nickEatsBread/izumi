<script lang="ts">
  import ThemeLayoutEditor from '$lib/components/themes/ThemeLayoutEditor.svelte'
  import { onDestroy, tick } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import Minus from '@lucide/svelte/icons/minus'
  import Palette from '@lucide/svelte/icons/palette'
  import { closeThemeStudio, resetToShippedTheme, themeStudioMinimized } from '$lib/settings/theme-studio-session'
  import { get } from 'svelte/store'
  import Copy from '@lucide/svelte/icons/copy'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import Download from '@lucide/svelte/icons/download'
  import Upload from '@lucide/svelte/icons/upload'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Check from '@lucide/svelte/icons/check'
  import { saveTextFile, ioErrorMessage } from '$lib/player/history-io'
  import { themePreset } from '$lib/settings/ui'
  import {
    activeStudioTheme,
    activeStudioThemeId,
    defaultStudioTheme,
    deleteStudioTheme,
    duplicateStudioTheme,
    hexToHslToken,
    hslTokenToHex,
    parseStudioTheme,
    saveStudioTheme,
    stringifyStudioTheme,
    studioThemes,
    themeStudioPreview,
    tokenContrast,
    type StudioTheme,
    type ThemeBackdrop,
    type ThemeFont,
  } from '$lib/settings/theme-studio'
  import { THEME_PRESETS, type ThemeTokens } from '$lib/theme-tokens'

  type PresetName = keyof typeof THEME_PRESETS
  type EditableToken = Exclude<keyof ThemeTokens, 'scheme'>

  const clone = (theme: StudioTheme): StudioTheme => JSON.parse(JSON.stringify(theme)) as StudioTheme
  let draft = $state<StudioTheme>(clone(get(themeStudioPreview) ?? get(activeStudioTheme)))
  let notice = $state('')
  let category = $state<'palette' | 'type' | 'backdrop' | 'layout' | 'saved'>('palette')
  let baseline = $state(JSON.stringify(get(themeStudioPreview) ?? get(activeStudioTheme)))
  let confirmDelete = $state(false)
  let confirmClose = $state(false)
  let panelHeading = $state<HTMLHeadingElement>()
  let resumeButton = $state<HTMLButtonElement>()
  let fileBusy = $state(false)
  const dirty = $derived(JSON.stringify(draft) !== baseline)
  let importInput = $state<HTMLInputElement>()

  const paletteStarters: Array<{ id: PresetName; label: string }> = [
    { id: 'izumi', label: 'Izumi' }, { id: 'midnight', label: 'Midnight' },
    { id: 'sakura', label: 'Sakura' }, { id: 'ocean', label: 'Ocean' }, { id: 'light', label: 'Light' },
  ]
  const colorGroups: Array<{ label: string; items: Array<{ key: EditableToken; label: string }> }> = [
    { label: 'Canvas', items: [
      { key: 'background', label: 'Background' }, { key: 'foreground', label: 'Text' },
      { key: 'card', label: 'Cards' }, { key: 'cardForeground', label: 'Card text' },
    ] },
    { label: 'Actions', items: [
      { key: 'theme', label: 'Brand accent' }, { key: 'ring', label: 'Focus ring' },
      { key: 'primary', label: 'Primary action' }, { key: 'primaryForeground', label: 'Primary text' },
    ] },
    { label: 'Surfaces', items: [
      { key: 'secondary', label: 'Secondary' }, { key: 'secondaryForeground', label: 'Secondary text' },
      { key: 'accent', label: 'Hover surface' }, { key: 'accentForeground', label: 'Hover text' },
      { key: 'muted', label: 'Muted surface' }, { key: 'mutedForeground', label: 'Muted text' },
      { key: 'border', label: 'Borders' }, { key: 'input', label: 'Inputs' },
    ] },
  ]
  const fonts: Array<{ id: ThemeFont; label: string; sample: string }> = [
    { id: 'nunito', label: 'Nunito', sample: 'Warm & rounded' },
    { id: 'system', label: 'System', sample: 'Native & direct' },
    { id: 'serif', label: 'Editorial', sample: 'Cinematic & literary' },
    { id: 'mono', label: 'Geist Mono', sample: 'Technical & precise' },
  ]
  const backdrops: Array<{ id: ThemeBackdrop; label: string }> = [
    { id: 'solid', label: 'Solid' }, { id: 'aurora', label: 'Aurora' },
    { id: 'spotlight', label: 'Spotlight' }, { id: 'mesh', label: 'Mesh' },
  ]

  const contrasts = $derived([
    { label: 'Body text', value: tokenContrast(draft.tokens.foreground, draft.tokens.background) },
    { label: 'Muted text', value: tokenContrast(draft.tokens.mutedForeground, draft.tokens.background) },
    { label: 'Primary button', value: tokenContrast(draft.tokens.primaryForeground, draft.tokens.primary) },
  ])
  const contrastPasses = $derived(contrasts.every((item) => item.value >= 4.5))

  $effect(() => {
    themeStudioPreview.set(clone(draft))
  })
  onDestroy(closeThemeStudio)

  function updateColor(key: EditableToken, event: Event) {
    draft.tokens[key] = hexToHslToken((event.currentTarget as HTMLInputElement).value)
  }

  function applyStarter(id: PresetName) {
    draft.tokens = { ...THEME_PRESETS[id] }
    draft.tokens.scheme = id === 'light' ? 'light' : 'dark'
    notice = ''
  }

  function selectTheme(id: string) {
    confirmDelete = false
    if (dirty) { notice = 'Save or discard your changes before choosing another theme.'; return }
    const selected = $studioThemes.find((theme) => theme.id === id)
    if (!selected) return
    draft = clone(selected)
    baseline = JSON.stringify(selected)
    notice = ''
  }

  function saveAndApply(close = false) {
    try {
    const saved = saveStudioTheme(clone(draft))
    draft = clone(saved)
    baseline = JSON.stringify(saved)
    $themePreset = 'custom'
    notice = 'Theme saved.'
    confirmClose = false
    if (close) closeThemeStudio()
    } catch (error) { notice = ioErrorMessage(error, 'Could not save the theme.') }
  }

  function makeCopy() {
    if ($studioThemes.length >= 24) return
    try {
    const copy = duplicateStudioTheme(clone(draft), Date.now(), false)
    draft = clone(copy)
    baseline = JSON.stringify(copy)
    notice = 'Created a separate editable copy.'
    } catch (error) { notice = ioErrorMessage(error, 'Could not copy the theme.') }
  }

  function removeCurrent() {
    if (!confirmDelete) { confirmDelete = true; return }
    confirmDelete = false
    try {
    const remaining = $studioThemes.filter((theme) => theme.id !== draft.id)
    if (!deleteStudioTheme(draft.id)) {
      notice = 'Keep at least one saved theme.'
      return
    }
    draft = clone(remaining[0] ?? defaultStudioTheme())
    baseline = JSON.stringify(draft)
    notice = 'Theme deleted.'
    } catch (error) { notice = ioErrorMessage(error, 'Could not remove the theme.') }
  }

  function discardChanges() {
    draft = JSON.parse(baseline) as StudioTheme
    confirmDelete = false
    confirmClose = false
    notice = 'Changes discarded.'
  }

  function resetDesign() {
    draft = clone(resetToShippedTheme())
    baseline = JSON.stringify(draft)
    confirmDelete = false
    confirmClose = false
    notice = 'Izumi’s original appearance restored.'
  }

  async function exportTheme() {
    if (fileBusy) return
    fileBusy = true
    try {
      const filename = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'izumi-theme'}.izumi-theme.json`
      const saved = await saveTextFile(filename, stringifyStudioTheme(draft))
      if (saved) notice = 'Theme file saved.'
    } catch (error) {
      notice = ioErrorMessage(error, 'Theme export failed.')
    } finally { fileBusy = false }
  }

  async function importTheme(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || fileBusy) return
    if (dirty) { notice = 'Save or discard your changes before importing a theme.'; return }
    if (file.size > 64_000 || $studioThemes.length >= 24) { notice = 'Use a theme file under 64 KB and keep fewer than 24 saved themes.'; return }
    fileBusy = true
    try {
      const imported = parseStudioTheme(await file.text())
      $studioThemes = [...$studioThemes, imported]
      baseline = JSON.stringify(imported)
      draft = clone(imported)
      notice = `${imported.name} loaded. Changes are live; save the theme to keep them.`
    } catch (error) {
      notice = ioErrorMessage(error, 'Invalid theme file.')
    } finally { fileBusy = false }
  }

  function requestClose() {
    if (dirty) confirmClose = true
    else closeThemeStudio()
  }

  async function minimize() {
    $themeStudioMinimized = true
    await tick()
    resumeButton?.focus()
  }

  async function expand() {
    $themeStudioMinimized = false
    await tick()
    panelHeading?.focus()
  }

  function editHex(key: EditableToken, event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const value = input.value.trim()
    const valid = /^#?[0-9a-f]{6}$/i.test(value)
    input.setCustomValidity(valid ? '' : 'Enter a six-digit hex colour, such as #E93B69.')
    if (valid) draft.tokens[key] = hexToHslToken(value)
  }

  function resetHex(key: EditableToken, event: FocusEvent) {
    const input = event.currentTarget as HTMLInputElement
    input.value = hslTokenToHex(draft.tokens[key]).toUpperCase()
    input.setCustomValidity('')
  }
</script>

<svelte:window onbeforeunload={(event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }} />

{#if $themeStudioMinimized}
  <button bind:this={resumeButton} type="button" data-focusable onclick={expand} class="studio-resume" aria-label="Expand Theme Studio">
    <Palette size={17} /><span>Theme Studio</span><span class="live-dot" aria-hidden="true"></span>
    <span class="resume-status">{dirty ? 'Unsaved' : 'Live'}</span>
  </button>
{/if}

<aside class="studio-panel" class:minimized={$themeStudioMinimized} aria-labelledby="studio-heading" data-theme-studio>
  <header class="studio-header">
    <div class="studio-title-row">
      <h2 id="studio-heading" bind:this={panelHeading} tabindex="-1"><Palette size={18} /> Theme Studio</h2>
      <div class="header-actions">
        <button type="button" data-focusable class="icon-button" onclick={minimize} aria-label="Minimize Theme Studio" title="Minimize"><Minus size={18} /></button>
        <button type="button" data-focusable class="icon-button" onclick={requestClose} aria-label="Close Theme Studio" title="Close"><X size={18} /></button>
      </div>
    </div>
    <p class="studio-intro"><span class="live-dot" aria-hidden="true"></span> Editing your client live</p>
    <p class="studio-hint">Browse any page. Every change appears as you edit.</p>
  </header>

  <nav aria-label="Theme controls" class="studio-tabs">
    {#each [{ id: 'palette', label: 'Colours' }, { id: 'type', label: 'Type & shape' }, { id: 'backdrop', label: 'Backdrop' }, { id: 'layout', label: 'Layout' }, { id: 'saved', label: 'Saved' }] as item}
      <button type="button" data-focusable aria-pressed={category === item.id} onclick={() => { category = item.id as typeof category; confirmDelete = false; notice = '' }}>{item.label}</button>
    {/each}
  </nav>

  <div class="studio-content" aria-busy={fileBusy}>
    {#if notice}<p role="status" class="studio-notice">{notice}</p>{/if}
    {#if category === 'palette'}
      <section class="control-section">
        <h3>Choose a starting point</h3>
        <div class="starter-grid">
          {#each paletteStarters as starter}
            <button type="button" data-focusable onclick={() => applyStarter(starter.id)} class="starter" aria-label={`Load ${starter.label} palette`} aria-pressed={JSON.stringify(draft.tokens) === JSON.stringify(THEME_PRESETS[starter.id])}>
              <span class="starter-swatch" style:background={`hsl(${THEME_PRESETS[starter.id].background})`}>
                <span style:background={`hsl(${THEME_PRESETS[starter.id].theme})`}></span>
                <span style:background={`hsl(${THEME_PRESETS[starter.id].foreground})`}></span>
              </span>
              <span>{starter.label}</span>
            </button>
          {/each}
        </div>
      </section>
      <section class="control-section">
        <div class="section-heading"><h3>Your colours</h3><span>Pick or enter hex</span></div>
        {#each [{ key: 'theme', label: 'Brand accent' }, { key: 'background', label: 'Background' }, { key: 'foreground', label: 'Text' }, { key: 'card', label: 'Cards' }] as item}
          {@render colorRow(item.key as EditableToken, item.label)}
        {/each}
      </section>
      <details class="control-section advanced-colours">
        <summary>More colours <span>Buttons, borders & surfaces</span></summary>
        {#each colorGroups as group}
          <div class="colour-group">
            <h4>{group.label}</h4>
            {#each group.items.filter(item => !['theme', 'background', 'foreground', 'card'].includes(item.key)) as item}
              {@render colorRow(item.key, item.label)}
            {/each}
          </div>
        {/each}
        <label class="setting-row"><span>Colour scheme</span><select bind:value={draft.tokens.scheme} data-focusable><option value="dark">Dark</option><option value="light">Light</option></select></label>
      </details>
      <details class="control-section contrast-check">
        <summary>Text contrast <span>{contrastPasses ? 'Looks readable' : 'Needs attention'}</span></summary>
        <div class="contrast-values">
          {#each contrasts as contrast}<p><span>{contrast.label}</span><span>{contrast.value.toFixed(2)}:1 · {contrast.value >= 4.5 ? 'Pass' : 'Low'}</span></p>{/each}
        </div>
        <p class="help-text">A ratio of 4.5:1 meets AA for normal text.</p>
      </details>
    {:else if category === 'layout'}
      <ThemeLayoutEditor bind:presentation={draft.presentation} />
    {:else if category === 'type'}
      <section class="control-section">
        <h3>Typeface</h3>
        <div class="font-options">
          {#each fonts as font}
            <button type="button" data-focusable onclick={() => draft.font = font.id} aria-pressed={draft.font === font.id} class="font-option" data-font={font.id}>
              <span class="font-sample" aria-hidden="true">Aa</span><span><strong>{font.label}</strong><small>{font.sample}</small></span>
              {#if draft.font === font.id}<Check size={16} />{/if}
            </button>
          {/each}
        </div>
      </section>
      <section class="control-section slider-section">
        <label><span class="slider-label"><span>Type &amp; UI scale</span><output>{Math.round(draft.fontScale * 100)}%</output></span><input bind:value={draft.fontScale} aria-label="Type and UI scale" type="range" min="0.85" max="1.2" step="0.01" data-focusable /></label>
        <p class="range-ends"><span>Smaller</span><span>Larger</span></p>
        <label><span class="slider-label"><span>Corner radius</span><output>{draft.radius === 0 ? 'Square' : `${draft.radius.toFixed(2)} rem`}</output></span><input bind:value={draft.radius} aria-label="Corner radius" type="range" min="0" max="2" step="0.05" data-focusable /></label>
        <p class="range-ends"><span>Sharp</span><span>Rounded</span></p>
      </section>
    {:else if category === 'backdrop'}
      <section class="control-section">
        <h3>Ambient backdrop</h3>
        <p class="help-text">A wash of colour behind your library.</p>
        <div class="backdrop-options">
          {#each backdrops as backdrop}
            <button type="button" data-focusable onclick={() => { draft.backdrop = backdrop.id; if (backdrop.id !== 'solid' && draft.backdropStrength === 0) draft.backdropStrength = 0.28 }} aria-pressed={draft.backdrop === backdrop.id}>
              <span class="backdrop-swatch" data-backdrop={backdrop.id} aria-hidden="true"></span><span>{backdrop.label}</span>
              {#if draft.backdrop === backdrop.id}<Check size={14} />{/if}
            </button>
          {/each}
        </div>
      </section>
      <section class="control-section slider-section">
        <label><span class="slider-label"><span>Strength</span><output>{Math.round(draft.backdropStrength * 100)}%</output></span><input bind:value={draft.backdropStrength} aria-label="Backdrop strength" type="range" min="0" max="0.65" step="0.01" data-focusable disabled={draft.backdrop === 'solid'} /></label>
        <p class="range-ends"><span>Subtle</span><span>Vivid</span></p>
        {#if draft.backdrop === 'mesh'}
          <label><span class="slider-label"><span>Mesh softness</span><output>{draft.glassBlur}px</output></span><input bind:value={draft.glassBlur} aria-label="Mesh softness" type="range" min="0" max="40" step="1" data-focusable /></label>
          <p class="range-ends"><span>Defined</span><span>Soft</span></p>
        {/if}
      </section>
    {:else}
      <section class="control-section">
        <label class="theme-name"><span>Theme name</span><input bind:value={draft.name} maxlength="48" data-focusable /></label>
        <div class="section-heading saved-heading"><h3>Saved themes</h3><span>{$studioThemes.length} / 24</span></div>
        <div class="saved-list">
          {#each $studioThemes as theme (theme.id)}
            <button type="button" data-focusable onclick={() => selectTheme(theme.id)} aria-pressed={theme.id === draft.id}>
              <span class="saved-swatch" style:background={`hsl(${theme.tokens.background})`}><span style:background={`hsl(${theme.tokens.theme})`}></span></span>
              <span class="saved-name">{theme.name}</span>{#if theme.id === $activeStudioThemeId && $themePreset === 'custom'}<small>Applied</small>{/if}{#if theme.id === draft.id}<Check size={15} />{/if}
            </button>
          {/each}
        </div>
        <div class="button-row">
          <button type="button" data-focusable onclick={makeCopy} disabled={$studioThemes.length >= 24 || fileBusy} class="studio-button secondary"><Copy size={15} /> Duplicate</button>
          <button type="button" data-focusable onclick={removeCurrent} disabled={$studioThemes.length <= 1 || fileBusy} class="studio-button"><Trash2 size={15} />{confirmDelete ? 'Confirm delete' : 'Delete'}</button>
          {#if confirmDelete}<button type="button" data-focusable onclick={() => confirmDelete = false} class="studio-button">Keep</button>{/if}
        </div>
      </section>
      <section class="control-section">
        <h3>Take your theme with you</h3>
        <p class="help-text">Theme files contain appearance settings only.</p>
        <div class="button-row">
          <button type="button" data-focusable onclick={exportTheme} disabled={fileBusy} class="studio-button secondary"><Download size={15} /> Export</button>
          <button type="button" data-focusable onclick={() => importInput?.click()} disabled={fileBusy || $studioThemes.length >= 24} class="studio-button secondary"><Upload size={15} /> Import</button>
        </div>
        <input bind:this={importInput} onchange={importTheme} type="file" accept="application/json,.json,.izumi-theme.json" hidden />
      </section>
    {/if}
  </div>

  <footer class="studio-footer">
    {#if confirmClose}
      <p class="close-prompt" role="status">Keep your changes before closing?</p>
      <div class="close-actions">
        <button type="button" data-focusable onclick={closeThemeStudio} disabled={fileBusy} class="studio-button secondary">Discard &amp; close</button>
        <button type="button" data-focusable onclick={() => saveAndApply(true)} disabled={fileBusy || !draft.name.trim()} class="studio-button primary">Save &amp; close</button>
      </div>
      <button type="button" data-focusable onclick={() => confirmClose = false} class="keep-editing">Keep editing</button>
    {:else}
      <div class="save-status"><span>{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span><span class="theme-label">{draft.name}</span></div>
      <div class="footer-actions">
        <button type="button" data-focusable onclick={discardChanges} disabled={!dirty || fileBusy} class="studio-button secondary"><RotateCcw size={14} /> Discard</button>
        <button type="button" data-focusable onclick={() => saveAndApply()} disabled={fileBusy || !draft.name.trim()} class="studio-button primary"><Check size={15} /> Save theme</button>
      </div>
    {/if}
    <button type="button" data-focusable onclick={resetDesign} disabled={fileBusy} class="studio-button reset-default" title="Restore Izumi’s original colours, font, scale, corners and backdrop"><RotateCcw size={14} /> Reset to default</button>
  </footer>
</aside>

{#snippet colorRow(key: EditableToken, label: string)}
  <div class="colour-row">
    <label class="colour-label"><input type="color" value={hslTokenToHex(draft.tokens[key])} oninput={(event) => updateColor(key, event)} data-focusable aria-label={label} /><span>{label}</span></label>
    <input class="hex-input" aria-label={`${label} hex`} value={hslTokenToHex(draft.tokens[key]).toUpperCase()} oninput={(event) => editHex(key, event)} onblur={(event) => resetHex(key, event)} spellcheck="false" maxlength="7" data-focusable />
  </div>
{/snippet}

<style>
  /* The editor stays legible even while the user experiments with low-contrast client colours. */
  .studio-panel, .studio-resume {
    --editor-bg: #19191d; --editor-fg: #f1f1f4; --editor-muted: #a5a5af; --editor-line: #34343d; --editor-control: #26262d; --editor-accent: #d6d6df; --editor-focus: #c8c8e0;
    color: var(--editor-fg); background: var(--editor-bg); color-scheme: dark;
    font-family: 'Nunito Variable', sans-serif; font-size: 14px; line-height: 1.4;
    border: 1px solid var(--editor-line); box-shadow: 0 16px 48px #07070c55, 0 2px 6px #07070c33;
  }
  .studio-panel { position: fixed; z-index: 40; top: 52px; left: 72px; width: 352px; max-width: calc(100vw - 88px); max-height: calc(100dvh - 72px); display: flex; flex-direction: column; border-radius: 16px; overflow: hidden; }
  .studio-panel.minimized { display: none; }
  .studio-header { padding: 18px 20px 16px; }
  .studio-title-row, .header-actions, .studio-title-row h2 { display: flex; align-items: center; }
  .studio-title-row { justify-content: space-between; gap: 8px; }
  .studio-title-row h2 { gap: 9px; font-size: 17px; font-weight: 800; letter-spacing: -.4px; }
  .header-actions { gap: 2px; }
  .icon-button { display: grid; place-items: center; width: 32px; height: 32px; color: var(--editor-muted); border-radius: 7px; }
  .studio-intro { display: flex; align-items: center; gap: 7px; margin-top: 12px; font-size: 12px; font-weight: 700; }
  .live-dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: #8bc8ac; }
  .studio-hint { margin-top: 5px; font-size: 12px; line-height: 1.5; color: var(--editor-muted); max-width: 265px; }
  .studio-tabs { display: flex; overflow-x: auto; padding: 0 12px; border-bottom: 1px solid var(--editor-line); }
  .studio-tabs button { flex: 1; min-height: 42px; padding: 0 7px; border-bottom: 2px solid transparent; font-size: 11px; font-weight: 700; white-space: nowrap; color: var(--editor-muted); }
  .studio-tabs button[aria-pressed='true'] { border-bottom-color: var(--editor-fg); color: var(--editor-fg); }
  .studio-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--editor-line) transparent; }
  .studio-content::-webkit-scrollbar { display: block; width: 4px; }
  .studio-content::-webkit-scrollbar-thumb { background: var(--editor-line); border-radius: 4px; }
  .control-section { padding: 18px 20px; border-bottom: 1px solid var(--editor-line); }
  .control-section:last-child { border-bottom: 0; }
  h3, summary { font-size: 12px; font-weight: 800; }
  h4 { margin: 16px 0 4px; font-size: 11px; font-weight: 700; color: var(--editor-muted); }
  .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .section-heading > span, summary > span { font-size: 11px; font-weight: 500; color: var(--editor-muted); }
  .starter-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px; margin-top: 12px; }
  .starter { min-width: 0; display: grid; gap: 7px; text-align: center; font-size: 10px; color: var(--editor-muted); }
  .starter-swatch { height: 38px; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 7px; border: 1px solid #ffffff22; outline: 2px solid transparent; outline-offset: 2px; }
  .starter-swatch > span { width: 11px; height: 16px; border-radius: 3px; }
  .starter[aria-pressed='true'] { color: var(--editor-fg); }
  .starter[aria-pressed='true'] .starter-swatch { outline-color: #c9c9d2; }
  .colour-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 45px; }
  .colour-label { display: flex; align-items: center; gap: 11px; font-size: 13px; cursor: pointer; }
  input[type='color'] { appearance: none; width: 28px; height: 28px; flex-shrink: 0; padding: 0; overflow: hidden; border: 1px solid #ffffff33; border-radius: 7px; background: none; cursor: pointer; }
  input[type='color']::-webkit-color-swatch-wrapper { padding: 0; }
  input[type='color']::-webkit-color-swatch { border: 0; border-radius: 6px; }
  input[type='color']::-moz-color-swatch { border: 0; }
  .hex-input { width: 84px; min-width: 0; padding: 7px 5px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--editor-muted); font-family: 'Geist Mono', monospace; font-size: 11px; text-align: right; }
  .hex-input:hover, .hex-input:focus { background: var(--editor-control); border-color: var(--editor-line); color: var(--editor-fg); }
  .hex-input:invalid { border-color: #e99898; }
  summary { cursor: pointer; }
  summary > span { margin-left: 6px; }
  .contrast-values { margin-top: 12px; }
  .contrast-values p { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
  .contrast-values p > span:last-child { font-variant-numeric: tabular-nums; color: var(--editor-muted); }
  .help-text { font-size: 12px; line-height: 1.6; color: var(--editor-muted); margin-top: 6px; }
  .font-options { display: grid; gap: 5px; margin-top: 12px; }
  .font-option { display: flex; align-items: center; gap: 14px; width: 100%; padding: 11px 10px; text-align: left; border: 1px solid transparent; border-radius: 8px; }
  .font-option[aria-pressed='true'], .backdrop-options button[aria-pressed='true'] { background: var(--editor-control); border-color: #666674; }
  .font-option > span:nth-child(2) { flex: 1; }
  .font-sample { width: 32px; font-size: 24px; }
  .font-option strong { display: block; font-size: 13px; font-weight: 700; }
  .font-option small { display: block; font-family: 'Nunito Variable', sans-serif; font-size: 11px; color: var(--editor-muted); margin-top: 2px; }
  [data-font='system'] { font-family: system-ui, sans-serif; }
  [data-font='serif'] { font-family: Georgia, serif; }
  [data-font='mono'] { font-family: 'Geist Mono', monospace; }
  .slider-label { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; }
  output { color: var(--editor-muted); font-family: 'Geist Mono', monospace; font-size: 11px; }
  input[type='range'] { display: block; width: 100%; height: 30px; margin-top: 7px; accent-color: var(--editor-accent); cursor: pointer; }
  .range-ends { display: flex; justify-content: space-between; font-size: 10px; color: var(--editor-muted); }
  .range-ends + label { display: block; margin-top: 24px; }
  .backdrop-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
  .backdrop-options button { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 7px; border: 1px solid var(--editor-line); border-radius: 8px; text-align: left; font-size: 12px; }
  .backdrop-options button > span:nth-child(2) { flex: 1; }
  .backdrop-swatch { width: 100%; height: 46px; background: #101014; border-radius: 4px; }
  [data-backdrop='aurora'] { background: radial-gradient(ellipse at 10% 0%, hsl(var(--theme) / .5), transparent 80%), #101014; }
  [data-backdrop='spotlight'] { background: radial-gradient(ellipse at 50% -10%, hsl(var(--theme) / .65), transparent 75%), #101014; }
  [data-backdrop='mesh'] { background: radial-gradient(at 10% 20%, hsl(var(--theme) / .5), transparent 60%), radial-gradient(at 80% 80%, hsl(var(--ring) / .5), transparent 60%), #101014; }
  .setting-row { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; font-size: 12px; }
  select, .theme-name input { background: var(--editor-control); color: var(--editor-fg); border: 1px solid var(--editor-line); border-radius: 7px; padding: 8px 10px; }
  .theme-name > span { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 700; }
  .theme-name input { width: 100%; min-height: 40px; font-size: 14px; }
  .saved-heading { margin-top: 24px; }
  .saved-list button { display: flex; align-items: center; gap: 10px; min-height: 50px; width: 100%; padding: 7px; text-align: left; border-radius: 7px; }
  .saved-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .saved-list small { font-size: 10px; color: var(--editor-muted); }
  .saved-swatch { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border: 1px solid #ffffff22; border-radius: 6px; }
  .saved-swatch span { width: 12px; height: 12px; border-radius: 3px; }
  .button-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
  .studio-footer { flex-shrink: 0; padding: 14px 20px 16px; border-top: 1px solid var(--editor-line); }
  .save-status { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 11px; font-size: 10px; color: var(--editor-muted); }
  .theme-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; }
  .footer-actions, .close-actions { display: grid; grid-template-columns: 1fr 1.2fr; gap: 8px; }
  .studio-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; border-radius: 7px; padding: 8px 10px; font-size: 12px; font-weight: 700; }
  .studio-button.primary { background: #e6e6ed; color: #202026; }
  .studio-button.secondary { background: var(--editor-control); }
  .reset-default { width: 100%; margin-top: 8px; color: var(--editor-muted); }
  .studio-panel button { transition: background 150ms, color 150ms, opacity 150ms; }
  .studio-panel button:hover:not(:disabled) { background-color: #35353f; color: var(--editor-fg); }
  .studio-panel button.primary:hover:not(:disabled) { background: #fff; color: #202026; }
  .studio-panel button:active:not(:disabled), .studio-resume:active { transform: translateY(1px); }
  .studio-panel :is(button, input, select, summary):focus-visible, .studio-resume:focus-visible { outline: 2px solid var(--editor-focus); outline-offset: 2px; border-radius: 5px; }
  .studio-panel :disabled { opacity: .4; cursor: not-allowed; }
  .studio-notice { padding: 12px 20px; background: var(--editor-control); font-size: 12px; line-height: 1.5; }
  .close-prompt { margin-bottom: 12px; font-size: 13px; }
  .keep-editing { display: block; width: 100%; margin-top: 8px; min-height: 28px; font-size: 12px; border-radius: 6px; color: var(--editor-muted); }
  .studio-resume { position: fixed; left: 72px; bottom: 24px; z-index: 40; display: flex; align-items: center; gap: 9px; padding: 12px 16px; border-radius: 12px; font-size: 13px; font-weight: 700; }
  .resume-status { font-size: 11px; font-weight: 500; color: var(--editor-muted); }
  @media (max-width: 640px) {
    .studio-panel { top: auto; left: 8px; bottom: calc(4rem + env(safe-area-inset-bottom) + 10px); width: calc(100vw - 16px); max-width: none; max-height: 58dvh; border-radius: 16px; }
    .studio-header { padding: 12px 16px; }
    .studio-intro { margin-top: 4px; }
    .studio-hint { display: none; }
    .studio-content { min-height: 64px; }
    .control-section { padding: 16px; }
    .studio-footer { padding: 10px 16px 12px; }
    .icon-button { width: 40px; height: 40px; }
    .studio-button { min-height: 40px; }
    .hex-input { font-size: 16px; width: 99px; }
    .studio-resume { left: 12px; bottom: calc(4rem + env(safe-area-inset-bottom) + 12px); }
  }
  @media (max-height: 540px) and (min-width: 641px) {
    .studio-panel { top: 36px; max-height: calc(100dvh - 44px); }
    .studio-header { padding: 10px 16px; }
    .studio-hint { display: none; }
    .studio-intro { margin-top: 3px; }
    .studio-footer { padding: 10px 16px; }
  }
</style>
