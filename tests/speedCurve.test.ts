import { describe, expect, it } from 'vitest'
import {
  applyEasing,
  clipSourceSpan,
  clipSourceTime,
  clipTimelineTimeForSource,
  createClip,
  sampleKeyframes,
  speedMultiplierAt,
  type Clip
} from '@shared/document'

function clipWithCurve(points: Array<{ t: number; v: number }>, duration = 10): Clip {
  return createClip({
    kind: 'video',
    start: 0,
    duration,
    inPoint: 5,
    speed: 1,
    speedCurve: { enabled: true, points }
  })
}

describe('speedMultiplierAt', () => {
  it('returns constant speed when no curve is enabled', () => {
    const clip = createClip({ kind: 'video', start: 0, duration: 10, speed: 2 })
    expect(speedMultiplierAt(clip, 5)).toBe(2)
  })

  it('interpolates linearly between curve points', () => {
    const clip = clipWithCurve([
      { t: 0, v: 1 },
      { t: 1, v: 3 }
    ])
    expect(speedMultiplierAt(clip, 0)).toBe(1)
    expect(speedMultiplierAt(clip, 5)).toBe(2)
    expect(speedMultiplierAt(clip, 10)).toBe(3)
  })

  it('holds value outside the covered range', () => {
    const clip = clipWithCurve([
      { t: 0.25, v: 0.5 },
      { t: 0.75, v: 2 }
    ])
    expect(speedMultiplierAt(clip, 1)).toBe(0.5)
    expect(speedMultiplierAt(clip, 9.9)).toBe(2)
  })
})

describe('clipSourceTime with speed curve', () => {
  it('integrates piecewise-linear speed correctly', () => {
    // Speed 1 for the first half, ramping 1→3 over the second half of 10s.
    const clip = clipWithCurve([
      { t: 0, v: 1 },
      { t: 0.5, v: 1 },
      { t: 1, v: 3 }
    ])
    // At t=5: consumed 5s of source. inPoint=5 → 10.
    expect(clipSourceTime(clip, 5)).toBeCloseTo(10, 5)
    // At t=10: 5 + average(1..3)*5 = 5 + 10 = 15 source seconds → 20.
    expect(clipSourceTime(clip, 10)).toBeCloseTo(20, 5)
    // At t=7.5: 5 + (2.5*1 + 0.5*0.5*2.5*2) = 8.75 → 13.75.
    expect(clipSourceTime(clip, 7.5)).toBeCloseTo(13.75, 5)
  })

  it('maps source time back to the matching timeline time', () => {
    const clip = clipWithCurve([
      { t: 0, v: 0.5 },
      { t: 1, v: 2 }
    ])
    // Round trip: timeline → source → timeline.
    for (const t of [0, 2.5, 5, 7.5, 10]) {
      const src = clipSourceTime(clip, t)
      expect(clipTimelineTimeForSource(clip, src)).toBeCloseTo(t, 4)
    }
  })

  it('computes the consumed source span', () => {
    const clip = clipWithCurve([
      { t: 0, v: 1 },
      { t: 0.5, v: 1 },
      { t: 1, v: 3 }
    ])
    // 5s at speed 1, then 5s ramping 1→3 (average 2) → 15 source seconds.
    expect(clipSourceSpan(clip)).toBeCloseTo(15, 5)
  })
})

describe('sampleKeyframes with easing', () => {
  it('supports hold easing (step between keyframes)', () => {
    const clip = createClip({
      kind: 'video',
      start: 0,
      duration: 10,
      keyframes: [
        { id: 'a', time: 2, scale: 1, easing: 'hold' },
        { id: 'b', time: 6, scale: 3 }
      ]
    })
    expect(sampleKeyframes(clip, 3).scale).toBe(1)
    expect(sampleKeyframes(clip, 6).scale).toBe(3)
  })

  it('supports linear easing', () => {
    const clip = createClip({
      kind: 'video',
      start: 0,
      duration: 10,
      keyframes: [
        { id: 'a', time: 0, scale: 1, easing: 'linear' },
        { id: 'b', time: 10, scale: 2 }
      ]
    })
    expect(sampleKeyframes(clip, 5).scale).toBeCloseTo(1.5, 5)
  })

  it('samples volume keyframes with first-keyframe hold before the range', () => {
    const clip = createClip({
      kind: 'video',
      start: 0,
      duration: 10,
      volume: 0.8,
      keyframes: [
        { id: 'a', time: 2, volume: 1 },
        { id: 'b', time: 4, volume: 0.5 }
      ]
    })
    // Before the first keyframe the value holds at that keyframe's value,
    // matching the transform keyframe behavior.
    expect(sampleKeyframes(clip, 0).volume).toBeCloseTo(1, 5)
    expect(sampleKeyframes(clip, 3).volume).toBeCloseTo(0.75, 5)
    expect(sampleKeyframes(clip, 5).volume).toBeCloseTo(0.5, 5)
  })
})

describe('applyEasing', () => {
  it('clamps and applies curves', () => {
    expect(applyEasing(-1, 'linear')).toBe(0)
    expect(applyEasing(2, 'linear')).toBe(1)
    expect(applyEasing(0.5, 'linear')).toBe(0.5)
    expect(applyEasing(0.5, 'hold')).toBe(0)
    expect(applyEasing(0.5, 'ease-in')).toBeCloseTo(0.25, 5)
    expect(applyEasing(0.5, 'ease-out')).toBeCloseTo(0.75, 5)
  })
})
