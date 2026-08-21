import { describe, expect, it } from 'vitest'
import { shakaDrmConfig } from './shaka-offline'

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
