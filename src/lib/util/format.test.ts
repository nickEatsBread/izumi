import { describe, it, expect } from 'vitest'
import { formatBytes, formatSpeed } from './format'

describe('formatBytes', () => {
  it('scales to KB/MB/GB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1610612736)).toBe('1.5 GB')
  })
  it('returns empty string for undefined/negative', () => {
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(-5)).toBe('')
  })
})

describe('formatSpeed', () => {
  it('appends /s', () => {
    expect(formatSpeed(1048576)).toBe('1.0 MB/s')
    expect(formatSpeed(0)).toBe('0 B/s')
  })
  it('empty for undefined', () => {
    expect(formatSpeed(undefined)).toBe('')
  })
})
