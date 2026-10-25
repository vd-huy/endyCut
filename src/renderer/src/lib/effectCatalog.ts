// CapCut-style effect catalog: Vietnamese display names grouped into
// categories, each backed by a real frame-renderer effect kind. The effects
// panel mirrors CapCut's layout (category sections + "Xem tất cả").
import type { EffectKind } from '@shared/document'

export interface EffectCatalogEntry {
  id: string
  name: string
  category: string
  kind: EffectKind
  /** Default strength 0..1 applied when the effect is added. */
  intensity: number
  /** Default span in seconds (clamped to the clip). */
  duration: number
  /** Extra chip-thumbnail styling over the shared gradient. */
  chip: { filter?: string; transform?: string }
}

const GRADIENT = 'linear-gradient(135deg, #7c5cff 0%, #4f7cff 35%, #38bdf8 65%, #f0abfc 100%)'
export const EFFECT_CHIP_GRADIENT = GRADIENT

export const EFFECT_CATEGORIES = ['Đang thịnh hành', 'Cơ bản', 'Ánh sáng', 'Phong cách'] as const

export const EFFECT_CATALOG: EffectCatalogEntry[] = [
  // — Đang thịnh hành —
  { id: 'zoom-lens', name: 'Zoom lens', category: 'Đang thịnh hành', kind: 'zoom', intensity: 0.8, duration: 2, chip: { transform: 'scale(1.15)' } },
  { id: 'blur', name: 'Blur', category: 'Đang thịnh hành', kind: 'blur', intensity: 0.7, duration: 2, chip: { filter: 'blur(4px)' } },
  { id: 'shake', name: 'Shake', category: 'Đang thịnh hành', kind: 'shake', intensity: 0.6, duration: 1.5, chip: { transform: 'rotate(-2deg) scale(1.08)' } },
  { id: 'shake-soft', name: 'Rung nhẹ', category: 'Đang thịnh hành', kind: 'shake', intensity: 0.3, duration: 2, chip: { transform: 'rotate(1.2deg) scale(1.05)' } },
  { id: 'dizzy', name: 'Choáng ngợp', category: 'Đang thịnh hành', kind: 'glow', intensity: 0.7, duration: 2, chip: { filter: 'brightness(1.3) saturate(1.3)' } },
  { id: 'glitch', name: 'Glitch', category: 'Đang thịnh hành', kind: 'glitch', intensity: 0.7, duration: 1.2, chip: { filter: 'hue-rotate(40deg) saturate(1.6)' } },
  { id: 'mosaic', name: 'Mosaic', category: 'Đang thịnh hành', kind: 'pixelate', intensity: 0.7, duration: 2, chip: { filter: 'contrast(1.2) blur(1px)' } },
  { id: 'rgbsplit', name: 'Tách RGB', category: 'Đang thịnh hành', kind: 'rgbsplit', intensity: 0.8, duration: 1.5, chip: { filter: 'hue-rotate(15deg) contrast(1.1)', transform: 'scaleX(1.02)' } },
  { id: 'zoom-punch', name: 'Giật zoom', category: 'Đang thịnh hành', kind: 'zoom', intensity: 1, duration: 0.6, chip: { transform: 'scale(1.3)' } },
  // — Cơ bản —
  { id: 'flash', name: 'Lóe sáng', category: 'Cơ bản', kind: 'flash', intensity: 0.6, duration: 0.8, chip: { filter: 'brightness(1.6)' } },
  { id: 'mirror', name: 'Gương đối xứng', category: 'Cơ bản', kind: 'mirror', intensity: 0.8, duration: 2, chip: { transform: 'scaleX(-1)' } },
  { id: 'film-grain', name: 'Hạt phim', category: 'Cơ bản', kind: 'grain', intensity: 0.6, duration: 2, chip: { filter: 'contrast(1.15) sepia(0.15)' } },
  { id: 'soft-blur', name: 'Làm mờ', category: 'Cơ bản', kind: 'blur', intensity: 0.4, duration: 2, chip: { filter: 'blur(2px)' } },
  { id: 'vignette', name: 'Viền tối', category: 'Cơ bản', kind: 'vignette', intensity: 0.7, duration: 2, chip: { filter: 'brightness(0.85)' } },
  { id: 'push-in', name: 'Phóng to', category: 'Cơ bản', kind: 'zoom', intensity: 0.5, duration: 3, chip: { transform: 'scale(1.1)' } },
  // — Ánh sáng —
  { id: 'light-leak', name: 'Rò ánh sáng', category: 'Ánh sáng', kind: 'light-leak', intensity: 0.7, duration: 2, chip: { filter: 'sepia(0.4) brightness(1.25)' } },
  { id: 'bloom', name: 'Hào quang', category: 'Ánh sáng', kind: 'glow', intensity: 0.5, duration: 3, chip: { filter: 'brightness(1.2) blur(1px)' } },
  { id: 'flash-strong', name: 'Lóe trắng', category: 'Ánh sáng', kind: 'flash', intensity: 0.95, duration: 0.5, chip: { filter: 'brightness(2)' } },
  { id: 'backlight', name: 'Ngược sáng', category: 'Ánh sáng', kind: 'dreamy', intensity: 0.5, duration: 3, chip: { filter: 'brightness(1.35) contrast(0.9)' } },
  // — Phong cách —
  { id: 'dreamy', name: 'Mơ màng', category: 'Phong cách', kind: 'dreamy', intensity: 0.8, duration: 3, chip: { filter: 'brightness(1.25) saturate(1.2) blur(1px)' } },
  { id: 'retro-grain', name: 'Phim cũ', category: 'Phong cách', kind: 'grain', intensity: 0.85, duration: 3, chip: { filter: 'sepia(0.35) contrast(1.2)' } },
  { id: 'deep-blur', name: 'Mờ sâu', category: 'Phong cách', kind: 'blur', intensity: 1, duration: 2, chip: { filter: 'blur(6px)' } },
  { id: 'vhs', name: 'VHS cổ điển', category: 'Phong cách', kind: 'rgbsplit', intensity: 0.55, duration: 3, chip: { filter: 'saturate(1.4) contrast(0.92)', transform: 'skewX(-1deg)' } },
  { id: 'noir', name: 'Noir đen trắng', category: 'Phong cách', kind: 'grain', intensity: 0.45, duration: 3, chip: { filter: 'grayscale(1) contrast(1.3)' } }
]

export function effectEntryById(id: string): EffectCatalogEntry | undefined {
  return EFFECT_CATALOG.find((e) => e.id === id)
}
