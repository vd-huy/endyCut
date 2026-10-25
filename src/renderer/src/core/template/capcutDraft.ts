// Converts a CapCut desktop draft (draft_content.json — the JianYing draft
// format) into CutClone's ProjectDocument. Pure functions only: no Electron,
// no DOM, so it is unit-testable in Node.
//
// All CapCut draft times are microseconds; CutClone works in seconds.
// Transform conventions match one-to-one: scale 1 = contain-fit to frame,
// x/y offsets are frame-size fractions centered on 0, rotation in degrees,
// alpha 0..1.
import type {
  AspectRatio,
  Clip,
  ClipEffect,
  ColorFilters,
  EffectKind,
  Keyframe,
  MediaAsset,
  ProjectDocument,
  TextStyle,
  Track,
  TransitionType
} from '@shared/document'
import { createClip, createText, createTrack, NEUTRAL_FILTERS } from '@shared/document'

const US = 1_000_000

export interface CapcutSegment {
  id?: string
  material_id?: string
  target_timerange?: { start?: number; duration?: number } | null
  source_timerange?: { start?: number; duration?: number } | null
  extra_material_refs?: string[]
  render_index?: number
  volume?: number
  clip?: {
    alpha?: number
    scale?: number
    rotation?: number
    flip?: { horizontal?: boolean; vertical?: boolean }
    transform?: { x?: number; y?: number }
  } | null
  common_keyframes?: CapcutKeyframeTrack[]
}

export interface CapcutKeyframeTrack {
  property_type?: string
  keyframe_list?: Array<{ time_offset?: number; values?: number[] }>
}

export interface CapcutTrack {
  id?: string
  type?: string
  name?: string
  segments?: CapcutSegment[]
}

export interface CapcutVideoMaterial {
  id?: string
  type?: string // 'video' | 'photo'
  path?: string
  url?: string
  duration?: number // microseconds
  width?: number
  height?: number
  has_audio?: boolean
  material_name?: string
}

export interface CapcutAudioMaterial {
  id?: string
  path?: string
  url?: string
  duration?: number
  name?: string
}

export interface CapcutTextMaterial {
  id?: string
  type?: string
  content?: string // JSON-encoded string
}

export interface CapcutMaterials {
  videos?: CapcutVideoMaterial[]
  audios?: CapcutAudioMaterial[]
  texts?: CapcutTextMaterial[]
  speeds?: Array<{ id?: string; speed?: number }>
  transitions?: Array<{ id?: string; name?: string; duration?: number }>
  video_effects?: Array<{ id?: string; name?: string }>
  audio_fades?: Array<{
    id?: string
    fade_in_duration?: number
    fade_out_duration?: number
  }>
  filters?: Array<{
    id?: string
    name?: string
    enable_adjust?: boolean
    adjust_params?: Array<{ name?: string; value?: number }>
  }>
  canvas_color?: string[]
}

export interface CapcutDraftContent {
  canvas_config?: { width?: number; height?: number; ratio?: string }
  duration?: number
  fps?: number
  name?: string
  tracks?: CapcutTrack[]
  materials?: CapcutMaterials
}

/** A remote material that must be downloaded before the document is usable. */
export interface PendingDownload {
  assetId: string
  url: string
  fileName: string
}

export interface CapcutDraftParseResult {
  doc: ProjectDocument
  warnings: string[]
  downloads: PendingDownload[]
  stats: { videoClips: number; audioClips: number; textClips: number; skipped: number }
}

const RATIO_TARGETS: Array<[AspectRatio, number]> = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['21:9', 21 / 9]
]

export function closestAspect(width: number, height: number): AspectRatio {
  if (!width || !height) return '16:9'
  const r = width / height
  let best: AspectRatio = '16:9'
  let bestDiff = Infinity
  for (const [name, value] of RATIO_TARGETS) {
    const d = Math.abs(Math.log(r / value))
    if (d < bestDiff) {
      bestDiff = d
      best = name
    }
  }
  return best
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function seconds(us?: number | null): number {
  return typeof us === 'number' && Number.isFinite(us) ? us / US : 0
}

function normalizeColorChannel(v: number): number {
  // Draft colors are usually 0..1 floats; tolerate 0..255 just in case.
  return v > 1 ? v / 255 : v
}

function colorToHex(rgb: unknown): string | null {
  if (!Array.isArray(rgb) || rgb.length < 3) return null
  const [r, g, b] = rgb.map((c) => clamp(Math.round(normalizeColorChannel(Number(c) || 0) * 255), 0, 255))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function extFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname
    const m = /\.(mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|gif|bmp)$/i.exec(pathname)
    return m ? `.${m[1].toLowerCase()}` : fallback
  } catch {
    return fallback
  }
}

function baseName(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/** Resolve a material path recorded in the draft to an absolute local path. */
function resolveMaterialPath(raw: string, draftFolder: string): string | null {
  if (!raw) return null
  const normalized = raw.replace(/\\/g, '/')
  if (/^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('/')) return normalized
  return `${draftFolder.replace(/\\/g, '/').replace(/\/$/, '')}/${normalized.replace(/^\.\//, '')}`
}

/** Map a CapCut transition name onto the closest transition CutClone supports. */
export function mapTransitionType(name: string): TransitionType | null {
  const n = name.toLowerCase()
  if (/blur|nhòe|模糊/.test(n)) return 'blur-cross'
  if (/black|đen|黑场/.test(n)) return 'fade-black'
  if (/white|trắng|白场/.test(n)) return 'fade-white'
  if (/zoom|phóng|scale|放大/.test(n)) return 'zoom-in'
  if (/spin|rotate|whip|xoay|旋转/.test(n)) return 'spin'
  // 'Swipe' transitions slide the frame; check before the 'wipe' substring.
  if (/slide|swipe|sweep|push|trượt|移动/.test(n)) {
    if (/up|lên|上/.test(n)) return 'slide-up'
    if (/down|xuống|下/.test(n)) return 'slide-down'
    if (/right|phải/.test(n)) return 'slide-right'
    return 'slide-left'
  }
  if (/wipe|quét|擦除/.test(n)) {
    if (/left|trái/.test(n)) return 'wipe-left'
    if (/up|lên|上/.test(n)) return 'wipe-up'
    if (/down|xuống|下/.test(n)) return 'wipe-down'
    return 'wipe-right'
  }
  if (/fade|dissolve|overlay|mờ|叠化|渐隐|渐显|黑/.test(n)) return 'crossfade'
  return null
}

/** Map a CapCut video-effect name onto a rendered CutClone effect kind. */
export function mapEffectKind(name: string): EffectKind | null {
  const n = name.toLowerCase()
  if (/flash|lóe|chớp|闪/.test(n)) return 'flash'
  if (/blur|mờ|nhòe|模糊|虚化/.test(n)) return 'blur'
  if (/shake|rung|抖动/.test(n)) return 'shake'
  if (/zoom|phóng|放大|推近/.test(n)) return 'zoom'
  if (/mirror|gương|đối xứng|镜像/.test(n)) return 'mirror'
  if (/pixel|mosaic|马赛克|像素/.test(n)) return 'pixelate'
  if (/glitch|lỗi|nhiễu|故障/.test(n)) return 'glitch'
  if (/dream|mơ|梦/.test(n)) return 'dreamy'
  if (/light.?leak|漏光|rò ánh/.test(n)) return 'light-leak'
  if (/vignette|暗角|viền tối/.test(n)) return 'vignette'
  if (/grain|noise|hạt|噪点|胶片/.test(n)) return 'grain'
  if (/glow|bloom|hào quang|phát sáng|发光/.test(n)) return 'glow'
  return null
}

interface ParsedTextStyle {
  text: string
  size: number
  bold: boolean
  italic: boolean
  color: string | null
}

/**
 * Text materials store their content as a JSON string:
 * {"text": "...", "styles": [{"size": 8, "bold": true, "fill": {"content":
 * {"solid": {"color": [r, g, b]}}}}, ...]}
 */
export function parseTextContent(content: string): ParsedTextStyle | null {
  if (!content) return null
  let parsed: {
    text?: string
    styles?: Array<{
      size?: number
      bold?: boolean
      italic?: boolean
      fill?: { content?: { solid?: { color?: unknown } } }
    }>
  }
  try {
    parsed = JSON.parse(content)
  } catch {
    return { text: content, size: 8, bold: false, italic: false, color: null }
  }
  const style = parsed.styles?.[0]
  const fill = style?.fill?.content?.solid?.color
  return {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    size: typeof style?.size === 'number' && style.size > 0 ? style.size : 8,
    bold: style?.bold === true,
    italic: style?.italic === true,
    color: colorToHex(fill)
  }
}

function mapAdjustParams(
  params: Array<{ name?: string; value?: number }> | undefined
): ColorFilters {
  const out: ColorFilters = { ...NEUTRAL_FILTERS }
  if (!params) return out
  for (const p of params) {
    const v = typeof p.value === 'number' ? p.value : 0
    switch ((p.name ?? '').toLowerCase()) {
      case 'brightness':
        out.brightness = clamp(1 + v, 0.2, 3)
        break
      case 'contrast':
        out.contrast = clamp(1 + v, 0.2, 3)
        break
      case 'saturation':
        out.saturation = clamp(1 + v, 0, 3)
        break
      case 'temperature':
        out.temperature = clamp(v, -1, 1)
        break
      default:
        break
    }
  }
  return out
}

/** Merge CapCut common_keyframes into CutClone keyframes keyed by time. */
interface KeyframeAccumulator extends Keyframe {
  scaleX?: number
  scaleY?: number
}

function mapKeyframes(segment: CapcutSegment): Keyframe[] {
  const byTime = new Map<number, KeyframeAccumulator>()
  for (const track of segment.common_keyframes ?? []) {
    const type = track.property_type ?? ''
    for (const kf of track.keyframe_list ?? []) {
      const value = Array.isArray(kf.values) ? kf.values[0] : undefined
      if (typeof value !== 'number' || !Number.isFinite(kf.time_offset)) continue
      const time = clamp(seconds(kf.time_offset), 0, 3600 * 2)
      let entry = byTime.get(time)
      if (!entry) {
        entry = { id: `${segment.id ?? 'kf'}-${time}`, time }
        byTime.set(time, entry)
      }
      switch (type) {
        case 'KFTypeScaleX':
          entry.scaleX = value
          break
        case 'KFTypeScaleY':
          entry.scaleY = value
          break
        case 'KFTypePositionX':
          entry.x = value
          break
        case 'KFTypePositionY':
          entry.y = value
          break
        case 'KFTypeAlpha':
          entry.opacity = clamp(value, 0, 1)
          break
        case 'KFTypeRotation':
          entry.rotation = value
          break
        default:
          break
      }
    }
  }
  const out: Keyframe[] = []
  for (const entry of byTime.values()) {
    if (entry.scaleX !== undefined && entry.scaleY !== undefined) {
      entry.scale = (entry.scaleX + entry.scaleY) / 2
    } else if (entry.scaleX !== undefined) {
      entry.scale = entry.scaleX
    } else if (entry.scaleY !== undefined) {
      entry.scale = entry.scaleY
    }
    delete entry.scaleX
    delete entry.scaleY
    out.push(entry)
  }
  return out.sort((a, b) => a.time - b.time)
}

function buildTextStyle(segment: CapcutSegment, material: CapcutTextMaterial): TextStyle {
  const style = createText()
  const parsed = parseTextContent(material.content ?? '')
  if (parsed) {
    if (parsed.text) style.content = parsed.text
    style.fontSize = clamp(parsed.size / 100, 0.02, 0.3)
    style.bold = parsed.bold
    style.italic = parsed.italic
    if (parsed.color) style.color = parsed.color
  }
  const clip = segment.clip
  style.scale = typeof clip?.scale === 'number' && clip.scale > 0 ? clip.scale : 1
  style.rotation = clip?.rotation ?? 0
  style.opacity = clamp(clip?.alpha ?? 1, 0, 1)
  // Draft transforms are centered on 0; ours are 0..1 fractions with 0.5 center.
  style.x = clamp(0.5 + (clip?.transform?.x ?? 0), 0.02, 0.98)
  style.y = clamp(0.5 + (clip?.transform?.y ?? 0), 0.02, 0.98)
  return style
}

export function capcutDraftToDocument(
  content: CapcutDraftContent,
  options: { draftFolder: string; draftName?: string; projectName?: string; templateId?: string; sourceUrl?: string }
): CapcutDraftParseResult {
  const warnings: string[] = []
  const downloads: PendingDownload[] = []
  const stats = { videoClips: 0, audioClips: 0, textClips: 0, skipped: 0 }

  const materials = content.materials ?? {}
  const videos = new Map<string, CapcutVideoMaterial>()
  for (const v of materials.videos ?? []) if (v.id) videos.set(v.id, v)
  const audios = new Map<string, CapcutAudioMaterial>()
  for (const a of materials.audios ?? []) if (a.id) audios.set(a.id, a)
  const texts = new Map<string, CapcutTextMaterial>()
  for (const t of materials.texts ?? []) if (t.id) texts.set(t.id, t)
  const speeds = new Map<string, number>()
  for (const s of materials.speeds ?? []) {
    if (s.id && typeof s.speed === 'number' && s.speed > 0) speeds.set(s.id, s.speed)
  }
  const transitions = new Map<string, { name: string; duration: number }>()
  for (const t of materials.transitions ?? []) {
    if (t.id && t.name) transitions.set(t.id, { name: t.name, duration: seconds(t.duration) })
  }
  const fades = new Map<string, { in: number; out: number }>()
  for (const f of materials.audio_fades ?? []) {
    if (f.id) fades.set(f.id, { in: seconds(f.fade_in_duration), out: seconds(f.fade_out_duration) })
  }
  const filters = new Map<string, ReturnType<typeof mapAdjustParams>>()
  for (const f of materials.filters ?? []) {
    if (f.id && f.enable_adjust !== false && f.adjust_params?.length) {
      filters.set(f.id, mapAdjustParams(f.adjust_params))
    }
  }
  const videoEffects = new Map<string, string>()
  for (const v of materials.video_effects ?? []) {
    if (v.id && v.name) videoEffects.set(v.id, v.name)
  }

  // Effect requests are collected with absolute timeline times (from effect
  // tracks and per-segment refs), then applied to every overlapping visual
  // clip after tracks are built.
  interface EffectRequest {
    start: number
    duration: number
    kind: EffectKind
    name: string
  }
  const effectRequests: EffectRequest[] = []
  const unsupportedEffects = new Set<string>()
  function pushEffectRequest(ref: string, start: number, duration: number): void {
    const name = videoEffects.get(ref)
    if (!name) return
    const kind = mapEffectKind(name)
    if (!kind) {
      unsupportedEffects.add(name)
      return
    }
    effectRequests.push({ start, duration, kind, name })
  }

  const canvasWidth = clamp(Math.round((content.canvas_config?.width ?? 0) / 2) * 2 || 1080, 240, 4096)
  const canvasHeight = clamp(Math.round((content.canvas_config?.height ?? 0) / 2) * 2 || 1920, 240, 4096)
  const fps = ((): 24 | 25 | 30 | 50 | 60 => {
    const raw = content.fps ?? 30
    const targets: Array<[number, 24 | 25 | 30 | 50 | 60]> = [
      [24, 24], [25, 25], [30, 30], [50, 50], [60, 60]
    ]
    return targets.reduce((best, cur) =>
      Math.abs(cur[0] - raw) < Math.abs(best[0] - raw) ? cur : best
    , targets[0])[1]
  })()

  const assets = new Map<string, MediaAsset>()

  function assetForMaterial(
    materialId: string,
    kind: 'video' | 'audio'
  ): MediaAsset | null {
    const existing = assets.get(materialId)
    if (existing) return existing
    if (kind === 'video') {
      const m = videos.get(materialId)
      if (!m) return null
      const isPhoto = m.type === 'photo'
      const localPath = resolveMaterialPath(m.path ?? '', options.draftFolder)
      const asset: MediaAsset = {
        id: crypto.randomUUID(),
        kind: isPhoto ? 'image' : 'video',
        path: localPath ?? '',
        fileName: (m.material_name || (m.path ? baseName(m.path) : '')) || `${m.id}.mp4`,
        duration: seconds(m.duration),
        width: m.width ?? 0,
        height: m.height ?? 0,
        importedAt: Date.now()
      }
      if (!localPath && m.url) {
        downloads.push({
          assetId: asset.id,
          url: m.url,
          fileName: `${m.id}${extFromUrl(m.url, isPhoto ? '.jpg' : '.mp4')}`
        })
      }
      assets.set(materialId, asset)
      return asset
    }
    const m = audios.get(materialId)
    if (!m) return null
    const localPath = resolveMaterialPath(m.path ?? '', options.draftFolder)
    const asset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: 'audio',
      path: localPath ?? '',
      fileName: (m.name || (m.path ? baseName(m.path) : '')) || `${m.id}.mp3`,
      duration: seconds(m.duration),
      width: 0,
      height: 0,
      importedAt: Date.now()
    }
    if (!localPath && m.url) {
      downloads.push({
        assetId: asset.id,
        url: m.url,
        fileName: `${m.id}${extFromUrl(m.url, '.mp3')}`
      })
    }
    assets.set(materialId, asset)
    return asset
  }

  const visualTracks: Array<{ track: Track; renderIndex: number }> = []
  const audioTracks: Track[] = []
  const missingMedia: string[] = []

  for (const draftTrack of content.tracks ?? []) {
    const type = draftTrack.type ?? ''
    if (type === 'effect') {
      // CapCut effect tracks: each segment spans an absolute timeline range.
      for (const segment of draftTrack.segments ?? []) {
        const target = segment.target_timerange
        const start = seconds(target?.start)
        const duration = seconds(target?.duration)
        if (duration <= 0 || !segment.material_id) continue
        pushEffectRequest(segment.material_id, start, duration)
      }
      continue
    }
    if (type !== 'video' && type !== 'audio' && type !== 'text') {
      const count = draftTrack.segments?.length ?? 0
      if (count > 0) {
        stats.skipped += count
        warnings.push(
          `Bỏ qua ${count} đoạn trên track "${type}" (CutClone chưa hỗ trợ loại này — hiệu ứng/sticker có thể cần Pro).`
        )
      }
      continue
    }

    const track = createTrack(
      type === 'text' ? 'text' : type,
      draftTrack.name || (type === 'text' ? 'Chữ' : type === 'audio' ? 'Âm thanh' : 'Video')
    )
    let maxRenderIndex = 0

    for (const segment of draftTrack.segments ?? []) {
      const materialId = segment.material_id ?? ''
      const target = segment.target_timerange
      const start = seconds(target?.start)
      const duration = seconds(target?.duration)
      if (duration <= 0) continue
      const refs = segment.extra_material_refs ?? []

      // Per-segment video-effect refs span the segment itself.
      for (const ref of refs) pushEffectRequest(ref, start, duration)

      const extra: Partial<Clip> = {}
      // Speed lives in a referenced speed material.
      for (const ref of refs) {
        const s = speeds.get(ref)
        if (s && s !== 1) extra.speed = s
      }
      // Fades (audio).
      for (const ref of refs) {
        const f = fades.get(ref)
        if (f) {
          extra.fadeIn = clamp(f.in, 0, duration)
          extra.fadeOut = clamp(f.out, 0, Math.max(0, duration - (extra.fadeIn ?? 0)))
        }
      }
      // Color adjustments.
      for (const ref of refs) {
        const f = filters.get(ref)
        if (f) extra.filters = { ...f }
      }
      // Transition into this clip.
      for (const ref of refs) {
        const t = transitions.get(ref)
        if (t) {
          const mapped = mapTransitionType(t.name)
          if (mapped) {
            extra.transitionIn = { type: mapped, duration: clamp(t.duration || 0.5, 0.1, Math.max(0.1, duration / 2)) }
          } else {
            warnings.push(`Bỏ qua chuyển cảnh không hỗ trợ: "${t.name}".`)
          }
        }
      }

      if (type === 'text') {
        const material = texts.get(materialId)
        if (!material) {
          stats.skipped++
          continue
        }
        const clip = createClip({
          kind: 'text',
          start,
          duration,
          text: buildTextStyle(segment, material),
          ...extra
        })
        clip.filters = extra.filters ?? { ...NEUTRAL_FILTERS }
        track.clips.push(clip)
        stats.textClips++
      } else {
        const material = assetForMaterial(materialId, type === 'audio' ? 'audio' : 'video')
        if (!material) {
          stats.skipped++
          missingMedia.push(materialId)
          continue
        }
        if (!material.path && !downloads.some((d) => d.assetId === material.id)) {
          missingMedia.push(materialId)
        }
        const clip = createClip({
          kind: material.kind === 'image' ? 'image' : type === 'audio' ? 'audio' : 'video',
          assetId: material.id,
          start,
          duration,
          inPoint: seconds(segment.source_timerange?.start),
          ...extra
        })
        const c = segment.clip
        clip.transform = {
          scale: typeof c?.scale === 'number' && c.scale > 0 ? c.scale : 1,
          x: clamp(c?.transform?.x ?? 0, -1, 1),
          y: clamp(c?.transform?.y ?? 0, -1, 1),
          rotation: c?.rotation ?? 0,
          opacity: clamp(c?.alpha ?? 1, 0, 1),
          flipX: c?.flip?.horizontal === true,
          flipY: c?.flip?.vertical === true,
          crop: { left: 0, right: 0, top: 0, bottom: 0 }
        }
        clip.keyframes = mapKeyframes(segment)
        if (type === 'video' || type === 'audio') {
          clip.volume = clamp(segment.volume ?? 1, 0, 2)
        }
        track.clips.push(clip)
        if (type === 'audio') stats.audioClips++
        else stats.videoClips++
      }
      maxRenderIndex = Math.max(maxRenderIndex, segment.render_index ?? 0)
    }

    if (track.clips.length === 0) continue
    track.clips.sort((a, b) => a.start - b.start)
    if (type === 'audio') audioTracks.push(track)
    else visualTracks.push({ track, renderIndex: maxRenderIndex })
  }

  // Higher CapCut render_index = drawn on top; CutClone shows top row first.
  visualTracks.sort((a, b) => b.renderIndex - a.renderIndex)
  const tracks: Track[] = [...visualTracks.map((v) => v.track), ...audioTracks]

  // Apply collected effect requests to every overlapping visual clip.
  if (effectRequests.length > 0) {
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.kind === 'text' || clip.kind === 'audio') continue
        for (const req of effectRequests) {
          const s = Math.max(req.start, clip.start)
          const e = Math.min(req.start + req.duration, clip.start + clip.duration)
          if (e - s <= 0.05) continue
          const effect: ClipEffect = {
            id: crypto.randomUUID(),
            kind: req.kind,
            name: req.name,
            start: s - clip.start,
            duration: e - s,
            intensity: 0.7
          }
          clip.effects = [...(clip.effects ?? []), effect]
        }
      }
    }
  }
  if (unsupportedEffects.size > 0) {
    const names = [...unsupportedEffects].slice(0, 5).join(', ')
    warnings.push(
      `Bỏ qua ${unsupportedEffects.size} hiệu ứng chưa hỗ trợ trên CutClone (${names}${unsupportedEffects.size > 5 ? '…' : ''}).`
    )
  }

  if (missingMedia.length > 0) {
    warnings.push(
      `${missingMedia.length} đoạn không tìm thấy tệp media trong draft — hãy thay media của bạn vào các đoạn đó.`
    )
  }

  const canvasColor = materials.canvas_color?.find((c) => /^#[0-9a-fA-F]{6}$/.test(c))
  const doc: ProjectDocument = {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    settings: {
      name: options.projectName || options.draftName || content.name || 'Mẫu CapCut',
      aspectRatio: closestAspect(canvasWidth, canvasHeight),
      width: canvasWidth,
      height: canvasHeight,
      fps,
      backgroundColor: canvasColor ?? '#000000'
    },
    mediaLibrary: [...assets.values()],
    markers: [],
    tracks,
    templateRef: {
      sourceUrl: options.sourceUrl ?? '',
      templateId: options.templateId ?? '',
      title: options.draftName || content.name || 'Mẫu CapCut',
      stage: 'draft'
    }
  }

  return { doc, warnings, downloads, stats }
}
