import type { Clip, Compound, Track } from './document'
import { clipSourceSpan } from './document'

/** Seconds a pixel maps to, given timeline zoom. */
export function pxToSeconds(px: number, pxPerSecond: number): number {
  return px / pxPerSecond
}

export function secondsToPx(seconds: number, pxPerSecond: number): number {
  return seconds * pxPerSecond
}

/** Find the closest snapping target within `thresholdSeconds`, or null. */
export function snapTime(
  time: number,
  candidates: number[],
  thresholdSeconds: number
): { time: number; target: number } | null {
  let best: number | null = null
  let bestDist = thresholdSeconds
  for (const c of candidates) {
    const d = Math.abs(c - time)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best === null ? null : { time: best, target: best }
}

/** Collect snap candidates from all clips (edges), the playhead and 0. */
export function collectSnapCandidates(tracks: Track[], playhead: number, excludeClipId?: string): number[] {
  const set = new Set<number>([0, playhead])
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue
      set.add(clip.start)
      set.add(clip.start + clip.duration)
    }
  }
  return [...set]
}

/** True if [start, start+duration) intersects any other clip on the track. */
export function overlapsTrack(track: Track, clipId: string, start: number, duration: number): boolean {
  const end = start + duration
  for (const other of track.clips) {
    if (other.id === clipId) continue
    const oEnd = other.start + other.duration
    if (start < oEnd && end > other.start) return true
  }
  return false
}

export interface TrimBounds {
  minStart: number // earliest allowed clip.start
  maxStart: number // latest allowed clip.start when dragging left edge
  maxEnd: number // latest allowed end when dragging right edge
}

/**
 * Bounds for trimming a clip on its track: cannot pass neighbors, cannot go
 * negative, and (for source-backed clips) cannot consume more media than
 * exists.
 */
export function trimBounds(track: Track, clip: Clip, sourceDuration: number): TrimBounds {
  let minStart = 0
  let maxEnd = Number.POSITIVE_INFINITY
  for (const other of track.clips) {
    if (other.id === clip.id) continue
    const oEnd = other.start + other.duration
    if (oEnd <= clip.start + 1e-6) minStart = Math.max(minStart, oEnd)
    if (other.start >= clip.start + clip.duration - 1e-6) maxEnd = Math.min(maxEnd, other.start)
  }
  // Left edge can extend back into unused source (inPoint >= 0):
  // available source before inPoint is inPoint / speed.
  const backSource = clip.inPoint / clip.speed
  minStart = Math.max(minStart, clip.start - backSource)
  // Right edge: remaining source after inPoint.
  if (sourceDuration > 0) {
    const remaining = (sourceDuration - clip.inPoint) / clip.speed
    maxEnd = Math.min(maxEnd, clip.start + clip.duration + remaining)
  }
  return {
    minStart,
    maxStart: Math.min(maxEnd, clip.start + clip.duration) - Math.min(0.05, clip.duration),
    maxEnd
  }
}

export interface SplitResult {
  left: Clip
  right: Clip
}

/**
 * Split a compound's inner tracks around `local` (seconds into the compound).
 * Clips crossing the cut are trimmed on both sides; everything else keeps its
 * place (right-side clips shift by -local). Returns null when either side
 * would be empty (no meaningful cut).
 */
function splitCompound(compound: Compound, local: number): { left: Compound; right: Compound } | null {
  const leftTracks: Track[] = []
  const rightTracks: Track[] = []
  let anyLeft = false
  let anyRight = false
  for (const track of compound.tracks) {
    const leftClips: Clip[] = []
    const rightClips: Clip[] = []
    for (const clip of track.clips) {
      const end = clip.start + clip.duration
      if (end <= local + 1e-6) {
        leftClips.push(clip)
        anyLeft = true
      } else if (clip.start >= local - 1e-6) {
        rightClips.push({ ...clip, start: clip.start - local })
        anyRight = true
      } else {
        // Crossing the cut: hand the outside part to each side.
        leftClips.push({ ...clip, duration: local - clip.start, fadeOut: 0 })
        rightClips.push({
          ...clip,
          id: crypto.randomUUID(),
          start: 0,
          duration: end - local,
          inPoint: clip.inPoint + (local - clip.start) * clip.speed,
          fadeIn: 0,
          transitionIn: null,
          keyframes: clip.keyframes
            .filter((k) => k.time > (local - clip.start))
            .map((k) => ({ ...k, id: crypto.randomUUID(), time: k.time - (local - clip.start) }))
        })
        anyLeft = true
        anyRight = true
      }
    }
    if (leftClips.length > 0) leftTracks.push({ ...track, clips: leftClips })
    if (rightClips.length > 0) rightTracks.push({ ...track, clips: rightClips })
  }
  if (!anyLeft || !anyRight || leftTracks.length === 0 || rightTracks.length === 0) return null
  return {
    left: { duration: local, tracks: leftTracks },
    right: { duration: Math.max(0.05, compound.duration - local), tracks: rightTracks }
  }
}

/** Split a clip at an absolute timeline time; returns null if outside. */
export function splitClip(clip: Clip, atTime: number): SplitResult | null {
  const local = atTime - clip.start
  if (local <= 0.05 || local >= clip.duration - 0.05) return null
  let leftCompound = clip.compound
  let rightCompound = clip.compound
  if (clip.compound) {
    const parts = splitCompound(clip.compound, local)
    if (!parts) return null
    leftCompound = parts.left
    rightCompound = parts.right
  }
  const left: Clip = {
    ...clip,
    duration: local,
    fadeOut: 0,
    keyframes: clip.keyframes.filter((k) => k.time <= local),
    compound: leftCompound,
    transform: { ...clip.transform, crop: { ...clip.transform.crop } },
    filters: { ...clip.filters }
  }
  const right: Clip = {
    ...clip,
    id: crypto.randomUUID(),
    start: clip.start + local,
    duration: clip.duration - local,
    inPoint: clip.inPoint + local * clip.speed,
    fadeIn: 0,
    transitionIn: null,
    keyframes: clip.keyframes
      .filter((k) => k.time > local)
      .map((k) => ({ ...k, id: crypto.randomUUID(), time: k.time - local })),
    compound: rightCompound,
    transform: { ...clip.transform, crop: { ...clip.transform.crop } },
    filters: { ...clip.filters }
  }
  return { left, right }
}

/**
 * Resolve a desired drop position so the clip fits on the track without
 * overlapping others. Returns the adjusted start, or null when there is no
 * room at all.
 */
export function resolveDropStart(track: Track, clipId: string, desiredStart: number, duration: number): number | null {
  if (!overlapsTrack(track, clipId, desiredStart, duration)) {
    return Math.max(0, desiredStart)
  }
  // Gather free windows on the track and find the closest valid start.
  const gaps: Array<{ from: number; to: number }> = []
  const sorted = [...track.clips].filter((c) => c.id !== clipId).sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const c of sorted) {
    if (c.start - cursor >= duration - 1e-6) gaps.push({ from: cursor, to: c.start - duration })
    cursor = Math.max(cursor, c.start + c.duration)
  }
  gaps.push({ from: cursor, to: Number.POSITIVE_INFINITY })
  let best: number | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const g of gaps) {
    const start = Math.min(Math.max(desiredStart, g.from), g.to)
    if (start < g.from - 1e-6 || start > g.to + 1e-6) continue
    const d = Math.abs(start - desiredStart)
    // Prefer the later position on ties: dropping onto an occupied block
    // naturally pushes the clip past it.
    if (d <= bestDist) {
      bestDist = d
      best = Math.max(0, start)
    }
  }
  return best
}

/**
 * Whether a transition can be applied: it needs the previous clip on the same
 * track to end at (or before) this clip's start, and total overlap must fit
 * inside both clips.
 */
export function transitionFits(prev: Clip, next: Clip, duration: number): boolean {
  const gap = next.start - (prev.start + prev.duration)
  if (gap > 0.001) return false
  return duration <= prev.duration - 0.05 && duration <= next.duration - 0.05
}

/** Total source span needed when queueing decodes for export. */
export function exportTimelineDuration(clips: Clip[]): number {
  return clips.reduce((acc, c) => Math.max(acc, c.start + clipSourceSpan(c)), 0)
}
