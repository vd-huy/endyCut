import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'

// Emoji sticker library, organized like CapCut's sticker categories.
// Uses the system emoji font — no external assets required.
const STICKER_CATEGORIES: Array<{ name: string; items: string[] }> = [
  {
    name: 'Cảm xúc',
    items: ['😀', '😂', '🥰', '😎', '🤩', '😢', '😡', '😱', '🤔', '😴', '🥳', '🤗', '😇', '🤣', '😍', '🥺']
  },
  {
    name: 'Cổ vũ',
    items: ['👍', '👏', '🙌', '💪', '🔥', '⭐', '✨', '💯', '🎉', '🎊', '🏆', '🥇', '❤️', '💜', '💥', '⚡']
  },
  {
    name: 'Vui nhộn',
    items: ['🎪', '🎭', '🤡', '🎈', '🎁', '🎮', '🎲', '🎵', '🎶', '🎤', '🎸', '🥁', '🚀', '🛸', '🌈', '☀️']
  },
  {
    name: 'Đồ ăn',
    items: ['🍕', '🍔', '🍟', '🌮', '🍩', '🍪', '🎂', '🍰', '🍓', '🍉', '🍇', '🥑', '☕', '🍺', '🧋', '🍿']
  },
  {
    name: 'Động vật',
    items: ['🐶', '🐱', '🐼', '🦊', '🐻', '🐸', '🐵', '🦁', '🐯', '🐰', '🐧', '🦄', '🐢', '🦋', '🐝', '🦖']
  },
  {
    name: 'Biểu tượng',
    items: ['❗', '❓', '💤', '💬', '💭', '🔔', '📌', '📍', '✅', '❌', '⚠️', '🔗', '💡', '📷', '🎬', '🎯']
  }
]

export default function StickerPanel() {
  const [query, setQuery] = useState('')
  const addStickerClip = useProjectStore((s) => s.addStickerClip)
  const playhead = useEditorStore((s) => s.playhead)

  const insert = (emoji: string) => {
    const ok = addStickerClip(playhead, emoji)
    if (!ok) window.alert('Không thêm được sticker — cần track chữ còn trống tại vị trí này.')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-700/60 p-3">
        <h2 className="mb-2 text-sm font-semibold text-white">Sticker</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm sticker…"
          className="w-full rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-ink-500 focus:border-accent"
        />
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
          Nhấn để chèn sticker tại playhead. Chỉnh trong Inspector sau khi chèn.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {STICKER_CATEGORIES.map((cat) => {
          const items = query.trim()
            ? cat.items.filter((e) => e.includes(query.trim()))
            : cat.items
          if (items.length === 0) return null
          return (
            <div key={cat.name} className="mb-4">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">{cat.name}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {items.map((emoji, i) => (
                  <button
                    key={`${emoji}-${i}`}
                    onClick={() => insert(emoji)}
                    className="flex aspect-square items-center justify-center rounded-lg bg-ink-800 text-2xl transition-transform hover:scale-105 hover:bg-ink-700"
                    title={`Chèn ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {query.trim() && STICKER_CATEGORIES.every((c) => c.items.every((e) => !e.includes(query.trim()))) && (
          <p className="py-8 text-center text-xs text-ink-500">Không tìm thấy sticker phù hợp.</p>
        )}
      </div>
    </div>
  )
}
