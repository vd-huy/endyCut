import { useEffect } from 'react'
import { Clapperboard, Clock, Film } from 'lucide-react'
import type { ProjectDocument } from '@shared/document'
import { totalDuration } from '@shared/document'
import { formatDuration } from '../lib/format'

export interface RestoreCandidate {
  doc: ProjectDocument
  name: string
  clips: number
  duration: number
}

/**
 * CapCut-style "continue project?" card shown at startup when an autosaved
 * draft exists. State-driven (not window.confirm) so React StrictMode's
 * double-mounted effects can't pop it twice.
 */
export default function RestoreModal({
  candidate,
  onRestore,
  onDismiss
}: {
  candidate: RestoreCandidate
  onRestore: (doc: ProjectDocument) => void
  onDismiss: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[400px] rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2.5">
          <Clapperboard size={22} className="brand-gradient" />
          <h2 className="text-base font-semibold text-white">Tiếp tục dự án?</h2>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-ink-400">
          Có một bản nháp được lưu tự động. Bạn có muốn mở tiếp để chỉnh sửa không?
        </p>
        <div className="mb-5 rounded-xl border border-ink-700 bg-ink-850 p-3.5">
          <p className="truncate text-sm font-medium text-white">{candidate.name}</p>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-400">
            <span className="flex items-center gap-1">
              <Film size={12} /> {candidate.clips} clip
            </span>
            <span className="flex items-center gap-1">
              <Clock size={12} /> {formatDuration(candidate.duration)}
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onDismiss}
            className="rounded-lg bg-ink-800 px-4 py-2 text-xs font-medium text-ink-300 hover:bg-ink-700 hover:text-white"
          >
            Dự án mới
          </button>
          <button
            onClick={() => onRestore(candidate.doc)}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-soft"
          >
            Tiếp tục
          </button>
        </div>
      </div>
    </div>
  )
}
