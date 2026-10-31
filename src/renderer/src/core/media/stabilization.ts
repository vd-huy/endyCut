import { ALL_FORMATS, Input, VideoSampleSink, type VideoSample } from 'mediabunny'
import type { Clip, MediaAsset } from '@shared/document'
import { clipSourceSpan } from '@shared/document'
import { createIpcFileSource } from './ipcSource'

/**
 * CapCut-style video stabilization, modeled on the draft's `SegmentVideo.stable`
 * (`Stable` with int `stable_level`, plus a cached per-frame matrix — see
 * docs/re-noise-reduction-stabilization.md). CapCut's `VideoStableService`
 * estimates a transform matrix per frame, caches it under
 * `Resources/video_stable/` and counter-applies it at render time.
 *
 * Local pipeline mirrors that shape:
 *  1. `analyzeStabilization` decodes the clip's source range at a reduced
 *     rate, estimates the global camera motion per frame pair (block matching
 *     + small-angle rotation fit) and integrates it into a camera path.
 *  2. The path is smoothed with a moving average whose radius grows with the
 *     selected level; `corrections = smoothed − raw` is the per-frame
 *     counter-transform, and `zoom` is the crop-in that hides the borders.
 *  3. The frame renderer samples the corrections at the current source time.
 *
 * Results are cached per clip source range + level (the `matrix_path` role).
 */

/** One path sample, normalized to the source frame (fraction of width/height). */
export interface MotionSample {
  /** Horizontal camera offset since the clip's first analyzed frame. */
  dx: number
  /** Vertical camera offset. */
  dy: number
  /** Camera roll in degrees. */
  rot: number
}

export interface StabilizationData {
  level: number
  /** Analysis sampling times in source seconds, relative to asset start. */
  times: number[]
  /** Raw cumulative camera path per sample. */
  raw: MotionSample[]
  /** Counter-transform per sample (smoothed − raw). */
  corrections: MotionSample[]
  /** Minimum scale factor that hides the borders introduced by corrections. */
  zoom: number
  analyzedAt: number
}

const ANALYSIS_FPS = 20
const MAX_SAMPLES = 600
const ANALYSIS_WIDTH = 96
const BLOCK_COLS = 6
const BLOCK_ROWS = 4
const SEARCH_RADIUS = 6

// ---------------------------------------------------------------------------
// Pure path math (unit-tested without a decoder)
// ---------------------------------------------------------------------------

/** Centered moving average over a path; the window shrinks at the edges. */
export function smoothPath(path: MotionSample[], radius: number): MotionSample[] {
  const n = path.length
  if (radius <= 0 || n === 0) return path.map((p) => ({ ...p }))
  const out: MotionSample[] = []
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n - 1, i + radius)
    let dx = 0
    let dy = 0
    let rot = 0
    for (let j = lo; j <= hi; j++) {
      dx += path[j].dx
      dy += path[j].dy
      rot += path[j].rot
    }
    const w = hi - lo + 1
    out.push({ dx: dx / w, dy: dy / w, rot: rot / w })
  }
  return out
}

/**
 * Integrate frame-to-frame motions into a cumulative camera path, smooth it,
 * and derive per-frame corrections plus the required crop-in zoom.
 */
export function buildStabilizationData(
  times: number[],
  motions: MotionSample[],
  level: number
): StabilizationData {
  const raw: MotionSample[] = []
  let dx = 0
  let dy = 0
  let rot = 0
  for (const m of motions) {
    dx += m.dx
    dy += m.dy
    rot += m.rot
    raw.push({ dx, dy, rot })
  }
  // Levels 1..4 → smoothing radius 4..16 samples (0.2s..0.8s at 20 Hz).
  const radius = Math.round(2 + 4.67 * Math.min(4, Math.max(1, level)))
  const smoothed = smoothPath(raw, radius)
  const corrections = raw.map((p, i) => ({
    dx: smoothed[i].dx - p.dx,
    dy: smoothed[i].dy - p.dy,
    rot: smoothed[i].rot - p.rot
  }))
  let worst = 0
  for (const c of corrections) {
    worst = Math.max(worst, Math.abs(c.dx), Math.abs(c.dy), Math.abs(c.rot) * 0.35)
  }
  const zoom = Math.min(1.4, 1 + worst * 2.1 + 0.01)
  return { level, times, raw, corrections, zoom, analyzedAt: Date.now() }
}

/** Linear correction interpolation at a source time; clamped at the ends. */
export function sampleCorrection(data: StabilizationData, sourceTime: number): MotionSample {
  const times = data.times
  if (times.length === 0) return { dx: 0, dy: 0, rot: 0 }
  if (sourceTime <= times[0]) return data.corrections[0]
  const last = times.length - 1
  if (sourceTime >= times[last]) return data.corrections[last]
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= sourceTime) lo = mid
    else hi = mid
  }
  const span = times[hi] - times[lo]
  const t = span > 0 ? (sourceTime - times[lo]) / span : 0
  const a = data.corrections[lo]
  const b = data.corrections[hi]
  return {
    dx: a.dx + (b.dx - a.dx) * t,
    dy: a.dy + (b.dy - a.dy) * t,
    rot: a.rot + (b.rot - a.rot) * t
  }
}

// ---------------------------------------------------------------------------
// Motion estimation
// ---------------------------------------------------------------------------

interface BlockMatch {
  x: number
  y: number
  dx: number
  dy: number
  score: number
}

/** SAD block matching between two grayscale frames (search ±radius, step 1). */
export function estimateFrameMotion(
  prev: Float32Array,
  next: Float32Array,
  width: number,
  height: number
): MotionSample {
  const bw = Math.floor(width / BLOCK_COLS)
  const bh = Math.floor(height / BLOCK_ROWS)
  const matches: BlockMatch[] = []
  for (let by = 0; by < BLOCK_ROWS; by++) {
    for (let bx = 0; bx < BLOCK_COLS; bx++) {
      const ox = bx * bw + ((width - bw * BLOCK_COLS) >> 1)
      const oy = by * bh + ((height - bh * BLOCK_ROWS) >> 1)
      let bestScore = Infinity
      let bestDx = 0
      let bestDy = 0
      // Seed with the zero offset so flat regions (where every shift scores
      // equally) report no motion instead of the corner of the search window.
      {
        let sad = 0
        let count = 0
        for (let y = 1; y < bh; y += 2) {
          for (let x = 1; x < bw; x += 2) {
            sad += Math.abs(prev[(oy + y) * width + ox + x] - next[(oy + y) * width + ox + x])
            count++
          }
        }
        if (count > 0) bestScore = sad / count
      }
      for (let cy = -SEARCH_RADIUS; cy <= SEARCH_RADIUS; cy++) {
        for (let cx = -SEARCH_RADIUS; cx <= SEARCH_RADIUS; cx++) {
          let sad = 0
          let count = 0
          for (let y = 1; y < bh; y += 2) {
            const ny = oy + y + cy
            if (ny < 0 || ny >= height) continue
            for (let x = 1; x < bw; x += 2) {
              const nx = ox + x + cx
              if (nx < 0 || nx >= width) continue
              sad += Math.abs(prev[ny * width + nx] - next[(oy + y) * width + ox + x])
              count++
            }
          }
          if (count === 0) continue
          const score = sad / count
          if (score < bestScore) {
            bestScore = score
            bestDx = cx
            bestDy = cy
          }
        }
      }
      if (bestScore < 28) matches.push({ x: ox + bw / 2, y: oy + bh / 2, dx: bestDx, dy: bestDy, score: bestScore })
    }
  }
  if (matches.length < Math.ceil(BLOCK_COLS * BLOCK_ROWS * 0.34)) return { dx: 0, dy: 0, rot: 0 }
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const tx = median(matches.map((m) => m.dx))
  const ty = median(matches.map((m) => m.dy))
  // Small-angle rotation fit on the translation residuals:
  // vx ≈ −(y−cy)·θ, vy ≈ (x−cx)·θ → least-squares θ over blocks.
  const cx = width / 2
  const cy = height / 2
  let num = 0
  let den = 0
  for (const m of matches) {
    const rx = m.x - cx
    const ry = m.y - cy
    const vx = m.dx - tx
    const vy = m.dy - ty
    num += rx * vy - ry * vx
    den += rx * rx + ry * ry
  }
  const rotRad = den > 1e-6 ? Math.max(-0.035, Math.min(0.035, num / den)) : 0
  return {
    dx: tx / width,
    dy: ty / height,
    rot: (rotRad * 180) / Math.PI
  }
}

// ---------------------------------------------------------------------------
// Cache + async analysis
// ---------------------------------------------------------------------------

const cache = new Map<string, StabilizationData>()
const inFlight = new Map<string, Promise<StabilizationData | null>>()

export function stabilizationKey(assetId: string, inPoint: number, span: number, level: number): string {
  return `${assetId}|${inPoint.toFixed(3)}|${span.toFixed(3)}|${level}`
}

/** Cached result for a clip's exact source range + level, if analyzed. */
export function getStabilizationData(clip: Clip, asset: MediaAsset | undefined): StabilizationData | null {
  if (!asset || asset.kind !== 'video' || !clip.stabilization?.enabled) return null
  const span = Math.min(clipSourceSpan(clip), asset.duration)
  if (span <= 0.2) return null
  return cache.get(stabilizationKey(asset.id, clip.inPoint, span, clip.stabilization.level)) ?? null
}

/**
 * Kick off analysis without awaiting (preview path): a no-op when a result or
 * an in-flight run already exists.
 */
export function kickStabilization(clip: Clip, asset: MediaAsset | undefined): void {
  if (!asset || asset.kind !== 'video' || !clip.stabilization?.enabled) return
  const span = Math.min(clipSourceSpan(clip), asset.duration)
  if (span <= 0.2) return
  const key = stabilizationKey(asset.id, clip.inPoint, span, clip.stabilization.level)
  if (cache.has(key) || inFlight.has(key)) return
  void analyzeStabilization(clip, asset).catch(() => {})
}

/**
 * Analyze the clip's source range (awaited at export time). Consecutive calls
 * for the same range + level share one run.
 */
export async function ensureStabilization(
  clip: Clip,
  asset: MediaAsset | undefined,
  onProgress?: (p: number) => void
): Promise<StabilizationData | null> {
  if (!asset || asset.kind !== 'video' || !clip.stabilization?.enabled) return null
  const span = Math.min(clipSourceSpan(clip), asset.duration)
  if (span <= 0.2) return null
  const level = clip.stabilization.level
  const key = stabilizationKey(asset.id, clip.inPoint, span, level)
  const cached = cache.get(key)
  if (cached) return cached
  const running = inFlight.get(key)
  if (running) return running
  const run = analyzeStabilization(clip, asset, onProgress)
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}

async function analyzeStabilization(
  clip: Clip,
  asset: MediaAsset,
  onProgress?: (p: number) => void
): Promise<StabilizationData | null> {
  const span = Math.min(clipSourceSpan(clip), asset.duration)
  const level = clip.stabilization?.level ?? 2
  const input = new Input({ formats: ALL_FORMATS, source: createIpcFileSource(asset.path) })
  const track = await input.getPrimaryVideoTrack()
  if (!track) return null
  const sink = new VideoSampleSink(track)

  const height = Math.max(32, Math.round((ANALYSIS_WIDTH * asset.height) / Math.max(1, asset.width)))
  const gray: Float32Array[] = []
  const times: number[] = []
  const canvas = document.createElement('canvas')
  canvas.width = ANALYSIS_WIDTH
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const sampleCount = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(span * ANALYSIS_FPS)))
  const step = span / sampleCount

  const grab = async (t: number): Promise<void> => {
    let sample: VideoSample | null = null
    try {
      sample = await sink.getSample(t)
      if (!sample) return
      ctx.drawImage(sample.toCanvasImageSource(), 0, 0, ANALYSIS_WIDTH, height)
      const img = ctx.getImageData(0, 0, ANALYSIS_WIDTH, height)
      const data = img.data
      const buf = new Float32Array(ANALYSIS_WIDTH * height)
      for (let i = 0, p = 0; p < buf.length; i += 4, p++) {
        buf[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
      }
      gray.push(buf)
      times.push(t)
    } catch {
      // undecodable frame — skip it
    } finally {
      sample?.close()
    }
  }

  for (let i = 0; i < sampleCount; i++) {
    await grab(clip.inPoint + i * step)
    if (i % 12 === 11) {
      onProgress?.(i / sampleCount)
      // Yield so the preview stays interactive during long analyses.
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  onProgress?.(1)
  if (gray.length < 4) return null

  const motions: MotionSample[] = [{ dx: 0, dy: 0, rot: 0 }]
  for (let i = 1; i < gray.length; i++) {
    motions.push(estimateFrameMotion(gray[i - 1], gray[i], ANALYSIS_WIDTH, height))
  }
  const data = buildStabilizationData(times, motions, level)
  const key = stabilizationKey(asset.id, clip.inPoint, span, level)
  cache.set(key, data)
  return data
}

/** Drop cached analyses for a removed asset (media library housekeeping). */
export function dropStabilizationForAsset(assetId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${assetId}|`)) cache.delete(key)
  }
}
