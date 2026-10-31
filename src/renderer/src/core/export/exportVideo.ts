import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  WebMOutputFormat,
  type VideoSample
} from 'mediabunny'
import type { Clip, MediaAsset, ProjectDocument, Track } from '@shared/document'
import {
  clipSourceSpan,
  clipSourceTime,
  clipTimelineTimeForSource,
  loudnessGain,
  sampleKeyframes,
  speedMultiplierAt
} from '@shared/document'
import { buildEffectNodes, PITCH_SEMITONES, pitchShiftBuffer } from '../audio/audioEffects'
import { denoiseBuffer } from '../audio/denoise'
import { documentDuration } from '../playback'
import { createIpcFileSource } from '../media/ipcSource'
import { ensureStabilization } from '../media/stabilization'
import { drawFrame, type FrameMediaSource } from '../render/frameRenderer'
import { gifFrameCount, GifEncoder } from './gif'

export type ExportFormat = 'mp4' | 'webm' | 'gif'
export type ExportQuality = 'low' | 'medium' | 'high' | 'custom'

export interface ExportSettings {
  /** Resolution scale relative to project settings (0.5 = 720p on a 1080p project). */
  resolutionScale: number
  /** Frames per second override; 0 keeps the project fps. */
  fps: number
  quality: ExportQuality
  /** Video bitrate when quality === 'custom', bits/s. */
  customBitrate?: number
  /** Audio bitrate, bits/s. */
  audioBitrate: number
  format: ExportFormat
  /** Skip the video track and emit a bare audio file (m4a/opus). */
  audioOnly?: boolean
  /** GIF frame rate, 8 | 10 | 12; ignored for other formats. */
  gifFps?: number
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolutionScale: 1,
  fps: 0,
  quality: 'high',
  audioBitrate: 192_000,
  format: 'mp4'
}

const QUALITY_BITRATE_FACTOR: Record<Exclude<ExportQuality, 'custom'>, number> = {
  low: 0.55,
  medium: 1,
  high: 1.7
}

/** Longest edge of GIF renderings; keeps hand-rolled LZW cost reasonable. */
const GIF_MAX_EDGE = 480

export interface ExportOptions {
  onProgress: (progress: number, stage: string) => void
  signal: { aborted: boolean }
  settings?: Partial<ExportSettings>
}

export interface ExportResult {
  buffer: ArrayBuffer
  durationSeconds: number
  /** Suggested file extension without dot ('mp4' | 'webm' | 'm4a' | 'opus' | 'gif'). */
  extension: string
}

interface AssetDecodeCache {
  input: Input
  videoSink: VideoSampleSink | null
}

function videoBitrateFor(width: number, height: number, fps: number, settings: ExportSettings): number {
  if (settings.quality === 'custom' && settings.customBitrate) return settings.customBitrate
  const factor = settings.quality === 'custom' ? 1 : QUALITY_BITRATE_FACTOR[settings.quality]
  const raw = width * height * fps * 0.14 * factor
  return Math.round(Math.min(40e6, Math.max(1.5e6, raw)))
}

function evenDim(value: number): number {
  const v = Math.max(16, Math.round(value))
  return v % 2 === 0 ? v : v + 1
}

// ---------------------------------------------------------------------------
// Frame sample bus shared by video/GIF/cover export paths: mediabunny's
// decoders are async while drawFrame is synchronous, so the samples the frame
// loop needs are pre-fetched each tick and handed to the renderer.
// ---------------------------------------------------------------------------

interface SampleBus {
  source: FrameMediaSource
  prepareFrame: (time: number) => Promise<void>
  release: () => void
}

function createSampleBus(doc: ProjectDocument): SampleBus {
  const decodes = new Map<string, AssetDecodeCache>()
  const getCache = (asset: MediaAsset): AssetDecodeCache => {
    let cache = decodes.get(asset.id)
    if (!cache) {
      cache = {
        input: new Input({
          formats: ALL_FORMATS,
          source: createIpcFileSource(asset.path)
        }),
        videoSink: null
      }
      decodes.set(asset.id, cache)
    }
    return cache
  }
  const videoSinkFor = async (asset: MediaAsset): Promise<VideoSampleSink | null> => {
    const cache = getCache(asset)
    if (!cache.videoSink) {
      const track = await cache.input.getPrimaryVideoTrack()
      if (!track) return null
      cache.videoSink = new VideoSampleSink(track)
    }
    return cache.videoSink
  }

  const frameSamples = new Map<string, VideoSample>()
  const endSamples = new Map<string, VideoSample>()

  const bus: SampleBus = {
    source: {
      getFrame: (clip) => {
        const sample = frameSamples.get(clip.id)
        if (!sample) return null
        return { image: sample.toCanvasImageSource(), width: sample.displayWidth, height: sample.displayHeight }
      },
      getFrameNearEnd: (clip) => {
        const sample = endSamples.get(clip.id)
        if (!sample) return null
        return { image: sample.toCanvasImageSource(), width: sample.displayWidth, height: sample.displayHeight }
      }
    },
    prepareFrame: async (time) => {
      frameSamples.clear()
      endSamples.clear()
      const active = collectActiveVisualClips(doc, time)
      for (const clip of active) {
        if (!hasVisualAsset(clip)) continue
        const asset = doc.mediaLibrary.find((a) => a.id === clip.assetId)
        if (!asset || asset.kind !== 'video') continue
        // Stabilization must be ready before its frames render; the analysis
        // is cached, so this is a no-op after the first pass.
        if (clip.stabilization?.enabled) await ensureStabilization(clip, asset)
        const localTime = clipSourceTime(clip, time)
        const sink = await videoSinkFor(asset)
        if (!sink) continue
        const sample = await sink.getSample(localTime)
        if (sample) frameSamples.set(clip.id, sample)
        if (
          !clip.compound &&
          clip.transitionIn &&
          time < clip.start + clip.transitionIn.duration &&
          clip.transitionIn.type !== 'fade-black' &&
          clip.transitionIn.type !== 'fade-white'
        ) {
          // Crossfade/slide/wipe need the previous clip's last frame; drawn
          // through getFrameNearEnd.
          const prev = findPreviousClip(doc, clip)
          if (prev && prev.assetId && !frameSamples.has(prev.id) && !endSamples.has(prev.id)) {
            const prevAsset = doc.mediaLibrary.find((a) => a.id === prev.assetId)
            if (prevAsset && prevAsset.kind === 'video') {
              const prevSink = await videoSinkFor(prevAsset)
              if (prevSink) {
                const endSample = await prevSink.getSample(
                  Math.max(0, clipSourceTime(prev, prev.start + prev.duration) - 0.05)
                )
                if (endSample) endSamples.set(prev.id, endSample)
              }
            }
          }
        }
      }
    },
    release: () => {
      for (const sample of frameSamples.values()) sample.close()
      for (const sample of endSamples.values()) sample.close()
      frameSamples.clear()
      endSamples.clear()
      decodes.clear()
    }
  }
  return bus
}

// ---------------------------------------------------------------------------
// Decode (up to a cap of) the audio track into peak buckets — now also gives
// us the RMS used by loudness normalization.
// ---------------------------------------------------------------------------

function hasVisualAsset(clip: Clip): boolean {
  return !!clip.assetId && (clip.kind === 'video' || clip.kind === 'image')
}

/** Walk visual clips (and compound inners) active at `time`. */
function collectActiveVisualClips(doc: ProjectDocument, time: number): Clip[] {
  const out: Clip[] = []
  const visit = (tracks: Track[], owner: Clip | null): void => {
    for (const track of tracks) {
      if (track.hidden || track.kind === 'audio') continue
      for (const clip of track.clips) {
        if (clip.compound) {
          const innerTime = time - clip.start
          if (innerTime >= 0 && innerTime < clip.compound.duration) {
            visit(clip.compound.tracks, clip)
          }
          continue
        }
        const local = owner ? time - owner.start : time
        if (local >= clip.start && local < clip.start + clip.duration) out.push(clip)
      }
    }
  }
  visit(doc.tracks, null)
  return out
}

function findPreviousClip(doc: ProjectDocument, clip: Clip): Clip | null {
  let best: Clip | null = null
  for (const track of doc.tracks) {
    for (const other of track.clips) {
      if (other.id === clip.id || other.kind === 'text' || other.kind === 'sticker') continue
      const end = other.start + other.duration
      if (end <= clip.start + 0.02 && end >= clip.start - 0.5) {
        if (!best || end > best.start + best.duration) best = other
      }
    }
  }
  return best
}

/**
 * Flatten every audible clip to outer-timeline times, expanding compounds so
 * their inner audio is mixed too. Track volume of a nested clip incorporates
 * the compound clip's own gain at the inner clip's start.
 */
function collectAudioClips(doc: ProjectDocument): Array<{ clip: Clip; trackVolume: number; muted: boolean }> {
  const out: Array<{ clip: Clip; trackVolume: number; muted: boolean }> = []
  const visit = (tracks: Track[], owner: Clip | null, ownerVolume: number, ownerMuted: boolean): void => {
    for (const track of tracks) {
      if (track.kind === 'text') continue
      for (const clip of track.clips) {
        if (clip.compound) {
          const gate = sampleKeyframes(clip, clip.start)
          visit(
            clip.compound.tracks,
            clip,
            ownerVolume * track.volume * gate.volume,
            ownerMuted || track.muted
          )
          continue
        }
        if (!clip.assetId) continue
        const asset = doc.mediaLibrary.find((a) => a.id === clip.assetId)
        if (!asset || asset.kind === 'image') continue
        const mapped = owner
          ? { ...clip, start: Math.max(0, owner.start + clip.start) }
          : clip
        out.push({
          clip: mapped,
          trackVolume: ownerVolume * track.volume,
          muted: ownerMuted || track.muted
        })
      }
    }
  }
  visit(doc.tracks, null, 1, false)
  return out
}

/**
 * Render the whole timeline fully in the renderer via WebCodecs + mediabunny.
 * Video frames are composited with drawFrame, audio is mixed in an
 * OfflineAudioContext; both feed the MP4, WebM or GIF muxer. audioOnly skips
 * the video track entirely (fast loudness-normalized audio renders).
 */
export async function renderProject(doc: ProjectDocument, options: ExportOptions): Promise<ExportResult> {
  const settings: ExportSettings = {
    ...DEFAULT_EXPORT_SETTINGS,
    ...options.settings
  } as ExportSettings
  const duration = documentDuration(doc)
  if (duration <= 0) throw new Error('Timeline trống — không có gì để xuất.')

  if (settings.audioOnly && settings.format !== 'webm') {
    return renderAudioOnlyProject(doc, options, duration, 'mp4')
  }
  if (settings.audioOnly) return renderAudioOnlyProject(doc, options, duration, 'webm')
  if (settings.format === 'gif') return renderGifProject(doc, options, duration, settings)
  return renderVideoProject(doc, options, duration, settings)
}

// ---------------------------------------------------------------------------
// Standard video (mp4/webm)
// ---------------------------------------------------------------------------

async function renderVideoProject(
  doc: ProjectDocument,
  options: ExportOptions,
  duration: number,
  settings: ExportSettings
): Promise<ExportResult> {
  const fps = settings.fps > 0 ? settings.fps : doc.settings.fps
  const width = evenDim(doc.settings.width * settings.resolutionScale)
  const height = evenDim(doc.settings.height * settings.resolutionScale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingQuality = 'high'

  const isWebM = settings.format === 'webm'
  const output = new Output({
    format: isWebM ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget()
  })

  const videoSource = new CanvasSource(canvas, {
    codec: isWebM ? 'vp9' : 'avc',
    bitrate: videoBitrateFor(width, height, fps, settings)
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  const audioClips = collectAudioClips(doc)
  let audioSource: AudioBufferSource | null = null
  if (audioClips.length > 0) {
    audioSource = new AudioBufferSource({ codec: isWebM ? 'opus' : 'aac', bitrate: settings.audioBitrate })
    output.addAudioTrack(audioSource)
  }

  await output.start()
  options.onProgress(0, 'Đang chuẩn bị…')
  const bus = createSampleBus(doc)

  const totalFrames = Math.ceil(duration * fps)
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (options.signal.aborted) throw new Error('__ABORTED__')
      const t = i / fps
      await bus.prepareFrame(t)

      drawFrame(ctx, doc, t, bus.source)
      bus.release()

      await videoSource.add(t, 1 / fps)

      if (i % 3 === 0 || i === totalFrames - 1) {
        const pct = i / totalFrames
        options.onProgress(pct * 0.85, `Đang kết xuất… ${Math.round(pct * 100)}%`)
      }
    }
  } finally {
    bus.release()
  }

  if (audioSource) {
    options.onProgress(0.87, 'Đang trộn âm thanh…')
    await renderAudioTrack(doc, audioSource, duration, options, (p) =>
      options.onProgress(0.85 + p * 0.12, 'Đang trộn âm thanh…')
    )
  }

  options.onProgress(0.98, 'Đang hoàn thiện file…')
  await output.finalize()
  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('Không tạo được dữ liệu video.')
  options.onProgress(1, 'Hoàn tất')
  return { buffer, durationSeconds: duration, extension: isWebM ? 'webm' : 'mp4' }
}

// ---------------------------------------------------------------------------
// Audio-only (m4a / opus)
// ---------------------------------------------------------------------------

async function renderAudioOnlyProject(
  doc: ProjectDocument,
  options: ExportOptions,
  duration: number,
  format: Extract<ExportFormat, 'mp4' | 'webm'>
): Promise<ExportResult> {
  const isWebM = format === 'webm'
  const output = new Output({
    format: isWebM ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget()
  })
  const audioSource = new AudioBufferSource({ codec: isWebM ? 'opus' : 'aac', bitrate: 192_000 })
  output.addAudioTrack(audioSource)
  await output.start()
  options.onProgress(0.05, 'Đang trộn âm thanh…')
  await renderAudioTrack(doc, audioSource, duration, options, (p) =>
    options.onProgress(0.05 + p * 0.9, 'Đang trộn âm thanh…')
  )
  options.onProgress(0.98, 'Đang hoàn thiện file…')
  await output.finalize()
  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('Không tạo được dữ liệu âm thanh.')
  options.onProgress(1, 'Hoàn tất')
  return { buffer, durationSeconds: duration, extension: isWebM ? 'opus' : 'm4a' }
}

// ---------------------------------------------------------------------------
// GIF (two passes: histogram → median-cut palette → streaming LZW)
// ---------------------------------------------------------------------------

async function renderGifProject(
  doc: ProjectDocument,
  options: ExportOptions,
  duration: number,
  settings: ExportSettings
): Promise<ExportResult> {
  const fps = Math.max(1, Math.min(12, Math.round(settings.gifFps ?? 10)))
  const scale = Math.min(1, GIF_MAX_EDGE / Math.max(doc.settings.width, doc.settings.height))
  const width = Math.max(2, Math.round(doc.settings.width * scale))
  const height = Math.max(2, Math.round(doc.settings.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingQuality = 'high'

  const encoder = new GifEncoder(width, height, fps)
  const bus = createSampleBus(doc)
  const drawAt = async (t: number): Promise<ImageData> => {
    await bus.prepareFrame(t)
    drawFrame(ctx, doc, t, bus.source)
    bus.release()
    return ctx.getImageData(0, 0, width, height)
  }

  const totalFrames = gifFrameCount(duration, fps)
  // Pass 1: histogram over every frame.
  for (let i = 0; i < totalFrames; i++) {
    if (options.signal.aborted) {
      bus.release()
      throw new Error('__ABORTED__')
    }
    encoder.addHistogramFrame((await drawAt(i / fps)).data)
    if (i % 2 === 0 || i === totalFrames - 1) {
      options.onProgress((i / totalFrames) * 0.4, 'Đang phân tích màu GIF…')
    }
  }
  if (!encoder.finalizePalette()) {
    bus.release()
    throw new Error('Không dựng được bảng màu GIF.')
  }

  // Pass 2: map colors and stream-LZW each frame.
  for (let i = 0; i < totalFrames; i++) {
    if (options.signal.aborted) {
      bus.release()
      throw new Error('__ABORTED__')
    }
    encoder.addFrame((await drawAt(i / fps)).data)
    if (i % 2 === 0 || i === totalFrames - 1) {
      options.onProgress(0.4 + (i / totalFrames) * 0.57, `Đang mã hoá GIF… ${Math.round((i / totalFrames) * 100)}%`)
    }
  }
  bus.release()
  options.onProgress(0.98, 'Đang hoàn thiện file…')
  const bytes = encoder.finishTrailer()
  options.onProgress(1, 'Hoàn tất')
  return { buffer: copyToBuffer(bytes), durationSeconds: duration, extension: 'gif' }
}

function copyToBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes instanceof Uint8Array) {
    const out = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(out).set(bytes)
    return out
  }
  return bytes as ArrayBuffer
}

// ---------------------------------------------------------------------------
// Cover still (PNG data URL) — rendered through the same compositor
// ---------------------------------------------------------------------------

/** Capture a still cover frame at `time` (CapCut "Đoạn bìa"). */
export async function renderCoverFrame(doc: ProjectDocument, time: number): Promise<string | null> {
  const duration = documentDuration(doc)
  if (duration <= 0) return null
  const clamped = Math.max(0, Math.min(time, duration - 0.001))
  const width = doc.settings.width
  const height = doc.settings.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingQuality = 'high'
  const bus = createSampleBus(doc)
  try {
    await bus.prepareFrame(clamped)
    drawFrame(ctx, doc, clamped, bus.source)
    bus.release()
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return null
  } finally {
    bus.release()
  }
}

// ---------------------------------------------------------------------------
// Audio mixing shared by mp4/webm/audio-only renders
// ---------------------------------------------------------------------------

/** Decode, schedule and mix all clip audio, then feed the encoder. */
async function renderAudioTrack(
  doc: ProjectDocument,
  audioSource: AudioBufferSource,
  duration: number,
  options: ExportOptions,
  onAudioProgress: (p: number) => void
): Promise<void> {
  const sampleRate = 48_000
  const offline = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(duration * sampleRate),
    sampleRate
  })

  const audioClips = collectAudioClips(doc)
  for (const { clip, trackVolume, muted } of audioClips) {
    if (options.signal.aborted) throw new Error('__ABORTED__')
    const asset = doc.mediaLibrary.find((a) => a.id === clip.assetId)
    if (!asset || muted) continue
    const input = new Input({
      formats: ALL_FORMATS,
      source: createIpcFileSource(asset.path)
    })
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) continue
    const sink = new AudioBufferSink(audioTrack)
    const gain = offline.createGain()
    scheduleGain(offline, gain, clip, trackVolume, asset)
    const effect = clip.audioEffect ?? 'none'
    if (effect !== 'none') {
      const { input: chainIn, output: chainOut } = buildEffectNodes(offline, effect)
      gain.connect(chainIn)
      chainOut.connect(offline.destination)
    } else {
      gain.connect(offline.destination)
    }
    const pitch = PITCH_SEMITONES[effect] ?? 0
    const span = clipSourceSpan(clip)
    const denoise = clip.denoise?.enabled ? clip.denoise : null
    try {
      const chunks: Array<{ buffer: AudioBuffer; timestamp: number }> = []
      for await (const { buffer, timestamp } of sink.buffers(clip.inPoint, clip.inPoint + span)) {
        if (options.signal.aborted) throw new Error('__ABORTED__')
        if (denoise) {
          chunks.push({ buffer, timestamp })
          continue
        }
        // Map this decoded chunk's source position back to the timeline,
        // honoring speed ramps, and rate the chunk by the local speed.
        const timelineTime = clipTimelineTimeForSource(clip, timestamp)
        const localSpeed = speedMultiplierAt(clip, timelineTime)
        const node = offline.createBufferSource()
        node.buffer = pitch !== 0 ? pitchShiftBuffer(offline, buffer, pitch) : buffer
        node.playbackRate.value = localSpeed
        node.connect(gain)
        node.start(timelineTime)
      }
      if (denoise && chunks.length > 0) {
        // Noise reduction needs one continuous pass (shared noise floor), so
        // the clip is decoded fully, denoised once, then scheduled per chunk
        // with AudioBufferSourceNode's offset/duration preserving the mapping.
        const first = chunks[0].buffer
        const totalLen = chunks.reduce((n, c) => n + c.buffer.length, 0)
        const full = offline.createBuffer(
          Math.max(1, first.numberOfChannels),
          Math.max(1, totalLen),
          first.sampleRate
        )
        let offset = 0
        const ranges: Array<{ timestamp: number; offset: number; length: number }> = []
        for (const { buffer, timestamp } of chunks) {
          for (let ch = 0; ch < full.numberOfChannels; ch++) {
            full.copyToChannel(buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1)), ch, offset)
          }
          ranges.push({ timestamp, offset, length: buffer.length })
          offset += buffer.length
        }
        const denoised = denoiseBuffer(offline, full, denoise)
        for (const { timestamp, offset: from, length } of ranges) {
          const timelineTime = clipTimelineTimeForSource(clip, timestamp)
          const localSpeed = speedMultiplierAt(clip, timelineTime)
          const node = offline.createBufferSource()
          node.buffer = denoised
          node.playbackRate.value = localSpeed
          node.connect(gain)
          node.start(timelineTime, from / denoised.sampleRate, length / denoised.sampleRate)
        }
      }
    } catch {
      // undecodable audio on this clip — skip it
    }
  }

  const rendered = await offline.startRendering()
  const chunkLength = sampleRate
  for (let start = 0; start < rendered.length; start += chunkLength) {
    if (options.signal.aborted) throw new Error('__ABORTED__')
    const length = Math.min(chunkLength, rendered.length - start)
    const chunk = new AudioBuffer({ numberOfChannels: 2, length, sampleRate })
    for (let ch = 0; ch < 2; ch++) {
      const source = rendered.getChannelData(Math.min(ch, rendered.numberOfChannels - 1))
      chunk.copyToChannel(source.subarray(start, start + length), ch)
    }
    await audioSource.add(chunk)
    onAudioProgress(start / Math.max(1, rendered.length))
  }
}

/** Volume automation: clip fades, keyframed volume, track + loudness gain. */
function scheduleGain(
  offline: OfflineAudioContext,
  gain: GainNode,
  clip: Clip,
  trackVolume: number,
  asset: MediaAsset
): void {
  const normalize = loudnessGain(asset, clip.audioNormalize)
  const keyframedBase = sampleKeyframes(clip, clip.start).volume ?? clip.volume
  const base = Math.min(2, keyframedBase * trackVolume) * normalize
  gain.gain.value = base

  // Keyframed volume (sampled every 50 ms).
  const kfVolume = clip.keyframes.filter((k) => k.volume !== undefined).sort((a, b) => a.time - b.time)
  if (kfVolume.length > 0) {
    const steps = Math.max(2, Math.ceil(clip.duration / 0.05))
    const curve = new Float32Array(steps)
    for (let i = 0; i < steps; i++) {
      const t = clip.start + (i / (steps - 1)) * clip.duration
      const v = sampleKeyframes(clip, t).volume ?? clip.volume
      curve[i] = Math.min(2, Math.max(0, v * trackVolume * normalize))
    }
    gain.gain.setValueCurveAtTime(curve, clip.start, clip.duration)
  }

  if (clip.fadeIn > 0) {
    gain.gain.setValueAtTime(0, clip.start)
    gain.gain.linearRampToValueAtTime(base, clip.start + clip.fadeIn)
  }
  if (clip.fadeOut > 0) {
    const from = Math.max(clip.start, clip.start + clip.duration - clip.fadeOut)
    gain.gain.setValueAtTime(base, from)
    gain.gain.linearRampToValueAtTime(0, clip.start + clip.duration)
  }
}

export function collectCompanionSrtCues(doc: ProjectDocument): Array<{ start: number; end: number; text: string }> {
  const cues: Array<{ start: number; end: number; text: string }> = []
  const visit = (tracks: Track[], owner: Clip | null): void => {
    for (const track of tracks) {
      if (track.kind !== 'text') continue
      for (const clip of track.clips) {
        const content = clip.text?.content.trim()
        if (!content) continue
        const start = owner ? owner.start + clip.start : clip.start
        cues.push({ start, end: start + clip.duration, text: content })
      }
    }
  }
  visit(doc.tracks, null)
  return cues.sort((a, b) => a.start - b.start)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message === '__ABORTED__'
}
