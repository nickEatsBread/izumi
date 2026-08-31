import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { legacyFunctionFallback, legacyTvCss } from './legacy-css.ts'

describe('legacy TV CSS', () => {
  it('creates usable values for engines without clamp/min/max', () => {
    expect(legacyFunctionFallback('clamp(16px, 2vw, 32px)')).toBe('2vw')
    expect(legacyFunctionFallback('min(50vw, 640px)')).toBe('640px')
    expect(legacyFunctionFallback('max(10px, 2vw)')).toBe('10px')
  })

  it('emits positional fallbacks before inset', async () => {
    const output = await postcss([legacyTvCss()]).process('.panel{inset:1px 2px 3px 4px;font-size:clamp(12px,2vw,24px)}', { from: undefined })
    expect(output.css).toContain('top:1px;right:2px;bottom:3px;left:4px;inset:1px 2px 3px 4px')
    expect(output.css).toContain('font-size:2vw;font-size:clamp(12px,2vw,24px)')
  })

  it('keeps functional inset values intact', async () => {
    const output = await postcss([legacyTvCss()]).process('.panel{inset:0 0 0 clamp(58px, 4vw, 82px)}', { from: undefined })
    expect(output.css).toContain('left:4vw')
    expect(output.css).toContain('inset:0 0 0 clamp(58px, 4vw, 82px)')
    expect(output.css).not.toContain('clamp(58px,;')
  })
})
