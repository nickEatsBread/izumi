// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { forgetPackageOrigin, packageOrigins, recordPackageOrigin } from './origins'

describe('package origins', () => {
  it('remembers and forgets which store a package came from', () => {
    packageOrigins.set({})
    recordPackageOrigin('example.pkg', 'https://x.test/index.json')
    expect(get(packageOrigins)).toEqual({ 'example.pkg': 'https://x.test/index.json' })
    forgetPackageOrigin('example.pkg')
    expect(get(packageOrigins)).toEqual({})
  })
})
