import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The mobile watch page reaches a related title through its own callback instead of the shared
// card link, so it is the one place that can drift from `mediaHref`. It cannot be exercised here
// (no APK, no DOM), so the wiring is pinned at the source level: the button must hand over the
// whole media node, and the navigation must derive its route from that node.
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const details = read('./AndroidWatchDetails.svelte')
const player = read('./AndroidPlayer.svelte')

describe('mobile related-title navigation', () => {
  it('passes the whole relation node, not just its id', () => {
    expect(details).toContain('onRelated(relation.node)')
    expect(details).not.toContain('onRelated(relation.node.id)')
    expect(details).toContain('onRelated: (media: Media) =>')
  })

  it('routes through the shared media href instead of hardcoding the anime route', () => {
    // A manga/light-novel relation sent to `/app/anime/<id>` asks AniList for an ANIME with that id
    // and gets `Not Found`, which surfaces on the detail page as a bare load failure.
    expect(player).toContain('goto(mediaHref(')
    expect(player).not.toMatch(/goto\(`\/app\/anime\/\$\{id\}`\)/)
    expect(player).toMatch(/import \{[^}]*mediaHref[^}]*\} from '\$lib\/anilist\/media'/)
  })
})
