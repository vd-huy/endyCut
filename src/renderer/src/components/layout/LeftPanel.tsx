import { FolderPlus, Type, Wand2, ArrowRightLeft, Film, Music, ImageIcon, LayoutTemplate, Sparkles, Smile } from 'lucide-react'
import { useEditorStore, type LeftTab } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'
import MediaLibrary from '../library/MediaLibrary'
import TextPanel from '../library/TextPanel'
import EffectsPanel from '../library/EffectsPanel'
import EffectsLibraryPanel from '../library/EffectsLibraryPanel'
import TransitionsPanel from '../library/TransitionsPanel'
import TemplatePanel from '../library/TemplatePanel'
import StickerPanel from '../library/StickerPanel'
import { formatDuration } from '../../lib/format'

const TABS: Array<{ id: LeftTab; label: string; icon: typeof Film }> = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'template', label: 'Mẫu', icon: LayoutTemplate },
  { id: 'video-effects', label: 'Hiệu ứng', icon: Sparkles },
  { id: 'text', label: 'Chữ', icon: Type },
  { id: 'stickers', label: 'Sticker', icon: Smile },
  { id: 'transitions', label: 'Chuyển cảnh', icon: ArrowRightLeft },
  { id: 'effects', label: 'Bộ lọc', icon: Wand2 }
]

export default function LeftPanel() {
  const tab = useEditorStore((s) => s.leftTab)
  const setTab = useEditorStore((s) => s.setLeftTab)
  const library = useProjectStore((s) => s.doc.mediaLibrary)

  const totals = library.reduce(
    (acc, a) => {
      acc.duration += a.kind !== 'image' ? a.duration : 0
      if (a.kind === 'video') acc.videos++
      else if (a.kind === 'audio') acc.audios++
      else acc.images++
      return acc
    },
    { duration: 0, videos: 0, audios: 0, images: 0 }
  )

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-ink-700/60 bg-ink-900">
      <nav className="grid shrink-0 grid-cols-7 border-b border-ink-700/60">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-col items-center gap-1 py-2.5 text-[9px] transition-colors ${
              tab === id ? 'border-b-2 border-accent text-accent' : 'border-b-2 border-transparent text-ink-400 hover:text-ink-300'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' && <MediaLibrary />}
        {tab === 'template' && <TemplatePanel />}
        {tab === 'video-effects' && <EffectsLibraryPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'stickers' && <StickerPanel />}
        {tab === 'transitions' && <TransitionsPanel />}
        {tab === 'effects' && <EffectsPanel />}
      </div>

      <footer className="shrink-0 border-t border-ink-700/60 px-3 py-2 text-[11px] text-ink-400">
        <div className="flex items-center justify-between">
          <span>
            {totals.videos} video · {totals.audios} âm thanh · {totals.images} ảnh
          </span>
          <span>{formatDuration(totals.duration)}</span>
        </div>
      </footer>
    </aside>
  )
}

export function EmptyLibraryHint({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex gap-2 text-ink-600">
        <FilmIcon />
        <MusicIcon />
        <ImgIcon />
      </div>
      <p className="text-xs text-ink-400">
        Kéo thả tệp vào cửa sổ
        <br />
        hoặc
      </p>
      <button
        onClick={onPick}
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-soft"
      >
        <FolderPlus size={15} /> Nhập media
      </button>
    </div>
  )
}

function FilmIcon() {
  return <ImageIcon size={26} className="rotate-0" />
}
function MusicIcon() {
  return <Music size={26} />
}
function ImgIcon() {
  return <ImageIcon size={26} className="-scale-x-100" />
}
