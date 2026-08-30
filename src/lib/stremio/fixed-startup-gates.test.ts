import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./play.ts', import.meta.url)), 'utf8')

describe('fixed playback startup gates', () => {
  it('does not wait for external subtitles before Android or desktop playback', () => {
    const android = source.slice(source.indexOf('if (androidEmbedded)'), source.indexOf('await mpvLoad({'))
    const desktop = source.slice(source.indexOf('// Embed mpv FIRST'), source.indexOf("traceResolve(trace, 'player embed start'"))
    expect(android).not.toContain('Promise.race([subsP')
    expect(desktop).not.toContain('Promise.race([\n          subsP')
    expect(source).toContain('const addonSubs: SubtitleCandidate[] = []')
    expect(source).toContain('const candidates: SubtitleCandidate[] = []')
  })

  it('starts Continue Watching from the stored media without awaiting its refresh', () => {
    const resume = source.slice(source.indexOf('export async function resumeEpisode'), source.indexOf('// Advance to an episode'))
    expect(resume).toContain('void refreshContinueMedia(media)')
    expect(resume).not.toContain('await refreshContinueMedia(media)')
  })
})
