import { useState } from 'react'
import {
  Download,
  FolderOpen,
  House,
  Redo2,
  Save,
  Settings,
  Undo2,
  Clapperboard,
  Circle
} from 'lucide-react'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'
import { ASPECT_DIMENSIONS, type AspectRatio } from '@shared/document'
import { IconButton } from '../ui/controls'
import { openProject, saveProject } from '../../App'
import HomeModal from '../HomeModal'
import RecordModal from '../RecordModal'
import KeymapModal from './KeymapModal'

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

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-3">
      <button
        onClick={() => setHomeOpen(true)}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-white hover:bg-ink-800"
        title="Trang chủ — dự án gần đây"
      >
        <Clapperboard size={20} className="text-accent" />
        <span className="text-sm font-semibold">CutClone</span>
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
        className="w-56 rounded-md bg-transparent px-2 py-1 text-sm text-white outline-none hover:bg-ink-800 focus:bg-ink-800"
        spellCheck={false}
      />
      {dirty && <span className="text-[11px] text-amber-400">• chưa lưu</span>}

      <div className="flex-1" />

      <IconButton title="Ghi màn hình / camera / giọng nói" onClick={() => setRecordOpen(true)}>
        <Circle size={14} className="text-red-400" fill="currentColor" />
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
        className="ml-1 flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-soft"
      >
        <Download size={15} /> Xuất video
      </button>

      {homeOpen && <HomeModal onClose={() => setHomeOpen(false)} />}
      {recordOpen && <RecordModal onClose={() => setRecordOpen(false)} />}
      {keymapOpen && <KeymapModal onClose={() => setKeymapOpen(false)} />}
    </header>
  )
}
