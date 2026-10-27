import { useState } from 'react'
import { Search, Sparkles, X } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { useEditorStore } from '../../store/editorStore'
import { EFFECT_CATALOG, EFFECT_CATEGORIES, EFFECT_CHIP_GRADIENT, type EffectCatalogEntry } from '../../lib/effectCatalog'
import { useEffectPreviewDataUrl } from '../../lib/effectPreview'

/** CapCut-style tile: looping GIF preview once baked, gradient before that. */
function EffectPreviewTile({ entry }: { entry: EffectCatalogEntry }) {
  const gif = useEffectPreviewDataUrl(entry)
  if (gif) {
    return <img src={gif} alt={entry.name} className="h-14 w-full object-cover" draggable={false} />
  }
  return (
    <div
      className="h-14 w-full"
      style={{
        background: EFFECT_CHIP_GRADIENT,
        filter: entry.chip.filter,
        transform: entry.chip.transform
      }}
    />
  )
}

export default function EffectsLibraryPanel() {
  const selectedId = useProjectStore((s) => s.selection.clipId)
  const findClip = useProjectStore((s) => s.findClip)
  const addEffect = useProjectStore((s) => s.addEffectToClip)
  const removeEffect = useProjectStore((s) => s.removeEffectFromClip)
  const setNotice = useEditorStore((s) => s.setImportNotice)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const selected = selectedId ? findClip(selectedId) : null

  const apply = (entryId: string) => {
    if (!selectedId) {
      setNotice('Chọn một clip trên timeline trước đã.')
      setTimeout(() => setNotice(null), 2500)
      return
    }
    const entry = EFFECT_CATALOG.find((e) => e.id === entryId)
    if (!entry) return
    addEffect(selectedId, {
      kind: entry.kind,
      name: entry.name,
      start: 0,
      duration: Math.min(entry.duration, selected?.clip.duration ?? entry.duration),
      intensity: entry.intensity
    })
  }

  const q = query.trim().toLowerCase()
  const visible = EFFECT_CATALOG.filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
  const categories = q
    ? [null]
    : expanded
      ? [expanded]
      : [...EFFECT_CATEGORIES]

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-ink-800 px-2 py-1.5">
        <Search size={13} className="text-ink-400" />
        <input
          placeholder="Tìm kiếm hiệu ứng"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent text-xs text-white outline-none"
        />
      </div>

      {!selectedId && (
        <p className="mb-2 text-[11px] text-ink-400">
          Chọn một clip trên timeline rồi bấm hiệu ứng để áp vào.
        </p>
      )}

      {selected && (selected.clip.effects?.length ?? 0) > 0 && (
        <div className="mb-3 rounded-md bg-ink-800/70 p-2">
          <p className="mb-1 text-[11px] font-semibold text-ink-300">Hiệu ứng của clip:</p>
          <div className="flex flex-wrap gap-1.5">
            {(selected.clip.effects ?? []).map((eff) => (
              <span
                key={eff.id}
                className="flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent"
              >
                <Sparkles size={10} /> {eff.name}
                <button
                  onClick={() => removeEffect(selected.clip.id, eff.id)}
                  className="text-accent hover:text-white"
                  title="Gỡ hiệu ứng"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {categories.map((category) => {
        const entries = category ? visible.filter((e) => e.category === category) : visible
        if (entries.length === 0) return null
        const isExpanded = category !== null && expanded === category
        return (
          <section key={category ?? 'search'} className="mb-3">
            {category && (
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">{category}</h3>
                <button
                  onClick={() => setExpanded(isExpanded ? null : category)}
                  className="text-[11px] text-ink-400 hover:text-accent"
                >
                  {isExpanded ? 'Thu gọn' : 'Xem tất cả'}
                </button>
              </div>
            )}
            <div className={`grid gap-2 ${isExpanded ? 'grid-cols-3' : 'grid-cols-3'}`}>
              {(isExpanded ? entries : entries.slice(0, 6)).map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => apply(entry.id)}
                  disabled={!selectedId}
                  className="group overflow-hidden rounded-lg ring-1 ring-ink-700 transition-all hover:ring-accent disabled:opacity-40"
                  title={`${entry.name} — ${entry.kind}`}
                >
                  <EffectPreviewTile entry={entry} />
                  <p className="truncate bg-ink-800 px-1 py-1 text-[10px] text-white">{entry.name}</p>
                </button>
              ))}
            </div>
          </section>
        )
      })}

      {visible.length === 0 && (
        <p className="text-[11px] text-ink-400">Không có hiệu ứng nào khớp "{query}".</p>
      )}
    </div>
  )
}
