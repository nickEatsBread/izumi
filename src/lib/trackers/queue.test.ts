import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { trackerQueue, enqueue, markConfirmed, classifyStatus, type TrackerOp } from './queue'

const progOp = (mediaId: number, progress: number): TrackerOp => ({ kind: 'progress', mediaId, progress, status: 'CURRENT' })
const statusOp = (mediaId: number): TrackerOp => ({ kind: 'status', mediaId, status: 'PLANNING' })
const mine = (mediaId: number) => get(trackerQueue).filter((e) => e.op.mediaId === mediaId && e.tracker === 'AniList')

describe('tracker retry queue', () => {
  beforeEach(() => trackerQueue.set([]))

  it('coalesces progress to a single highest entry (never replays ep3 then ep5)', () => {
    enqueue('AniList', progOp(100, 3))
    enqueue('AniList', progOp(100, 5))
    expect(mine(100)).toHaveLength(1)
    expect(mine(100)[0].op.progress).toBe(5)
  })

  it('keeps the higher progress even when enqueued out of order', () => {
    enqueue('AniList', progOp(101, 5))
    enqueue('AniList', progOp(101, 3))
    expect(mine(101)).toHaveLength(1)
    expect(mine(101)[0].op.progress).toBe(5)
  })

  it('skips a progress enqueue at or below the confirmed floor (only-increase)', () => {
    markConfirmed('AniList', 102, 8)
    enqueue('AniList', progOp(102, 5))
    expect(mine(102)).toHaveLength(0)
  })

  it('does NOT drop a REPEATING (rewatch) progress op below the confirmed floor', () => {
    markConfirmed('AniList', 104, 12)
    enqueue('AniList', { kind: 'progress', mediaId: 104, progress: 3, status: 'REPEATING' })
    expect(mine(104)).toHaveLength(1)
    expect(mine(104)[0].op.status).toBe('REPEATING')
  })

  it('a progress enqueue evicts a pending status op for the same title', () => {
    enqueue('AniList', statusOp(103))
    enqueue('AniList', progOp(103, 2))
    expect(mine(103)).toHaveLength(1)
    expect(mine(103)[0].op.kind).toBe('progress')
  })

  it('classifies transient vs permanent HTTP statuses', () => {
    expect(classifyStatus(500)).toBe('retry')
    expect(classifyStatus(429)).toBe('retry')
    expect(classifyStatus(408)).toBe('retry')
    expect(classifyStatus(401)).toBe('drop')
    expect(classifyStatus(404)).toBe('drop')
    expect(classifyStatus(400)).toBe('drop')
  })
})
