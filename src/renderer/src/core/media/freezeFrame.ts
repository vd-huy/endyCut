import type { MediaAsset } from '@shared/document'
import { getEngineInstance } from '../playbackInstance'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'

/**
 * Capture the current preview frame of a video clip as a PNG asset and insert
 * an image clip at the playhead (CapCut-style freeze frame).
 */
export async function freezeFrameAtPlayhead(clipId: string): Promise<boolean> {
  const project = useProjectStore.getState()
  const found = project.findClip(clipId)
  if (!found || found.clip.kind !== 'video') return false
  const playhead = useEditorStore.getState().playhead
  if (playhead < found.clip.start || playhead >= found.clip.start + found.clip.duration) {
    window.alert('Đặt playhead trong phạm vi clip trước khi đóng băng khung hình.')
    return false
  }
  const engine = getEngineInstance()
  const sourceCanvas = engine?.getPreviewCanvas()
  if (!sourceCanvas) {
    window.alert('Chưa có khung hình để chụp.')
    return false
  }
  const out = document.createElement('canvas')
  out.width = project.doc.settings.width
  out.height = project.doc.settings.height
  const ctx = out.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height)
  const dataUrl = out.toDataURL('image/png')
  let filePath: string
  try {
    filePath = await window.api.writeDataFile(dataUrl, `freeze-${Date.now()}.png`)
  } catch (error) {
    console.error('Freeze frame save failed', error)
    window.alert('Không lưu được khung hình đóng băng.')
    return false
  }
  const asset: MediaAsset = {
    id: crypto.randomUUID(),
    kind: 'image',
    path: filePath,
    fileName: `Khung đóng băng ${new Date().toLocaleTimeString('vi-VN')}.png`,
    duration: 0,
    width: out.width,
    height: out.height,
    thumbnail: dataUrl,
    importedAt: Date.now()
  }
  project.addAssetsToLibrary([asset])
  project.addAssetToTimeline(asset.id, playhead)
  return true
}
