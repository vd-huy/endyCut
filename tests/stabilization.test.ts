import { describe, expect, it } from 'vitest'
import {
  buildStabilizationData,
  estimateFrameMotion,
  sampleCorrection,
  smoothPath,
  type MotionSample
} from '../src/renderer/src/core/media/stabilization'

describe('smoothPath', () => {
  it('keeps a constant path unchanged', () => {
    const path: MotionSample[] = Array.from({ length: 20 }, () => ({ dx: 0.02, dy: -0.01, rot: 0.1 }))
    const smoothed = smoothPath(path, 4)
    for (const p of smoothed) {
      expect(p.dx).toBeCloseTo(0.02, 6)
      expect(p.dy).toBeCloseTo(-0.01, 6)
      expect(p.rot).toBeCloseTo(0.1, 6)
    }
  })

  it('damps an isolated spike', () => {
    const path: MotionSample[] = Array.from({ length: 21 }, (_, i) => ({
      dx: i === 10 ? 0.3 : 0,
      dy: 0,
      rot: 0
    }))
    const smoothed = smoothPath(path, 5)
    // The spike spreads across the 11-sample window: 0.3/11 ≈ 0.027.
    expect(smoothed[10].dx).toBeGreaterThan(0.01)
    expect(smoothed[10].dx).toBeLessThan(0.15)
    expect(smoothed[9].dx).toBeCloseTo(smoothed[10].dx, 6)
  })
})

describe('buildStabilizationData', () => {
  it('yields near-identity corrections for a still camera', () => {
    const times = Array.from({ length: 30 }, (_, i) => i / 20)
    const motions = Array.from({ length: 30 }, () => ({ dx: 0, dy: 0, rot: 0 }))
    const data = buildStabilizationData(times, motions, 2)
    for (const c of data.corrections) {
      expect(Math.abs(c.dx)).toBeLessThan(1e-9)
      expect(Math.abs(c.dy)).toBeLessThan(1e-9)
    }
    expect(data.zoom).toBeCloseTo(1.01, 5)
  })

  it('counteracts handheld jitter (stabilized path is flatter)', () => {
    const times = Array.from({ length: 60 }, (_, i) => i / 20)
    const motions = times.map((_, i) => ({
      dx: 0.01 * Math.sin(i / 2.5),
      dy: 0.008 * Math.cos(i / 3),
      rot: 0
    }))
    const data = buildStabilizationData(times, motions, 3)
    // raw[i] + corrections[i] is the smoothed (stabilized) camera path.
    const range = (values: number[]): number => Math.max(...values) - Math.min(...values)
    const rawRange = range(data.raw.map((p) => p.dx))
    const stabilizedRange = range(data.raw.map((p, i) => p.dx + data.corrections[i].dx))
    expect(stabilizedRange).toBeLessThan(rawRange * 0.6)
    // And zoom grows to cover the correction.
    expect(data.zoom).toBeGreaterThan(1.01)
    expect(data.zoom).toBeLessThanOrEqual(1.4)
  })

  it('stronger levels stabilize more', () => {
    const times = Array.from({ length: 80 }, (_, i) => i / 20)
    const motions = times.map((_, i) => ({ dx: 0.012 * Math.sin(i / 2), dy: 0, rot: 0 }))
    const soft = buildStabilizationData(times, motions, 1)
    const strong = buildStabilizationData(times, motions, 4)
    const range = (values: number[]): number => Math.max(...values) - Math.min(...values)
    const stabilized = (d: ReturnType<typeof buildStabilizationData>): number =>
      range(d.raw.map((p, i) => p.dx + d.corrections[i].dx))
    expect(stabilized(strong)).toBeLessThan(stabilized(soft))
  })
})

describe('sampleCorrection', () => {
  const data = buildStabilizationData(
    [0, 1, 2, 3],
    [
      { dx: 0, dy: 0, rot: 0 },
      { dx: 0.1, dy: 0, rot: 0 },
      { dx: 0.1, dy: 0.1, rot: 0 },
      { dx: 0, dy: 0.1, rot: 0 }
    ],
    1
  )

  it('clamps outside the analyzed range', () => {
    expect(sampleCorrection(data, -1).dx).toBeCloseTo(data.corrections[0].dx)
    expect(sampleCorrection(data, 99).dy).toBeCloseTo(data.corrections[3].dy)
  })

  it('interpolates between samples', () => {
    const mid = sampleCorrection(data, 1.5)
    const a = data.corrections[1]
    const b = data.corrections[2]
    expect(mid.dx).toBeGreaterThanOrEqual(Math.min(a.dx, b.dx) - 1e-9)
    expect(mid.dx).toBeLessThanOrEqual(Math.max(a.dx, b.dx) + 1e-9)
  })
})

describe('estimateFrameMotion', () => {
  const W = 96
  const H = 72

  /** Whole textured scene + a bright marker block, shifted by (shiftX, shiftY). */
  function frame(shiftX: number, shiftY: number): Float32Array {
    const f = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = x - shiftX
        const sy = y - shiftY
        f[y * W + x] =
          0.35 + 0.18 * Math.sin(sx * 0.7 + sy * 0.31) + 0.14 * Math.sin(sx * 0.13 - sy * 0.53)
      }
    }
    const cx = Math.round(W / 2 + shiftX)
    const cy = Math.round(H / 2 + shiftY)
    for (let y = cy - 8; y <= cy + 8; y++) {
      for (let x = cx - 8; x <= cx + 8; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) f[y * W + x] = 0.95
      }
    }
    return f
  }

  it('detects a pure horizontal shift (content right → camera dx negative)', () => {
    const motion = estimateFrameMotion(frame(0, 0), frame(3, 0), W, H)
    expect(motion.dx).toBeCloseTo(-3 / W, 2)
    expect(motion.dy).toBeCloseTo(0, 1)
  })

  it('detects a vertical shift (content up → camera dy positive)', () => {
    const motion = estimateFrameMotion(frame(0, 0), frame(0, -2), W, H)
    expect(motion.dy).toBeCloseTo(2 / H, 2)
    expect(motion.dx).toBeCloseTo(0, 1)
  })

  it('reports zero motion for identical frames', () => {
    const f = frame(0, 0)
    const motion = estimateFrameMotion(f, f, W, H)
    expect(motion.dx).toBe(0)
    expect(motion.dy).toBe(0)
    expect(motion.rot).toBeCloseTo(0, 3)
  })

  it('reports zero motion on flat frames instead of a search-corner artifact', () => {
    const flat = new Float32Array(W * H).fill(0.2)
    const motion = estimateFrameMotion(flat, flat, W, H)
    expect(motion.dx).toBe(0)
    expect(motion.dy).toBe(0)
  })
})
