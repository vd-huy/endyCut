import { ALL_FORMATS, AudioBufferSink, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, VideoSampleSink } from 'mediabunny'
import type { AssetKind, MediaAsset } from '@shared/document'
import { detectBeats, needsProxy } from '@shared/document'
import { createIpcFileSource } from './ipcSource'

export function mediaUrlFor(filePath: string): string {
  return `media://local?f=${encodeURIComponent(filePath)}`
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

export function guessKindFromPath(filePath: string): AssetKind {
  const lower = filePath.toLowerCase()
  if (IMAGE_EXTENSIONS.has(lower.slice(lower.lastIndexOf('.')))) return 'image'
  if (AUDIO_EXTENSIONS.has(lower.slice(lower.lastIndexOf('.')))) return 'audio'
  return 'video'
}

function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

/**
 * Load an image through a same-origin blob URL. A media:// <img> request is
 * no-CORS and taints the canvas (breaking toDataURL), and fetching a custom
 * scheme from the http dev origin is CORS-blocked outright — reading the
 * bytes over the existing IPC bridge avoids both problems.
 */
async function loadBlobImage(
  filePath: string
): Promise<{ img: HTMLImageElement; width: number; height: number; revoke: () => void }> {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const mime = IMAGE_MIME[ext] ?? 'image/png'
  const size = await window.api.mediaFileSize(filePath)
  const bytes = await window.api.mediaReadSlice(filePath, 0, size)
  // Copy into an ArrayBuffer-backed view (Blob requires a concrete buffer).
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy], { type: mime })
  const objectUrl = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Không đọc được ảnh'))
    img.src = objectUrl
  })
  let revoked = false
  return {
    img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    revoke: () => {
      if (!revoked) {
        revoked = true
        URL.revokeObjectURL(objectUrl)
      }
    }
  }
}

function drawImageThumbnail(img: HTMLImageElement, width: number, height: number): string {
  const scale = Math.min(1, 320 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}

async function makeVideoThumbnail(
  input: Input,
  duration: number
): Promise<string | undefined> {
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) return undefined
  const sink = new VideoSampleSink(videoTrack)
  const sample = await sink.getSample(Math.min(duration > 0 ? duration * 0.25 : 0, 3))
  if (!sample) return undefined
  try {
    const w = sample.displayWidth
    const h = sample.displayHeight
    const scale = Math.min(1, 320 / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')!
    sample.draw(ctx, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.75)
  } finally {
    sample.close()
  }
}

/**
 * Decode (up to a cap of) the audio track into peak buckets, plus the
 * long-term RMS used by loudness normalization.
 */
async function makeWaveform(
  input: Input,
  duration: number
): Promise<{ waveform: number[]; rms: number } | undefined> {
  const audioTrack = await input.getPrimaryAudioTrack()
  if (!audioTrack) return undefined
  const span = Math.min(duration, 300)
  if (span <= 0) return undefined
  const bucketCount = Math.min(4000, Math.max(64, Math.round(span * 40)))
  const buckets = new Float32Array(bucketCount)
  let sumSq = 0
  let samples = 0
  const sink = new AudioBufferSink(audioTrack)
  try {
    for await (const { buffer, timestamp } of sink.buffers(0, span)) {
      let peak = 0
      // RMS + peak across up to two channels, per decoded chunk.
      const channels = Math.min(2, buffer.numberOfChannels)
      for (let c = 0; c < channels; c++) {
        const channel = buffer.getChannelData(c)
        for (let i = 0; i < channel.length; i++) {
          const v = channel[i]
          if (c === 0) {
            const a = v < 0 ? -v : v
            if (a > peak) peak = a
          }
          sumSq += v * v
        }
        samples += channel.length
      }
      const index = Math.min(bucketCount - 1, Math.floor((timestamp / span) * bucketCount))
      if (peak > buckets[index]) buckets[index] = peak
    }
  } catch {
    if (samples === 0) return undefined
  }
  const waveform = Array.from(buckets)
  if (samples === 0) return { waveform, rms: 0 }
  return { waveform, rms: Math.min(1, Math.sqrt(sumSq / samples)) }
}

/**
 * Build a MediaAsset for a local file. Uses mediabunny for video/audio
 * metadata, thumbnails and waveforms; plain Image loading for pictures.
 */
export async function importAssetFromFile(filePath: string): Promise<MediaAsset> {
  const kind = guessKindFromPath(filePath)
  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind,
    path: filePath,
    fileName: baseName(filePath),
    duration: 0,
    width: 0,
    height: 0,
    importedAt: Date.now()
  }

  if (kind === 'image') {
    // Single blob-URL load feeds both the dimensions and the thumbnail.
    const { img, width, height, revoke } = await loadBlobImage(filePath)
    try {
      asset.width = width
      asset.height = height
      asset.duration = 5 // default still-image length on the timeline
      asset.thumbnail = drawImageThumbnail(img, width, height)
    } finally {
      revoke()
    }
    return asset
  }

  const input = new Input({ formats: ALL_FORMATS, source: createIpcFileSource(filePath) })
  const duration = await input.computeDuration()
  asset.duration = duration

  const videoTrack = await input.getPrimaryVideoTrack()
  if (videoTrack) {
    asset.kind = 'video'
    asset.width = await videoTrack.getDisplayWidth()
    asset.height = await videoTrack.getDisplayHeight()
    asset.thumbnail = (await makeVideoThumbnail(input, duration)) ?? undefined
  } else {
    asset.kind = 'audio'
    const audioTrack = await input.getPrimaryAudioTrack()
    if (audioTrack) {
      asset.sampleRate = await audioTrack.getSampleRate()
      asset.channels = await audioTrack.getNumberOfChannels()
    }
  }

  // Waveform/RMS/beat analysis runs in the background (analyzeAssetAudio) so
  // the library tile appears right away even for long recordings.
  return asset
}

/**
 * Background pass after import: decode the audio track once, extract the
 * peak envelope, the long-term RMS (loudness) and beat markers, then patch
 * the asset in place. Best-effort — failures are silent and leave the asset
 * usable for playback/export.
 */
export async function analyzeAssetAudio(
  assetId: string,
  filePath: string,
  kind: MediaAsset['kind'],
  duration: number,
  patch: (assetId: string, fields: Partial<MediaAsset>) => void
): Promise<void> {
  if (kind === 'image') return
  try {
    const input = new Input({ formats: ALL_FORMATS, source: createIpcFileSource(filePath) })
    const audioInfo = await makeWaveform(input, duration)
    if (!audioInfo) return
    const samplesPerSecond = duration > 0 ? audioInfo.waveform.length / duration : 0
    const result = samplesPerSecond > 0 ? detectBeats(audioInfo.waveform, samplesPerSecond) : null
    patch(assetId, {
      waveform: audioInfo.waveform,
      rms: audioInfo.rms,
      ...(result ? { beats: result.beats, bpm: result.bpm } : {})
    })
  } catch {
    /* analysis is best-effort */
  }
}

/** Import many files, reporting each asset as it finishes. */
export async function importAssets(
  paths: string[],
  onAsset: (asset: MediaAsset) => void,
  onError?: (path: string, error: unknown) => void
): Promise<void> {
  const concurrency = 2
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < paths.length) {
      const path = paths[cursor++]
      try {
        onAsset(await importAssetFromFile(path))
      } catch (error) {
        onError?.(path, error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker))
}

/**
 * Render a half-resolution, preview-only mp4 copy of a heavy clip (mediabunny
 * re-encode) and persist it under userData/proxy. Export keeps using the
 * original file — the proxy exists only so 4K/6K clips scrub smoothly.
 */
export async function ensureProxy(asset: MediaAsset): Promise<string | undefined> {
  if (!needsProxy(asset) || asset.proxyPath) return asset.proxyPath
  try {
    const input = new Input({ formats: ALL_FORMATS, source: createIpcFileSource(asset.path) })
    const track = await input.getPrimaryVideoTrack()
    if (!track) return undefined
    const duration = await input.computeDuration()
    if (duration <= 0) return undefined
    const srcW = await track.getDisplayWidth()
    const srcH = await track.getDisplayHeight()
    const scale = Math.min(0.5, Math.max(0.2, 1280 / Math.max(srcW, srcH)))
    const width = evenDim(srcW * scale)
    const height = evenDim(srcH * scale)
    if (width >= srcW && height >= srcH) return undefined // already small enough

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })!
    ctx.imageSmoothingQuality = 'high'

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget()
    })
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: Math.min(6_000_000, Math.max(2_000_000, Math.round(width * height * 30 * 0.12)))
    })
    output.addVideoTrack(videoSource, { frameRate: 30 })
    await output.start()

    const sink = new VideoSampleSink(track)
    for await (const sample of sink.samples()) {
      if (sample.timestamp >= duration) {
        sample.close()
        break
      }
      sample.draw(ctx, 0, 0, width, height)
      await videoSource.add(sample.timestamp, sample.duration)
      sample.close()
    }
    await output.finalize()
    const data = (output.target as BufferTarget).buffer
    if (!data || data.byteLength === 0) return undefined
    return await window.api.writeProxy(asset.path, data)
  } catch {
    return undefined // proxy is best-effort; preview keeps the original path
  }
}

function evenDim(value: number): number {
  const v = Math.max(16, Math.round(value))
  return v % 2 === 0 ? v : v + 1
}
