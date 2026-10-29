import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { IPC, type AppInfo } from '@shared/api'
import { createBackup, ensureDailyBackup, listBackups } from './backup'
import { migrate, openDatabase, pendingMigrations, schemaVersion } from './db/database'
import { buildMenu } from './menu'
import { resolveDataPaths, type DataPaths } from './paths'

const HOUR = 60 * 60 * 1000

let db: DatabaseSync
let paths: DataPaths
let mainWindow: BrowserWindow | null = null

app.commandLine.appendSwitch('lang', 'fr')

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
  registerIpc()
  buildMenu({
    backupNow: () => backupNow(),
    openDataFolder: () => void shell.openPath(paths.root)
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
  ensureDailyBackup(db, paths.backups)
  setInterval(() => ensureDailyBackup(db, paths.backups), HOUR)
}

function backupNow(): string {
  return createBackup(db, paths.backups, 'manuelle')
}

function registerIpc(): void {
  ipcMain.handle(IPC.getAppInfo, (): AppInfo => {
    const last = listBackups(paths.backups)[0]
    return {
      version: app.getVersion(),
      platform: process.platform,
      dataDir: paths.root,
      schemaVersion: schemaVersion(db),
      lastBackupAt: last ? last.date.toISOString() : null
    }
  })
  ipcMain.handle(IPC.openDataFolder, async () => {
    await shell.openPath(paths.root)
  })
  ipcMain.handle(IPC.backupNow, () => backupNow())
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
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
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff' }),
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
