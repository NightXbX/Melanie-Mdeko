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
  type ProductPrefill,
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
import { checkDatabase, checkLinks, type LinkResponse } from './check'
import { importPdf } from './import'
import { parseProductPage, type ProductInfo } from './product-page'
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
  ipcMain.handle(IPC.readProductPage, async (_e, url: string): Promise<ProductPrefill | null> => {
    const info = await readProductPage(url)
    if (!info) return null
    return { name: info.name, priceCents: info.priceCents, supplier: supplierFor(db, url) ?? info.siteName, description: info.description, imageUrls: info.imageUrls }
  })
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

  // Vérification de la base, et des liens en ligne (un passage à la fois, interruptible).
  ipcMain.handle(IPC.checkDatabase, () => checkDatabase(db, paths))
  ipcMain.handle(IPC.showDatabase, () => shell.showItemInFolder(paths.database))
  let linkCheck: { stop: boolean } | null = null
  ipcMain.handle(IPC.checkLinks, async (e) => {
    if (linkCheck) throw new Error('La vérification des liens est déjà en cours.')
    const run = { stop: false }
    linkCheck = run
    try {
      return await checkLinks(db, fetchLink, (p) => !e.sender.isDestroyed() && e.sender.send(IPC.linkProgress, p), () => run.stop)
    } finally {
      linkCheck = null
    }
  })
  ipcMain.handle(IPC.stopLinkCheck, () => {
    if (linkCheck) linkCheck.stop = true
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

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-FR,fr;q=0.9'
}

// Fournisseur déjà connu pour ce site (kavehome.com → « Kave Home »).
function supplierFor(db: DatabaseSync, url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    const row = db
      .prepare("SELECT name FROM suppliers WHERE domain IS NOT NULL AND (? = domain OR ? LIKE '%.' || domain) ORDER BY length(domain) DESC LIMIT 1")
      .get(host, host) as { name: string } | undefined
    return row?.name ?? null
  } catch {
    return null
  }
}

// Page produit : d'abord une simple lecture (rapide), puis, si le site ne répond pas ou construit sa page
// par script, une fenêtre invisible qui l'ouvre comme un navigateur. null : rien de lisible.
async function readProductPage(url: string): Promise<ProductInfo | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await net.fetch(url, { redirect: 'follow', signal: controller.signal, headers: BROWSER_HEADERS })
    if (response.ok && (response.headers.get('content-type') ?? '').includes('html')) {
      const info = parseProductPage(await response.text(), response.url || url)
      if (info?.name && info.imageUrls.length) return info
    }
  } catch {
    // Site injoignable par cette voie : on essaie avec la fenêtre invisible.
  } finally {
    clearTimeout(timer)
  }
  return readWithBrowser(url)
}

async function readWithBrowser(url: string): Promise<ProductInfo | null> {
  // Session à part, en mémoire : rien n'est gardé (cookies, cache) après la lecture.
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, partition: 'lecture-produit', images: false } })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.session.on('will-download', (e) => e.preventDefault())
  try {
    await Promise.race([
      win.loadURL(url, { userAgent: BROWSER_HEADERS['User-Agent'] }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), 25000))
    ])
    // Laisse aux scripts de la page le temps d'ajouter les informations du produit.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const html = (await win.webContents.executeJavaScript('document.documentElement.outerHTML')) as string
    return parseProductPage(html, win.webContents.getURL() || url)
  } catch {
    return null
  } finally {
    win.destroy()
  }
}

// Ouvre la page du produit comme un navigateur (beaucoup de sites refusent les requêtes sans en-têtes).
async function fetchLink(url: string): Promise<LinkResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await net.fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: BROWSER_HEADERS
    })
    void response.body?.cancel().catch(() => undefined)
    return { status: response.status, finalUrl: response.url || null }
  } catch {
    return { status: null, finalUrl: null }
  } finally {
    clearTimeout(timer)
  }
}
