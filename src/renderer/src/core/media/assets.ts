import { ALL_FORMATS, AudioBufferSink, Input, VideoSampleSink } from 'mediabunny'
import type { AssetKind, MediaAsset } from '@shared/document'
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

async function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Không đọc được ảnh'))
    img.src = url
  })
}

async function makeImageThumbnail(url: string): Promise<string> {
  const { width, height } = await loadImageDimensions(url)
  const scale = Math.min(1, 320 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Không đọc được ảnh'))
    img.src = url
  })
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

/** Decode (up to a cap of) the audio track and reduce it to peak values. */
async function makeWaveform(input: Input, duration: number): Promise<number[] | undefined> {
  const audioTrack = await input.getPrimaryAudioTrack()
  if (!audioTrack) return undefined
  const span = Math.min(duration, 300)
  if (span <= 0) return undefined
  const bucketCount = Math.min(4000, Math.max(64, Math.round(span * 40)))
  const buckets = new Float32Array(bucketCount)
  const sink = new AudioBufferSink(audioTrack)
  try {
    for await (const { buffer, timestamp } of sink.buffers(0, span)) {
      const channel = buffer.getChannelData(0)
      const step = Math.max(1, Math.floor(channel.length / 64))
      let peak = 0
      for (let i = 0; i < channel.length; i += step) {
        const v = Math.abs(channel[i])
        if (v > peak) peak = v
      }
      const index = Math.min(bucketCount - 1, Math.floor((timestamp / span) * bucketCount))
      if (peak > buckets[index]) buckets[index] = peak
    }
  } catch {
    return undefined
  }
  return Array.from(buckets)
}

/**
 * Build a MediaAsset for a local file. Uses mediabunny for video/audio
 * metadata, thumbnails and waveforms; plain Image loading for pictures.
 */
export async function importAssetFromFile(filePath: string): Promise<MediaAsset> {
  const kind = guessKindFromPath(filePath)
  const url = mediaUrlFor(filePath)
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
    const dims = await loadImageDimensions(url)
    asset.width = dims.width
    asset.height = dims.height
    asset.duration = 5 // default still-image length on the timeline
    asset.thumbnail = await makeImageThumbnail(url)
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
    asset.waveform = (await makeWaveform(input, duration)) ?? undefined
  } else {
    asset.kind = 'audio'
    const audioTrack = await input.getPrimaryAudioTrack()
    if (audioTrack) {
      asset.sampleRate = await audioTrack.getSampleRate()
      asset.channels = await audioTrack.getNumberOfChannels()
    }
    asset.waveform = (await makeWaveform(input, duration)) ?? undefined
  }
  return asset
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
