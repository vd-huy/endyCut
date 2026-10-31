import type { AudioEffectKind, Clip, DenoiseMode, MediaAsset, ProjectDocument, Track } from '@shared/document'
import { clipFadeMultiplier, clipSourceTime, loudnessGain, sampleKeyframes, speedMultiplierAt } from '@shared/document'
import { buildEffectNodes, ensurePitchNode, PITCH_SEMITONES, PREVIEWABLE_EFFECTS } from './audio/audioEffects'
import { ensureDenoiseNode } from './audio/denoise'
import { drawFrame, type DecodedFrame, type FrameMediaSource } from './render/frameRenderer'

const RESYNC_THRESHOLD = 0.25

interface AudioChain {
  effect: AudioEffectKind
  /** Identity of the active denoise settings (null = off) — rebuilds when changed. */
  denoiseKey: string | null
  input: MediaElementAudioSourceNode
  output: AudioNode
  extra: AudioNode[]
}

interface Entry {
  element: HTMLVideoElement | HTMLAudioElement | null
  image?: HTMLImageElement
  chain?: AudioChain
}/**
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
    const visit = (clips: Clip[], owner: Clip | null): void => {
      for (const clip of clips) {
        if (clip.compound) {
          for (const innerTrack of clip.compound.tracks) visit(innerTrack.clips, clip)
          continue
        }
        if (clip.kind === 'text') continue
        const key = owner ? `${owner.id}:${clip.id}` : clip.id
        const localTime = owner ? clamped - owner.start : clamped
        const active = localTime >= clip.start && localTime < clip.start + clip.duration
        const entry = this.entries.get(key)
        if (!entry?.element) continue
        if (active) {
          const target = clipSourceTime(clip, localTime)
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
    for (const track of this.doc.tracks) visit(track.clips, null)
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

  /** Sync media elements for every asset-backed clip, incl. compound inners. */
  private syncClips(liveClipIds: Set<string>): void {
    const time = this.onPlayheadCurrent()
    const visitTrack = (track: Track, clips: Clip[], owner: Clip | null): void => {
      for (const clip of clips) {
        const key = owner ? `${owner.id}:${clip.id}` : clip.id
        liveClipIds.add(key)
        if (clip.compound) {
          for (const innerTrack of clip.compound.tracks) {
            visitTrack(innerTrack, innerTrack.clips, clip)
          }
          continue
        }
        if (clip.kind === 'text' || !clip.assetId) continue
        const asset = this.doc.mediaLibrary.find((a) => a.id === clip.assetId)
        if (!asset) continue
        const localTime = owner ? time - owner.start : time
        const active = localTime >= clip.start && localTime < clip.start + clip.duration
        const existing = this.entries.get(key)
        if (!active) {
          if (existing?.element && !existing.element.paused) existing.element.pause()
          continue
        }
        if (owner && owner.transform.opacity === 0) continue // whole compound hidden
        // The compound clip's own gain/fade wraps its inner clips' audio.
        const extraVolume = owner
          ? Math.max(0, Math.min(2, sampleKeyframes(owner, time).volume * clipFadeMultiplier(owner, time)))
          : 1
        const muted = owner ? false : (track.muted || track.hidden)
        const entry = this.ensureEntry(key, clip, asset)
        this.syncElement(clip, track, entry, localTime, asset, extraVolume, muted)
      }
    }
    for (const track of this.doc.tracks) visitTrack(track, track.clips, null)
  }

  private syncAndDraw(): void {
    if (!this.ctx) return

    const liveClipIds = new Set<string>()
    this.syncClips(liveClipIds)

    // Sweep entries whose clips disappeared from the document.
    for (const [key, entry] of this.entries) {
      if (!liveClipIds.has(key)) {
        entry.element?.pause()
        entry.element?.removeAttribute('src')
        this.entries.delete(key)
      }
    }

    drawFrame(this.ctx, this.doc, this.onPlayheadCurrent(), this.playbackSource)
  }

  private syncElement(
    clip: Clip,
    track: Track,
    entry: Entry,
    time: number,
    asset: MediaAsset,
    extraVolume = 1,
    muted = track.muted
  ): void {
    const el = entry.element
    if (!el) return
    const expected = clipSourceTime(clip, time)
    el.playbackRate = Math.min(16, Math.max(0.0625, speedMultiplierAt(clip, time)))
    const fade = clipFadeMultiplier(clip, time)
    const audible = !muted && clip.kind !== 'image' && extraVolume > 0.001
    el.muted = !audible
    const keyframed = sampleKeyframes(clip, time)
    el.volume = Math.min(
      1,
      Math.max(
        0,
        keyframed.volume * track.volume * fade * extraVolume * loudnessGain(asset, clip.audioNormalize)
      )
    )
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

  /** Route clips with previewable audio effects or denoise through WebAudio. */
  private syncAudioChain(clip: Clip, el: HTMLMediaElement, entry: Entry, audible: boolean): void {
    const effect = clip.audioEffect ?? 'none'
    const denoise = clip.denoise
    const denoiseKey = denoise?.enabled ? `${Math.round(denoise.rate * 100)}|${denoise.mode}` : null
    const wanted = audible && (PREVIEWABLE_EFFECTS.has(effect) || denoiseKey) ? effect : null
    const chain = entry.chain
    if (!wanted) {
      this.teardownChain(entry)
      return
    }
    if (chain && chain.effect === wanted && chain.denoiseKey === denoiseKey) return
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext()
      } catch {
        return // WebAudio unavailable — play unprocessed
      }
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume()
    try {
      // The element can only be routed once per document: reuse the existing
      // MediaElementAudioSourceNode and rebuild only the effect sub-chain.
      const source = chain?.input ?? this.audioCtx.createMediaElementSource(el)
      if (chain) {
        try {
          chain.output.disconnect()
        } catch {
          /* ignore */
        }
        for (const node of chain.extra) {
          try {
            node.disconnect()
          } catch {
            /* ignore */
          }
        }
      }
      const { nodes, input, output } = buildEffectNodes(this.audioCtx, wanted)
      source.connect(input)
      output.connect(this.audioCtx.destination)
      entry.chain = { effect: wanted, denoiseKey, input: source, output, extra: nodes }
      void this.insertWorklets(entry, wanted)
    } catch {
      // Element already routed once and the old chain is gone — leave it
      // unprocessed rather than breaking audio.
      entry.chain = undefined
    }
  }

  private teardownChain(entry: Entry): void {
    const chain = entry.chain
    if (!chain) return
    try {
      chain.input.disconnect()
      chain.output.disconnect()
      for (const node of chain.extra) node.disconnect()
    } catch {
      /* already torn down */
    }
    entry.chain = undefined
  }

  /**
   * Splice the optional AudioWorklet inserts (granular pitch shifter for pitch
   * effects, streaming denoiser) between the effect chain and the destination.
   * Async because worklet modules compile on first use; the entry is
   * re-validated after each await so a changed chain doesn't get spliced.
   */
  private async insertWorklets(entry: Entry, effect: AudioEffectKind): Promise<void> {
    const ctx = this.audioCtx
    const chain = entry.chain
    if (!ctx || !chain) return
    const inserts: AudioWorkletNode[] = []
    if (PITCH_SEMITONES[effect]) {
      const node = await ensurePitchNode(ctx, PITCH_SEMITONES[effect] ?? 0)
      if (this.audioCtx !== ctx || entry.chain !== chain) return
      if (node) inserts.push(node)
    }
    if (chain.denoiseKey) {
      const [rate, mode] = chain.denoiseKey.split('|')
      const node = await ensureDenoiseNode(ctx, {
        enabled: true,
        rate: Number(rate) / 100,
        mode: mode as DenoiseMode
      })
      if (this.audioCtx !== ctx || entry.chain !== chain) return
      if (node) inserts.push(node)
    }
    if (inserts.length === 0) return
    try {
      chain.output.disconnect(ctx.destination)
    } catch {
      /* not connected */
    }
    let prev: AudioNode = chain.output
    for (const node of inserts) {
      prev.connect(node)
      prev = node
      chain.extra.push(node)
    }
    prev.connect(ctx.destination)
  }

  private ensureEntry(key: string, clip: Clip, asset: MediaAsset): Entry {
    const existing = this.entries.get(key)
    if (existing) return existing
    const url = mediaUrlOf(asset, clip.kind !== 'image')
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
    this.entries.set(key, entry)
    return entry
  }

  private playbackSource: FrameMediaSource = {
    getFrame: (clip, asset, sourceTime): DecodedFrame | null => {
      if (clip.kind === 'image') {
        const entry = this.ensureEntry(clip.id, clip, asset)
        const img = entry.image!
        if (!img.complete || img.naturalWidth === 0) return null
        return { image: img, width: img.naturalWidth, height: img.naturalHeight }
      }
      const entry = this.ensureEntry(clip.id, clip, asset)
      const el = entry.element as HTMLVideoElement
      if (el.readyState < 2) return null
      return { image: el, width: el.videoWidth, height: el.videoHeight }
    },
    getFrameNearEnd: (clip, asset): DecodedFrame | null => {
      if (clip.kind === 'image') {
        return this.playbackSource.getFrame(clip, asset, 0)
      }
      const entry = this.ensureEntry(clip.id, clip, asset)
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
    for (const clip of track.clips) {
      if (clip.compound) {
        // Nested clips extend their own bound; count them too.
        for (const inner of clip.compound.tracks) {
          for (const ic of inner.clips) end = Math.max(end, clip.start + ic.start + ic.duration)
        }
      }
      end = Math.max(end, clip.start + clip.duration)
    }
  }
  return end
}

function mediaUrlOf(asset: MediaAsset, preferProxy = false): string {
  // Preview-only: a generated proxy file scrubs far smoother on heavy 4K+.
  if (preferProxy && asset.kind === 'video' && asset.proxyPath) {
    return `media://local?f=${encodeURIComponent(asset.proxyPath)}`
  }
  return `media://local?f=${encodeURIComponent(asset.path)}`
}
