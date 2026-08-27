import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import { detailHints, rememberDetail } from './detail-hint'

describe('detail navigation hints', () => {
  beforeEach(() => detailHints.set({}))

  it('carries the exact title displayed by Continue Watching', () => {
    rememberDetail({ id: 101, title: { romaji: 'Series' } }, 'Displayed series name')
    expect(get(detailHints)[101]?.title).toMatchObject({
      romaji: 'Series',
      userPreferred: 'Displayed series name',
    })
  })
})
