import type { Clip, ClipEffect, Compound, EffectKind, Mask, MediaAsset, ProjectDocument, TextAnimationKind, Track } from '@shared/document'
import { clipFadeMultiplier, clipSourceTime, cssFilterString, sampleKeyframes } from '@shared/document'
import { colorGrade } from '../color/colorGrade'

const EMOJI_FONT = `'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`

export interface DecodedFrame {
  image: CanvasImageSource
  width: number
  height: number
}

/**
 * Abstraction over "give me pixels for this clip at this source time".
 * Playback uses HTML media elements; export uses mediabunny decoders.
 */
export interface FrameMediaSource {
  getFrame(clip: Clip, asset: MediaAsset, sourceTime: number): DecodedFrame | null
  /** Optional: last frame of the previous clip, for transition crossfades. */
  getFrameNearEnd(clip: Clip, asset: MediaAsset): DecodedFrame | null
}

// ---------------------------------------------------------------------------
// Clip effects (CapCut-style "Hiệu ứng")
// ---------------------------------------------------------------------------

export interface EffectPassState {
  /** Extra blur (px at 1080p scale) applied to the clip itself. */
  blurPx: number
  /** Extra scale multiplier on top of the clip's own transform. */
  zoom: number
  /** Position jitter in px (shake). */
  dx: number
  dy: number
  /** Overlay/secondary passes that need the rendered base frame. */
  passes: Array<{ kind: EffectKind; intensity: number; p: number }>
}

const EMPTY_EFFECTS: EffectPassState = { blurPx: 0, zoom: 1, dx: 0, dy: 0, passes: [] }

export function activeEffects(clip: Clip, time: number): EffectPassState {
  const list = clip.effects
  if (!list || list.length === 0) return EMPTY_EFFECTS
  const local = time - clip.start
  const state: EffectPassState = { blurPx: 0, zoom: 1, dx: 0, dy: 0, passes: [] }
  for (const eff of list) {
    if (local < eff.start || local >= eff.start + eff.duration) continue
    const p = Math.min(1, Math.max(0, (local - eff.start) / Math.max(0.01, eff.duration)))
    const k = eff.intensity
    switch (eff.kind) {
      case 'blur':
        state.blurPx += 24 * k
        break
      case 'zoom': {
        // Gentle pulse: scale peaks mid-effect.
        const wave = Math.sin(p * Math.PI)
        state.zoom *= 1 + 0.35 * k * wave
        break
      }
      case 'shake': {
        const t = time * 22
        state.dx += Math.sin(t * 1.7) * 26 * k
        state.dy += Math.cos(t * 2.3) * 20 * k
        break
      }
      case 'glow':
      case 'flash':
      case 'mirror':
      case 'vignette':
      case 'grain':
      case 'pixelate':
      case 'glitch':
      case 'dreamy':
      case 'light-leak':
      case 'rgbsplit':
        state.passes.push({ kind: eff.kind, intensity: k, p })
        break
    }
  }
  return state
}

let noisePattern: CanvasPattern | null = null
function getNoisePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (noisePattern) return noisePattern
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const nctx = c.getContext('2d')!
  const img = nctx.createImageData(128, 128)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255)
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  nctx.putImageData(img, 0, 0)
  noisePattern = ctx.createPattern(c, 'repeat')
  return noisePattern
}

const scratchCanvases: HTMLCanvasElement[] = []
function getScratch(index: number, w: number, h: number): HTMLCanvasElement {
  let c = scratchCanvases[index]
  if (!c) {
    c = document.createElement('canvas')
    scratchCanvases[index] = c
  }
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  return c
}

// ---------------------------------------------------------------------------
// Chroma key (green screen)
// ---------------------------------------------------------------------------

const keyedCache = new Map<string, HTMLCanvasElement>()
const KEYED_CACHE_MAX = 6

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 180, 80]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Key out `chroma.color` from the cropped source region. Returns a canvas of
 * the region with keyed pixels made transparent. Results are cached per clip
 * frame to keep realtime playback affordable.
 */
function getKeyedSource(
  clipId: string,
  frame: DecodedFrame,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  chroma: { color: string; similarity: number; smoothness: number; spill: number }
): HTMLCanvasElement | null {
  const cacheKey = `${clipId}|${sx.toFixed(0)},${sy.toFixed(0)},${sw.toFixed(0)},${sh.toFixed(0)}|${chroma.color}|${chroma.similarity.toFixed(3)}|${chroma.smoothness.toFixed(3)}|${chroma.spill.toFixed(3)}`
  const cached = keyedCache.get(cacheKey)
  if (cached) return cached

  const w = Math.max(1, Math.round(sw))
  const h = Math.max(1, Math.round(sh))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(frame.image, sx, sy, sw, sh, 0, 0, w, h)
  } catch {
    return null
  }
  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data
  const [kr, kg, kb] = hexToRgb(chroma.color)
  const sim = Math.min(1, Math.max(0, chroma.similarity))
  const smooth = Math.min(1, Math.max(0, chroma.smoothness))
  const spill = Math.min(1, Math.max(0, chroma.spill))
  const cutEnd = sim + Math.max(0.001, smooth)
  // Dominant key channel, for spill suppression on surviving pixels.
  const keyMax = Math.max(kr, kg, kb)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const dr = r - kr
    const dg = g - kg
    const db = b - kb
    const dist = Math.sqrt((dr * dr + dg * dg + db * db) / 3) / 255
    if (dist < sim) {
      data[i + 3] = 0
    } else if (dist < cutEnd) {
      const t = (dist - sim) / (cutEnd - sim)
      data[i + 3] = Math.round(data[i + 3] * t)
      // Suppress key-color spill proportionally to how close we are to the key.
      const spillFactor = 1 - spill * (1 - t)
      if (keyMax === g && g > Math.max(r, b)) data[i + 1] = Math.round(Math.max(r, b) + (g - Math.max(r, b)) * spillFactor)
      else if (keyMax === r && r > Math.max(g, b)) data[i] = Math.round(Math.max(g, b) + (r - Math.max(g, b)) * spillFactor)
      else if (keyMax === b && b > Math.max(r, g)) data[i + 2] = Math.round(Math.max(r, g) + (b - Math.max(r, g)) * spillFactor)
    }
  }
  ctx.putImageData(img, 0, 0)
  keyedCache.set(cacheKey, canvas)
  if (keyedCache.size > KEYED_CACHE_MAX) {
    const oldest = keyedCache.keys().next().value
    if (oldest !== undefined) keyedCache.delete(oldest)
  }
  return canvas
}

// ---------------------------------------------------------------------------
// Shape masks
// ---------------------------------------------------------------------------

function maskShapePath(ctx: CanvasRenderingContext2D, mask: Mask, rw: number, rh: number): void {
  ctx.beginPath()
  switch (mask.shape) {
    case 'circle':
      ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2)
      break
    case 'rectangle':
      ctx.rect(-rw, -rh, rw * 2, rh * 2)
      break
    case 'triangle':
      ctx.moveTo(0, -rh)
      ctx.lineTo(-rw, rh * 0.85)
      ctx.lineTo(rw, rh * 0.85)
      ctx.closePath()
      break
    case 'star': {
      const outer = rw
      const inner = outer * 0.45
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outer : inner
        const angle = (Math.PI / 5) * i - Math.PI / 2
        const px = Math.cos(angle) * radius
        const py = Math.sin(angle) * radius * (rh / Math.max(1e-6, rw))
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      break
    }
    case 'heart':
      ctx.moveTo(0, rh * 0.62)
      ctx.bezierCurveTo(-rw * 0.95, rh * 0.05, -rw * 0.72, -rh * 0.75, 0, -rh * 0.28)
      ctx.bezierCurveTo(rw * 0.72, -rh * 0.75, rw * 0.95, rh * 0.05, 0, rh * 0.62)
      ctx.closePath()
      break
    default:
      ctx.rect(-rw, -rh, rw * 2, rh * 2)
  }
}

/**
 * Apply a feathered shape mask to a full-frame scratch canvas holding the
 * clip's rendered content, using destination-in/out compositing.
 */
function applyMask(target: CanvasRenderingContext2D, mask: Mask, W: number, H: number, scratchIndex: number): void {
  const maskCanvas = getScratch(scratchIndex, W, H)
  const mctx = maskCanvas.getContext('2d')!
  mctx.setTransform(1, 0, 0, 1, 0, 0)
  mctx.globalCompositeOperation = 'source-over'
  mctx.clearRect(0, 0, W, H)
  mctx.fillStyle = '#ffffff'

  if (mask.shape === 'linear') {
    // Wipe band along the rotated axis: soft edges sized by feather.
    mctx.translate(mask.cx * W, mask.cy * H)
    mctx.rotate((mask.rotation * Math.PI) / 180)
    const rw = Math.max(2, mask.rx * W)
    const f = Math.min(0.49, Math.max(0.001, mask.feather))
    const g = mctx.createLinearGradient(-rw, 0, rw, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(f, '#ffffff')
    g.addColorStop(1 - f, '#ffffff')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    mctx.fillStyle = g
    const diag = Math.sqrt(W * W + H * H)
    mctx.fillRect(-diag, -diag, diag * 2, diag * 2)
  } else {
    mctx.translate(mask.cx * W, mask.cy * H)
    mctx.rotate((mask.rotation * Math.PI) / 180)
    const rw = Math.max(2, mask.rx * W)
    const rh = Math.max(2, mask.ry * H)
    const featherPx = Math.min(120, mask.feather * Math.min(rw, rh))
    if (featherPx >= 1) mctx.filter = `blur(${featherPx.toFixed(1)}px)`
    maskShapePath(mctx, mask, rw, rh)
    mctx.fill()
    mctx.filter = 'none'
  }

  target.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in'
  target.drawImage(maskCanvas, 0, 0)
  target.globalCompositeOperation = 'source-over'
}

/** Draw overlay / composite passes for the active effects of a clip. */
export function drawEffectPasses(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  time: number,
  W: number,
  H: number,
  drawBase: (target: CanvasRenderingContext2D) => void
): void {
  const state = activeEffects(clip, time)
  for (const pass of state.passes) {
    const k = pass.intensity
    switch (pass.kind) {
      case 'flash': {
        const wave = Math.sin(pass.p * Math.PI)
        ctx.save()
        ctx.globalAlpha = Math.min(1, 0.85 * k * wave)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, W, H)
        ctx.restore()
        break
      }
      case 'vignette': {
        ctx.save()
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(1, `rgba(0,0,0,${0.75 * k})`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
        ctx.restore()
        break
      }
      case 'grain': {
        const pattern = getNoisePattern(ctx)
        if (pattern) {
          ctx.save()
          ctx.globalAlpha = 0.16 * k
          ctx.globalCompositeOperation = 'overlay'
          ctx.fillStyle = pattern
          const jitter = (Math.floor(time * 24) % 7) * 13
          ctx.translate(-jitter, -jitter)
          ctx.fillRect(0, 0, W + 128, H + 128)
          ctx.restore()
        }
        break
      }
      case 'light-leak': {
        ctx.save()
        const g = ctx.createLinearGradient(0, 0, W, H)
        const a = 0.4 * k * (0.7 + 0.3 * Math.sin(pass.p * Math.PI))
        g.addColorStop(0, `rgba(255,170,60,${a})`)
        g.addColorStop(0.5, 'rgba(255,120,40,0)')
        g.addColorStop(1, `rgba(255,220,150,${a * 0.6})`)
        ctx.globalCompositeOperation = 'screen'
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
        ctx.restore()
        break
      }
      case 'glow':
      case 'dreamy': {
        // Base redrawn blurred and composited additively (bloom).
        const scratch = getScratch(0, W, H)
        const sctx = scratch.getContext('2d')!
        sctx.clearRect(0, 0, W, H)
        sctx.filter = `blur(${Math.round(Math.min(40, 6 + 26 * k))}px) brightness(${pass.kind === 'dreamy' ? 1.25 : 1.15})`
        drawBase(sctx)
        sctx.filter = 'none'
        ctx.save()
        ctx.globalAlpha = pass.kind === 'dreamy' ? 0.55 * k : 0.5 * k
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(scratch, 0, 0)
        ctx.restore()
        break
      }
      case 'mirror': {
        const scratch = getScratch(0, W, H)
        const sctx = scratch.getContext('2d')!
        sctx.clearRect(0, 0, W, H)
        drawBase(sctx)
        ctx.save()
        ctx.globalAlpha = 0.55 * k
        ctx.translate(W, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(scratch, 0, 0)
        ctx.restore()
        break
      }
      case 'pixelate': {
        const base = getScratch(0, W, H)
        const bctx = base.getContext('2d')!
        bctx.clearRect(0, 0, W, H)
        drawBase(bctx)
        const sw = Math.max(2, Math.round(W / (4 + 20 * k)))
        const sh = Math.max(2, Math.round(H / (4 + 20 * k)))
        const small = getScratch(1, sw, sh)
        const smallCtx = small.getContext('2d')!
        smallCtx.clearRect(0, 0, sw, sh)
        smallCtx.drawImage(base, 0, 0, sw, sh)
        bctx.imageSmoothingEnabled = false
        bctx.drawImage(small, 0, 0, sw, sh, 0, 0, W, H)
        bctx.imageSmoothingEnabled = true
        ctx.save()
        ctx.globalAlpha = Math.min(1, 0.35 + 0.65 * k)
        ctx.drawImage(base, 0, 0)
        ctx.restore()
        break
      }
      case 'glitch': {
        const scratch = getScratch(0, W, H)
        const sctx = scratch.getContext('2d')!
        sctx.clearRect(0, 0, W, H)
        drawBase(sctx)
        ctx.save()
        const sliceH = H / 12
        for (let i = 0; i < 12; i++) {
          const seed = Math.floor(time * 12) * 31 + i * 7
          const offset = ((seed % 100) / 100 - 0.5) * 90 * k
          const hue = (seed % 2 === 0 ? 60 : -60) * k
          ctx.filter = `hue-rotate(${hue}deg) saturate(1.6)`
          ctx.drawImage(scratch, 0, i * sliceH, W, sliceH, offset, i * sliceH, W, sliceH)
        }
        ctx.filter = 'none'
        ctx.restore()
        break
      }
      case 'rgbsplit': {
        // Chromatic aberration: three tinted, offset copies of the base frame.
        const scratch = getScratch(0, W, H)
        const sctx = scratch.getContext('2d')!
        sctx.clearRect(0, 0, W, H)
        drawBase(sctx)
        ctx.save()
        const off = 8 * k * (Math.min(W, H) / 1080)
        const copies: Array<{ dx: number; filter: string; alpha: number }> = [
          { dx: -off, filter: 'sepia(1) saturate(9) hue-rotate(-55deg)', alpha: 0.45 },
          { dx: 0, filter: 'none', alpha: 0.6 },
          { dx: off, filter: 'sepia(1) saturate(9) hue-rotate(150deg)', alpha: 0.45 }
        ]
        for (const copy of copies) {
          ctx.globalAlpha = copy.alpha * k
          ctx.filter = copy.filter
          ctx.drawImage(scratch, copy.dx, 0)
        }
        ctx.globalAlpha = 1
        ctx.filter = 'none'
        ctx.restore()
        break
      }
    }
  }
}

function activeClipAt(track: Track, time: number): Clip | null {
  for (const clip of track.clips) {
    if (time >= clip.start && time < clip.start + clip.duration) return clip
  }
  return null
}

function clipEndingAt(track: Track, clip: Clip): Clip | null {
  let best: Clip | null = null
  for (const other of track.clips) {
    if (other.id === clip.id) continue
    const end = other.start + other.duration
    if (end <= clip.start + 0.02 && end >= clip.start - 0.5) {
      if (!best || end > best.start + best.duration) best = other
    }
  }
  return best
}

function drawImageClip(
  ctx: CanvasRenderingContext2D,
  frame: DecodedFrame,
  clip: Clip,
  doc: ProjectDocument,
  time: number,
  extraAlpha: number,
  eff: EffectPassState = EMPTY_EFFECTS
) {
  const W = doc.settings.width
  const H = doc.settings.height
  const keyframed = sampleKeyframes(clip, time)
  const transform = clip.transform
  const crop = transform.crop
  const cropLeft = Math.min(0.9, Math.max(0, crop.left))
  const cropRight = Math.min(0.9 - cropLeft, Math.max(0, crop.right))
  const cropTop = Math.min(0.9, Math.max(0, crop.top))
  const cropBottom = Math.min(0.9 - cropTop, Math.max(0, crop.bottom))

  // Chroma keying happens on the source pixels, before any transform.
  let image: CanvasImageSource = frame.image
  let sx = frame.width * cropLeft
  let sy = frame.height * cropTop
  let sw = Math.max(1, frame.width * (1 - cropLeft - cropRight))
  let sh = Math.max(1, frame.height * (1 - cropTop - cropBottom))
  const chroma = clip.chromaKey
  if (chroma?.enabled) {
    const keyed = getKeyedSource(clip.id, frame, sx, sy, sw, sh, chroma)
    if (keyed) {
      image = keyed
      sx = 0
      sy = 0
      sw = keyed.width
      sh = keyed.height
    }
  }

  // Advanced grading (curves / color wheels / .cube LUT) right after keying,
  // on source pixels — before transform/mask. Gracefully skipped when WebGL2
  // or the LUT aren't available.
  if (clip.colorAdvanced?.enabled) {
    const graded = colorGrade(image, sx, sy, sw, sh, clip.colorAdvanced)
    if (graded) {
      image = graded
      sx = 0
      sy = 0
      sw = graded.width
      sh = graded.height
    }
  }

  const fade = clipFadeMultiplier(clip, time)
  const alpha = keyframed.opacity * fade * extraAlpha
  if (alpha <= 0.001) return

  const mask = clip.mask
  const needsMask = !!mask && mask.shape !== 'none'
  const blend = clip.blendMode && clip.blendMode !== 'normal' ? clip.blendMode : null

  const fit = Math.min(W / sw, H / sh) * keyframed.scale * eff.zoom
  const dw = sw * fit
  const dh = sh * fit
  // Effect blur is calibrated at 1080p; scale with the canvas.
  const blurScale = Math.min(W, H) / 1080
  const cx = W / 2 + keyframed.x * W + eff.dx * blurScale
  const cy = H / 2 + keyframed.y * H + eff.dy * blurScale

  const drawCore = (target: CanvasRenderingContext2D) => {
    target.save()
    // Preserve any filter the caller already set (e.g. bloom blur), then add
    // the clip's color filters and effect blur on top.
    const existing = target.filter && target.filter !== 'none' ? `${target.filter} ` : ''
    const colorFilter = cssFilterString(clip.filters)
    const blurPx = eff.blurPx > 0 ? `blur(${(eff.blurPx * blurScale).toFixed(1)}px)` : ''
    const combined = [existing, colorFilter === 'none' ? '' : colorFilter, blurPx]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (combined) target.filter = combined
    target.translate(cx, cy)
    target.rotate((keyframed.rotation * Math.PI) / 180)
    target.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1)
    try {
      target.drawImage(image, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh)
    } catch {
      // frame not ready — skip
    }
    target.restore()
  }

  if (!needsMask) {
    ctx.save()
    ctx.globalAlpha = alpha
    if (blend) ctx.globalCompositeOperation = blend
    drawCore(ctx)
    ctx.restore()
    return
  }

  // Masked clips render into a full-frame scratch canvas, get their alpha cut
  // by the mask shape, then composite onto the scene (honoring blend mode).
  const scratch = getScratch(2, W, H)
  const sctx = scratch.getContext('2d')!
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.globalAlpha = 1
  sctx.globalCompositeOperation = 'source-over'
  sctx.filter = 'none'
  sctx.clearRect(0, 0, W, H)
  drawCore(sctx)
  applyMask(sctx, mask!, W, H, 3)
  ctx.save()
  ctx.globalAlpha = alpha
  if (blend) ctx.globalCompositeOperation = blend
  ctx.drawImage(scratch, 0, 0)
  ctx.restore()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate
      } else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const x = Math.min(1, Math.max(0, t))
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

function easeOutBounce(t: number): number {
  let x = Math.min(1, Math.max(0, t))
  const n1 = 7.5625
  const d1 = 2.75
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

interface TextAnimState {
  alpha: number
  dx: number
  dy: number
  scale: number
  /** 0..1 progress for typewriter slicing (1 = full text). */
  chars: number
}

function textAnimState(clip: Clip, time: number): TextAnimState {
  const text = clip.text!
  const state: TextAnimState = { alpha: 1, dx: 0, dy: 0, scale: 1, chars: 1 }
  const anim = text.animation
  if (!anim || (anim.in === 'none' && anim.out === 'none')) return state
  const d = Math.max(0.05, anim.duration)
  const local = time - clip.start
  const apply = (kind: TextAnimationKind, p: number, dir: 1 | -1) => {
    if (kind === 'none' || p >= 1) return
    const q = Math.min(1, Math.max(0, p))
    switch (kind) {
      case 'fade':
        state.alpha *= q
        break
      case 'slide-up':
        state.dy += (1 - q) * 0.08 * dir
        state.alpha *= Math.min(1, q * 1.6)
        break
      case 'slide-down':
        state.dy -= (1 - q) * 0.08 * dir
        state.alpha *= Math.min(1, q * 1.6)
        break
      case 'slide-left':
        state.dx += (1 - q) * 0.1 * dir
        state.alpha *= Math.min(1, q * 1.6)
        break
      case 'slide-right':
        state.dx -= (1 - q) * 0.1 * dir
        state.alpha *= Math.min(1, q * 1.6)
        break
      case 'zoom':
        state.scale *= 0.6 + 0.4 * q
        state.alpha *= q
        break
      case 'pop':
        state.scale *= 0.4 + 0.6 * easeOutBack(q)
        state.alpha *= Math.min(1, q * 2)
        break
      case 'bounce':
        state.dy -= (1 - easeOutBounce(q)) * 0.06
        break
      case 'typewriter':
        state.chars = Math.min(state.chars, q)
        break
    }
  }
  if (anim.in !== 'none' && local < d) apply(anim.in, local / d, 1)
  if (anim.out !== 'none' && local > clip.duration - d) apply(anim.out, (clip.duration - local) / d, -1)
  return state
}

function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  doc: ProjectDocument,
  time: number,
  extraAlpha: number
) {
  const text = clip.text
  if (!text || !text.content.trim()) return
  const W = doc.settings.width
  const H = doc.settings.height
  const keyframed = sampleKeyframes(clip, time)
  const fade = clipFadeMultiplier(clip, time)
  const anim = textAnimState(clip, time)
  const alpha = keyframed.opacity * fade * extraAlpha * anim.alpha
  if (alpha <= 0.001) return

  const content =
    anim.chars >= 1 ? text.content : text.content.slice(0, Math.max(1, Math.ceil(text.content.length * anim.chars)))

  const fontSize = text.fontSize * H * Math.max(0.05, keyframed.scale) * anim.scale
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textBaseline = 'middle'
  ctx.font = `${text.italic ? 'italic ' : ''}${text.bold ? '700 ' : '400 '}${fontSize}px ${text.fontFamily}`
  const maxWidth = text.maxWidth * W
  const lines = wrapText(ctx, content, maxWidth)
  const lineHeight = fontSize * text.lineHeight
  const totalHeight = lines.length * lineHeight
  const anchorX = text.x * W + anim.dx * W
  const anchorY = text.y * H + anim.dy * H
  ctx.translate(anchorX, anchorY)
  ctx.rotate(((keyframed.rotation + text.rotation) * Math.PI) / 180)

  let textAlign: CanvasTextAlign = 'center'
  let offsetX = 0
  if (text.align === 'left') {
    textAlign = 'left'
    offsetX = -maxWidth / 2
  } else if (text.align === 'right') {
    textAlign = 'right'
    offsetX = maxWidth / 2
  }
  ctx.textAlign = textAlign

  if (text.backgroundColor) {
    const boxWidth = Math.min(maxWidth, Math.max(...lines.map((l) => ctx.measureText(l).width))) + fontSize * 0.5
    const boxX = text.align === 'left' ? offsetX - fontSize * 0.25 : text.align === 'right' ? offsetX - boxWidth + fontSize * 0.25 : -boxWidth / 2
    ctx.fillStyle = text.backgroundColor
    ctx.fillRect(boxX, -totalHeight / 2 - fontSize * 0.15, boxWidth, totalHeight + fontSize * 0.3)
  }

  lines.forEach((line, i) => {
    const y = -totalHeight / 2 + lineHeight / 2 + i * lineHeight
    if (text.strokeWidth > 0) {
      ctx.lineJoin = 'round'
      ctx.strokeStyle = text.strokeColor
      ctx.lineWidth = fontSize * text.strokeWidth
      ctx.strokeText(line, offsetX, y)
    }
    ctx.fillStyle = text.color
    ctx.fillText(line, offsetX, y)
  })
  ctx.restore()
}

function drawStickerClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  doc: ProjectDocument,
  time: number,
  extraAlpha: number
) {
  const st = clip.sticker
  if (!st || !st.emoji) return
  const W = doc.settings.width
  const H = doc.settings.height
  const keyframed = sampleKeyframes(clip, time)
  const fade = clipFadeMultiplier(clip, time)
  const alpha = st.opacity * keyframed.opacity * fade * extraAlpha
  if (alpha <= 0.001) return

  const size = st.size * H * Math.max(0.05, keyframed.scale)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `${size}px ${EMOJI_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(st.x * W + keyframed.x * W, st.y * H + keyframed.y * H)
  ctx.rotate(((st.rotation + keyframed.rotation) * Math.PI) / 180)
  ctx.scale(st.flipX ? -1 : 1, 1)
  try {
    ctx.fillText(st.emoji, 0, 0)
  } catch {
    // font not ready — skip
  }
  ctx.restore()
}

/**
 * Draw one composited frame of the project at `time` onto ctx (which must be
 * sized to doc.settings.width/height).
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDocument,
  time: number,
  source: FrameMediaSource
): void {
  renderTracks(ctx, doc, time, source, true)
}

/** Core track walk shared by the top-level frame and compound-clip drawing. */
function renderTracks(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDocument,
  time: number,
  source: FrameMediaSource,
  fillBg: boolean
): void {
  const W = doc.settings.width
  const H = doc.settings.height
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  if (fillBg) {
    ctx.fillStyle = doc.settings.backgroundColor
    ctx.fillRect(0, 0, W, H)
  }

  // Draw back layers first: the END of the tracks array is the bottom row.
  for (let ti = doc.tracks.length - 1; ti >= 0; ti--) {
    const track = doc.tracks[ti]
    if (track.hidden || track.kind === 'audio') continue
    const clip = activeClipAt(track, time)
    if (!clip) continue

    let extraAlpha = 1
    let transformOverride: ((c: CanvasRenderingContext2D) => void) | null = null
    let snapshot: DecodedFrame | null = null
    /** True when the transition case pushed a ctx.save() that wraps drawing. */
    let transitionCtxSave = false
    /** True when the transition case pushed a rect clip that wraps drawing. */
    let wipeClip = false

    if (clip.transitionIn && time < clip.start + clip.transitionIn.duration) {
      const p = Math.min(1, (time - clip.start) / Math.max(0.01, clip.transitionIn.duration))
      const prev = clipEndingAt(track, clip)
      const prevAsset = prev?.assetId ? doc.mediaLibrary.find((a) => a.id === prev.assetId) : undefined
      if (prev && prevAsset) {
        snapshot = source.getFrameNearEnd(prev, prevAsset)
      }
      switch (clip.transitionIn.type) {
        case 'crossfade':
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1 - p)
          extraAlpha = p
          break
        case 'fade-black':
          extraAlpha = p
          break
        case 'fade-white':
          extraAlpha = p
          ctx.save()
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, W, H)
          ctx.restore()
          break
        case 'slide-left':
          transformOverride = (c) => c.translate((1 - p) * W, 0)
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          break
        case 'slide-right':
          transformOverride = (c) => c.translate(-(1 - p) * W, 0)
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          break
        case 'slide-up':
          transformOverride = (c) => c.translate(0, (1 - p) * H)
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          break
        case 'slide-down':
          transformOverride = (c) => c.translate(0, -(1 - p) * H)
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          break
        case 'wipe-right':
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, 0, W * p, H)
          ctx.clip()
          transformOverride = null
          wipeClip = true
          break
        case 'wipe-left':
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.beginPath()
          ctx.rect(W * (1 - p), 0, W * p, H)
          ctx.clip()
          transformOverride = null
          wipeClip = true
          break
        case 'wipe-up':
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, H * (1 - p), W, H * p)
          ctx.clip()
          transformOverride = null
          wipeClip = true
          break
        case 'wipe-down':
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, 0, W, H * p)
          ctx.clip()
          transformOverride = null
          wipeClip = true
          break
        case 'zoom-in': {
          // Incoming grows from 55% to full size over the outgoing clip.
          const s = 0.55 + 0.45 * p
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.translate(W / 2, H / 2)
          ctx.scale(s, s)
          ctx.translate(-W / 2, -H / 2)
          extraAlpha = p
          transformOverride = null
          transitionCtxSave = true
          break
        }
        case 'spin': {
          // Incoming rotates in from a quarter turn.
          const angle = (1 - p) * 90
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.translate(W / 2, H / 2)
          ctx.rotate((angle * Math.PI) / 180)
          ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p)
          ctx.translate(-W / 2, -H / 2)
          extraAlpha = p
          transformOverride = null
          transitionCtxSave = true
          break
        }
        case 'blur-cross': {
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1 - p)
          ctx.save()
          ctx.filter = `blur(${((1 - p) * 24 * (Math.min(W, H) / 1080)).toFixed(1)}px)`
          extraAlpha = p
          transformOverride = null
          transitionCtxSave = true
          break
        }
        case 'zoom-out': {
          // Incoming shrinks from oversized to fit.
          const s = 1.45 - 0.45 * p
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.translate(W / 2, H / 2)
          ctx.scale(s, s)
          ctx.translate(-W / 2, -H / 2)
          extraAlpha = p
          transformOverride = null
          transitionCtxSave = true
          break
        }
        case 'whip-pan': {
          // Fast horizontal pan with motion blur on the incoming clip.
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.translate(p * W, 0)
          ctx.filter = `blur(${(Math.sin(p * Math.PI) * 14 * (Math.min(W, H) / 1080)).toFixed(1)}px)`
          extraAlpha = 1
          transformOverride = null
          transitionCtxSave = true
          break
        }
        case 'circle-open': {
          if (snapshot) drawImageClip(ctx, snapshot, prev!, doc, time, 1)
          ctx.save()
          ctx.beginPath()
          ctx.arc(W / 2, H / 2, p * Math.sqrt(W * W + H * H) * 0.6, 0, Math.PI * 2)
          ctx.clip()
          transformOverride = null
          wipeClip = true
          break
        }
      }
    }

    if (transitionCtxSave || transformOverride) {
      ctx.save()
      if (transformOverride) transformOverride(ctx)
      drawWithOverride(ctx, doc, time, clip, source, extraAlpha)
      ctx.restore()
    } else {
      drawClipContent(ctx, doc, time, clip, source, extraAlpha)
    }

    if (transitionCtxSave) {
      ctx.restore() // matching the save inside the transition case
      ctx.filter = 'none'
    } else if (wipeClip) {
      ctx.restore() // matching the clip rect save above
    }
  }
  ctx.restore()
}

function drawWithOverride(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDocument,
  time: number,
  clip: Clip,
  source: FrameMediaSource,
  extraAlpha: number
) {
  drawClipContent(ctx, doc, time, clip, source, extraAlpha)
}

/**
 * Draw a compound (nested) clip: renders its inner tracks into a scratch
 * canvas with a recursive track walk, then composites it like any media clip
 * (keyframe transform, blend, mask, fade). Inner time runs 0..compound.duration.
 */
function drawCompoundClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  doc: ProjectDocument,
  time: number,
  source: FrameMediaSource,
  extraAlpha: number
): void {
  const compound = clip.compound as Compound
  const W = doc.settings.width
  const H = doc.settings.height
  const innerTime = Math.min(compound.duration, Math.max(0, time - clip.start))
  const keyframed = sampleKeyframes(clip, time)
  const fade = clipFadeMultiplier(clip, time)
  const alpha = keyframed.opacity * fade * extraAlpha
  if (alpha <= 0.001) return

  const scratch = getScratch(4, W, H)
  const sctx = scratch.getContext('2d')!
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.globalAlpha = 1
  sctx.globalCompositeOperation = 'source-over'
  sctx.filter = 'none'
  sctx.clearRect(0, 0, W, H)
  renderTracks(sctx, { ...doc, tracks: compound.tracks }, innerTime, source, false)

  const transform = clip.transform
  // Compounds scale/rotate as a whole; per-edge crop is not applied to inner
  // content (inner clips can crop individually).
  const fit = Math.max(0.05, keyframed.scale)
  const dw = W * fit
  const dh = H * fit
  const cx = W / 2 + keyframed.x * W
  const cy = H / 2 + keyframed.y * H

  const mask = clip.mask
  const needsMask = !!mask && mask.shape !== 'none'
  const blend = clip.blendMode && clip.blendMode !== 'normal' ? clip.blendMode : null

  const blit = (target: CanvasRenderingContext2D, src: HTMLCanvasElement) => {
    target.save()
    target.globalAlpha = alpha
    if (blend) target.globalCompositeOperation = blend
    target.translate(cx, cy)
    target.rotate((keyframed.rotation * Math.PI) / 180)
    target.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1)
    try {
      target.drawImage(src, -dw / 2, -dh / 2, dw, dh)
    } catch {
      // scratch not ready — skip
    }
    target.restore()
  }

  if (!needsMask) {
    blit(ctx, scratch)
    return
  }
  // Masking needs a second full-frame scratch to hold the transformed content.
  const out = getScratch(5, W, H)
  const octx = out.getContext('2d')!
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.globalAlpha = 1
  octx.globalCompositeOperation = 'source-over'
  octx.filter = 'none'
  octx.clearRect(0, 0, W, H)
  blit(octx, scratch)
  applyMask(octx, mask!, W, H, 6)
  ctx.save()
  ctx.globalAlpha = 1
  ctx.drawImage(out, 0, 0)
  ctx.restore()
}

function drawClipContent(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDocument,
  time: number,
  clip: Clip,
  source: FrameMediaSource,
  extraAlpha: number
) {
  if (clip.kind === 'text') {
    drawTextClip(ctx, clip, doc, time, extraAlpha)
    return
  }
  if (clip.kind === 'sticker') {
    drawStickerClip(ctx, clip, doc, time, extraAlpha)
    return
  }
  if (clip.compound) {
    drawCompoundClip(ctx, clip, doc, time, source, extraAlpha)
    return
  }
  const asset = clip.assetId ? doc.mediaLibrary.find((a) => a.id === clip.assetId) : null
  if (!asset) return
  const frame = source.getFrame(clip, asset, clipSourceTime(clip, time))
  if (!frame) return
  const eff = activeEffects(clip, time)
  drawImageClip(ctx, frame, clip, doc, time, extraAlpha, eff)
  if (eff.passes.length > 0) {
    drawEffectPasses(ctx, clip, time, doc.settings.width, doc.settings.height, (target) => {
      drawImageClip(target, frame, clip, doc, time, extraAlpha, eff)
    })
  }
}
