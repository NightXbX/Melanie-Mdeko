import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import {
  IPC,
  type AppInfo,
  type ArticleFilters,
  type ArticleInput,
  type ArticleQuery,
  type DownloadedImage,
  type ImportSummary,
  type ImageUpload,
  type UndoResult
} from '@shared/api'
import {
  editorChoices,
  emptyTrash,
  getArticleInput,
  listTrash,
  restoreArticle,
  saveArticle,
  trashArticle,
  UndoStack,
  uploadImage
} from './article-edit'
import { articleFacets, getArticle, searchArticles } from './articles'
import { listBackups } from './backup'
import { importPdf } from './import'
import { schemaVersion } from './db/database'
import type { DataPaths } from './paths'

const MAX_PAGE = 200
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024

export function registerIpc(db: DatabaseSync, paths: DataPaths, backupNow: () => string): void {
  const undo = new UndoStack()

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
    await shell.openPath(paths.home)
  })
  ipcMain.handle(IPC.backupNow, () => backupNow())

  ipcMain.handle(IPC.searchArticles, (_e, q: ArticleQuery) =>
    searchArticles(db, { ...q, limit: Math.min(Math.max(q.limit, 1), MAX_PAGE), offset: Math.max(q.offset, 0) })
  )
  ipcMain.handle(IPC.articleFacets, (_e, text: string, filters: ArticleFilters) => articleFacets(db, text, filters))
  ipcMain.handle(IPC.getArticle, (_e, id: number) => getArticle(db, id))

  ipcMain.handle(IPC.editorChoices, () => editorChoices(db))
  ipcMain.handle(IPC.getArticleInput, (_e, id: number) => getArticleInput(db, id))
  ipcMain.handle(IPC.saveArticle, (_e, input: ArticleInput) => saveArticle(db, input, undo))
  ipcMain.handle(IPC.uploadImage, (_e, image: ImageUpload) => uploadImage(db, paths.root, image))
  ipcMain.handle(IPC.downloadImage, (_e, url: string) => downloadImage(url))
  ipcMain.handle(IPC.trashArticle, (_e, id: number) => trashArticle(db, id, undo))
  ipcMain.handle(IPC.restoreArticle, (_e, id: number) => restoreArticle(db, id, undo))
  ipcMain.handle(IPC.listTrash, () => listTrash(db))
  ipcMain.handle(IPC.emptyTrash, () => emptyTrash(db, paths.root, undo))
  ipcMain.handle(IPC.undo, (): UndoResult | null => {
    const entry = undo.pop()
    if (!entry) return null
    entry.undo()
    return { label: entry.label, articleId: entry.articleId }
  })

  // Import d'un design book ou d'une shopping list PDF (un seul à la fois).
  let importing = false
  ipcMain.handle(IPC.importPdf, async (e, path?: string): Promise<ImportSummary | null> => {
    if (importing) throw new Error('Un import est déjà en cours.')
    let file = path
    if (!file) {
      const win = BrowserWindow.fromWebContents(e.sender)
      const options = { title: 'Importer un design book ou une shopping list', properties: ['openFile' as const], filters: [{ name: 'PDF', extensions: ['pdf'] }] }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return null
      file = result.filePaths[0]
    }
    if (!/\.pdf$/i.test(file)) throw new Error('Choisissez un fichier PDF.')
    importing = true
    try {
      return await importPdf(db, paths.root, new Uint8Array(readFileSync(file)), (page, total) => e.sender.send(IPC.importProgress, page, total))
    } finally {
      importing = false
    }
  })

  // Boîte de confirmation native (feuille attachée à la fenêtre sur Mac).
  ipcMain.handle(IPC.confirm, async (e, message: string, detail: string, action: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { type: 'warning' as const, message, detail, buttons: [action, 'Annuler'], defaultId: 0, cancelId: 1 }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return response === 0
  })

  // Seuls les liens web s'ouvrent, dans le navigateur par défaut.
  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
}

// Photo glissée depuis un site web : on récupère l'image à son adresse.
async function downloadImage(url: string): Promise<DownloadedImage> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Cette adresse n'est pas une image du web.")
  const response = await net.fetch(url)
  const mimeType = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!response.ok || !mimeType.startsWith('image/')) throw new Error("Impossible de récupérer cette image.")
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('Cette image est trop lourde.')
  return { bytes, mimeType }
}
