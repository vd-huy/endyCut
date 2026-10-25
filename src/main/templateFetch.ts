// CapCut template link resolution, metadata scraping, file downloads and
// CapCut desktop draft folder discovery. Runs in the Electron main process so
// requests bypass renderer CORS and can reach %LOCALAPPDATA% directly.
import { app, net } from 'electron'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export interface TemplateMeta {
  templateId: string
  title: string
  desc: string
  authorName: string
  coverUrl: string
  previewVideoUrl: string
  width: number
  height: number
  /** Preview/template duration in milliseconds (0 when unknown). */
  durationMs: number
  segmentAmount: number
  usageAmount: number
  resolvedUrl: string
}

export interface CapcutDraftInfo {
  folder: string
  name: string
  modifiedAt: number
  templateId: string
  hasContent: boolean
}

const TEMPLATE_ID_PATTERNS = [
  /template-detail\/(?:[^/?#]+\/)?(\d{10,25})/,
  /[?&]template_?id=(\d{10,25})/i
]

export function parseTemplateId(url: string): string | null {
  for (const re of TEMPLATE_ID_PATTERNS) {
    const m = re.exec(url)
    if (m) return m[1]
  }
  return null
}

export async function resolveTemplateLink(rawUrl: string): Promise<TemplateMeta> {
  let url = rawUrl.trim()
  if (!url) throw new Error('Chưa nhập link mẫu')
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Link không hợp lệ')
  }
  if (!/(^|\.)capcut\.com$/i.test(parsed.hostname)) {
    throw new Error('Chỉ hỗ trợ link mẫu từ capcut.com')
  }

  // Web-editor template links (capcut.com/editor-template/<guid>?templateId=…)
  // don't embed template JSON; their numeric id resolves via the SEO
  // template-detail page, which does.
  let fetchUrl = url
  if (/\/editor-template\//i.test(parsed.pathname)) {
    const id = parseTemplateId(url)
    if (id) fetchUrl = `https://www.capcut.com/template-detail/${id}`
  }

  // Short share links (capcut.com/t/xxx) resolve via redirects to the
  // template-detail page, which carries the template JSON inline. The SSR
  // page is occasionally served without the JSON blob (verification /
  // interstitial), so a few attempts are needed.
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200))
    try {
      const response = await net.fetch(fetchUrl, {
        headers: {
          'user-agent': DESKTOP_UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9'
        },
        redirect: 'follow'
      })
      if (!response.ok) {
        throw new Error(`Không mở được trang mẫu (HTTP ${response.status}). Kiểm tra lại link.`)
      }
      const html = await response.text()
      const meta = extractTemplateMeta(html)
      if (!meta) {
        throw new Error(
          `Trang mẫu không chứa dữ liệu dự kiến (url=${response.url}, ${html.length} bytes).`
        )
      }
      meta.resolvedUrl = response.url || url
      if (!meta.templateId) meta.templateId = parseTemplateId(meta.resolvedUrl) ?? ''
      return meta
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  const message = lastError?.message ?? 'Lỗi không xác định'
  if (message.includes('không chứa dữ liệu dự kiến')) {
    throw new Error(
      'Không đọc được dữ liệu mẫu sau vài lần thử — CapCut có thể đang chặn hoặc đổi cấu trúc trang. Thử lại sau ít phút.'
    )
  }
  throw lastError ?? new Error('Không đọc được trang mẫu')
}

/** Pull templateDetail out of the SSR JSON blob embedded in the page. */
export function extractTemplateMeta(html: string): TemplateMeta | null {
  const m = /<script[^>]*id="__MODERN_ROUTER_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  let data: unknown
  try {
    data = JSON.parse(m[1])
  } catch {
    return null
  }
  const loaders = (data as { loaderData?: Record<string, unknown> }).loaderData ?? {}
  let detail: Record<string, unknown> | null = null
  for (const value of Object.values(loaders)) {
    const v = value as { templateDetail?: Record<string, unknown> }
    if (v && typeof v === 'object' && v.templateDetail) {
      detail = v.templateDetail
      break
    }
  }
  if (!detail) return null
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const author = detail.author as { nickname?: unknown; name?: unknown } | null
  return {
    templateId: str(detail.templateId),
    title: str(detail.title),
    desc: str(detail.desc),
    authorName: author ? str(author.nickname) || str(author.name) : '',
    coverUrl: str(detail.coverUrl),
    previewVideoUrl: str(detail.videoUrl),
    width: num(detail.videoWidth),
    height: num(detail.videoHeight),
    durationMs: num(detail.templateDuration),
    segmentAmount: num(detail.segmentAmount),
    usageAmount: num(detail.usageAmount),
    resolvedUrl: ''
  }
}

export async function downloadTemplateFile(url: string, destPath: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL tải không hợp lệ')
  // Writes are only allowed inside the app's own data folder.
  const allowedRoot = path.resolve(app.getPath('userData'))
  const dest = path.resolve(destPath)
  if (!dest.startsWith(allowedRoot + path.sep)) {
    throw new Error('Đường dẫn lưu không hợp lệ')
  }
  const response = await net.fetch(url, {
    headers: { 'user-agent': DESKTOP_UA },
    redirect: 'follow'
  })
  if (!response.ok) throw new Error(`Tải tệp thất bại (HTTP ${response.status})`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 512 * 1024 * 1024) throw new Error('Tệp quá lớn (>512MB)')
  await fsPromises.mkdir(path.dirname(dest), { recursive: true })
  await fsPromises.writeFile(dest, buffer)
  return dest
}

/**
 * Known CapCut / JianYing desktop draft roots on Windows. Users open a
 * template once in CapCut ("Dùng mẫu") and the full draft lands in one of
 * these folders — that draft is the reliable source for full structure import.
 */
export function capcutDraftRoots(): string[] {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  const bases = ['CapCut', 'JianyingPro', 'CapCut CN', '剪映专业版']
  return bases.map((b) =>
    path.join(localAppData, b, 'User Data', 'Projects', 'com.lveditor.draft')
  )
}

function draftNameFromMeta(raw: string): string {
  const m = /"draft_name"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)
  if (!m) return ''
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return ''
  }
}

function templateIdFromMeta(raw: string): string {
  const m = /"(?:draft_cloud_template_id|template_id)"\s*:\s*"?(\d{10,25})"?/.exec(raw)
  return m ? m[1] : ''
}

export async function listCapcutDrafts(): Promise<CapcutDraftInfo[]> {
  const out: CapcutDraftInfo[] = []
  for (const root of capcutDraftRoots()) {
    let entries: string[]
    try {
      entries = await fsPromises.readdir(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      const folder = path.join(root, entry)
      let stat
      try {
        stat = await fsPromises.stat(folder)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      let hasContent = false
      try {
        await fsPromises.access(path.join(folder, 'draft_content.json'))
        hasContent = true
      } catch {
        // draft_meta_info-only folders are stale; skip
        continue
      }
      let name = entry
      let templateId = ''
      try {
        const metaRaw = await fsPromises.readFile(
          path.join(folder, 'draft_meta_info.json'),
          'utf-8'
        )
        name = draftNameFromMeta(metaRaw) || entry
        templateId = templateIdFromMeta(metaRaw)
      } catch {
        // meta file optional
      }
      out.push({
        folder,
        name,
        modifiedAt: stat.mtimeMs,
        templateId,
        hasContent
      })
    }
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export async function readCapcutDraft(
  folder: string
): Promise<{ content: string; meta: string | null }> {
  if (!path.isAbsolute(folder)) throw new Error('Đường dẫn draft không hợp lệ')
  const content = await fsPromises.readFile(path.join(folder, 'draft_content.json'), 'utf-8')
  let meta: string | null = null
  try {
    meta = await fsPromises.readFile(path.join(folder, 'draft_meta_info.json'), 'utf-8')
  } catch {
    // optional
  }
  return { content, meta }
}
