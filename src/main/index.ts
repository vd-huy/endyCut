import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync, promises as fsPromises } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { registerMediaProtocol } from './mediaProtocol'
import { initUpdater } from './updater'
import {
  downloadTemplateFile,
  listCapcutDrafts,
  readCapcutDraft,
  resolveTemplateLink
} from './templateFetch'

const isDev = !!process.env.ELECTRON_RENDERER_URL

// Dev-only CDP endpoint for automated UI verification. Must be set before
// Chromium initializes.
if (isDev) app.commandLine.appendSwitch('remote-debugging-port', '9223')

let mainWindow: BrowserWindow | null = null

const AUTO_SAVE_FILE = () => path.join(app.getPath('userData'), 'autosave.json')
const RECENT_PROJECTS_FILE = () => path.join(app.getPath('userData'), 'recent-projects.json')
const GENERATED_DIR = () => path.join(app.getPath('userData'), 'generated')
const PROXY_DIR = () => path.join(app.getPath('userData'), 'proxy')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 760,
    show: false,
    backgroundColor: '#0d0d12',
    autoHideMenuBar: true,
    title: 'EndyCut',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'
])

function isValidMediaPath(p: string): boolean {
  if (!path.isAbsolute(p)) return false
  return MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())
}

function contentTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase()
  const map: Record<string, string> = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
  }
  return map[ext] ?? 'application/octet-stream'
}

/** Run a PowerShell script and return trimmed stdout. */
function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message)))
        else resolve(String(stdout).trim())
      }
    )
  })
}

export interface RecentProjectEntry {
  path: string
  name: string
  openedAt: number
}

async function readRecentProjects(): Promise<RecentProjectEntry[]> {
  try {
    const raw = await fsPromises.readFile(RECENT_PROJECTS_FILE(), 'utf-8')
    const list = JSON.parse(raw) as RecentProjectEntry[]
    return Array.isArray(list) ? list.filter((e) => e && typeof e.path === 'string') : []
  } catch {
    return []
  }
}

async function writeRecentProjects(list: RecentProjectEntry[]): Promise<void> {
  await fsPromises.writeFile(RECENT_PROJECTS_FILE(), JSON.stringify(list.slice(0, 20)), 'utf-8')
}

app.whenReady().then(() => {
  registerMediaProtocol()

  ipcMain.handle('media:pickFiles', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Nhập media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: [...MEDIA_EXTENSIONS].map((e) => e.slice(1)) }
      ]
    })
    return result.canceled ? [] : result.filePaths.filter(isValidMediaPath)
  })

  ipcMain.handle('media:fileSize', async (_e, filePath: string) => {
    if (!isValidMediaPath(filePath)) throw new Error('Invalid media path')
    const stat = await fsPromises.stat(filePath)
    return stat.size
  })

  ipcMain.handle('media:readSlice', async (_e, filePath: string, start: number, length: number) => {
    if (!isValidMediaPath(filePath)) throw new Error('Invalid media path')
    if (!Number.isFinite(start) || !Number.isFinite(length) || start < 0 || length <= 0 || length > 64 * 1024 * 1024) {
      throw new Error('Invalid read range')
    }
    const handle = await fsPromises.open(filePath, 'r')
    try {
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  })

  ipcMain.handle('project:save', async (_e, filePath: string, json: string) => {
    if (!filePath.endsWith('.json')) filePath += '.json'
    await fsPromises.writeFile(filePath, json, 'utf-8')
    return filePath
  })

  ipcMain.handle('project:pickSavePath', async () => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu dự án',
      defaultPath: 'du-an.endycut.json',
      filters: [{ name: 'EndyCut Project', extensions: ['json'] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('project:pickOpenPath', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Mở dự án',
      properties: ['openFile'],
      filters: [{ name: 'EndyCut Project', extensions: ['json'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('project:read', async (_e, filePath: string) => {
    return fsPromises.readFile(filePath, 'utf-8')
  })

  ipcMain.handle('project:autosave', async (_e, json: string) => {
    await fsPromises.writeFile(AUTO_SAVE_FILE(), json, 'utf-8')
  })

  ipcMain.handle('project:readAutosave', async () => {
    try {
      return await fsPromises.readFile(AUTO_SAVE_FILE(), 'utf-8')
    } catch {
      return null
    }
  })

  // Recent projects (CapCut-style home list).
  ipcMain.handle('project:recentList', () => readRecentProjects())
  ipcMain.handle('project:recentAdd', async (_e, filePath: string, name: string) => {
    const list = (await readRecentProjects()).filter((e) => e.path !== filePath)
    list.unshift({ path: filePath, name: name || path.basename(filePath), openedAt: Date.now() })
    await writeRecentProjects(list)
    return list
  })
  ipcMain.handle('project:recentRemove', async (_e, filePath: string) => {
    const list = (await readRecentProjects()).filter((e) => e.path !== filePath)
    await writeRecentProjects(list)
    return list
  })

  // Write a data-URL payload into userData and return the absolute path
  // (used by freeze-frame capture and other generated media).
  ipcMain.handle('data:writeFile', async (_e, dataUrl: string, fileName: string) => {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl)
    if (!match) throw new Error('Invalid data URL')
    await fsPromises.mkdir(GENERATED_DIR(), { recursive: true })
    const safeName = (fileName || `gen-${Date.now()}.png`).replace(/[\\/:*?"<>|]/g, '-')
    const filePath = path.join(GENERATED_DIR(), safeName)
    await fsPromises.writeFile(filePath, Buffer.from(match[2], 'base64'))
    return filePath
  })

  // Advanced color grading: pick + read an Adobe .cube LUT.
  ipcMain.handle('color:pickLutPath', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Nhập LUT (.cube)',
      properties: ['openFile'],
      filters: [{ name: 'LUT', extensions: ['cube'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('color:readLut', async (_e, filePath: string) => {
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.cube') {
      throw new Error('Invalid LUT path')
    }
    return fsPromises.readFile(filePath, 'utf-8')
  })

  // Preview proxies: persist renderer-produced mp4 bytes under userData/proxy
  // and return the path. Only used for smooth playback, never for export.
  ipcMain.handle('media:writeProxy', async (_e, sourcePath: string, data: ArrayBuffer) => {
    await fsPromises.mkdir(PROXY_DIR(), { recursive: true })
    const id = path
      .basename(sourcePath)
      .toLowerCase()
      .replace(/[^a-z0-9.+-]+/g, '_')
      .slice(0, 48)
    const filePath = path.join(PROXY_DIR(), `${id}.${Date.now()}.proxy.mp4`)
    const buffer = Buffer.from(data as ArrayBuffer)
    if (buffer.length === 0) throw new Error('Empty proxy payload')
    await fsPromises.writeFile(filePath, buffer)
    return filePath
  })

  // Windows local text-to-speech via SAPI (runs fully offline).
  ipcMain.handle('tts:listVoices', async () => {
    try {
      const out = await runPowerShell(
        'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + \'|\' + $_.VoiceInfo.Culture }'
      )
      return out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, culture] = line.split('|')
          return { name, culture: culture ?? '' }
        })
    } catch {
      return []
    }
  })

  ipcMain.handle('tts:synthesize', async (_e, text: string, voice: string, rate: number) => {
    const clean = String(text).replace(/'/g, "''")
    const voiceArg = voice ? String(voice).replace(/'/g, "''") : ''
    await fsPromises.mkdir(GENERATED_DIR(), { recursive: true })
    const filePath = path.join(GENERATED_DIR(), `tts-${Date.now()}.wav`)
    const clampedRate = Math.min(10, Math.max(-10, Math.round(Number(rate) || 0)))
    const script = [
      "Add-Type -AssemblyName System.Speech",
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      voiceArg ? `$s.SelectVoice('${voiceArg}')` : '$null',
      `$s.Rate = ${clampedRate}`,
      `$s.SetOutputToWaveFile('${filePath.replace(/'/g, "''")}')`,
      `$s.Speak('${clean}')`,
      '$s.Dispose()'
    ]
      .filter((line) => line !== '$null')
      .join('; ')
    await runPowerShell(script)
    return filePath
  })

  ipcMain.handle('export:pickSavePath', async (_e, extension?: string) => {
    if (!mainWindow) return null
    const ext = extension === 'webm' ? 'webm' : 'mp4'
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Xuất video',
      defaultPath: `video-xuat.${ext}`,
      filters: [{ name: ext === 'webm' ? 'WebM Video' : 'MP4 Video', extensions: [ext] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('export:write', async (_e, filePath: string, data: ArrayBuffer) => {
    await fsPromises.writeFile(filePath, Buffer.from(data))
    return true
  })

  ipcMain.handle('srt:pickOpenPath', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Nhập phụ đề SRT',
      properties: ['openFile'],
      filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('srt:pickSavePath', async () => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Xuất phụ đề SRT',
      defaultPath: 'phu-de.srt',
      filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('srt:read', async (_e, filePath: string) => {
    if (!filePath.toLowerCase().endsWith('.srt')) throw new Error('Invalid subtitle path')
    return fsPromises.readFile(filePath, 'utf-8')
  })

  ipcMain.handle('srt:write', async (_e, filePath: string, content: string) => {
    if (!filePath.toLowerCase().endsWith('.srt')) filePath += '.srt'
    await fsPromises.writeFile(filePath, content, 'utf-8')
    return filePath
  })

  ipcMain.handle('shell:showItemInFolder', (_e, p: string) => {
    if (typeof p !== 'string' || !p.trim()) return false
    // UI paths may use forward slashes or a missing separator after the drive.
    const normalized = path.normalize(p.replace(/\//g, path.sep))
    const target = path.isAbsolute(normalized) ? normalized : path.resolve(normalized)
    try {
      if (existsSync(target) && shell.showItemInFolder(target)) return true
    } catch {
      // fall through to the folder fallback
    }
    const dir = path.dirname(target)
    if (existsSync(dir)) {
      void shell.openPath(dir)
      return true
    }
    return false
  })

  // Only https URLs — the update modal links to the GitHub releases page.
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (typeof url !== 'string' || !/^https:\/\/(github\.com|api\.github\.com)\//i.test(url)) return false
    void shell.openExternal(url)
    return true
  })

  ipcMain.handle('template:resolveLink', (_e, url: string) => resolveTemplateLink(url))
  ipcMain.handle('template:downloadFile', (_e, url: string, destPath: string) =>
    downloadTemplateFile(url, destPath)
  )
  ipcMain.handle('template:listDrafts', () => listCapcutDrafts())
  ipcMain.handle('template:readDraft', (_e, folder: string) => readCapcutDraft(folder))

  ipcMain.handle('app:userDataPath', () => app.getPath('userData'))

  initUpdater()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Referenced by contentTypeFor users in mediaProtocol; kept exported for tests.
export { contentTypeFor }
