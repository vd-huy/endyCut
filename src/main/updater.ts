import { BrowserWindow, app, ipcMain } from 'electron'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'

/**
 * Auto-update via GitHub Releases (electron-updater). electron-builder's
 * publish config (electron-builder.yml → publish.provider: github) emits
 * latest.yml next to the installer; the release workflow uploads both, and
 * this module checks that feed against the running version.
 *
 * Everything is dynamic + guarded: in dev (or when app-update.yml is absent)
 * the updater reports supported:false instead of crashing at startup.
 */

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  supported: boolean
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  /** 0..100 while downloading, else null. */
  progressPercent: number | null
  error: string | null
}

type AutoUpdater = typeof import('electron-updater')['autoUpdater']

let updater: AutoUpdater | null = null
let wired = false
let autoTimer: NodeJS.Timeout | null = null

const state: UpdateState = {
  supported: false,
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progressPercent: null,
  error: null
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updates:state', state)
  }
}

function setState(patch: Partial<UpdateState>): void {
  Object.assign(state, patch)
  broadcast()
}

async function loadUpdater(): Promise<AutoUpdater | null> {
  if (!app.isPackaged) return null
  try {
    const mod = await import('electron-updater')
    return mod.autoUpdater
  } catch {
    return null
  }
}

function wireEvents(au: NonNullable<AutoUpdater>): void {
  if (wired) return
  wired = true
  au.autoDownload = false // the user starts the download from the update modal
  au.autoInstallOnAppQuit = true
  au.on('checking-for-update', () => setState({ status: 'checking', error: null }))
  au.on('update-available', (info: UpdateInfo) => {
    setState({ status: 'available', availableVersion: String(info?.version ?? ''), error: null })
  })
  au.on('update-not-available', () =>
    setState({ status: 'not-available', availableVersion: null, error: null })
  )
  au.on('download-progress', (progress: ProgressInfo) =>
    setState({
      status: 'downloading',
      progressPercent: Math.min(100, Math.max(0, Number(progress?.percent ?? 0)))
    })
  )
  au.on('update-downloaded', () => setState({ status: 'downloaded', progressPercent: 100 }))
  au.on('error', (error: Error) => {
    // A failed background check is not worth alarming the user about; the
    // manual check surfaces the message in the modal.
    setState({ status: 'error', error: error?.message ?? String(error) })
  })
}

async function checkNow(): Promise<UpdateState> {
  const au = updater ?? (await loadUpdater())
  if (!au) return state
  updater = au
  wireEvents(au)
  setState({ supported: true, status: 'checking', error: null })
  try {
    await au.checkForUpdates()
  } catch (error) {
    setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
  return state
}

export async function downloadUpdate(): Promise<UpdateState> {
  const au = updater
  if (!au || state.status !== 'available') return state
  setState({ status: 'downloading', progressPercent: 0 })
  try {
    await au.downloadUpdate()
  } catch (error) {
    setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
  return state
}

export function installUpdate(): void {
  // Silent NSIS install into the existing directory, then relaunch.
  updater?.quitAndInstall(true, true)
}

/** Register IPC + start the periodic background check (packaged builds only). */
export function initUpdater(): void {
  ipcMain.handle('updates:getState', () => state)
  ipcMain.handle('updates:check', () => checkNow())
  ipcMain.handle('updates:download', () => downloadUpdate())
  ipcMain.handle('updates:install', () => {
    installUpdate()
    return true
  })

  // One check shortly after launch, then every 6 hours.
  setTimeout(() => {
    void checkNow()
    if (autoTimer) clearInterval(autoTimer)
    autoTimer = setInterval(() => void checkNow(), 6 * 60 * 60 * 1000)
  }, 5_000)
}
