import { useEffect, useState } from 'react'
import { Clapperboard, FilePlus2, Film, FolderOpen, Trash2, X } from 'lucide-react'
import type { RecentProjectEntry } from '../../../preload'
import { resetToNewDocument, useProjectStore } from '../store/projectStore'
import { useEditorStore } from '../store/editorStore'
import { openProject } from '../App'
import { formatDateTime } from '../lib/format'

/**
 * CapCut-style home screen: start a new project or reopen a recent one.
 * Shown on demand from the TopBar home button.
 */
export default function HomeModal({ onClose }: { onClose: () => void }) {
  const [recent, setRecent] = useState<RecentProjectEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api
      .recentProjects()
      .then(setRecent)
      .catch(() => setRecent([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openRecent = async (entry: RecentProjectEntry) => {
    try {
      const json = await window.api.readProjectFile(entry.path)
      const parsed = JSON.parse(json)
      if (!parsed?.tracks || !parsed?.settings) throw new Error('Định dạng không hợp lệ')
      useProjectStore.getState().loadDocument(parsed)
      useProjectStore.getState().markSaved(entry.path)
      useEditorStore.getState().setPlayhead(0)
      void window.api.addRecentProject(entry.path, parsed.settings?.name ?? entry.name)
      onClose()
    } catch (error) {
      window.alert(`Không mở được dự án: ${String(error)}`)
    }
  }

  const removeRecent = async (entry: RecentProjectEntry) => {
    const list = await window.api.removeRecentProject(entry.path)
    setRecent(list)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70">
      <div className="max-h-[86vh] w-[560px] overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Clapperboard size={22} className="text-accent" />
            <h2 className="text-lg font-semibold">CutClone</h2>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              resetToNewDocument()
              onClose()
            }}
            className="flex flex-col items-center gap-2 rounded-xl bg-accent px-4 py-5 text-white hover:bg-accent-soft"
          >
            <FilePlus2 size={22} />
            <span className="text-sm font-semibold">Dự án mới</span>
          </button>
          <button
            onClick={async () => {
              const opened = await openProject()
              if (opened) onClose()
            }}
            className="flex flex-col items-center gap-2 rounded-xl bg-ink-800 px-4 py-5 text-white hover:bg-ink-700"
          >
            <FolderOpen size={22} />
            <span className="text-sm font-semibold">Mở file dự án</span>
          </button>
        </div>

        <h3 className="mb-2 text-sm font-medium text-ink-300">Dự án gần đây</h3>
        {loading ? (
          <p className="py-6 text-center text-xs text-ink-500">Đang tải…</p>
        ) : recent.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-500">
            Chưa có dự án nào. Lưu một dự án để thấy nó ở đây.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((entry) => (
              <li
                key={entry.path}
                className="group flex items-center gap-3 rounded-lg bg-ink-800/70 px-3 py-2 hover:bg-ink-800"
              >
                <Film size={16} className="shrink-0 text-accent" />
                <button onClick={() => void openRecent(entry)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-xs font-medium text-white">{entry.name}</p>
                  <p className="truncate text-[10px] text-ink-500">
                    {entry.path} · {formatDateTime(entry.openedAt)}
                  </p>
                </button>
                <button
                  onClick={() => void removeRecent(entry)}
                  className="shrink-0 text-ink-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  title="Xóa khỏi danh sách"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
