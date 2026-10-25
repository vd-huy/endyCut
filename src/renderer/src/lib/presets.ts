import type { ColorFilters } from '@shared/document'
import { NEUTRAL_FILTERS } from '@shared/document'

const BASE: Omit<ColorFilters, 'presetId'> = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  hue: 0,
  exposure: 1,
  highlights: 0,
  shadows: 0
}

export interface FilterPreset {
  id: string
  name: string
  values: Omit<ColorFilters, 'presetId'>
  /** CSS filter for the preview chip. */
  css: string
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', name: 'Gốc', values: { ...BASE }, css: 'none' },
  {
    id: 'vivid',
    name: 'Rực rỡ',
    values: { ...BASE, brightness: 1.08, contrast: 1.18, saturation: 1.35, temperature: 0.08 },
    css: 'brightness(1.08) contrast(1.18) saturate(1.35) sepia(0.03)'
  },
  {
    id: 'warm',
    name: 'Ấm áp',
    values: { ...BASE, brightness: 1.05, contrast: 1.05, saturation: 1.12, temperature: 0.55 },
    css: 'brightness(1.05) contrast(1.05) saturate(1.12) sepia(0.22)'
  },
  {
    id: 'cool',
    name: 'Lạnh',
    values: { ...BASE, brightness: 1.0, contrast: 1.1, saturation: 0.92, temperature: -0.6 },
    css: 'brightness(1) contrast(1.1) saturate(0.92) hue-rotate(-15deg)'
  },
  {
    id: 'mono',
    name: 'Đen trắng',
    values: { ...BASE, brightness: 1.02, contrast: 1.15, saturation: 0, temperature: 0 },
    css: 'brightness(1.02) contrast(1.15) saturate(0)'
  },
  {
    id: 'fade',
    name: 'Nhạt',
    values: { ...BASE, brightness: 1.12, contrast: 0.85, saturation: 0.85, temperature: 0.2 },
    css: 'brightness(1.12) contrast(0.85) saturate(0.85) sepia(0.08)'
  },
  {
    id: 'drama',
    name: 'Kịch tính',
    values: { ...BASE, brightness: 0.92, contrast: 1.35, saturation: 1.05, temperature: -0.15 },
    css: 'brightness(0.92) contrast(1.35) saturate(1.05) hue-rotate(-4deg)'
  },
  {
    id: 'dream',
    name: 'Mơ màng',
    values: { ...BASE, brightness: 1.15, contrast: 0.9, saturation: 1.2, temperature: 0.35 },
    css: 'brightness(1.15) contrast(0.9) saturate(1.2) sepia(0.14)'
  },
  {
    id: 'mv-classic',
    name: 'MV cổ điển',
    values: { ...BASE, brightness: 0.98, contrast: 1.22, saturation: 0.78, temperature: -0.2 },
    css: 'brightness(0.98) contrast(1.22) saturate(0.78) hue-rotate(-8deg)'
  },
  {
    id: 'moody',
    name: 'Tâm trạng',
    values: { ...BASE, brightness: 0.92, contrast: 1.12, saturation: 0.72, temperature: -0.35 },
    css: 'brightness(0.92) contrast(1.12) saturate(0.72) hue-rotate(-18deg)'
  },
  {
    id: 'natural-skin',
    name: 'Da mộc',
    values: { ...BASE, brightness: 1.06, contrast: 0.96, saturation: 1.05, temperature: 0.25 },
    css: 'brightness(1.06) contrast(0.96) saturate(1.05) sepia(0.1)'
  },
  {
    id: 'misty',
    name: 'Sương mù',
    values: { ...BASE, brightness: 1.18, contrast: 0.82, saturation: 0.88, temperature: -0.12 },
    css: 'brightness(1.18) contrast(0.82) saturate(0.88) hue-rotate(6deg)'
  },
  {
    id: 'pink-fog',
    name: 'Hồng mê',
    values: { ...BASE, brightness: 1.1, contrast: 0.95, saturation: 1.25, temperature: 0.3 },
    css: 'brightness(1.1) contrast(0.95) saturate(1.25) hue-rotate(-6deg) sepia(0.18)'
  },
  {
    id: 'nostalgia',
    name: 'Hoài niệm',
    values: { ...BASE, brightness: 1.04, contrast: 1.08, saturation: 0.85, temperature: 0.55 },
    css: 'brightness(1.04) contrast(1.08) saturate(0.85) sepia(0.3)'
  },
  {
    id: 'snow',
    name: 'Tuyết trắng',
    values: { ...BASE, brightness: 1.16, contrast: 1.05, saturation: 0.65, temperature: -0.5 },
    css: 'brightness(1.16) contrast(1.05) saturate(0.65) hue-rotate(-12deg)'
  },
  {
    id: 'halo',
    name: 'Hào quang',
    values: { ...BASE, brightness: 1.22, contrast: 0.9, saturation: 1.1, temperature: 0.18 },
    css: 'brightness(1.22) contrast(0.9) saturate(1.1) sepia(0.06)'
  }
]

export const TRANSITION_TYPES: Array<{ id: import('@shared/document').TransitionType; name: string }> = [
  { id: 'crossfade', name: 'Hòa trộn' },
  { id: 'fade-black', name: 'Mờ qua đen' },
  { id: 'fade-white', name: 'Mờ qua trắng' },
  { id: 'blur-cross', name: 'Hòa mờ' },
  { id: 'slide-left', name: 'Trượt sang trái' },
  { id: 'slide-right', name: 'Trượt sang phải' },
  { id: 'slide-up', name: 'Trượt lên trên' },
  { id: 'slide-down', name: 'Trượt xuống dưới' },
  { id: 'wipe-right', name: 'Quét sang phải' },
  { id: 'wipe-left', name: 'Quét sang trái' },
  { id: 'wipe-up', name: 'Quét lên trên' },
  { id: 'wipe-down', name: 'Quét xuống dưới' },
  { id: 'zoom-in', name: 'Phóng to' },
  { id: 'zoom-out', name: 'Thu nhỏ' },
  { id: 'whip-pan', name: 'Quay cuộn' },
  { id: 'circle-open', name: 'Hình tròn mở' },
  { id: 'spin', name: 'Xoay chuyển' }
]

export const FONT_FAMILIES = [
  { id: 'Segoe UI, Arial, sans-serif', name: 'Segoe UI' },
  { id: 'Arial, sans-serif', name: 'Arial' },
  { id: 'Georgia, serif', name: 'Georgia' },
  { id: '"Times New Roman", serif', name: 'Times New Roman' },
  { id: '"Courier New", monospace', name: 'Courier New' },
  { id: 'Impact, sans-serif', name: 'Impact' },
  { id: 'Verdana, sans-serif', name: 'Verdana' },
  { id: '"Segoe UI Black", "Arial Black", sans-serif', name: 'Black' }
]
