import { useProjectStore } from '../../store/projectStore'
import { FILTER_PRESETS } from '../../lib/presets'
import { NEUTRAL_FILTERS } from '@shared/document'

export default function EffectsPanel() {
  const selectedId = useProjectStore((s) => s.selection.clipId)
  const findClip = useProjectStore((s) => s.findClip)

  const applyPreset = (presetId: string) => {
    if (!selectedId) return
    const preset = FILTER_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    useProjectStore.getState().pushHistory()
    useProjectStore.getState().updateFilters(selectedId, {
      ...preset.values,
      presetId: presetId === 'none' ? null : presetId
    })
  }

  const currentPreset = selectedId ? findClip(selectedId)?.clip.filters.presetId : null

  return (
    <div className="p-3">
      <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
        {selectedId
          ? 'Chọn một bộ lọc để áp lên clip đang chọn.'
          : 'Chọn một clip trên timeline trước, rồi chọn bộ lọc ở đây.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {FILTER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            disabled={!selectedId}
            onClick={() => applyPreset(preset.id)}
            className={`overflow-hidden rounded-lg ring-1 transition-all disabled:opacity-40 ${
              currentPreset === preset.id ? 'ring-2 ring-accent' : 'ring-ink-700 hover:ring-ink-400'
            }`}
          >
            <div
              className="h-16 w-full"
              style={{
                filter: preset.css,
                background:
                  'linear-gradient(135deg, #7c5cff 0%, #4f7cff 35%, #38bdf8 65%, #f0abfc 100%)'
              }}
            />
            <p className="bg-ink-800 py-1 text-[11px] text-white">{preset.name}</p>
          </button>
        ))}
      </div>
      {selectedId && (
        <button
          onClick={() => {
            useProjectStore.getState().pushHistory()
            useProjectStore.getState().updateFilters(selectedId, { ...NEUTRAL_FILTERS, presetId: null })
          }}
          className="mt-3 w-full rounded-md bg-ink-800 py-2 text-xs text-ink-300 hover:bg-ink-700 hover:text-white"
        >
          Đặt lại về gốc
        </button>
      )}
    </div>
  )
}
