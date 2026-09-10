import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('./FirstRunSetup.svelte')
const artwork = read('./SetupArtwork.svelte')
const checklist = read('./SetupChecklist.svelte')
const home = read('../../../routes/app/home/+page.svelte')
// The shell owns no controls any more — every input lives in a step component — so the focus and
// heading styling it used to scope to itself had to move to the global sheet to keep reaching them.
const css = read('../../../app.css')
const steps = Object.fromEntries(
  ['WelcomeStep', 'WatchStep', 'ConnectStep', 'SyncStep', 'SourcesStep', 'PlaybackStep', 'ReadyStep']
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
    for (const step of ['welcome', 'watch', 'connect', 'sync', 'sources', 'playback']) {
      expect(shell).toContain(`step === '${step}'`)
    }
    expect(shell).not.toMatch(/step === \d/)
  })

  it('shows the full artwork on welcome and the chosen artwork afterwards', () => {
    expect(shell).toContain("intent={step === 'welcome' ? { anime: true, films: true } : intent}")
    expect(shell.indexOf('<SetupArtwork')).toBeLessThan(shell.indexOf('{#key step}'))
    expect(artwork).toContain('$derived(intent.anime && intent.films')
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

  it('offers two independent library checkboxes instead of a third combined mode', () => {
    expect(watch).toContain('type="checkbox"')
    expect(watch).toContain('function toggle(key:')
    expect(watch).toContain('if (!next.anime && !next.films)')
    // Refusing the last untick leaves `intent` unchanged, so Svelte never re-renders the input.
    // The checkbox has to be put back by hand or a screen reader reads an enabled library as off.
    expect(watch).toContain('input.checked = intent[key]')
    expect(watch).not.toContain("'both'")
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

  it.each(['en', 'ja'])('spells the onboarding brand lowercase in %s', locale => {
    const messages = JSON.parse(read(`../../../../messages/${locale}.json`)) as Record<string, string>
    const copy = Object.entries(messages).filter(([key]) => key.startsWith('onboarding_') || key.startsWith('setup_'))
    expect(copy.length).toBeGreaterThan(0)
    expect(copy.filter(([, value]) => /\bIzumi\b/.test(value))).toEqual([])
    expect(messages.onboarding_welcome_title).toContain('izumi')
  })
})
