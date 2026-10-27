// Effect preview tiles, CapCut-style: every effect gets a small looping GIF
// that shows the real frame-renderer pipeline (blur/zoom/shake state + overlay
// passes) applied to an illustrated sample scene. The GIFs are baked offline
// in the renderer with our own GifEncoder — no external assets.
// Filter presets ("Bộ lọc") reuse the same sample scene as a static thumbnail.

import { useEffect, useState } from 'react'
import { createClip, type Clip } from '@shared/document'
import { activeEffects, drawEffectPasses } from '../core/render/frameRenderer'
import { GifEncoder } from '../core/export/gif'
import { EFFECT_CHIP_GRADIENT, type EffectCatalogEntry } from './effectCatalog'

const PREVIEW_W = 240
const PREVIEW_H = 160
const PREVIEW_FPS = 10
const PREVIEW_SCALE = Math.min(PREVIEW_W, PREVIEW_H) / 1080

// ---------------------------------------------------------------------------
// Sample scene: illustrated sunset with layered mountains and sea, varied
// colors so quantization, grain and chromatic effects read clearly.
// ---------------------------------------------------------------------------

function paintScene(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  // Sky gradient.
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62)
  sky.addColorStop(0, '#2b1055')
  sky.addColorStop(0.45, '#7c2f8e')
  sky.addColorStop(0.78, '#ff7b54')
  sky.addColorStop(1, '#ffd56b')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H * 0.66)

  // Stars.
  const starSeeds = [7, 21, 33, 48, 62, 75, 90, 104, 119, 131, 146, 159, 172, 189, 200, 214, 226]
  for (const s of starSeeds) {
    const x = (s * 37) % W
    const y = ((s * 53) % (H * 0.38)) | 0
    ctx.fillStyle = s % 3 === 0 ? '#ffe9a8' : '#ffffff'
    ctx.globalAlpha = 0.35 + ((s % 5) / 10)
    ctx.fillRect(x, y, s % 3 === 0 ? 2 : 1, s % 3 === 0 ? 2 : 1)
  }
  ctx.globalAlpha = 1

  // Sun.
  const sun = ctx.createRadialGradient(W * 0.68, H * 0.42, 2, W * 0.68, H * 0.42, H * 0.3)
  sun.addColorStop(0, '#fff7d6')
  sun.addColorStop(0.25, '#ffd24a')
  sun.addColorStop(1, 'rgba(255,120,60,0)')
  ctx.fillStyle = sun
  ctx.fillRect(W * 0.38, H * 0.12, W * 0.68, H * 0.62)
  ctx.beginPath()
  ctx.arc(W * 0.68, H * 0.42, H * 0.09, 0, Math.PI * 2)
  ctx.fillStyle = '#fff3b0'
  ctx.fill()

  // Distant mountains.
  ctx.fillStyle = '#5b3f97'
  drawHill(ctx, W, H * 0.62, H * 0.5, H * 0.62, 5, 0.7)
  // Sea.
  const sea = ctx.createLinearGradient(0, H * 0.62, 0, H)
  sea.addColorStop(0, '#3a1f6e')
  sea.addColorStop(1, '#1d1246')
  ctx.fillStyle = sea
  ctx.fillRect(0, H * 0.62, W, H * 0.38)
  // Sun reflection.
  ctx.fillStyle = 'rgba(255,200,110,0.35)'
  for (let i = 0; i < 7; i++) {
    const wave = H * 0.62 + 8 + i * ((H * 0.3) / 7)
    const width = W * (0.06 + i * 0.015)
    ctx.fillRect(W * 0.68 - width / 2, wave, width, 2)
  }
  // Near hills (dark silhouettes).
  ctx.fillStyle = '#3d2865'
  drawHill(ctx, W, H * 0.78, H * 0.24, H * 0.78, 4, 1.4)
  ctx.fillStyle = '#22143f'
  drawHill(ctx, W, H, H * 0.3, H + 2, 3, 2.1)

  // Palm-ish silhouettes on the left hill.
  drawPalm(ctx, W * 0.16, H * 0.79, H * 0.34)
  drawPalm(ctx, W * 0.27, H * 0.82, H * 0.26)
}

function drawHill(
  ctx: CanvasRenderingContext2D,
  W: number,
  baseY: number,
  amp: number,
  bottom: number,
  peaks: number,
  jiggle: number
): void {
  const waveK = 2.3 * Math.PI
  ctx.beginPath()
  ctx.moveTo(0, bottom)
  for (let i = 0; i <= peaks * 2; i++) {
    const x = (i / (peaks * 2)) * W
    const y = baseY - Math.sin(i * waveK + jiggle) * amp * (i % 2 === 0 ? 0.8 : 0.35)
    ctx.lineTo(x, Math.max(2, y))
  }
  ctx.lineTo(W, bottom)
  ctx.closePath()
  ctx.fill()
}

function drawPalm(ctx: CanvasRenderingContext2D, x: number, y: number, height: number): void {
  ctx.strokeStyle = '#1a0f33'
  ctx.lineWidth = Math.max(1.5, height * 0.05)
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(x + height * 0.12, y - height * 0.55, x + height * 0.2, y - height)
  ctx.stroke()
  const topX = x + height * 0.2
  const topY = y - height
  for (let leaf = -2; leaf <= 2; leaf++) {
    ctx.beginPath()
    ctx.moveTo(topX, topY)
    ctx.quadraticCurveTo(topX + leaf * height * 0.28, topY - height * 0.16, topX + leaf * height * 0.34, topY + height * 0.08)
    ctx.lineWidth = Math.max(1, height * 0.035)
    ctx.stroke()
  }
}

function sampleSceneCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PREVIEW_W
  canvas.height = PREVIEW_H
  paintScene(canvas.getContext('2d')!, PREVIEW_W, PREVIEW_H)
  return canvas
}

let sceneUrl: string | null = null
/** Static scene thumbnail for filter tiles (CapCut shows real imagery). */
export function sampleSceneDataUrl(): string | null {
  if (sceneUrl) return sceneUrl
  try {
    sceneUrl = sampleSceneCanvas().toDataURL('image/jpeg', 0.85)
    return sceneUrl
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// GIF baking for effect tiles
// ---------------------------------------------------------------------------

function fakeEffectClip(entry: EffectCatalogEntry): Clip {
  const clip = createClip({ kind: 'image', start: 0, duration: entry.duration })
  clip.effects = [
    { id: 'preview', kind: entry.kind, name: entry.name, start: 0, duration: entry.duration, intensity: entry.intensity }
  ]
  return clip
}

/** Mirrors drawImageClip's transform math at a preview-friendly scale. */
function renderPreviewFrame(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  scene: HTMLCanvasElement,
  W: number,
  H: number,
  time: number
): void {
  const eff = activeEffects(clip, time)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.clearRect(0, 0, W, H)

  const drawBase = (target: CanvasRenderingContext2D) => {
    target.save()
    const existing = target.filter && target.filter !== 'none' ? `${target.filter} ` : ''
    const blurPx = eff.blurPx > 0 ? `blur(${(eff.blurPx * PREVIEW_SCALE).toFixed(1)}px)` : ''
    const combined = `${existing}${blurPx}`.trim()
    if (combined) target.filter = combined
    target.translate(W / 2 + eff.dx * PREVIEW_SCALE, H / 2 + eff.dy * PREVIEW_SCALE)
    target.scale(eff.zoom, eff.zoom)
    try {
      target.drawImage(scene, -W / 2, -H / 2, W, H)
    } catch {
      /* not ready */
    }
    target.restore()
  }

  drawBase(ctx)
  if (eff.passes.length > 0) {
    drawEffectPasses(ctx, clip, time, W, H, drawBase)
  }
}

const baked = new Map<string, string>()
const pending = new Set<string>()
const subscribers = new Set<() => void>()
const queue: EffectCatalogEntry[] = []
let draining = false

function notifySubscribers(): void {
  for (const fn of [...subscribers]) fn()
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  while (queue.length > 0) {
    const entry = queue.shift()!
    try {
      baked.set(entry.id, await bakeEffectPreview(entry))
      notifySubscribers()
    } catch (e) {
      console.warn('[effectPreview] Không bake được preview cho', entry.id, e)
    }
    // Yield between bakes so the UI keeps responding.
    await new Promise((resolve) => setTimeout(resolve, 24))
  }
  draining = false
}

async function bakeEffectPreview(entry: EffectCatalogEntry): Promise<string> {
  const frames = Math.max(6, Math.min(24, Math.round(entry.duration * PREVIEW_FPS)))
  const scene = sampleSceneCanvas()
  const clip = fakeEffectClip(entry)
  const canvas = document.createElement('canvas')
  canvas.width = PREVIEW_W
  canvas.height = PREVIEW_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const step = entry.duration / frames
  const pixels: Uint8ClampedArray[] = []
  for (let i = 0; i < frames; i++) {
    renderPreviewFrame(ctx, clip, scene, PREVIEW_W, PREVIEW_H, i * step)
    pixels.push(ctx.getImageData(0, 0, PREVIEW_W, PREVIEW_H).data)
  }
  const encoder = new GifEncoder(PREVIEW_W, PREVIEW_H, PREVIEW_FPS)
  for (const px of pixels) encoder.addHistogramFrame(px)
  if (!encoder.finalizePalette()) throw new Error('Palette trống')
  for (const px of pixels) encoder.addFrame(px)
  const bytes = encoder.finishTrailer()
  let bin = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:image/gif;base64,${btoa(bin)}`
}

/**
 * React hook: returns the baked GIF data URL for an effect, queuing the bake
 * on first use. Falls back to null until ready (tile shows the gradient).
 */
export function useEffectPreviewDataUrl(entry: EffectCatalogEntry): string | null {
  const [value, setValue] = useState<string | null>(() => baked.get(entry.id) ?? null)
  useEffect(() => {
    if (baked.has(entry.id)) {
      setValue(baked.get(entry.id) ?? null)
      return
    }
    let alive = true
    const listener = () => {
      if (alive) setValue(baked.get(entry.id) ?? null)
    }
    subscribers.add(listener)
    if (!pending.has(entry.id)) {
      pending.add(entry.id)
      queue.push(entry)
    }
    void drainQueue()
    return () => {
      alive = false
      subscribers.delete(listener)
    }
  }, [entry.id])
  return value
}

export function effectPreviewTileData(entry: EffectCatalogEntry): string | null {
  return baked.get(entry.id) ?? null
}
