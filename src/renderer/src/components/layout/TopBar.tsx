import { useEffect, useState } from 'react'
import {
  ArrowUpCircle,
  FolderOpen,
  House,
  Redo2,
  RefreshCw,
  Save,
  Settings,
  Undo2,
  Clapperboard,
  Circle,
  Upload
} from 'lucide-react'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'
import { ASPECT_DIMENSIONS, type AspectRatio } from '@shared/document'
import { IconButton } from '../ui/controls'
import { openProject, saveProject } from '../../App'
import HomeModal from '../HomeModal'
import RecordModal from '../RecordModal'
import KeymapModal from './KeymapModal'
import UpdateModal from '../UpdateModal'
import type { UpdateState } from '../../../../preload'

const RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '21:9']

export default function TopBar() {
  const doc = useProjectStore((s) => s.doc)
  const dirty = useProjectStore((s) => s.dirty)
  const past = useProjectStore((s) => s.past.length)
  const future = useProjectStore((s) => s.future.length)
  const setExportOpen = useEditorStore((s) => s.setExportState)
  const keymapOpen = useEditorStore((s) => s.keymapOpen)
  const setKeymapOpen = useEditorStore((s) => s.setKeymapOpen)
  const [homeOpen, setHomeOpen] = useState(false)
  const [recordOpen, setRecordOpen] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)

  // Follow the main-process updater (background + manual checks both land here).
  useEffect(() => {
    let alive = true
    void window.api.updatesGetState().then((s) => alive && setUpdateState(s))
    const off = window.api.onUpdateState((s) => alive && setUpdateState(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  // Pop the modal once when a new version shows up in the background.
  useEffect(() => {
    if (updateState?.status === 'available') setUpdateOpen(true)
  }, [updateState?.status])

  const pill =
    updateState?.status === 'available'
      ? `Bản mới v${updateState.availableVersion ?? ''}`
      : updateState?.status === 'downloading'
        ? `Đang tải ${Math.round(updateState.progressPercent ?? 0)}%`
        : updateState?.status === 'downloaded'
          ? 'Sẵn sàng cài đặt'
          : null

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-700/60 bg-ink-900 px-3">
      <button
        onClick={() => setHomeOpen(true)}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-white hover:bg-ink-800"
        title="Trang chủ — dự án gần đây"
      >
        <Clapperboard size={20} className="brand-gradient" />
        <span className="text-sm font-bold tracking-tight">
          <span className="brand-gradient">Endy</span>Cut
        </span>
        <House size={13} className="text-ink-400" />
      </button>

      <div className="mx-2 h-6 w-px bg-ink-700" />

      <IconButton title="Hoàn tác (Ctrl+Z)" onClick={() => useProjectStore.getState().undo()} disabled={past === 0}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton title="Làm lại (Ctrl+Y)" onClick={() => useProjectStore.getState().redo()} disabled={future === 0}>
        <Redo2 size={16} />
      </IconButton>

      <div className="mx-1 h-6 w-px bg-ink-700" />

      <input
        value={doc.settings.name}
        onChange={(e) => useProjectStore.getState().setSettings({ name: e.target.value })}
        className="w-56 rounded-md bg-transparent px-2 py-1 text-center text-sm text-white outline-none hover:bg-ink-800 focus:bg-ink-800"
        spellCheck={false}
      />
      {dirty && <span className="text-[11px] text-amber-400">• chưa lưu</span>}

      <div className="flex-1" />

      {pill && (
        <button
          onClick={() => setUpdateOpen(true)}
          title="Có bản cập nhật mới — bấm để xem"
          className="flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent/15 px-3 py-1 text-[11px] font-semibold text-accent hover:bg-accent/25"
        >
          <ArrowUpCircle size={13} />
          {pill}
          {updateState?.status === 'downloading' && updateState.progressPercent != null && (
            <span className="tabular-nums">{Math.round(updateState.progressPercent)}%</span>
          )}
        </button>
      )}
      <IconButton title="Ghi màn hình / camera / giọng nói" onClick={() => setRecordOpen(true)}>
        <Circle size={14} className="text-red-400" fill="currentColor" />
      </IconButton>
      <IconButton
        title="Kiểm tra cập nhật"
        onClick={() => {
          void window.api.updatesCheck()
          setUpdateOpen(true)
        }}
      >
        <RefreshCw size={14} />
      </IconButton>
      <IconButton title="Phím tắt (?)" onClick={() => setKeymapOpen(true)}>
        <Settings size={15} />
      </IconButton>

      <select
        value={doc.settings.aspectRatio}
        onChange={(e) => {
          const ratio = e.target.value as AspectRatio
          const dims = ASPECT_DIMENSIONS[ratio]
          useProjectStore.getState().setSettings({
            aspectRatio: ratio,
            width: dims.width,
            height: dims.height
          })
        }}
        className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
      >
        {RATIOS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <button
        onClick={() => void openProject()}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-ink-300 hover:bg-ink-700 hover:text-white"
      >
        <FolderOpen size={15} /> Mở
      </button>
      <button
        onClick={() => void saveProject()}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-ink-300 hover:bg-ink-700 hover:text-white"
      >
        <Save size={15} /> Lưu
      </button>

      <button
        onClick={() => setExportOpen({ open: true })}
        className="ml-1 flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent-soft"
      >
        <Upload size={14} /> Xuất
      </button>

      {homeOpen && <HomeModal onClose={() => setHomeOpen(false)} />}
      {recordOpen && <RecordModal onClose={() => setRecordOpen(false)} />}
      {keymapOpen && <KeymapModal onClose={() => setKeymapOpen(false)} />}
      {updateOpen && updateState && <UpdateModal state={updateState} onClose={() => setUpdateOpen(false)} />}
    </header>
  )
}
