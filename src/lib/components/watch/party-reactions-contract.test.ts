import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/lib/components/watch/PartyPresence.svelte'), 'utf8')

describe('synced reaction player UI', () => {
  it('renders every supported reaction through the shared room sender', () => {
    expect(source).toContain('PARTY_REACTION_EMOJIS')
    expect(source).toContain('sendPartyReaction(emoji)')
    expect(source).toContain('aria-label={`React ${emoji}`}')
  })

  it('identifies the sender and expires each animated burst', () => {
    expect(source).toContain("reaction.own ? 'You' : reaction.name")
    expect(source).toContain('party-reaction-rise 4.1s')
  })
})
