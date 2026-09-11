import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('./FirstRunSetup.svelte')
const artwork = read('./SetupArtwork.svelte')
const checklist = read('./SetupChecklist.svelte')
const intro = read('./IntroSequence.svelte')
const home = read('../../../routes/app/home/+page.svelte')
// The shell owns no controls any more — every input lives in a step component — so the focus and
// heading styling it used to scope to itself had to move to the global sheet to keep reaching them.
const css = read('../../../app.css')
const steps = Object.fromEntries(
  ['WatchStep', 'MetadataStep', 'AccessStep', 'StartupStep', 'ConnectStep', 'SyncStep', 'SourcesStep', 'PlaybackStep', 'ReadyStep']
    .map(name => [name, read(`./steps/${name}.svelte`)]),
) as Record<string, string>
const watch = steps.WatchStep
const sources = steps.SourcesStep

describe('onboarding presentation contracts', () => {
  it('keeps a single artwork wordmark without captions or a visible step header', () => {
    expect(shell.match(/<Wordmark\b/g)).toHaveLength(1)
    expect(shell).toContain('class="art-wordmark"><Wordmark />')
    expect(shell).not.toContain('<header')
    expect(shell).not.toContain('step-progress')
    expect(shell).not.toContain('art-caption')
    expect(shell).toContain('id="setup-progress" class="sr-only"')
    expect(shell.indexOf('<footer')).toBeLessThan(shell.indexOf('</main>'))
  })

  it('routes by named step rather than by index, so the order can change safely', () => {
    for (const step of ['watch', 'metadata', 'access', 'startup', 'connect', 'sync', 'sources', 'playback']) {
      expect(shell).toContain(`step === '${step}'`)
    }
    expect(shell).not.toMatch(/step === \d/)
  })

  it('lets the artwork follow the chosen libraries, dogs included', () => {
    expect(shell).toContain('<SetupArtwork {intent} />')
    expect(shell.indexOf('<SetupArtwork')).toBeLessThan(shell.indexOf('{#key step}'))
    // Choosing neither is allowed, so the wall has an answer for it rather than showing catalogs
    // the user just opted out of.
    expect(artwork).toContain('const empty = $derived(!intent.anime && !intent.films)')
    expect(artwork).toContain('dog.ceo')
    expect(artwork).toContain('nekos.best')
  })

  it('orients keyboard users on each step without an outline on a non-interactive heading', () => {
    expect(shell).toContain("querySelector<HTMLElement>('[data-step-heading]')")
    expect(shell).toContain('.focus({ preventScroll: true })')
    expect(shell).toContain('cancelAnimationFrame(frame)')
    expect(css).toContain('.setup-heading:focus { outline: none; box-shadow: none; }')
    expect(css).toContain('.onboarding-surface button:focus-visible')
    // Every screen, not just a sample: a step without the marker leaves focus stranded on the shell.
    for (const step of Object.values(steps)) {
      expect(step).toContain('data-step-heading tabindex="-1" aria-describedby="setup-progress"')
    }
  })

  it('crossfades mounted images and loops identical groups with reduced-motion support', () => {
    expect(artwork).toContain('{#each [0, 1] as repeat (repeat)}')
    expect(artwork).toContain('translateY(-50%)')
    expect(artwork).toContain('transition: opacity')
    expect(artwork).toContain('img.shown:global([data-loaded])')
    expect(artwork).toContain('prefers-reduced-motion: reduce')
    expect(shell).toContain('.setup-content { animation: none; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .tile-spinner { animation: none; } }')
  })

  it('gives each film decision its own screen instead of nesting them under the checkboxes', () => {
    // An earlier draft folded the provider choice, the TMDB key and the startup picker into the
    // watch screen. One decision per screen is the contract; the watch screen owns only the
    // checkboxes, and the key screen exists separately so it can follow the provider choice.
    expect(watch).not.toContain('m.onboarding_metadata_title()')
    expect(watch).not.toContain('m.onboarding_startup_title()')
    expect(watch).not.toContain('tmdbToken')
    expect(steps.MetadataStep).toContain('m.onboarding_metadata_title()')
    expect(steps.AccessStep).toContain('m.onboarding_tmdb_access_title()')
    expect(steps.StartupStep).toContain('m.onboarding_startup_title()')
  })

  it('offers two independent library checkboxes instead of a third combined mode', () => {
    expect(watch).toContain('type="checkbox"')
    expect(watch).toContain('function toggle(key:')
    expect(watch).not.toContain("'both'")
    // Both may be off. The footer holds the flow instead of the control refusing the user, which
    // is why the checkbox no longer has to be re-synced by hand after a rejected change.
    expect(watch).not.toContain('input.checked')
    expect(shell).toContain("const blocked = $derived(step === 'watch' && !intent.anime && !intent.films)")
    expect(shell).toContain('disabled={busy || blocked}')
  })

  it('sends both token guides to the maintained walkthrough instead of hardcoding the steps', () => {
    const access = steps.AccessStep
    const guide = read('../catalog/TmdbCredentialGuide.svelte')
    for (const source of [access, guide]) {
      expect(source).toContain('https://duckkota.gitlab.io/guides/tmdb/')
    }
    expect(access).not.toContain('onboarding_tmdb_instruction_1')
    expect(guide).not.toContain('const steps = [')
    // Both screens offer the keyless provider so a user without a token is never stuck.
    expect(access).toContain('onswitch')
    expect(guide).toContain('onUseKeyless')
  })

  it('shows each source its own artwork rather than an unlabelled row', () => {
    expect(sources).toContain('<AddonLogo logo={suggestion.logo}')
  })

  it('never lets a truncating row blow its grid track out past the container', () => {
    // A grid item defaults to min-width:auto, so a column with no explicit track sizes to the
    // widest row's max-content. `truncate` is white-space:nowrap, which makes that the whole
    // untruncated string — the card overflowed and the text clipped hard instead of ellipsising.
    // Only containers that actually hold truncating rows are checked; a bare `grid` wrapping a
    // label and an input is fine and must not be flagged.
    const rowLists: [string, string][] = [
      ['SourcesStep', steps.SourcesStep],
      ['ConnectStep', steps.ConnectStep],
      ['SetupChecklist', checklist],
    ]
    for (const [name, source] of rowLists) {
      const containers = [...source.matchAll(/class="(mt-\d+ grid [^"]*)"/g)].map(match => match[1])
      expect(containers.length, `${name} has no row container`).toBeGreaterThan(0)
      for (const classes of containers) {
        expect(classes, `${name}: "${classes}" needs an explicit track`).toMatch(/grid-cols-/)
      }
    }
  })

  it('never pre-selects a source for the user', () => {
    expect(sources).toContain('let picked = $state<string[]>([])')
    expect(sources).not.toMatch(/picked\s*=\s*\[[^\]]/)
  })

  it('lets every step be skipped and keeps what was skipped recoverable', () => {
    expect(shell).toContain('m.onboarding_skip_step()')
    expect(checklist).toContain('$setupRemainder.filter')
    // Asserted per exit, not once for the file. Abandoning the wizard from the welcome screen is
    // the state with the most left undone, so it needs the remainder recorded more than finishing
    // does — and an earlier draft recorded it only on the finish path while still passing a
    // file-wide check for the same string.
    for (const exit of ['function complete()', 'function skip()']) {
      const body = shell.slice(shell.indexOf(exit))
      expect(body.slice(0, body.indexOf('\n  }'))).toContain('setupRemainder.set(remainderFrom(readiness))')
    }
    // The home screen picks one of several layouts. Each has to carry the checklist, or skipped
    // setup becomes unreachable for whoever lands on the layout that forgot it.
    const layout = home.slice(home.indexOf('{#if $offlineMode}'))
    const branches = layout.match(/^\{(?:#if|:else)/gm) ?? []
    expect(branches.length).toBeGreaterThan(1)
    expect(layout.match(/<SetupChecklist \/>/g) ?? []).toHaveLength(branches.length)
  })

  it('plays the ident once per launch without persisting a setting for it', () => {
    // A stored "intro seen" flag would survive a reinstall of the profile and could never be
    // cleared by rerunning setup. The gate is the wizard itself — it only exists for a new user —
    // plus a module flag so an /app navigation that re-creates the wizard does not replay it.
    expect(intro).toContain('<script module')
    expect(intro).toContain('let played = false')
    expect(intro).not.toContain('persisted')
    expect(shell).toContain('let introRunning = $state(!introAlreadyPlayed())')
    // Inside the dialog, so the skip control is inside the wizard's existing focus trap.
    const dialog = shell.slice(shell.indexOf('role="dialog"'))
    const close = dialog.lastIndexOf('{/if}')
    expect(close).toBeGreaterThan(-1)
    expect(dialog.indexOf('<IntroSequence')).toBeGreaterThan(dialog.indexOf('</main>'))
    expect(dialog.indexOf('<IntroSequence')).toBeLessThan(close)
  })

  it('lets any key or click interrupt the ident, with nothing on screen saying so', () => {
    for (const event of ['keydown', 'pointerdown']) expect(intro).toContain(`window.addEventListener('${event}'`)
    for (const event of ['keydown', 'pointerdown']) expect(intro).toContain(`window.removeEventListener('${event}'`)
    // No visible affordance: the ident only ever plays into first-run setup, so a permanent
    // "skip" label would advertise an escape from a screen the user sees once.
    expect(intro).not.toContain('<button')
    expect(intro).not.toContain('intro-skip')
    // Completing twice would fire the wizard's reveal mid-fade; the guard is the reason skip and
    // the scheduled end can both call finish().
    expect(intro).toContain('if (done) return')
    expect(intro).toContain('clearTimeout(timer)')
  })

  it('drops the splash layers under reduced motion instead of freezing them mid-air', () => {
    // Disabling the animations would leave a droplet parked above the mark and four opaque rings
    // sitting on top of it, so the layers are never rendered at all.
    expect(intro).toContain("document.documentElement.dataset.motion === 'reduced'")
    expect(intro).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)')")
    const guarded = intro.slice(intro.indexOf('{#if !reduced}'), intro.indexOf('{/if}'))
    for (const layer of ['drop', 'flash', 'bloom', 'ring-1', 'ring-2', 'ring-3', 'crest']) {
      expect(guarded, `${layer} must be inside the reduced-motion guard`).toContain(layer)
    }
  })

  it('animates the ident on the compositor only, which is what gamescope can afford', () => {
    // Every @keyframes block sits at the end of the sheet, so anything declared past the first one
    // is part of the ident's motion. A width, a filter or a box-shadow in here would repaint a
    // full-screen layer every frame on the hardware least able to absorb it.
    const frames = intro.slice(intro.indexOf('@keyframes'))
    const properties = [...frames.matchAll(/([a-z-]+)\s*:/g)].map(match => match[1])
    expect(properties.length).toBeGreaterThan(20)
    expect([...new Set(properties)].sort()).toEqual(['opacity', 'transform'])
  })

  it('keeps the scheduled hand-off in step with the fade that performs it', () => {
    // The timer decides when the wizard becomes interactive again. Retuning the CSS exit without
    // it would either cut the fade short or leave the ident sitting on a finished screen.
    const runtime = intro.match(/const RUNTIME = reduced \? (\d+) : (\d+)/)
    const full = intro.match(/animation: intro-out (\d+)ms cubic-bezier\([^)]*\) (\d+)ms both;/)
    const quiet = intro.match(/\.intro\.reduced \{ animation: intro-out (\d+)ms ease (\d+)ms both; \}/)
    expect(runtime).toBeTruthy()
    expect(full).toBeTruthy()
    expect(quiet).toBeTruthy()
    expect(Number(runtime![2])).toBeGreaterThanOrEqual(Number(full![1]) + Number(full![2]))
    expect(Number(runtime![1])).toBeGreaterThanOrEqual(Number(quiet![1]) + Number(quiet![2]))
  })

  it.each(['en', 'ja'])('spells the onboarding brand lowercase in %s', locale => {
    const messages = JSON.parse(read(`../../../../messages/${locale}.json`)) as Record<string, string>
    const copy = Object.entries(messages).filter(([key]) => key.startsWith('onboarding_') || key.startsWith('setup_'))
    expect(copy.length).toBeGreaterThan(0)
    expect(copy.filter(([, value]) => /\bIzumi\b/.test(value))).toEqual([])
    expect(messages.onboarding_welcome_title).toContain('izumi')
  })
})
