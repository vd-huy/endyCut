import type { AudioEffectKind, Clip, MediaAsset, ProjectDocument } from '@shared/document'
import { clipFadeMultiplier, clipSourceTime, sampleKeyframes, speedMultiplierAt } from '@shared/document'
import { buildEffectNodes, PREVIEWABLE_EFFECTS } from './audio/audioEffects'
import { drawFrame, type DecodedFrame, type FrameMediaSource } from './render/frameRenderer'

const RESYNC_THRESHOLD = 0.25

interface AudioChain {
  effect: AudioEffectKind
  input: MediaElementAudioSourceNode
  output: AudioNode
  extra: AudioNode[]
}

interface Entry {
  element: HTMLVideoElement | HTMLAudioElement | null
  image?: HTMLImageElement
  chain?: AudioChain
}

/**
 * Owns HTML media elements and drives preview playback: a rAF loop advances
 * the playhead, keeps active elements in sync and repaints the canvas.
 */
export class PlaybackEngine {
  private doc: ProjectDocument
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private entries = new Map<string, Entry>() // key: clip.id
  private raf = 0
  private lastTick = 0
  private playing = false
  private onPlayhead: (t: number) => void
  private onEnded: (() => void) | null = null
  private loop = false
  private audioCtx: AudioContext | null = null

  constructor(doc: ProjectDocument, onPlayhead: (t: number) => void) {
    this.doc = doc
    this.onPlayhead = onPlayhead
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    canvas.width = this.doc.settings.width
    canvas.height = this.doc.settings.height
    this.ctx = canvas.getContext('2d')
    this.tick()
  }

  detach(): void {
    cancelAnimationFrame(this.raf)
    this.playing = false
    for (const entry of this.entries.values()) {
      entry.element?.pause()
      entry.element?.removeAttribute('src')
      if (entry.chain) {
        try {
          entry.chain.input.disconnect()
          entry.chain.output.disconnect()
          for (const node of entry.chain.extra) node.disconnect()
        } catch {
          /* ignore */
        }
      }
    }
    this.entries.clear()
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }
    this.canvas = null
    this.ctx = null
  }

  setDoc(doc: ProjectDocument): void {
    this.doc = doc
    if (this.canvas) {
      const changed =
        this.canvas.width !== doc.settings.width || this.canvas.height !== doc.settings.height
      if (changed) {
        this.canvas.width = doc.settings.width
        this.canvas.height = doc.settings.height
      }
    }
  }

  setLoop(loop: boolean): void {
    this.loop = loop
  }

  play(): void {
    if (this.playing) return
    const duration = documentDuration(this.doc)
    if (this.onPlayheadCurrent() >= duration - 0.01) this.onPlayhead(0)
    this.playing = true
    this.lastTick = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  pause(): void {
    this.playing = false
    cancelAnimationFrame(this.raf)
    for (const entry of this.entries.values()) {
      if (entry.element && !entry.element.paused) entry.element.pause()
    }
  }

  isPlaying(): boolean {
    return this.playing
  }

  /** The preview canvas, for frame capture (freeze frame). */
  getPreviewCanvas(): HTMLCanvasElement | null {
    return this.canvas
  }

  seek(time: number, redraw = true): void {
    const clamped = Math.max(0, Math.min(time, documentDuration(this.doc)))
    this.onPlayhead(clamped)
    // Snap active elements immediately so scrubbing feels responsive.
    for (const track of this.doc.tracks) {
      for (const clip of track.clips) {
        if (clip.kind === 'text') continue
        const active = clamped >= clip.start && clamped < clip.start + clip.duration
        const entry = this.entries.get(clip.id)
        if (!entry?.element) continue
        if (active) {
          const target = clipSourceTime(clip, clamped)
          if (Math.abs(entry.element.currentTime - target) > 0.05) {
            try {
              entry.element.currentTime = target
            } catch {
              /* not seekable yet */
            }
          }
        } else if (!entry.element.paused) {
          entry.element.pause()
        }
      }
    }
    if (redraw) this.tick()
  }

  onEndedCallback(cb: (() => void) | null): void {
    this.onEnded = cb
  }

  /** Paint exactly one frame at the current playhead without advancing. */
  private tick = (): void => {
    const now = performance.now()
    const dt = Math.min(0.25, (now - this.lastTick) / 1000)
    this.lastTick = now
    if (this.playing) {
      let next = this.onPlayheadCurrent() + dt
      const duration = documentDuration(this.doc)
      if (next >= duration) {
        if (this.loop) {
          next = 0
        } else {
          next = duration
          this.playing = false
          this.onEnded?.()
        }
      }
      this.onPlayhead(next)
    }
    this.syncAndDraw()
    if (this.playing) this.raf = requestAnimationFrame(this.tick)
  }

  private playheadGetter: () => number = () => 0

  setPlayheadGetter(getter: () => number): void {
    this.playheadGetter = getter
  }

  private onPlayheadCurrent(): number {
    return this.playheadGetter()
  }

  private syncAndDraw(): void {
    if (!this.ctx) return
    const time = this.onPlayheadCurrent()

    const liveClipIds = new Set<string>()
    for (const track of this.doc.tracks) {
      for (const clip of track.clips) {
        liveClipIds.add(clip.id)
        if (clip.kind === 'text' || !clip.assetId) continue
        const asset = this.doc.mediaLibrary.find((a) => a.id === clip.assetId)
        if (!asset) continue
        const active = time >= clip.start && time < clip.start + clip.duration
        if (!active) {
          const entry = this.entries.get(clip.id)
          if (entry?.element && !entry.element.paused) entry.element.pause()
          continue
        }
        const entry = this.ensureEntry(clip, asset)
        this.syncElement(clip, track, entry, time)
      }
    }

    // Sweep entries whose clips disappeared from the document.
    for (const [key, entry] of this.entries) {
      if (!liveClipIds.has(key)) {
        entry.element?.pause()
        entry.element?.removeAttribute('src')
        this.entries.delete(key)
      }
    }

    drawFrame(this.ctx, this.doc, time, this.playbackSource)
  }

  private syncElement(clip: Clip, track: ProjectDocument['tracks'][number], entry: Entry, time: number): void {
    const el = entry.element
    if (!el) return
    const expected = clipSourceTime(clip, time)
    el.playbackRate = Math.min(16, Math.max(0.0625, speedMultiplierAt(clip, time)))
    const fade = clipFadeMultiplier(clip, time)
    const audible = !track.muted && clip.kind !== 'image'
    el.muted = !audible
    const keyframed = sampleKeyframes(clip, time)
    el.volume = Math.min(1, Math.max(0, keyframed.volume * track.volume * fade))
    this.syncAudioChain(clip, el, entry, audible)
    if (this.playing) {
      if (Math.abs(el.currentTime - expected) > RESYNC_THRESHOLD) {
        try {
          el.currentTime = expected
        } catch {
          /* not ready */
        }
      }
      if (el.paused) {
        el.play().catch(() => {
          /* autoplay guard: redraw-only */
        })
      }
    } else if (!el.paused) {
      el.pause()
    }
  }

  /** Route clips with previewable audio effects through a WebAudio chain. */
  private syncAudioChain(clip: Clip, el: HTMLMediaElement, entry: Entry, audible: boolean): void {
    const wanted = audible && PREVIEWABLE_EFFECTS.has(clip.audioEffect ?? 'none') ? clip.audioEffect : null
    const chain = entry.chain
    if (!wanted) {
      if (chain) {
        try {
          chain.input.disconnect()
          chain.output.disconnect()
          for (const node of chain.extra) node.disconnect()
        } catch {
          /* already torn down */
        }
        entry.chain = undefined
      }
      return
    }
    if (chain && chain.effect === wanted) return
    if (chain) {
      try {
        chain.input.disconnect()
        chain.output.disconnect()
        for (const node of chain.extra) node.disconnect()
      } catch {
        /* ignore */
      }
      entry.chain = undefined
    }
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext()
      } catch {
        return // WebAudio unavailable — play unprocessed
      }
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume()
    try {
      const source = this.audioCtx.createMediaElementSource(el)
      const { nodes, input, output } = buildEffectNodes(this.audioCtx, wanted)
      source.connect(input)
      output.connect(this.audioCtx.destination)
      entry.chain = { effect: wanted, input: source, output, extra: nodes }
    } catch {
      // Element already routed once — leave it unprocessed rather than breaking audio.
      entry.chain = undefined
    }
  }

  private ensureEntry(clip: Clip, asset: MediaAsset): Entry {
    const existing = this.entries.get(clip.id)
    if (existing) return existing
    const url = mediaUrlOf(asset)
    let entry: Entry
    if (clip.kind === 'image') {
      const img = new Image()
      img.src = url
      entry = { element: null, image: img }
    } else if (clip.kind === 'audio') {
      const audio = document.createElement('audio')
      audio.src = url
      audio.preload = 'auto'
      entry = { element: audio }
    } else {
      const video = document.createElement('video')
      video.src = url
      video.preload = 'auto'
      video.playsInline = true
      entry = { element: video }
    }
    this.entries.set(clip.id, entry)
    return entry
  }

  private playbackSource: FrameMediaSource = {
    getFrame: (clip, asset, sourceTime): DecodedFrame | null => {
      if (clip.kind === 'image') {
        const entry = this.ensureEntry(clip, asset)
        const img = entry.image!
        if (!img.complete || img.naturalWidth === 0) return null
        return { image: img, width: img.naturalWidth, height: img.naturalHeight }
      }
      const entry = this.ensureEntry(clip, asset)
      const el = entry.element as HTMLVideoElement
      if (el.readyState < 2) return null
      return { image: el, width: el.videoWidth, height: el.videoHeight }
    },
    getFrameNearEnd: (clip, asset): DecodedFrame | null => {
      if (clip.kind === 'image') {
        return this.playbackSource.getFrame(clip, asset, 0)
      }
      const entry = this.ensureEntry(clip, asset)
      const el = entry.element as HTMLVideoElement
      const end = clip.start + clip.duration - 0.06
      const target = clipSourceTime(clip, end)
      if (el.readyState >= 2 && Math.abs(el.currentTime - target) < 0.4) {
        return { image: el, width: el.videoWidth, height: el.videoHeight }
      }
      if (el.readyState >= 1) {
        try {
          el.currentTime = target
        } catch {
          /* ignore */
        }
      }
      return null
    }
  }
}

export function documentDuration(doc: ProjectDocument): number {
  let end = 0
  for (const track of doc.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration)
  }
  return end
}

function mediaUrlOf(asset: MediaAsset): string {
  return `media://local?f=${encodeURIComponent(asset.path)}`
}
