// Orchestrates "paste a CapCut template link → auto-set up the project".
// Two stages:
//  1. 'link'  — resolve the public template page, adopt its canvas settings and
//               drop the official preview video in as a locked reference track.
//  2. 'draft' — if the user has opened the template once in CapCut desktop
//               ("Dùng mẫu"), the full draft (tracks, segments, texts, speeds,
//               transitions) is on disk and gets imported completely.
import { importAssetFromFile } from '../media/assets'
import { useProjectStore } from '../../store/projectStore'
import { useEditorStore } from '../../store/editorStore'
import { createClip, createProjectDocument, createTrack } from '@shared/document'
import type { CapcutDraftInfo, TemplateMeta } from '../../../../preload'
import {
  capcutDraftToDocument,
  closestAspect,
  type CapcutDraftContent
} from './capcutDraft'

export interface TemplateImportOutcome {
  stage: 'link' | 'draft'
  meta: TemplateMeta | null
  warnings: string[]
  message: string
}

export function templateIdFromMetaJson(raw: string | null): string {
  if (!raw) return ''
  const m = /"(?:draft_cloud_template_id|template_id)"\s*:\s*"?(\d{10,25})"?/.exec(raw)
  return m ? m[1] : ''
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'template'
}

function joinPath(base: string, ...parts: string[]): string {
  return `${base.replace(/[\\/]+$/, '')}/${parts.join('/')}`
}

async function userDataPath(): Promise<string> {
  const p = await window.api.getUserDataPath()
  if (!p) throw new Error('Ứng dụng chưa sẵn sàng, thử lại sau vài giây.')
  return p
}

export async function listCapcutDrafts(): Promise<CapcutDraftInfo[]> {
  return window.api.listCapcutDrafts()
}

export async function findDraftForTemplate(templateId: string): Promise<CapcutDraftInfo | null> {
  if (!templateId) return null
  const drafts = await listCapcutDrafts()
  return drafts.find((d) => d.templateId === templateId) ?? null
}

/**
 * Import the full edit structure from a CapCut desktop draft folder and load
 * it as the current project. Remote (cloud) materials are downloaded into the
 * app data folder; missing local files are reported as warnings.
 */
export async function importDraftFromFolder(
  folder: string,
  onStatus: (s: string) => void,
  ref?: { sourceUrl?: string; templateId?: string; title?: string }
): Promise<{ warnings: string[] }> {
  onStatus('Đang đọc draft CapCut…')
  const { content, meta } = await window.api.readCapcutDraft(folder)
  let parsed: CapcutDraftContent
  try {
    parsed = JSON.parse(content) as CapcutDraftContent
  } catch {
    throw new Error('draft_content.json không đọc được (có thể bị mã hóa bởi phiên bản CapCut mới).')
  }
  const folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? 'CapCut draft'
  const templateId = ref?.templateId || templateIdFromMetaJson(meta)

  onStatus('Đang dựng timeline theo mẫu…')
  const result = capcutDraftToDocument(parsed, {
    draftFolder: folder,
    draftName: ref?.title || folderName,
    sourceUrl: ref?.sourceUrl,
    templateId
  })

  if (result.downloads.length > 0) {
    onStatus(`Đang tải ${result.downloads.length} media từ mẫu…`)
    const dir = joinPath(await userDataPath(), 'templates', sanitizeName(templateId || folderName))
    let failed = 0
    for (const d of result.downloads) {
      try {
        const dest = await window.api.downloadTemplateFile(d.url, joinPath(dir, d.fileName))
        const asset = result.doc.mediaLibrary.find((a) => a.id === d.assetId)
        if (asset) {
          asset.path = dest
          asset.fileName = d.fileName
        }
      } catch {
        failed++
      }
    }
    if (failed > 0) {
      result.warnings.push(`Không tải được ${failed} media từ máy chủ mẫu — thay media của bạn vào chỗ trống.`)
    }
  }

  if (result.doc.tracks.length === 0) {
    throw new Error('Draft không chứa track nào CutClone hỗ trợ (video/âm thanh/chữ).')
  }

  useProjectStore.getState().loadDocument(result.doc)
  useEditorStore.getState().setPlayhead(0)
  return { warnings: result.warnings }
}

/**
 * Paste-a-link flow. Always resolves public metadata and builds the project
 * skeleton (canvas + locked preview reference track). If the full draft is
 * already on disk (user opened the template once in CapCut), it is imported
 * instead and the skeleton is skipped.
 */
export async function importTemplateFromLink(
  rawUrl: string,
  onStatus: (s: string) => void
): Promise<TemplateImportOutcome> {
  onStatus('Đang đọc trang mẫu từ capcut.com…')
  const meta = await window.api.resolveTemplateLink(rawUrl)
  if (!meta.title && !meta.templateId) {
    throw new Error('Không đọc được thông tin mẫu từ link này.')
  }
  const warnings: string[] = []

  // Fast path: full draft already downloaded by CapCut desktop.
  onStatus('Đang tìm draft của mẫu này trên máy…')
  const match = await findDraftForTemplate(meta.templateId)
  if (match) {
    const result = await importDraftFromFolder(match.folder, onStatus, {
      sourceUrl: meta.resolvedUrl || rawUrl,
      templateId: meta.templateId,
      title: match.name || meta.title
    })
    return {
      stage: 'draft',
      meta,
      warnings: result.warnings,
      message: `Đã dựng đầy đủ theo mẫu "${meta.title || match.name}" từ draft CapCut. Xuất video khi bạn sẵn sàng.`
    }
  }

  // Skeleton from public metadata: canvas + official preview as reference.
  const skeleton = await buildSkeletonFromMeta(meta, rawUrl, warnings, onStatus)
  useProjectStore.getState().loadDocument(skeleton)
  useEditorStore.getState().setPlayhead(0)
  return {
    stage: 'link',
    meta,
    warnings,
    message:
      'Đã dựng khung theo mẫu (tỉ lệ, thời lượng, video mẫu làm tham chiếu). ' +
      'Để tự động dựng đầy đủ từng clip: mở mẫu này trong CapCut một lần (nút "Dùng mẫu"), ' +
      'sau đó bấm "Nhập draft từ CapCut" trong tab Mẫu.'
  }
}

async function buildSkeletonFromMeta(
  meta: TemplateMeta,
  rawUrl: string,
  warnings: string[],
  onStatus: (s: string) => void
) {
  const doc = createProjectDocument(`Mẫu: ${meta.title || 'CapCut'}`)
  if (meta.width && meta.height) {
    doc.settings.aspectRatio = closestAspect(meta.width, meta.height)
    doc.settings.width = Math.max(240, Math.round(meta.width / 2) * 2)
    doc.settings.height = Math.max(240, Math.round(meta.height / 2) * 2)
  }

  let previewAssetId: string | undefined
  let coverPath: string | undefined
  const tplDir = joinPath(await userDataPath(), 'templates', sanitizeName(meta.templateId || 'link'))

  if (meta.previewVideoUrl) {
    onStatus('Đang tải video xem trước của mẫu…')
    try {
      const dest = await window.api.downloadTemplateFile(meta.previewVideoUrl, joinPath(tplDir, 'preview.mp4'))
      onStatus('Đang phân tích video mẫu…')
      const asset = await importAssetFromFile(dest)
      doc.mediaLibrary.push(asset)
      const track = createTrack('video', 'Tham chiếu mẫu (khóa)')
      track.locked = true
      const clip = createClip({
        kind: 'video',
        assetId: asset.id,
        start: 0,
        duration: asset.duration || meta.durationMs / 1000 || 5
      })
      track.clips.push(clip)
      doc.tracks = [track, ...doc.tracks]
      previewAssetId = asset.id
    } catch (error) {
      warnings.push(`Không tải được video xem trước: ${String(error)}`)
    }
  } else {
    warnings.push('Mẫu này không có video xem trước công khai.')
  }

  if (meta.coverUrl) {
    try {
      coverPath = await window.api.downloadTemplateFile(meta.coverUrl, joinPath(tplDir, 'cover.jpg'))
    } catch {
      // cover is decorative
    }
  }

  doc.templateRef = {
    sourceUrl: meta.resolvedUrl || rawUrl,
    templateId: meta.templateId,
    title: meta.title,
    authorName: meta.authorName || undefined,
    coverPath: coverPath || undefined,
    previewAssetId,
    stage: 'link'
  }
  return doc
}
