// Streaming GIF89a encoder (no external dependency):
//   pass 1 — 5-bit RGB histogram over every sampled frame
//   pass 2 — median-cut palette from the histogram, per-frame color mapping
//            through the bins, streaming LZW compression + block writer.
// Handles loop extension, per-frame Graphic Control delays and image data as
// 255-byte sub-blocks. Quality trade-off is CapCut-like: one global palette.

const MAX_PIX_PER_PALETTE_FOCUS = 200_000

interface Box {
  indices: number[] // histogram bins inside this box
}

export class GifEncoder {
  private width: number
  private height: number
  private fps: number
  private histogram: Float64Array // 32768 bins (5-bit RGB)
  private palette: Uint8Array | null = null // RGB triples
  private binToIndex: Int16Array | null = null
  private chainBytes: number[] = []
  private frameCount = 0
  private headerWritten = false

  constructor(width: number, height: number, fps: number) {
    this.width = width
    this.height = height
    this.fps = Math.max(1, Math.min(50, fps))
    this.histogram = new Float64Array(32768)
  }

  /** Feed one frame's pixels into the histogram (pass 1). */
  addHistogramFrame(data: Uint8ClampedArray): void {
    const step = data.length / 4 > MAX_PIX_PER_PALETTE_FOCUS ? 16 : 4
    for (let i = 0; i + 3 < data.length; i += step) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      this.histogram[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++
    }
  }

  /** Build the global palette (pass 1.5). Must run after all histogram frames. */
  finalizePalette(): boolean {
    this.palette = medianCutPalette(this.histogram, 255)
    this.binToIndex = new Int16Array(32768).fill(-1)
    return this.palette.length > 0
  }

  /** Encode one RGBA frame (pass 2). */
  addFrame(data: Uint8ClampedArray): void {
    if (!this.palette || !this.binToIndex) throw new Error('finalizePalette() first')
    const pixelCount = Math.floor(data.length / 4)
    const indices = new Uint8Array(pixelCount)
    for (let i = 0, p = 0; i + 3 < data.length; i += 4, p++) {
      const bin = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
      let idx = this.binToIndex[bin]
      if (idx < 0) {
        // Nearest palette color for an unsampled bin, cached on the bin.
        idx = nearestPaletteIndex(this.palette, data[i], data[i + 1], data[i + 2])
        this.binToIndex[bin] = idx
      }
      indices[p] = idx
    }
    this.writeFrame(indices)
    this.frameCount++
  }

  get frames(): number {
    return this.frameCount
  }

  // ---- binary helpers ------------------------------------------------------
  private bytes(chunk: number[] | Uint8Array): void {
    for (const b of chunk) this.chainBytes.push(b)
  }

  private u16(value: number): number[] {
    const v = Math.max(0, Math.min(0xffff, Math.round(value)))
    return [v & 0xff, (v >> 8) & 0xff]
  }

  private writeHeader(): void {
    if (this.headerWritten) return
    this.headerWritten = true
    this.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // "GIF89a"
    this.bytes(this.u16(this.width))
    this.bytes(this.u16(this.height))
    const sizeBits = 7 // 256-entry global color table
    // Table size lives in packed bits 0..2 (2^(N+1) entries); bits 4..6 are
    // the deprecated color-resolution writeup — putting the size there makes
    // full parsers read a 2-entry table and reject every frame ("missing
    // frame" / black tiles).
    this.bytes([0x80 | sizeBits, 0, 0])
    const palette = this.palette!
    this.bytes(palette)
    // Pad the color table to the advertised power-of-two length (256).
    const extra = 256 * 3 - palette.length
    for (let i = 0; i < extra; i++) this.chainBytes.push(0)
    // NETSCAPE2.0 loop extension: loop forever.
    this.bytes([
      0x21, 0xff, 0x0b,
      0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
      0x03, 0x01, 0x00, 0x00, 0x00
    ])
  }

  private writeFrame(indices: Uint8Array): void {
    if (!this.headerWritten) this.writeHeader()
    // Graphic Control Extension: delay in 1/100 s, no transparency.
    const delay = Math.max(2, Math.round(100 / this.fps))
    this.bytes([0x21, 0xf9, 0x04, 0x04, ...this.u16(delay), 0x00, 0x00])
    // Image descriptor.
    this.bytes([0x2c, ...this.u16(0), ...this.u16(0), ...this.u16(this.width), ...this.u16(this.height), 0x00])
    // LZW minimum code size precedes the compressed data sub-blocks.
    this.bytes([8])
    // LZW-compressed image data in ≤255-byte sub-blocks.
    const compressed = lzwCompress(indices, 8)
    const CHUNK = 255
    for (let i = 0; i < compressed.length; i += CHUNK) {
      const len = Math.min(CHUNK, compressed.length - i)
      this.bytes([len])
      for (let j = 0; j < len; j++) this.chainBytes.push(compressed[i + j])
    }
    this.bytes([0x00])
  }

  finishTrailer(): Uint8Array {
    this.bytes([0x3b])
    return new Uint8Array(this.chainBytes)
  }
}

function nearestPaletteIndex(palette: Uint8Array, r: number, g: number, b: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  const n = Math.min(256, palette.length / 3)
  for (let i = 0; i < n; i++) {
    const dr = r - palette[i * 3]
    const dg = g - palette[i * 3 + 1]
    const db = b - palette[i * 3 + 2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestDist) {
      bestDist = d
      best = i
      if (d === 0) break
    }
  }
  return best
}

/** Median-cut quantizer over a 5-bit histogram (weighted by pixel counts). */
export function medianCutPalette(histogram: Float64Array, maxColors: number): Uint8Array {
  const bins: number[] = []
  for (let i = 0; i < histogram.length; i++) if (histogram[i] > 0) bins.push(i)
  if (bins.length === 0) return new Uint8Array([0, 0, 0])

  let boxes: Box[] = [{ indices: bins }]
  const target = Math.min(maxColors, Math.max(2, bins.length))
  while (boxes.length < target) {
    // Choose the box with the largest weighted channel span.
    let widest = -1
    let widestScore = 0
    for (let i = 0; i < boxes.length; i++) {
      const score = boxScore(boxes[i], histogram)
      if (score > widestScore) {
        widestScore = score
        widest = i
      }
    }
    if (widest < 0 || widestScore <= 0) break
    const parts = splitBox(boxes[widest], histogram)
    if (!parts) break
    boxes = [...boxes.slice(0, widest), ...parts, ...boxes.slice(widest + 1)]
  }

  const paletteLength = boxes.length
  const palette = new Uint8Array(paletteLength * 3)
  for (let i = 0; i < paletteLength; i++) {
    const avg = boxAverage(boxes[i], histogram)
    palette[i * 3] = avg[0]
    palette[i * 3 + 1] = avg[1]
    palette[i * 3 + 2] = avg[2]
  }
  return palette
}

function channelExtremes(box: Box): { min: number[]; max: number[]; biggest: number } {
  const min = [255, 255, 255]
  const max = [0, 0, 0]
  for (const bin of box.indices) {
    const r = (bin >> 10) & 0x1f
    const g = (bin >> 5) & 0x1f
    const bl = bin & 0x1f
    min[0] = Math.min(min[0], r)
    min[1] = Math.min(min[1], g)
    min[2] = Math.min(min[2], bl)
    max[0] = Math.max(max[0], r)
    max[1] = Math.max(max[1], g)
    max[2] = Math.max(max[2], bl)
  }
  const spans = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const biggest = spans[0] >= spans[1] && spans[0] >= spans[2] ? 0 : spans[1] >= spans[2] ? 1 : 2
  return { min, max, biggest }
}

/** Split score = weighted span of the widest channel (0 = not splittable). */
function boxScore(box: Box, histogram: Float64Array): number {
  if (box.indices.length < 2) return 0
  const { min, max, biggest } = channelExtremes(box)
  let weight = 0
  for (const bin of box.indices) weight += histogram[bin]
  if (weight <= 0) return 0
  const span5 = max[biggest] - min[biggest]
  return span5 <= 0 ? 0 : weight * span5 * 8
}

function splitBox(box: Box, histogram: Float64Array): Box[] | null {
  if (box.indices.length < 2) return null
  const { min, max, biggest } = channelExtremes(box)
  const shift = [10, 5, 0][biggest]
  const sorted = [...box.indices].sort((a, b) => ((a >> shift) & 0x1f) - ((b >> shift) & 0x1f))
  // Weighted median split.
  let total = 0
  for (const bin of sorted) total += histogram[bin]
  if (total <= 0) return null
  let acc = 0
  let split = 0
  for (let i = 0; i < sorted.length; i++) {
    acc += histogram[sorted[i]]
    if (acc >= total / 2) {
      split = Math.min(Math.max(1, i + 1), sorted.length - 1)
      break
    }
  }
  if (split === 0 || split === sorted.length) return null
  const a = sorted.slice(0, split)
  const b = sorted.slice(split)
  if (a.length === 0 || b.length === 0) return null
  return [{ indices: a }, { indices: b }]
}

function boxAverage(box: Box, histogram: Float64Array): [number, number, number] {
  let w = 0
  let r = 0
  let g = 0
  let b = 0
  for (const bin of box.indices) {
    const weight = histogram[bin]
    w += weight
    r += weight * (((bin >> 10) & 0x1f) * 255) / 31
    g += weight * (((bin >> 5) & 0x1f) * 255) / 31
    b += weight * ((bin & 0x1f) * 255) / 31
  }
  if (w <= 0) return [0, 0, 0]
  return [Math.round(r / w), Math.round(g / w), Math.round(b / w)]
}

// ---------------------------------------------------------------------------
// LZW encoding (GIF variant: codes grow 9..12 bits, CLEAR reset at overflow).
// ---------------------------------------------------------------------------

function lzwCompress(input: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize
  const eoi = clearCode + 1
  let nextCode = eoi + 1
  let codeSize = minCodeSize + 1
  const dict = new Map<number, number>()

  const out: number[] = []
  let bitBuffer = 0
  let bitCount = 0
  const emitCode = (code: number): void => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }
  const reset = (): void => {
    dict.clear()
    nextCode = eoi + 1
    codeSize = minCodeSize + 1
  }

  emitCode(clearCode)
  let prefix = -1
  for (let i = 0; i < input.length; i++) {
    const pixel = input[i]
    if (prefix < 0) {
      prefix = pixel
      continue
    }
    const key = (prefix << 8) | pixel
    const match = dict.get(key)
    if (match !== undefined) {
      prefix = match
      continue
    }
    emitCode(prefix)
    if (nextCode < 4096) {
      dict.set(key, nextCode)
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++
      nextCode++
    }
    if (nextCode >= 4096) {
      emitCode(clearCode)
      reset()
    }
    prefix = pixel
  }
  if (prefix >= 0) emitCode(prefix)
  emitCode(eoi)
  if (bitCount > 0) out.push(bitBuffer & 0xff)
  return out
}

/** Clamp helper shared by the GIF export branch. */
export function gifFrameCount(durationSeconds: number, fps: number): number {
  return Math.min(1200, Math.max(1, Math.round(durationSeconds * fps)))
}
