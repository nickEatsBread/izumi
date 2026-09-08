import { expect, it } from 'vitest'
import { isSupplementalVideo, isTvVideoCompatible } from './playback-suitability'
it('rejects promotional releases while preserving titles that contain the same words', () => {
  for (const extra of ['Trailer', 'Prologue', 'Featurette', 'Sample']) expect(isSupplementalVideo({ title: `Example Film ${extra} 2160p` }, 'Example Film')).toBe(true)
  expect(isSupplementalVideo({ title: 'The Prologue 2024 1080p' }, 'The Prologue')).toBe(false)
  expect(isSupplementalVideo({ url: 'https://media.example/opaque' }, 'Example Film')).toBe(false)
})
it('retains compatible fallback encodes and rejects declared unsupported variants', () => {
  expect(isSupplementalVideo({ title: 'Example 1080p\nOfficial Prologue' }, 'Example')).toBe(true)
  expect(isSupplementalVideo({ title: 'Example', url: 'https://media.example/Example%20Trailer.mkv' }, 'Example')).toBe(true)
  expect(isSupplementalVideo({ title: 'Example', url: 'https://media.example/opaque?token=preview' }, 'Example')).toBe(false)
  expect(isTvVideoCompatible({ title: 'Example 1080p HEVC 12-bit' })).toBe(false)
  expect(isTvVideoCompatible({ title: 'Example 1080p H264 4:4:4' })).toBe(false)
  expect(isTvVideoCompatible({ title: 'Example 2160p DV HEVC' })).toBe(false)
  expect(isTvVideoCompatible({ title: 'Example 2160p DV HDR10 HEVC' })).toBe(true)
  expect(isTvVideoCompatible({ title: 'Example 1080p H.264 10-bit' })).toBe(false)
  expect(isTvVideoCompatible({ title: 'Example 1080p HEVC 10-bit' })).toBe(true)
  expect(isTvVideoCompatible({ title: 'Example 1080p AV1' }, { av1: false })).toBe(false)
  expect(isTvVideoCompatible({ title: 'Example 2160p HDR10' }, { hdr: false })).toBe(false)
  expect(isTvVideoCompatible({ title: 'Example 1080p H.264' }, { uhd: false, hdr: false })).toBe(true)
})
it('rejects making-of documentaries indexed under the film', () => {
  expect(isSupplementalVideo({ title: 'Example Film (2026) the Making of an Epic' }, 'Example.Film')).toBe(true)
  expect(isTvVideoCompatible({ title: 'Example 2160p Dolby Vision HDR ENG mp4' })).toBe(false)
})
