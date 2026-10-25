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
import type { Clip, MediaAsset, ProjectDocument } from '@shared/document'
import { clipSourceSpan, clipSourceTime, clipTimelineTimeForSource, sampleKeyframes, speedMultiplierAt } from '@shared/document'
import { buildEffectNodes, PITCH_SEMITONES, pitchShiftBuffer } from '../audio/audioEffects'
import { documentDuration } from '../playback'
import { createIpcFileSource } from '../media/ipcSource'
import { drawFrame, type FrameMediaSource } from '../render/frameRenderer'

export type ExportFormat = 'mp4' | 'webm'
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

export interface ExportOptions {
  onProgress: (progress: number, stage: string) => void
  signal: { aborted: boolean }
  settings?: Partial<ExportSettings>
}

export interface ExportResult {
  buffer: ArrayBuffer
  durationSeconds: number
  /** Suggested file extension without dot ('mp4' | 'webm'). */
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

/**
 * Render the whole timeline fully in the renderer via WebCodecs + mediabunny.
 * Video frames are composited with drawFrame, audio is mixed in an
 * OfflineAudioContext; both feed the MP4 or WebM muxer.
 */
export async function renderProject(doc: ProjectDocument, options: ExportOptions): Promise<ExportResult> {
  const settings: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, ...options.settings }
  const fps = settings.fps > 0 ? settings.fps : doc.settings.fps
  const width = evenDim(doc.settings.width * settings.resolutionScale)
  const height = evenDim(doc.settings.height * settings.resolutionScale)
  const duration = documentDuration(doc)
  if (duration <= 0) throw new Error('Timeline trống — không có gì để xuất.')

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

  // mediabunny decoding is async while drawFrame is synchronous — fetch the
  // needed samples up front, then hand them to the renderer.
  const frameSamples = new Map<string, VideoSample>()
  const endSamples = new Map<string, VideoSample>()

  const exportSource: FrameMediaSource = {
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
  }

  const totalFrames = Math.ceil(duration * fps)
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (options.signal.aborted) throw new Error('__ABORTED__')
      const t = i / fps

      frameSamples.clear()
      endSamples.clear()
      const active = collectActiveVisualClips(doc, t)
      for (const { clip } of active) {
        if (!hasVisualAsset(clip)) continue
        const asset = doc.mediaLibrary.find((a) => a.id === clip.assetId)
        if (!asset || asset.kind !== 'video') continue
        const sink = await videoSinkFor(asset)
        if (!sink) continue
        const sample = await sink.getSample(clipSourceTime(clip, t))
        if (sample) frameSamples.set(clip.id, sample)
        if (
          clip.transitionIn &&
          t < clip.start + clip.transitionIn.duration &&
          clip.transitionIn.type !== 'fade-black' &&
          clip.transitionIn.type !== 'fade-white'
        ) {
          // Crossfade/slide/wipe need the previous clip's last frame; it gets
          // drawn through getFrameNearEnd.
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

      drawFrame(ctx, doc, t, exportSource)
      for (const sample of frameSamples.values()) sample.close()
      for (const sample of endSamples.values()) sample.close()

      await videoSource.add(t, 1 / fps)

      if (i % 3 === 0 || i === totalFrames - 1) {
        const pct = i / totalFrames
        options.onProgress(pct * 0.85, `Đang kết xuất… ${Math.round(pct * 100)}%`)
      }
    }
  } finally {
    for (const sample of frameSamples.values()) sample.close()
    for (const sample of endSamples.values()) sample.close()
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

/** Clips that need decoded video frames (video/image — text & stickers draw themselves). */
function hasVisualAsset(clip: Clip): boolean {
  return !!clip.assetId && (clip.kind === 'video' || clip.kind === 'image')
}

interface ActiveClipRef {
  clip: Clip
  trackIndex: number
}

function collectActiveVisualClips(doc: ProjectDocument, time: number): ActiveClipRef[] {
  const out: ActiveClipRef[] = []
  for (let ti = 0; ti < doc.tracks.length; ti++) {
    const track = doc.tracks[ti]
    if (track.hidden || track.kind === 'audio') continue
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) {
        out.push({ clip, trackIndex: ti })
      }
    }
  }
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

function collectAudioClips(doc: ProjectDocument): Array<{ clip: Clip; trackVolume: number; muted: boolean }> {
  const out: Array<{ clip: Clip; trackVolume: number; muted: boolean }> = []
  for (const track of doc.tracks) {
    if (track.kind === 'text') continue
    for (const clip of track.clips) {
      if (!clip.assetId) continue
      const asset = doc.mediaLibrary.find((a) => a.id === clip.assetId)
      if (!asset || asset.kind === 'image') continue
      out.push({ clip, trackVolume: track.volume, muted: track.muted })
    }
  }
  return out
}

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
    scheduleGain(offline, gain, clip, trackVolume)
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
    try {
      for await (const { buffer, timestamp } of sink.buffers(clip.inPoint, clip.inPoint + span)) {
        if (options.signal.aborted) throw new Error('__ABORTED__')
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

/** Volume automation: clip fades, keyframed volume, and track volume. */
function scheduleGain(offline: OfflineAudioContext, gain: GainNode, clip: Clip, trackVolume: number): void {
  const keyframedBase = sampleKeyframes(clip, clip.start).volume ?? clip.volume
  const base = Math.min(2, keyframedBase * trackVolume)
  gain.gain.value = base

  // Keyframed volume (sampled every 50 ms).
  const kfVolume = clip.keyframes.filter((k) => k.volume !== undefined).sort((a, b) => a.time - b.time)
  if (kfVolume.length > 0) {
    const steps = Math.max(2, Math.ceil(clip.duration / 0.05))
    const curve = new Float32Array(steps)
    for (let i = 0; i < steps; i++) {
      const t = clip.start + (i / (steps - 1)) * clip.duration
      const v = sampleKeyframes(clip, t).volume ?? clip.volume
      curve[i] = Math.min(2, Math.max(0, v * trackVolume))
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

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.message === '__ABORTED__'
}
