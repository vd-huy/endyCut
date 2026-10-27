// .cube LUT parsing + caching. Files are read (and validated) by the main
// process through `readColorLut`; this module only parses/caches.
import type { CubeLut } from './types'

const cache = new Map<string, CubeLut>()

/**
 * Parse an Adobe .cube text file. Supports LUT_3D_SIZE (and falls back to
 * 1D LUT_1D_SIZE tables which we upsample-ignroe — only 3D tables are useful
 * for grading). Data rows are R-fastest, matching WebGL texture3D layout.
 */
export function parseCube(text: string): CubeLut | null {
  let size = 0
  let data: Float32Array | null = null
  let filled = 0
  let min = 0
  let max = 1
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('TITLE') || line.startsWith('LUT_1D_SIZE')) continue
    if (line.startsWith('DOMAIN_')) {
      const nums = line.split(' ').slice(1).map(Number)
      const first = Number.isFinite(nums[0]) ? nums[0] : 0
      const second = Number.isFinite(nums[1]) ? nums[1] : 1
      const upper = Number.isFinite(nums[2]) ? nums[2] : second
      // DOMAIN_MIN comes first, DOMAIN_MAX second — track both orders.
      if (line.startsWith('DOMAIN_MIN')) min = first < 0 ? first : min
      else max = upper > 1 ? upper : max
      continue
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      const sizeNum = Number(line.split(' ')[1])
      if (Number.isInteger(sizeNum) && sizeNum >= 2 && sizeNum <= 128) {
        size = sizeNum
        data = new Float32Array(size * size * size * 3)
        filled = 0
      }
      continue
    }
    if (size > 0 && data) {
      const nums = line.split(/\s+/).map(Number)
      if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) continue
      const scale = max - min !== 0 ? 1 / (max - min) : 1
      const idx = filled * 3
      if (idx + 3 > data.length) break
      data[idx] = (nums[0] - min) * scale
      data[idx + 1] = (nums[1] - min) * scale
      data[idx + 2] = (nums[2] - min) * scale
      filled++
    }
  }
  if (!size || !data || filled !== data.length / 3) return null
  return { size, data }
}

/** Get (and cache) a parsed LUT for an absolute path. */
export async function lutForPath(path: string): Promise<CubeLut | null> {
  const cached = cache.get(path)
  if (cached) return cached
  try {
    const text = await window.api.readColorLut(path)
    if (!text) return null
    const parsed = parseCube(text)
    if (parsed) cache.set(path, parsed)
    return parsed
  } catch {
    return null
  }
}

export type { CubeLut }
