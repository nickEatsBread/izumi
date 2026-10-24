import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Controller-mode wiring in Settings components (spec §5). vitest has no Svelte plugin, so these
// read the source; the behaviour lives in src/lib/settings/*.ts and is tested there.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('SettingsSubcategory in controller mode (spec §5.3)', () => {
  const source = read('./SettingsSubcategory.svelte')

  it('folds through the shared rules and remembers per section', () => {
    expect(source).toContain("import { rememberSubcategory, subcategoryFoldable, subcategoryLine, subcategoryStartsCollapsed } from '$lib/settings/subcategory-fold'")
    expect(source).toContain('const foldable = $derived(subcategoryFoldable($settingsControllerMode, collapsible, def?.advanced === true))')
    // `open` stays the bindable source of truth (pages defer work on it); controller mode opens it on arrival.
    expect(source).toContain('if (!untrack(startsCollapsed)) open = true')
    expect(source).toContain('const collapsed = $derived(foldable && !open)')
    expect(source).toContain('rememberSubcategory($settingsControllerMode, section?.id, id, !next)')
    expect(source).toContain("const line = $derived(subcategoryLine(summary, $settingsControllerMode, rows))")
  })

  it('keeps the contract markup and open triggers', () => {
    expect(source).toContain('data-settings-subcategory={id}')
    expect(source).toContain("data-collapsed={collapsed ? '' : undefined}")
    expect(source).toContain('data-subcategory-toggle aria-expanded={!collapsed}')
    expect(source).toContain('data-settings-subcategory-body hidden={collapsed || undefined}')
    expect(source).toContain('node.addEventListener(SUBCATEGORY_OPEN_EVENT, onOpen)')
    // page.url, not afterNavigate: a same-page hash link only updates page.url (no navigation callbacks).
    expect(source).toContain("page.url.hash === `#${id}`")
  })
})

describe('SelectMenu in controller mode (spec §3.5)', () => {
  const source = read('./SelectMenu.svelte')

  it('draws a centred, portalled picker first: 420 px wide, list capped at 320 px', () => {
    const controller = source.indexOf('{#if $settingsControllerMode}')
    expect(controller).toBeGreaterThan(-1)
    expect(source.indexOf('{:else if $isMobile}')).toBeGreaterThan(controller)
    // Above first-run setup (z-160), which hosts a SelectMenu; below the native picker (175) and OSK (190).
    expect(source).toContain('<div use:portal bind:this={backdrop} class="fixed inset-0 z-[165] grid place-items-center bg-black/60 p-4" role="presentation"')
    expect(source).toContain('class="w-[23.333rem] max-w-full rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-2xl"')
    expect(source).toContain('class="max-h-[17.778rem] overflow-y-auto overscroll-contain">')
    expect(source).toContain('data-select-picker')
  })

  it('lets the d-pad measure an inline trigger by its row, and lights that row in controller mode', () => {
    // nav `navRect` reads this marker; a field-variant trigger keeps its own box.
    expect(source).toContain("data-nav-measure-row={variant === 'inline' || undefined}")
    const css = read('../../../app.css')
    // One rule set lights the row for an inline trigger and for any control on a row's [data-nav-line].
    const lit = '[data-setting-key]:has([data-nav-line] [data-focusable]:focus, [data-nav-measure-row]:focus)'
    expect(css).toContain(`.gamemode ${lit} { box-shadow: var(--izumi-safe-focus-ring); }`)
    expect(css).toContain(`.controller-mode ${lit} {\n  box-shadow: var(--izumi-safe-focus-ring), 0 8px 24px rgb(0 0 0 / 0.4);`)
    expect(css).toContain(`.tv-mode ${lit} {\n  box-shadow: 0 0 0 4px #fff, 0 8px 28px rgb(0 0 0 / 0.45);`)
    expect(css).toContain(`[data-settings-controller] ${lit} { background-color: hsl(var(--foreground) / 0.1); }`)
    expect(css).not.toContain('[data-setting-key]:has([data-nav-measure-row]:focus)')
    // The control's own ring goes. The inline trigger also loses its fill, after (and as specific as)
    // the row-fill rule; a control on a line keeps it, so two controls on one line stay apart.
    expect(css).toContain(':is(.gamemode, .controller-mode, .tv-mode) :is([data-setting-key] [data-nav-line] [data-focusable], [data-focusable][data-nav-measure-row]):focus { box-shadow: none; }')
    const suppress = css.indexOf(':is(.gamemode, .controller-mode, .tv-mode) [data-focusable][data-nav-measure-row]:focus { background-color: transparent; }')
    expect(suppress).toBeGreaterThan(css.indexOf('[data-settings-controller] [data-settings-subcategory-body] [data-focusable]:focus'))
  })

  it('is a modal dialog whose list is the listbox, not a listbox around a heading', () => {
    const picker = source.slice(source.indexOf('{#if $settingsControllerMode}'), source.indexOf('{:else if $isMobile}'))
    expect(picker).toContain('role="dialog"')
    expect(picker).toContain('aria-modal="true"')
    // The trigger announces what opens: the picker dialog here, the listbox menu elsewhere.
    expect(source).toContain("aria-haspopup={$settingsControllerMode ? 'dialog' : 'listbox'}")
    expect(picker).toContain("<div data-nav-scroll-container role={searchable ? undefined : 'listbox'} aria-labelledby={searchable || !ariaLabel ? undefined : pickerTitle}")
  })

  it('names the dialog and its list once, from the visible heading, with a fallback name', () => {
    const picker = source.slice(source.indexOf('{#if $settingsControllerMode}'), source.indexOf('{:else if $isMobile}'))
    expect(source).toContain('const pickerTitle = $props.id()')
    expect(picker).toContain('<h2 id={pickerTitle} class="truncate px-3 pb-2 text-base font-bold">{ariaLabel}</h2>')
    expect(picker).toContain('aria-labelledby={ariaLabel ? pickerTitle : undefined}')
    expect(picker).toContain("aria-label={ariaLabel ? undefined : 'Options'}")
    expect(picker).not.toContain('aria-label={ariaLabel}')
  })

  it('draws the search box above the capped list, never sticky inside it over a revealed row', () => {
    const picker = source.slice(source.indexOf('{#if $settingsControllerMode}'), source.indexOf('{:else if $isMobile}'))
    const search = picker.indexOf('{#if searchable}{@render searchBox()}{/if}')
    expect(search).toBeGreaterThan(-1)
    expect(picker.indexOf('<div data-nav-scroll-container role=')).toBeGreaterThan(search)
    // The shared option list draws it itself only for the anchored menus.
    const list = source.slice(source.indexOf('{#snippet optionList()}'), source.indexOf('{/snippet}', source.indexOf('{#snippet optionList()}')))
    expect(list).toContain('{#if searchable && !$settingsControllerMode}{@render searchBox()}{/if}')
  })

  it('dismisses from a click on the backdrop, never the pointerdown a touch tap starts with', () => {
    // The trigger becomes the focus hint, so the next d-pad press resumes on it instead of <body>.
    expect(source).toContain("import { setFocusHint } from '$lib/nav/focus-hint'")
    expect(source).toContain('onclick={(event) => { if (event.target === event.currentTarget) { open = false; setFocusHint(trigger) } }}')
    expect(source).toContain('!backdrop?.contains(event.target as Node)) open = false')
    // A host that closes on outside presses (ListEditor) recognises the portalled picker by this.
    const backdrop = source.slice(source.indexOf('<div use:portal bind:this={backdrop}'), source.indexOf('bind:this={menu}'))
    expect(backdrop).toContain('data-select-picker-backdrop')
  })

  it('skips placement work for the centred picker, which never reads it', () => {
    expect(source).toContain('if (!trigger || $settingsControllerMode) return')
    expect(source).toContain('if (!open || $settingsControllerMode) return')
  })

  // The option lookup, stepping and reveal are tested in src/lib/settings/controller-picker.test.ts.
  it('opens on the current value and walks the open panel, revealing each option in the picker', () => {
    expect(source).toContain('const list: ParentNode = menu ?? root')
    expect(source).toContain('if ($settingsControllerMode) centrePickerValue(list, value)')
    expect(source).toContain("stepMenuOption(menu ?? root, event.key === 'ArrowDown' ? 1 : -1, $settingsControllerMode)")
  })
})

describe('setup-heavy rows in controller mode (spec §5.4)', () => {
  const component = read('./SetupElsewhere.svelte')
  const page = (name: string) => read(`../../../routes/app/settings/${name}/+page.svelte`)

  it('renders a status row in controller mode and the full controls elsewhere', () => {
    expect(component).toContain('{#if $settingsControllerMode}')
    expect(component).toContain('<SettingsRow {title} description={where} value={status} {settingKey} control={disclosure} onActivate={() => (expanded = !expanded)} {expanded} {children} />')
    // An inline disclosure: a ChevronDown that turns, not the link row's fixed ChevronRight.
    expect(component).toContain("transition-transform {expanded ? 'rotate-180' : ''}")
    expect(component).toContain('{@render children()}')
  })

  it('wraps custom mpv options, the subtitle text filter, Worker setup and Theme Studio', () => {
    // settingKey on the wrapper is what lands a search hit on the status row.
    expect(page('playback')).toMatch(/<SetupElsewhere title="Custom mpv options"[^>]*settingKey="custom-mpv-options"[^>]*>[\s\S]*?bind:value=\{\$rawMpvOptions\}[\s\S]*?<\/SetupElsewhere>/)
    expect(page('subtitles')).toMatch(/<SetupElsewhere title="Text filter"[^>]*settingKey="text-filter"[^>]*>[\s\S]*?\$subtitleRegexFilter[\s\S]*?<\/SetupElsewhere>/)
    expect(page('appearance')).toMatch(/<SetupElsewhere title="Theme Studio"[^>]*>[\s\S]*?href="\/app\/settings\/theme-studio"[\s\S]*?<\/SetupElsewhere>/)
  })

  it('wraps only the Worker deployment rows, and only while they show', () => {
    const devices = page('devices')
    // Gated like its content, so peer-to-peer users never see an empty Cloudflare row.
    const block = devices.match(/\{#if cloudflareSetupOpen\}\s*<SetupElsewhere title="Worker setup"[^>]*>([\s\S]*?)<\/SetupElsewhere>\s*\{\/if\}/)
    expect(block).not.toBeNull()
    expect(block![1]).toContain('deployCloudflare()')
    expect(block![1]).toContain('connectCloudflare()')
    // Worker updates is a plain button with a pending-update panel; it stays a direct row.
    expect(block![1]).not.toContain('openCloudflareWorkerUpdate')
    expect(devices.match(/<SetupElsewhere /g)).toHaveLength(1)
    expect(devices).toContain('settingKey="worker-updates"')
  })

  it('tells controller users how to edit device-local values here, not on another device', () => {
    // Custom mpv options, the text filter and studio themes are not synced settings.
    for (const name of ['playback', 'subtitles']) expect(page(name)).toContain('where="Needs a keyboard: connect one to edit here"')
    expect(page('appearance')).toContain('where="Needs a mouse and keyboard: connect them to design here"')
  })
})

describe('Playback › Controls in Game mode (spec §5.5)', () => {
  it('shows the controller map instead of keyboard rebinding', () => {
    const playback = read('../../../routes/app/settings/playback/+page.svelte')
    expect(playback).toMatch(/<SettingsSubcategory id="controls"[^>]*>\s*\{#if \$gameMode\}<ControllerMap \/>\{:else\}/)
    // Task 12's fix-up gated the whole Controls block on !$gameMode until the map lands; it must not hide the map.
    expect(playback).toMatch(/\{#if !\$isAndroid\}\s*<SettingsSubcategory id="controls"/)
    expect(playback).not.toMatch(/\{#if [^}]*\$gameMode[^}]*\}\s*<SettingsSubcategory id="controls"/)
    const map = read('./ControllerMap.svelte')
    expect(map).toContain('{#each CONTROLLER_MAP as group (group.title)}')
    expect(map).toContain('<Glyph {family} button={key} />')
  })
})

describe('one-line control groups outside a row header (d-pad lines)', () => {
  // nav `navRect` measures these by the whole line on Up/Down, so Down from the full-width row above
  // lands on the line's first control instead of skipping the narrow ones at its left edge.
  it.each([
    ['../../../routes/app/settings/devices/+page.svelte', '<div data-nav-line class="flex flex-col gap-3 sm:flex-row sm:items-center">'],
    ['../../../routes/app/settings/library/+page.svelte', '<div data-nav-line class="px-3 py-2.5">\n      <p class="mb-2 text-xs font-semibold text-muted-foreground">Preview — try it</p>'],
    ['../../../routes/app/settings/accounts/+page.svelte', '<p data-nav-line class="px-3 py-2.5 text-xs leading-5 text-muted-foreground">Browse lists in <a href="/app/library"'],
    ['./HistorySettings.svelte', '<div data-nav-line class="flex flex-wrap gap-2">'],
  ])('%s marks its control group', (file, markup) => {
    expect(read(file)).toContain(markup)
  })
})
