// Shared data model for the whole app. Keep this file dependency-free so the
// Electron main process, preload and renderer can all import it.

export type AssetKind = 'video' | 'audio' | 'image'

export interface MediaAsset {
  id: string
  kind: AssetKind
  /** Absolute filesystem path of the source file. */
  path: string
  fileName: string
  /** Seconds; images use 0. */
  duration: number
  /** Video/image pixel size. */
  width: number
  height: number
  /** data:image/png;base64 thumbnail. */
  thumbnail?: string
  /** Normalized peak values (0..1) for audio waveforms. */
  waveform?: number[]
  /** Original sample rate / channels for audio, informational. */
  sampleRate?: number
  channels?: number
  /** Millisecond epoch when imported. */
  importedAt: number
}

export interface Transform {
  /** 1 = fit-to-frame base scale. */
  scale: number
  /** Offset from frame center, in fraction of frame size (-1..1). */
  x: number
  y: number
  /** Degrees, clockwise. */
  rotation: number
  /** 0..1 */
  opacity: number
  flipX: boolean
  flipY: boolean
  /** Crop insets as fraction of the source frame (0..0.9 each side). */
  crop: { left: number; right: number; top: number; bottom: number }
}

export interface ColorFilters {
  brightness: number // 1 = neutral
  contrast: number // 1 = neutral
  saturation: number // 1 = neutral
  /** -1 (cool) .. 1 (warm), approximated with a hue-rotate/sepia mix. */
  temperature: number
  /** -1..1, shifts all hues (hue-rotate approximation). */
  hue: number
  /** 0..2, approximated with a contrast curve on the low end. */
  exposure: number
  /** -1..1, lift/gain on bright regions. */
  highlights: number
  /** -1..1, lift/gain on dark regions. */
  shadows: number
  presetId: string | null
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export type MaskShape = 'none' | 'circle' | 'rectangle' | 'triangle' | 'star' | 'heart' | 'linear'

export interface Mask {
  shape: MaskShape
  /** Mask center, fraction of frame size (0..1). */
  cx: number
  cy: number
  /** Radii as a fraction of frame width (rx) / height (ry). */
  rx: number
  ry: number
  /** Degrees, clockwise. */
  rotation: number
  /** 0..1 soft edge width (fraction of the radius). */
  feather: number
  /** Show the frame outside the mask instead of inside. */
  invert: boolean
}

export interface ChromaKey {
  enabled: boolean
  /** Hex color keyed out (default CapCut-style green). */
  color: string
  /** 0..1 distance threshold where pixels become fully transparent. */
  similarity: number
  /** 0..1 extra ramp above the threshold fading to opaque. */
  smoothness: number
  /** 0..1 suppression of key-color spill on remaining pixels. */
  spill: number
}

export type AudioEffectKind =
  | 'none'
  | 'echo'
  | 'reverb'
  | 'robot'
  | 'phone'
  | 'bass-boost'
  | 'high-pitch'
  | 'low-pitch'
  | 'noise-reduction'

/** One point of a speed-ramp curve: timeline progress t (0..1) → speed multiplier v. */
export interface SpeedCurvePoint {
  t: number
  v: number
}

export interface SpeedCurve {
  enabled: boolean
  /** Sorted by t; first/last points pin the curve to the clip edges. */
  points: SpeedCurvePoint[]
}

export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold'

export interface Keyframe {
  id: string
  /** Seconds relative to clip start (0..clip.duration). */
  time: number
  scale?: number
  x?: number
  y?: number
  rotation?: number
  opacity?: number
  volume?: number
  easing?: KeyframeEasing
}

export interface Marker {
  id: string
  /** Timeline position, seconds. */
  time: number
  label: string
  color: string
}

export interface StickerData {
  /** Emoji sequence rendered with the system emoji font. */
  emoji: string
  /** Height as a fraction of frame height (0.05..1). */
  size: number
  /** Anchor position, fraction of frame size (0..1). */
  x: number
  y: number
  rotation: number
  opacity: number
  flipX: boolean
}

export type TextAnimationKind =
  | 'none'
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'typewriter'
  | 'zoom'
  | 'pop'
  | 'bounce'

export interface TextAnimation {
  in: TextAnimationKind
  out: TextAnimationKind
  /** Seconds for each in/out animation. */
  duration: number
}

export type TransitionType =
  | 'crossfade'
  | 'fade-black'
  | 'fade-white'
  | 'slide-left'
  | 'slide-up'
  | 'slide-right'
  | 'slide-down'
  | 'wipe-right'
  | 'wipe-left'
  | 'wipe-up'
  | 'wipe-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'whip-pan'
  | 'circle-open'
  | 'spin'
  | 'blur-cross'

export interface Transition {
  type: TransitionType
  duration: number
}

/**
 * Rendered clip effects (CapCut-style "Hiệu ứng"). Each spans a time range
 * inside its clip and is drawn by the frame renderer.
 */
export type EffectKind =
  | 'blur'
  | 'zoom'
  | 'shake'
  | 'glow'
  | 'flash'
  | 'mirror'
  | 'vignette'
  | 'grain'
  | 'pixelate'
  | 'glitch'
  | 'dreamy'
  | 'light-leak'
  | 'rgbsplit'

export interface ClipEffect {
  id: string
  kind: EffectKind
  /** Display name (Vietnamese, from the effect catalog). */
  name: string
  /** Seconds relative to clip start. */
  start: number
  duration: number
  /** 0..1, maps to the catalog preset's strength. */
  intensity: number
}

export interface TextStyle {
  content: string
  fontFamily: string
  fontSize: number // fraction of frame height (0.02..0.3)
  color: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  strokeColor: string
  strokeWidth: number // fraction of font size
  backgroundColor: string | null
  /** Position of the text anchor, fraction of frame size. */
  x: number
  y: number
  lineHeight: number
  maxWidth: number // fraction of frame width, for wrapping
  scale: number
  rotation: number
  opacity: number
  /** Entrance/exit animation applied around the clip edges. */
  animation: TextAnimation
}

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'sticker'

export interface Clip {
  id: string
  kind: ClipKind
  /** Timeline start, seconds. */
  start: number
  /** Timeline duration, seconds (already accounts for speed). */
  duration: number
  /** Source offset at clip.start, seconds. */
  inPoint: number
  assetId?: string
  speed: number
  /** Optional speed-ramp curve overriding the constant speed. */
  speedCurve?: SpeedCurve
  volume: number // 0..2
  fadeIn: number // seconds
  fadeOut: number
  transform: Transform
  filters: ColorFilters
  transitionIn: Transition | null
  keyframes: Keyframe[]
  /** Canvas blend mode used when compositing this clip. */
  blendMode?: BlendMode
  /** Shape mask cutting the clip's pixels. */
  mask?: Mask
  /** Green-screen style keying. */
  chromaKey?: ChromaKey
  /** Audio processing applied in preview (partial) and export (full). */
  audioEffect?: AudioEffectKind
  /** CapCut-style visual effects applied over time ranges of this clip. */
  effects?: ClipEffect[]
  text?: TextStyle
  sticker?: StickerData
}

export interface Track {
  id: string
  kind: 'video' | 'audio' | 'text'
  name: string
  clips: Clip[]
  volume: number // 0..2, audio tracks & video audio
  muted: boolean
  hidden: boolean
  locked: boolean
}

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '21:9'

export interface ProjectSettings {
  name: string
  aspectRatio: AspectRatio
  width: number
  height: number
  fps: 24 | 25 | 30 | 50 | 60
  backgroundColor: string
}

export interface TemplateRef {
  /** Original capcut.com link the user pasted ('' when imported from a draft). */
  sourceUrl: string
  templateId: string
  title: string
  authorName?: string
  /** Local path of the downloaded cover/preview, when available. */
  coverPath?: string
  previewAssetId?: string
  /**
   * 'link' = skeleton built from public template metadata (preview video as a
   * reference track). 'draft' = full structure imported from a CapCut draft.
   */
  stage: 'link' | 'draft'
}

export interface ProjectDocument {
  version: 1
  id: string
  createdAt: number
  modifiedAt: number
  settings: ProjectSettings
  mediaLibrary: MediaAsset[]
  /**
   * Display order, top row first. Compositing draws video/text tracks from the
   * end of the array to the start (bottom row = back layer).
   */
  tracks: Track[]
  /** Timeline markers (CapCut-style "Đánh dấu"). */
  markers: Marker[]
  /** Set when the project was set up from a CapCut template. */
  templateRef?: TemplateRef
}

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '21:9': { width: 2560, height: 1080 }
}

export const NEUTRAL_FILTERS: ColorFilters = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  hue: 0,
  exposure: 1,
  highlights: 0,
  shadows: 0,
  presetId: null
}

export const DEFAULT_MASK: Mask = {
  shape: 'none',
  cx: 0.5,
  cy: 0.5,
  rx: 0.35,
  ry: 0.35,
  rotation: 0,
  feather: 0.1,
  invert: false
}

export const DEFAULT_CHROMA_KEY: ChromaKey = {
  enabled: false,
  color: '#00b140',
  similarity: 0.28,
  smoothness: 0.12,
  spill: 0.2
}

/** Default speed-ramp presets, CapCut-style (timeline t → speed multiplier). */
export const SPEED_CURVE_PRESETS: Record<string, { name: string; points: SpeedCurvePoint[] }> = {
  hero: { name: 'Anh hùng', points: [{ t: 0, v: 0.5 }, { t: 0.4, v: 0.5 }, { t: 0.6, v: 2 }, { t: 1, v: 2 }] },
  bullet: { name: 'Viên đạn', points: [{ t: 0, v: 3 }, { t: 0.15, v: 3 }, { t: 0.3, v: 0.4 }, { t: 0.7, v: 0.4 }, { t: 0.85, v: 3 }, { t: 1, v: 3 }] },
  flyIn: { name: 'Bay vào', points: [{ t: 0, v: 4 }, { t: 0.5, v: 1 }, { t: 1, v: 1 }] },
  flyOut: { name: 'Bay ra', points: [{ t: 0, v: 1 }, { t: 0.5, v: 1 }, { t: 1, v: 4 }] },
  flashIn: { name: 'Chớp vào', points: [{ t: 0, v: 0.3 }, { t: 0.2, v: 0.3 }, { t: 0.35, v: 2.5 }, { t: 1, v: 1 }] },
  montage: { name: 'Phối cảnh', points: [{ t: 0, v: 2 }, { t: 0.5, v: 0.5 }, { t: 1, v: 2 }] }
}

export function createTransform(): Transform {
  return {
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    crop: { left: 0, right: 0, top: 0, bottom: 0 }
  }
}

export function createMask(partial: Partial<Mask> = {}): Mask {
  return { ...DEFAULT_MASK, ...partial }
}

export function createChromaKey(partial: Partial<ChromaKey> = {}): ChromaKey {
  return { ...DEFAULT_CHROMA_KEY, ...partial }
}

export function createTextAnimation(): TextAnimation {
  return { in: 'none', out: 'none', duration: 0.5 }
}

export function createText(): TextStyle {
  return {
    content: 'Nhập chữ của bạn',
    fontFamily: 'Segoe UI, Arial, sans-serif',
    fontSize: 0.08,
    color: '#ffffff',
    bold: true,
    italic: false,
    align: 'center',
    strokeColor: '#000000',
    strokeWidth: 0,
    backgroundColor: null,
    x: 0.5,
    y: 0.5,
    lineHeight: 1.25,
    maxWidth: 0.85,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: createTextAnimation()
  }
}

export function createSticker(emoji = '✨'): StickerData {
  return {
    emoji,
    size: 0.3,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    opacity: 1,
    flipX: false
  }
}

export function createClip(partial: Partial<Clip> & Pick<Clip, 'kind' | 'start' | 'duration'>): Clip {
  return {
    id: crypto.randomUUID(),
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: createTransform(),
    filters: { ...NEUTRAL_FILTERS },
    transitionIn: null,
    keyframes: [],
    effects: [],
    ...partial
  }
}

export function createTrack(kind: Track['kind'], name: string): Track {
  return {
    id: crypto.randomUUID(),
    kind,
    name,
    clips: [],
    volume: 1,
    muted: false,
    hidden: false,
    locked: false
  }
}

export function createProjectDocument(name = 'Dự án mới'): ProjectDocument {
  const dims = ASPECT_DIMENSIONS['16:9']
  return {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      name,
      aspectRatio: '16:9',
      width: dims.width,
      height: dims.height,
      fps: 30,
      backgroundColor: '#000000'
    },
    mediaLibrary: [],
    markers: [],
    tracks: [
      createTrack('text', 'Chữ'),
      createTrack('video', 'Video 2'),
      createTrack('video', 'Video 1'),
      createTrack('audio', 'Âm thanh 1')
    ]
  }
}

export function totalDuration(doc: ProjectDocument): number {
  let end = 0
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration)
    }
  }
  return end
}

/** Speed multiplier at a given timeline time (speed-ramp aware). */
export function speedMultiplierAt(clip: Clip, timelineTime: number): number {
  const curve = clip.speedCurve
  if (!curve || !curve.enabled || curve.points.length < 2) return clip.speed
  const local = timelineTime - clip.start
  const p = clip.duration > 0 ? Math.min(1, Math.max(0, local / clip.duration)) : 0
  const pts = curve.points
  if (p <= pts[0].t) return pts[0].v
  if (p >= pts[pts.length - 1].t) return pts[pts.length - 1].v
  for (let i = 0; i < pts.length - 1; i++) {
    if (p >= pts[i].t && p <= pts[i + 1].t) {
      const span = pts[i + 1].t - pts[i].t
      const f = span <= 0 ? 0 : (p - pts[i].t) / span
      return pts[i].v + (pts[i + 1].v - pts[i].v) * f
    }
  }
  return clip.speed
}

/**
 * Map a timeline position inside the clip to a source media position.
 * With a speed curve, integrates the varying multiplier over the elapsed
 * timeline time (piecewise-linear speed → piecewise-quadratic integral).
 */
export function clipSourceTime(clip: Clip, timelineTime: number): number {
  const curve = clip.speedCurve
  if (!curve || !curve.enabled || curve.points.length < 2) {
    return clip.inPoint + (timelineTime - clip.start) * clip.speed
  }
  const local = timelineTime - clip.start
  const duration = Math.max(1e-6, clip.duration)
  const pts = curve.points
  let elapsed = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const segStart = pts[i].t * duration
    const segEnd = pts[i + 1].t * duration
    if (local <= segStart) break
    const v0 = pts[i].v
    const v1 = pts[i + 1].v
    const end = Math.min(local, segEnd)
    const w = end - segStart
    if (w <= 0) continue
    // Integral of linearly interpolated speed over [segStart, end].
    const fullSpan = segEnd - segStart
    const frac = fullSpan <= 0 ? 0 : w / fullSpan
    elapsed += w * v0 + 0.5 * frac * w * (v1 - v0)
    if (local <= segEnd) break
  }
  return clip.inPoint + elapsed
}

/** How much source material this clip consumes, in source seconds. */
export function clipSourceSpan(clip: Clip): number {
  return clipSourceTime(clip, clip.start + clip.duration) - clip.inPoint
}

/**
 * Inverse of clipSourceTime: given a source position, return the timeline
 * time at which the playback reaches it (needed to schedule audio accurately
 * under speed curves).
 */
export function clipTimelineTimeForSource(clip: Clip, sourceTime: number): number {
  const uniform = () => clip.start + (sourceTime - clip.inPoint) / Math.max(1e-6, clip.speed)
  const curve = clip.speedCurve
  if (!curve || !curve.enabled || curve.points.length < 2) return uniform()
  const target = sourceTime - clip.inPoint
  let lo = 0
  let hi = clip.duration
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const reached = clipSourceTime(clip, clip.start + mid) - clip.inPoint
    if (reached < target) lo = mid
    else hi = mid
  }
  return clip.start + (lo + hi) / 2
}

/** Fade multiplier at a given time within the clip. */
export function clipFadeMultiplier(clip: Clip, timelineTime: number): number {
  const local = timelineTime - clip.start
  let m = 1
  if (clip.fadeIn > 0 && local < clip.fadeIn) m *= Math.max(0, local / clip.fadeIn)
  if (clip.fadeOut > 0 && local > clip.duration - clip.fadeOut) {
    m *= Math.max(0, (clip.duration - local) / clip.fadeOut)
  }
  return m
}

export function applyEasing(t: number, easing: KeyframeEasing | undefined): number {
  const x = Math.min(1, Math.max(0, t))
  switch (easing) {
    case 'linear':
      return x
    case 'ease-in':
      return x * x
    case 'ease-out':
      return 1 - (1 - x) * (1 - x)
    case 'hold':
      return 0
    case 'ease-in-out':
    default:
      return x * x * (3 - 2 * x) // smoothstep
  }
}

const KEYFRAME_PROPS = ['scale', 'x', 'y', 'rotation', 'opacity', 'volume'] as const

export type KeyframeProps = { [K in (typeof KEYFRAME_PROPS)[number]]: number }

/** Linear/eased interpolation over keyframes; falls back to static clip values. */
export function sampleKeyframes(clip: Clip, timelineTime: number): KeyframeProps {
  const local = timelineTime - clip.start
  const out: Record<string, number> = {
    scale: clip.transform.scale,
    x: clip.transform.x,
    y: clip.transform.y,
    rotation: clip.transform.rotation,
    opacity: clip.transform.opacity,
    volume: clip.volume
  }
  if (clip.keyframes.length === 0) return out as KeyframeProps
  for (const prop of KEYFRAME_PROPS) {
    const kfs = clip.keyframes.filter((k) => k[prop] !== undefined).sort((a, b) => a.time - b.time)
    if (kfs.length === 0) continue
    if (local <= kfs[0].time) {
      out[prop] = kfs[0][prop]!
      continue
    }
    const last = kfs[kfs.length - 1]
    if (local >= last.time) {
      out[prop] = last[prop]!
      continue
    }
    for (let i = 0; i < kfs.length - 1; i++) {
      if (local >= kfs[i].time && local <= kfs[i + 1].time) {
        const span = kfs[i + 1].time - kfs[i].time
        const t = span <= 0 ? 0 : (local - kfs[i].time) / span
        const eased = applyEasing(t, kfs[i].easing)
        out[prop] = kfs[i][prop]! + (kfs[i + 1][prop]! - kfs[i][prop]!) * eased
        break
      }
    }
  }
  return out as KeyframeProps
}

export function cssFilterString(f: ColorFilters): string {
  const parts: string[] = []
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`)
  if (f.exposure !== 1) parts.push(`brightness(${f.exposure})`)
  if (f.temperature > 0) parts.push(`sepia(${Math.min(1, f.temperature) * 0.4})`)
  if (f.temperature < 0) parts.push(`hue-rotate(${f.temperature * 25}deg)`)
  if (f.hue !== 0) parts.push(`hue-rotate(${f.hue * 90}deg)`)
  if (f.highlights > 0) parts.push(`brightness(${1 + f.highlights * 0.12})`)
  if (f.shadows < 0) parts.push(`brightness(${1 + f.shadows * 0.25}) contrast(${1 - f.shadows * 0.15})`)
  if (f.shadows > 0) parts.push(`contrast(${1 - f.shadows * 0.12})`)
  return parts.join(' ') || 'none'
}

/**
 * Fill defaults for documents saved by older versions so every stored clip
 * and project has the current shape (forward compatibility for open/autosave).
 */
export function normalizeDocument(input: ProjectDocument): ProjectDocument {
  const doc: ProjectDocument = {
    ...input,
    markers: Array.isArray(input.markers) ? input.markers : [],
    settings: { ...input.settings },
    mediaLibrary: input.mediaLibrary ?? [],
    tracks: (input.tracks ?? []).map((track) => ({
      ...track,
      clips: (track.clips ?? []).map((clip) => ({
        ...clip,
        transform: { ...createTransform(), ...clip.transform },
        filters: { ...NEUTRAL_FILTERS, ...clip.filters },
        keyframes: clip.keyframes ?? [],
        effects: clip.effects ?? [],
        blendMode: clip.blendMode ?? 'normal',
        mask: clip.mask ?? { ...DEFAULT_MASK },
        chromaKey: clip.chromaKey ?? { ...DEFAULT_CHROMA_KEY },
        audioEffect: clip.audioEffect ?? 'none'
      }))
    }))
  }
  return doc
}
