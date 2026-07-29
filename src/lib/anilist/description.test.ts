import { describe, expect, it } from 'vitest'
import { descriptionText } from './description'

describe('descriptionText', () => {
  it('collapses AniList newlines around break tags into one paragraph gap', () => {
    const description = 'First paragraph.\n<br><br>\nSecond paragraph.'

    expect(descriptionText(description)).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('normalizes excessive and whitespace-only blank lines', () => {
    const description = 'First.\r\n \r\n\r\n\t\r\nSecond.'

    expect(descriptionText(description)).toBe('First.\n\nSecond.')
  })

  it('removes markup and decodes common entities', () => {
    const description = '<p>A &amp; B</p><p>&quot;C&quot; &lt; D&#039;s score</p>'

    expect(descriptionText(description)).toBe('A & B\n\n"C" < D\'s score')
  })

  it('returns an empty string for a missing description', () => {
    expect(descriptionText()).toBe('')
  })
})
