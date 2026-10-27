// User key bindings (CapCut-style "Phím tắt"). Combos are stored as display
// strings like "Ctrl+B", "Shift+ArrowLeft", "Space" and matched by
// `matchKeymapAction`, which normalizes a KeyboardEvent to the same form.

export interface KeymapActionMeta {
  id: string
  label: string
  /** true when the browser must block its default for this combo. */
  prevent?: boolean
}

/** Stable registry — every route the App handles is listed here exactly once. */
export const KEYMAP_ACTIONS: KeymapActionMeta[] = [
  { id: 'play-pause', label: 'Phát / tạm dừng', prevent: true },
  { id: 'split', label: 'Tách clip tại playhead', prevent: true },
  { id: 'delete', label: 'Xóa clip đã chọn' },
  { id: 'undo', label: 'Hoàn tác', prevent: true },
  { id: 'redo', label: 'Làm lại', prevent: true },
  { id: 'save', label: 'Lưu dự án', prevent: true },
  { id: 'copy', label: 'Sao chép clip', prevent: true },
  { id: 'paste', label: 'Dán clip', prevent: true },
  { id: 'duplicate', label: 'Nhân đôi clip', prevent: true },
  { id: 'marker-add', label: 'Thêm mốc đánh dấu' },
  { id: 'step-back', label: 'Lùi 1 khung hình (Shift: lùi 1s)' },
  { id: 'step-forward', label: 'Tiến 1 khung hình (Shift: tiến 1s)' },
  { id: 'goto-start', label: 'Về đầu timeline' },
  { id: 'export', label: 'Mở hộp thoại Xuất video', prevent: true },
  { id: 'toggle-snapping', label: 'Bật/tắt bắt điểm (snap)' },
  { id: 'open-keymap', label: 'Bảng phím tắt' }
]

export const DEFAULT_KEYMAP: Record<string, string> = {
  'play-pause': 'Space',
  split: 'Ctrl+B',
  delete: 'Delete',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z|Ctrl+Y',
  save: 'Ctrl+S',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  duplicate: 'Ctrl+D',
  'marker-add': 'M',
  'step-back': 'ArrowLeft',
  'step-forward': 'ArrowRight',
  'goto-start': 'Home',
  export: 'Ctrl+E',
  'toggle-snapping': 'S',
  'open-keymap': '?'
}

const STORAGE_KEY = 'cc-keymap'

export function loadKeymap(): Record<string, string> {
  const map = { ...DEFAULT_KEYMAP }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>
      for (const meta of KEYMAP_ACTIONS) {
        const value = parsed[meta.id]
        if (typeof value === 'string' && value) map[meta.id] = value
      }
    }
  } catch {
    /* corrupt — defaults */
  }
  return map
}

export function saveKeymapValue(actionId: string, combo: string): void {
  try {
    const stored: Record<string, string> = {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) Object.assign(stored, JSON.parse(raw) as Record<string, unknown>)
    } catch {
      /* start fresh */
    }
    stored[actionId] = combo
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    /* quota */
  }
}

export function resetKeymap(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Punctuation keys keep their raw glyph ('?', '-', '='); shift stays implicit. */
function isPunctuation(key: string): boolean {
  return key.length === 1 && !/[a-zA-Z0-9]/.test(key)
}

/**
 * Normalize a KeyboardEvent into the combo string used by the map:
 * modifier order Ctrl / Shift / Alt, then the key in canonical form.
 */
export function comboFromEvent(e: KeyboardEvent): string {
  if (e.code === 'Space') {
    const parts = ['Space']
    if (e.ctrlKey) parts.unshift('Ctrl')
    return parts.join('+')
  }
  const key = e.key
  const keyBase =
    key === ' ' ? 'Space' : key.length === 1 && !isPunctuation(key) ? key.toUpperCase() : key
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey && !isPunctuation(keyBase)) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(keyBase)
  return parts.join('+')
}

/** First action whose binding matches this event, or null. Bindings may list
 *  alternatives separated by '|' (e.g. "Ctrl+Shift+Z|Ctrl+Y"). */
export function matchKeymapAction(e: KeyboardEvent, map: Record<string, string>): string | null {
  const combo = comboFromEvent(e)
  for (const meta of KEYMAP_ACTIONS) {
    if (map[meta.id]?.split('|').includes(combo)) return meta.id
  }
  return null
}

/** Short collision copy used by the modal when a binding is taken. */
export function findCollision(
  actionId: string,
  combo: string,
  map: Record<string, string>
): KeymapActionMeta | null {
  for (const other of KEYMAP_ACTIONS) {
    if (other.id !== actionId && map[other.id] === combo) return other
  }
  return null
}
