import { describe, expect, it } from 'vitest'
import { AUTO_ABR, abrMaxHeight, shouldPinFastStart } from './abr'

describe('Auto ABR', () => {
  it('keeps ABR on and does not let Network Information override measured throughput', () => {
    expect(AUTO_ABR.enabled).toBe(true)
    expect(AUTO_ABR.useNetworkInformation).toBe(false)
    expect(AUTO_ABR.defaultBandwidthEstimate).toBeGreaterThanOrEqual(1_000_000)
    expect(AUTO_ABR.defaultBandwidthEstimate).toBeLessThan(5_000_000)
    expect(AUTO_ABR.switchInterval).toBeGreaterThanOrEqual(2)
    expect(AUTO_ABR.switchInterval).toBeLessThanOrEqual(8)
  })

  it('does not re-pin a startup rung after the first frame while Auto is selected', () => {
    expect(shouldPinFastStart('auto', false)).toBe(true)
    expect(shouldPinFastStart('auto', true)).toBe(false)
    expect(shouldPinFastStart(720, true)).toBe(false)
    expect(shouldPinFastStart(720, false)).toBe(false)
  })

  it('caps Auto height only until the first frame so later estimates can climb', () => {
    expect(abrMaxHeight('auto', false)).toBe(360)
    expect(abrMaxHeight('auto', true)).toBe(Infinity)
    expect(abrMaxHeight(1080, false)).toBe(Infinity)
  })
})
