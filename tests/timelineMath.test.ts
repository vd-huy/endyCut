import { describe, expect, it } from 'vitest'
import { createClip, createTrack, type Clip } from '../src/shared/document'
import {
  collectSnapCandidates,
  overlapsTrack,
  resolveDropStart,
  snapTime,
  splitClip,
  transitionFits,
  trimBounds
} from '../src/shared/timelineMath'

function clipAt(start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return createClip({ kind: 'video', start, duration, ...extra })
}

describe('snapTime', () => {
  it('snaps to the closest candidate within threshold', () => {
    const result = snapTime(1.04, [1, 2, 3], 0.1)
    expect(result).toEqual({ time: 1, target: 1 })
  })
  it('returns null when nothing is close', () => {
    expect(snapTime(1.5, [1, 2], 0.1)).toBeNull()
  })
})

describe('collectSnapCandidates', () => {
  it('includes clip edges, playhead and zero', () => {
    const track = createTrack('video', 'V1')
    track.clips = [clipAt(2, 3)]
    const candidates = collectSnapCandidates([track], 5, 'none')
    expect(candidates).toContain(0)
    expect(candidates).toContain(5)
    expect(candidates).toContain(2)
    expect(candidates).toContain(5) // end edge 2+3
  })
})

describe('overlapsTrack', () => {
  it('detects overlap with other clips only', () => {
    const track = createTrack('video', 'V1')
    track.clips = [clipAt(0, 2, { id: 'a' }), clipAt(5, 2, { id: 'b' })]
    expect(overlapsTrack(track, 'x', 1, 2)).toBe(true)
    expect(overlapsTrack(track, 'x', 2, 3)).toBe(false)
    expect(overlapsTrack(track, 'a', 1, 2)).toBe(false) // ignores itself
  })
})

describe('splitClip', () => {
  it('splits in the middle, adjusting inPoint for speed', () => {
    const clip = clipAt(10, 10, { id: 'a', inPoint: 5, speed: 2 })
    const result = splitClip(clip, 15)
    expect(result).not.toBeNull()
    expect(result!.left.duration).toBe(5)
    expect(result!.right.start).toBe(15)
    expect(result!.right.duration).toBe(5)
    expect(result!.right.inPoint).toBe(15) // 5 + 5*2
    expect(result!.right.id).not.toBe('a')
  })
  it('rejects splits too close to edges', () => {
    expect(splitClip(clipAt(0, 10), 0.01)).toBeNull()
    expect(splitClip(clipAt(0, 10), 9.99)).toBeNull()
  })
  it('keeps transition on the left clip only', () => {
    const clip = clipAt(0, 10, { transitionIn: { type: 'crossfade', duration: 1 } })
    const result = splitClip(clip, 5)!
    expect(result.left.transitionIn).toEqual({ type: 'crossfade', duration: 1 })
    expect(result.right.transitionIn).toBeNull()
  })
})

describe('trimBounds', () => {
  it('clips cannot cross neighbors', () => {
    const track = createTrack('video', 'V1')
    // Clip b holds 5s of unused source before its inPoint, so it could reach
    // back to 0 — but clip a blocks it at 2.
    track.clips = [clipAt(0, 2, { id: 'a' }), clipAt(5, 3, { id: 'b', inPoint: 5 })]
    const bounds = trimBounds(track, track.clips[1], 60)
    expect(bounds.minStart).toBe(2)
    // Right edge limited only by remaining source: 8 + (60-5)/1.
    expect(bounds.maxEnd).toBe(63)
  })
  it('left trim cannot exceed available source before inPoint', () => {
    const track = createTrack('video', 'V1')
    const clip = clipAt(2, 2, { id: 'a', inPoint: 1, speed: 1 })
    track.clips = [clip]
    const bounds = trimBounds(track, clip, 10)
    expect(bounds.minStart).toBeCloseTo(1) // 2 - 1s of unused source
  })
})

describe('resolveDropStart', () => {
  it('returns desired start when free', () => {
    const track = createTrack('video', 'V1')
    track.clips = []
    expect(resolveDropStart(track, 'x', 3, 2)).toBe(3)
  })
  it('pushes past an occupied clip', () => {
    const track = createTrack('video', 'V1')
    track.clips = [clipAt(2, 4, { id: 'a' })]
    // Drop onto the occupied window: nearest valid is after it.
    expect(resolveDropStart(track, 'x', 3, 2)).toBe(6)
    expect(resolveDropStart(track, 'x', 1, 2)).toBe(0) // fits before
  })
})

describe('transitionFits', () => {
  it('requires adjacent clips and enough room', () => {
    const prev = clipAt(0, 4, { id: 'p' })
    const next = clipAt(4, 4, { id: 'n' })
    expect(transitionFits(prev, next, 1)).toBe(true)
    expect(transitionFits(prev, next, 10)).toBe(false)
    const gapped = clipAt(6, 4, { id: 'g' })
    expect(transitionFits(prev, gapped, 1)).toBe(false)
  })
})
