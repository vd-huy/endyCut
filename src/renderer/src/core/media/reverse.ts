// Reverse a video asset into a new playable asset (CapCut-style "Đảo ngược").
// The renderer decodes the source forward, captures frames as JPEG blobs and
// re-encodes them backwards; audio chunks get their samples reversed and are
// scheduled back-to-front, so the reversed clip looks AND sounds reversed.
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink
} from 'mediabunny'
import type { MediaAsset } from '@shared/document'
import { createIpcFileSource } from './ipcSource'

/** Hard cap so reversing stays responsive (≈ 30 s of source). */
const MAX_SPAN = 30

/** Longest edge of the reversed output; keeps memory and encode cost sane. */
const MAX_EDGE = 1920

interface CapturedFrame {
  /** Reverse-domain time: position this frame should occupy when played back. */
  time: number
  duration: number
  blob: Blob
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Không đọc được khung hình đã quay backward'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Không mã hoá được khung hình'))),
      'image/jpeg',
      0.85
    )
  })
}

/**
 * Build a reversed duplicate of `asset`. Returns a brand-new MediaAsset whose
 * `path` points at the reversed mp4 under userData/generated. The original
 * asset and every other clip referencing it stay untouched.
 */
export async function buildReversedMediaAsset(asset: MediaAsset): Promise<MediaAsset | null> {
  if (asset.kind !== 'video' || asset.duration <= 0) return null
  const input = new Input({ formats: ALL_FORMATS, source: createIpcFileSource(asset.path) })
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) return null
  const duration = Math.min(asset.duration, MAX_SPAN)
  const srcW = await videoTrack.getDisplayWidth()
  const srcH = await videoTrack.getDisplayHeight()
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH))
  const even = (v: number) => {
    const r = Math.max(16, Math.round(v))
    return r % 2 === 0 ? r : r + 1
  }
  const width = even(srcW * scale)
  const height = even(srcH * scale)

  // ---- Pass 1: capture source frames forward as small JPEG blobs -----------
  const sink = new VideoSampleSink(videoTrack)
  const frames: CapturedFrame[] = []
  const captureCanvas = document.createElement('canvas')
  captureCanvas.width = width
  captureCanvas.height = height
  const capCtx = captureCanvas.getContext('2d', { alpha: false })!
  capCtx.imageSmoothingQuality = 'high'
  for await (const sample of sink.samples(0, duration)) {
    try {
      const t = Math.max(0, sample.timestamp)
      const d = Math.max(0, sample.duration)
      if (t < duration) {
        sample.draw(capCtx, 0, 0, width, height)
        const blob = await canvasToBlob(captureCanvas)
        frames.push({ time: t, duration: d, blob })
      }
    } finally {
      sample.close()
    }
  }
  if (frames.length === 0) return null
  const span = Math.min(duration, Math.max(...frames.map((f) => f.time + (f.duration || 1 / 30))))

  // ---- Pass 2: encode frames in reverse order ------------------------------
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget()
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })!
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: Math.min(12e6, Math.max(2.5e6, Math.round(width * height * 30 * 0.14)))
  })
  output.addVideoTrack(videoSource, { frameRate: 30 })

  const audioTrack = await input.getPrimaryAudioTrack()
  let audioSource: AudioBufferSource | null = null
  let reversedAudioBuffer: AudioBuffer | null = null
  if (audioTrack) {
    try {
      const audioSink = new AudioBufferSink(audioTrack)
      const chunks: AudioBuffer[] = []
      let sampleRate = 48_000
      let channels = 1
      let totalLength = 0
      for await (const { buffer, timestamp } of audioSink.buffers(0, duration)) {
        if (timestamp >= span) break
        channels = Math.max(channels, buffer.numberOfChannels)
        sampleRate = buffer.sampleRate
        totalLength += buffer.length
        chunks.push(buffer)
      }
      if (chunks.length > 0 && totalLength > 0) {
        // Concatenate all chunks, then flip the whole signal so reversed audio
        // matches reversed frames. ~11 MB per 30 s stereo — cheap enough.
        const concat: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(totalLength))
        let cursor = 0
        for (const chunk of chunks) {
          for (let ch = 0; ch < channels; ch++) {
            const target = concat[ch]
            const src = chunk.getChannelData(Math.min(ch, chunk.numberOfChannels - 1))
            target.set(src, cursor)
          }
          cursor += chunk.length
        }
        const flip = new AudioBuffer({ numberOfChannels: channels, length: totalLength, sampleRate })
        for (let ch = 0; ch < channels; ch++) {
          const data = flip.getChannelData(ch)
          const src = concat[ch]
          for (let i = 0, j = totalLength - 1; i < totalLength; i++, j--) data[i] = src[j]
        }
        reversedAudioBuffer = flip
      }
    } catch {
      // undecodable audio — reverse silently (video only)
    }
  }
  if (reversedAudioBuffer) {
    audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 160_000 })
    output.addAudioTrack(audioSource)
  }
  await output.start()

  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]
    const img = await blobToImage(frame.blob)
    try {
      ctx.drawImage(img, 0, 0, width, height)
      const reversedTime = span - frame.time - (frame.duration || 1 / 30)
      await videoSource.add(Math.max(0, reversedTime), frame.duration || 1 / 30)
    } finally {
      URL.revokeObjectURL(img.src)
    }
  }

  if (audioSource && reversedAudioBuffer) {
    await audioSource.add(reversedAudioBuffer)
  }

  await output.finalize()
  const data = (output.target as BufferTarget).buffer
  if (!data || data.byteLength === 0) return null

  // ---- Persist next to other generated media ------------------------------
  const baseDir = await window.api.getUserDataPath()
  const dirPath = `${baseDir}\\generated`
  const fileName = `reverse-${crypto.randomUUID().slice(0, 8)}.mp4`
  const written = await window.api.writeExportFile(`${dirPath}\\${fileName}`, data)
  if (!written) return null

  const reversedAsset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'video',
    path: `${dirPath}\\${fileName}`,
    fileName: `[đảo] ${asset.fileName}`,
    duration: span,
    width: srcW,
    height: srcH,
    waveform: undefined,
    importedAt: Date.now()
  }
  // Quick poster from the middle captured frame so the library shows content.
  try {
    const mid = frames[Math.floor(frames.length / 2)]
    if (mid) {
      const img = await blobToImage(mid.blob)
      const t = document.createElement('canvas')
      t.width = 320
      t.height = Math.max(1, Math.round((320 * height) / width))
      t.getContext('2d')!.drawImage(img, 0, 0, t.width, t.height)
      reversedAsset.thumbnail = t.toDataURL('image/jpeg', 0.75)
      URL.revokeObjectURL(img.src)
    }
  } catch {
    /* thumbnail optional */
  }
  return reversedAsset
}
