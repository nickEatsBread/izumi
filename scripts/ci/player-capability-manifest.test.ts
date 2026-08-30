import { describe, expect, it } from 'vitest'
import {
  parseAndroidBuildProvenance,
  parseFlagTable,
  parseHwaccels,
  parseProtocols,
  parseWindowsBuildProvenance,
} from './player-capability-manifest.mjs'

describe('player capability manifest parsing', () => {
  it('extracts and sorts feature tables without flag columns', () => {
    expect(parseFlagTable(`
 Decoders:
 V..... h264                 H.264
 A....D aac                  AAC
 V..... h264                 duplicate
 ------
    `)).toEqual(['aac', 'h264'])
  })

  it('keeps input and output protocols separate', () => {
    expect(parseProtocols(`
Supported file protocols:
Input:
http
https
Output:
file
http
    `)).toEqual({ input: ['http', 'https'], output: ['file', 'http'] })
    expect(parseHwaccels('Hardware acceleration methods:\nvaapi\nvulkan\n'))
      .toEqual(['vaapi', 'vulkan'])
  })

  it('records the reviewed Android native graph from the build contract', () => {
    expect(parseAndroidBuildProvenance(`
readonly REPO="https://example.test/libmpv-android.git"
readonly COMMIT="abc123"
readonly MPV_VERSION="0.41.0"
readonly FFMPEG_VERSION="8.1.2"
readonly LIBPLACEBO_VERSION="7.360.1"
readonly LIBASS_VERSION="0.17.5"
    `)).toEqual({
      repository: 'https://example.test/libmpv-android.git',
      commit: 'abc123',
      mpv: '0.41.0',
      ffmpeg: '8.1.2',
      libplacebo: '7.360.1',
      libass: '0.17.5',
    })
  })

  it('records the pinned Windows snapshot identity', () => {
    expect(parseWindowsBuildProvenance(`
$PinnedTag = '20260829'
$PinnedAsset = 'mpv-dev-x86_64-20260829-git-e8673660ab.7z'
$PinnedSha256 = 'abc123'
    `)).toEqual({
      releaseTag: '20260829',
      asset: 'mpv-dev-x86_64-20260829-git-e8673660ab.7z',
      expectedSha256: 'abc123',
    })
  })
})
