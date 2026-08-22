import { describe, expect, it } from 'vitest'
import { offlineRetryParameters, shakaDrmConfig } from './shaka-offline'

const drm = {
  keySystem: 'com.widevine.alpha',
  licenseUrl: 'http://127.0.0.1/license',
  videoRobustness: 'SW_SECURE_CRYPTO',
}

describe('shakaDrmConfig', () => {
  it('only advertises the provider key system so Windows PlayReady cannot steal the CDM', () => {
    const config = shakaDrmConfig(drm, false)
    expect(Object.keys(config.servers)).toEqual(['com.widevine.alpha'])
    expect(Object.keys(config.advanced)).toEqual(['com.widevine.alpha'])
    expect(config.preferredKeySystems).toEqual(['com.widevine.alpha'])
    expect(config.advanced['com.widevine.alpha']?.persistentStateRequired).toBe(false)
  })

  it('requires persistent CDM state only when this device can keep a stored license', () => {
    expect(shakaDrmConfig(drm, true).advanced['com.widevine.alpha']?.persistentStateRequired).toBe(true)
  })
})

describe('offlineRetryParameters', () => {
  it('does not abort in-flight fragments after 5s of slow proxy progress', () => {
    expect(offlineRetryParameters.stallTimeout).toBe(0)
    expect(offlineRetryParameters.maxAttempts).toBe(2)
    expect(offlineRetryParameters.timeout).toBeGreaterThanOrEqual(60_000)
  })
})
