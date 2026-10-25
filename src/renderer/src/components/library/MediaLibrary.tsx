import { useState } from 'react'
import { FolderPlus, Plus, Trash2, Search } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { useEditorStore } from '../../store/editorStore'
import { importAssets } from '../../core/media/assets'
import { mediaUrlFor } from '../../core/media/assets'
import { formatDuration } from '../../lib/format'
import { EmptyLibraryHint } from '../layout/LeftPanel'

export default function MediaLibrary() {
  const assets = useProjectStore((s) => s.doc.mediaLibrary)
  const addAssets = useProjectStore((s) => s.addAssetsToLibrary)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const addAssetToTimeline = useProjectStore((s) => s.addAssetToTimeline)
  const playhead = useEditorStore((s) => s.playhead)
  const setNotice = useEditorStore((s) => s.setImportNotice)
  const [query, setQuery] = useState('')

  const pickFiles = async () => {
    const paths = await window.api.pickMediaFiles()
    if (paths.length === 0) return
    setNotice(`Đang nhập ${paths.length} tệp…`)
    await importAssets(
      paths,
      (asset) => addAssets([asset]),
      (path, err) => {
        console.warn('Import lỗi', path, err)
        setNotice(`Lỗi nhập: ${path.split(/[\\/]/).pop()}`)
        setTimeout(() => setNotice(null), 3000)
      }
    )
    setNotice(null)
  }

  const visible = assets.filter((a) =>
    query ? a.fileName.toLowerCase().includes(query.toLowerCase()) : true
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-2">
        <button
          onClick={() => void pickFiles()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent/90 px-3 py-2 text-xs font-semibold text-white hover:bg-accent"
        >
          <FolderPlus size={14} /> Nhập
        </button>
        <div className="flex flex-1 items-center gap-1.5 rounded-md bg-ink-800 px-2 py-1.5">
          <Search size={13} className="text-ink-400" />
          <input
            placeholder="Tìm…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-white outline-none"
          />
        </div>
      </div>

      {assets.length === 0 ? (
        <EmptyLibraryHint onPick={() => void pickFiles()} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-2">
          {visible.map((asset) => (
            <div
              key={asset.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-cc-asset', asset.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => addAssetToTimeline(asset.id, playhead)}
              className="group relative overflow-hidden rounded-lg bg-ink-800 ring-1 ring-ink-700 hover:ring-accent"
            >
              <div className="flex h-20 items-center justify-center bg-black/40">
                {asset.thumbnail ? (
                  <img src={asset.thumbnail} alt="" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-2xl">{asset.kind === 'audio' ? '🎵' : '🎞️'}</span>
                )}
              </div>
              <div className="px-1.5 py-1">
                <p className="truncate text-[11px] text-white" title={asset.fileName}>
                  {asset.fileName}
                </p>
                <p className="text-[10px] text-ink-400">
                  {asset.kind === 'image'
                    ? `${asset.width}×${asset.height}`
                    : asset.kind === 'audio'
                      ? formatDuration(asset.duration)
                      : `${formatDuration(asset.duration)} · ${asset.width}×${asset.height}`}
                </p>
              </div>
              <button
                title="Thêm vào timeline"
                onClick={() => addAssetToTimeline(asset.id, playhead)}
                className="absolute right-1 top-1 hidden rounded bg-accent p-1 text-white group-hover:block"
              >
                <Plus size={12} />
              </button>
              <button
                title="Xóa khỏi thư viện"
                onClick={() => removeAsset(asset.id)}
                className="absolute left-1 top-1 hidden rounded bg-black/70 p-1 text-ink-300 hover:text-red-400 group-hover:block"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function assetThumbUrl(path: string): string {
  return mediaUrlFor(path)
}
