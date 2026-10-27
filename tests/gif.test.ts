import { describe, expect, it } from 'vitest'
import { gifFrameCount, GifEncoder, medianCutPalette } from '../src/renderer/src/core/export/gif'

function solidFrame(gray: number, w = 4, h = 4): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
    data[i + 3] = 255
  }
  return data
}

describe('gifFrameCount', () => {
  it('estimates sampled frames for a duration', () => {
    expect(gifFrameCount(2, 10)).toBe(20)
    expect(gifFrameCount(5, 12)).toBe(60)
  })
})

describe('medianCutPalette', () => {
  it('returns palette colors for sampled bins', () => {
    const histogram = new Float64Array(32768)
    histogram[((255 >> 3) << 10)] = 10 // red-ish bin
    histogram[((0 >> 3) << 10)] = 10 // black bin
    const palette = medianCutPalette(histogram, 255)
    expect(palette.length).toBeGreaterThanOrEqual(6) // at least 2 colors
  })
})

describe('GifEncoder', () => {
  it('emits GIF89a header with global color table and trailer', () => {
    const encoder = new GifEncoder(4, 4, 10)
    encoder.addHistogramFrame(solidFrame(255))
    encoder.addHistogramFrame(solidFrame(0))
    expect(encoder.finalizePalette()).toBe(true)
    encoder.addFrame(solidFrame(255))
    encoder.addFrame(solidFrame(0))
    const bytes = encoder.finishTrailer()
    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a')
    // Global color table flag + 256 entries advertised in the packed byte.
    expect(bytes[10] & 0x80).not.toBe(0)
    // Image data must start with the LZW minimum code size byte (8) right
    // after the 10-byte image descriptor — browsers render frames as empty
    // without it. Locate the 4x4 image descriptor past the global table and
    // check the byte that follows it.
    let descriptorAt = -1
    for (let i = 13 + 768; i < bytes.length - 10; i++) {
      if (
        bytes[i] === 0x2c &&
        bytes[i + 1] === 0 && bytes[i + 2] === 0 && // left, top
        bytes[i + 3] === 0 && bytes[i + 4] === 0 &&
        bytes[i + 5] === 4 && bytes[i + 6] === 0 && // width 4
        bytes[i + 7] === 4 && bytes[i + 8] === 0 && // height 4
        bytes[i + 9] === 0 // packed: no local table, non-interlaced
      ) {
        descriptorAt = i
        break
      }
    }
    expect(descriptorAt).toBeGreaterThan(0)
    expect(bytes[descriptorAt + 10]).toBe(8)
    expect(bytes[bytes.length - 1]).toBe(0x3b) // trailer
    expect(encoder.frames).toBe(2)
  })

  it('keeps constant frames far below raw pixel cost', () => {
    const frame = solidFrame(128, 64, 64)
    const encoder = new GifEncoder(64, 64, 10)
    encoder.addHistogramFrame(frame)
    expect(encoder.finalizePalette()).toBe(true)
    encoder.addFrame(frame)
    const bytes = encoder.finishTrailer()
    const rawPixels = 64 * 64 // 4096 packed indices
    expect(bytes.length).toBeLessThan(768 /* palette */ + 64 /* header/ext */ + rawPixels)
  })
})
