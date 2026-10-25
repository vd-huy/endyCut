import { ArrowRightLeft } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { TRANSITION_TYPES } from '../../lib/presets'
import type { TransitionType } from '@shared/document'
import { transitionFits } from '@shared/timelineMath'

export default function TransitionsPanel() {
  const selectedId = useProjectStore((s) => s.selection.clipId)
  const findClip = useProjectStore((s) => s.findClip)
  const selected = selectedId ? findClip(selectedId) : null

  const prevInfo = (() => {
    if (!selected) return null
    const { clip, track } = selected
    let prev: { track: typeof track; clip: (typeof track.clips)[number] } | null = null
    for (const other of track.clips) {
      if (other.id === clip.id) continue
      const end = other.start + other.duration
      if (end <= clip.start + 0.02 && end >= clip.start - 0.5) {
        if (!prev || end > prev.clip.start + prev.clip.duration) {
          prev = { track, clip: other }
        }
      }
    }
    return prev
  })()

  const apply = (type: TransitionType) => {
    if (!selected) return
    const { clip } = selected
    const duration = Math.min(1, clip.duration * 0.4)
    if (prevInfo && !transitionFits(prevInfo.clip, clip, duration)) {
      window.alert('Chuyển cảnh cần hai clip liền nhau và đủ dài (tối thiểu hơn 0.05s mỗi bên).')
      return
    }
    useProjectStore.getState().setTransition(clip.id, { type, duration })
  }

  return (
    <div className="p-3">
      <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
        {selected
          ? 'Chọn hiệu ứng chuyển cảnh áp vào ĐẦU clip đang chọn (nằm giữa clip trước và clip này).'
          : 'Chọn một clip trên timeline trước.'}
      </p>
      {selected?.clip.transitionIn && (
        <div className="mb-3 rounded-md bg-ink-800 p-2 text-[11px] text-ink-300">
          Đang dùng:{' '}
          <b className="text-white">
            {TRANSITION_TYPES.find((t) => t.id === selected.clip.transitionIn?.type)?.name ?? '—'}
          </b>{' '}
          ({selected.clip.transitionIn.duration.toFixed(2)}s)
          <button
            onClick={() => useProjectStore.getState().setTransition(selected.clip.id, null)}
            className="mt-1 block text-[11px] text-red-400 hover:underline"
          >
            Gỡ chuyển cảnh
          </button>
        </div>
      )}
      <div className="space-y-2">
        {TRANSITION_TYPES.map(({ id, name }) => (
          <button
            key={id}
            disabled={!selected}
            onClick={() => apply(id)}
            className="flex w-full items-center gap-3 rounded-lg bg-ink-800 px-3 py-2.5 text-left text-sm text-white ring-1 ring-ink-700 hover:ring-accent disabled:opacity-40"
          >
            <ArrowRightLeft size={16} className="text-accent" />
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}
