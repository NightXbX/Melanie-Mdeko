import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { ensureSearchIndex } from './articles'
import { createBackup, ensureDailyBackup } from './backup'
import { migrate, openDatabase, pendingMigrations, schemaVersion } from './db/database'
import { registerIpc } from './ipc'
import { registerAiIpc } from './ai'
import { registerProjectsIpc } from './projects-ipc'
import { handleMedia, registerMediaScheme } from './media'
import { buildMenu } from './menu'
import { resolveDataPaths, type DataPaths } from './paths'
import { registerUpdates } from './update'

const HOUR = 60 * 60 * 1000

let db: DatabaseSync
let paths: DataPaths
let mainWindow: BrowserWindow | null = null

app.commandLine.appendSwitch('lang', 'fr')
// Mélanie travaille en mode clair, quel que soit le réglage du Mac.
nativeTheme.themeSource = 'light'
registerMediaScheme()

// Une seule instance : deux fenêtres qui écrivent dans la même base, c'est le risque de conflit.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start)
}

function start(): void {
  try {
    openData()
  } catch (error) {
    dialog.showErrorBox(
      "Impossible d'ouvrir vos données",
      `${(error as Error).message}\n\nVos données n'ont pas été modifiées.`
    )
    app.exit(1)
    return
  }

  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: app.getVersion(),
    copyright: 'm·deko'
  })
  handleMedia(paths.root, (sha) => {
    const row = db.prepare('SELECT rel_path FROM images WHERE sha256 = ?').get(sha) as { rel_path: string } | undefined
    return row?.rel_path ?? null
  })
  registerIpc(db, paths, backupNow)
  registerProjectsIpc(db, paths)
  registerAiIpc(db, paths)
  registerUpdates(db, paths)
  buildMenu({
    backupNow: () => backupNow(),
    openDataFolder: () => void shell.openPath(paths.home)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function openData(): void {
  paths = resolveDataPaths()
  db = openDatabase(paths.database)
  // Sauvegarde systématique avant de faire évoluer la structure d'une base existante.
  if (schemaVersion(db) > 0 && pendingMigrations(db).length > 0) {
    createBackup(db, paths.backups, 'avant-mise-a-jour')
  }
  migrate(db)
  ensureSearchIndex(db)
  ensureDailyBackup(db, paths.backups)
  setInterval(() => ensureDailyBackup(db, paths.backups), HOUR)
}

function backupNow(): string {
  return createBackup(db, paths.backups, 'manuelle')
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: app.name,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: 'sidebar',
          visualEffectState: 'followWindow',
          backgroundColor: '#00000000'
        }
      : { backgroundColor: '#ffffff' }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Les liens web s'ouvrent dans le navigateur, jamais dans l'appli.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  db?.close()
})
