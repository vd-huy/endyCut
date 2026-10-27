// Keyboard shortcuts reference + editor (CapCut-style keymap dialog).

import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw, X } from 'lucide-react'
import {
  DEFAULT_KEYMAP,
  KEYMAP_ACTIONS,
  comboFromEvent,
  findCollision,
  loadKeymap,
  resetKeymap,
  saveKeymapValue
} from '../../lib/keymap'

export default function KeymapModal({ onClose }: { onClose: () => void }) {
  const [map, setMap] = useState(loadKeymap)
  const [capturing, setCapturing] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  // Live capture: the next keypress re-binds the highlighted action.
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return
      const combo = comboFromEvent(e)
      const collision = findCollision(capturing, combo, map)
      if (collision) {
        setConflict(`"${collision.label}" đã dùng ${combo}. Hãy chọn phím khác cho "${KEYMAP_ACTIONS.find(a => a.id === capturing)?.label ?? capturing}".`)
        return
      }
      setConflict(null)
      saveKeymapValue(capturing, combo)
      setMap((prev) => ({ ...prev, [capturing]: combo }))
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, map])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onPointerDown={onClose}>
      <div
        className="max-h-[86vh] w-[520px] overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Keyboard size={18} /> Phím tắt
          </h2>
          <button onClick={onClose} className="text-ink-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {conflict && (
          <p className="mb-3 rounded-md bg-amber-950/60 p-2 text-xs text-amber-300">{conflict}</p>
        )}

        <div className="space-y-1">
          {KEYMAP_ACTIONS.map((meta) => {
            const combo = (map[meta.id] ?? DEFAULT_KEYMAP[meta.id] ?? '—').split('|')[0]
            if (capturing === meta.id) {
              return (
                <div
                  key={meta.id}
                  className="flex items-center justify-between rounded-lg bg-accent/15 px-3 py-2 text-xs ring-1 ring-accent"
                >
                  <span className="text-ink-200">{meta.label}</span>
                  <span className="font-semibold text-accent">Nhấn phím mới… (Esc hủy)</span>
                </div>
              )
            }
            return (
              <div
                key={meta.id}
                className="flex items-center justify-between rounded-lg bg-ink-800/60 px-3 py-2 text-xs hover:bg-ink-800"
              >
                <span className="text-ink-300">{meta.label}</span>
                <div className="flex items-center gap-2">
                  <kbd className="rounded border border-ink-600 bg-ink-900 px-2 py-0.5 font-mono text-[11px] text-white">
                    {combo}
                  </kbd>
                  <button
                    onClick={() => {
                      setConflict(null)
                      setCapturing(meta.id)
                    }}
                    className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-700 hover:text-white"
                  >
                    Đổi
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <button
          onClick={() => {
            resetKeymap()
            setMap(loadKeymap())
            setConflict(null)
          }}
          className="mt-4 flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700 hover:text-white"
        >
          <RotateCcw size={12} /> Khôi phục mặc định
        </button>
        <p className="mt-3 text-[10px] leading-relaxed text-ink-500">
          Khi đang gõ trong ô nhập (input/textarea) phím tắt tạm dừng để soạn bình thường.
        </p>
      </div>
    </div>
  )
}
