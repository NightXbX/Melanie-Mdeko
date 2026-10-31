import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, dialog, shell } from 'electron'
import type { Page } from '@shared/book'
import type { BookFormat } from '@shared/projects'
import type { DataPaths } from '../paths'
import { getProject, projectTitle } from '../projects'
import { bookData } from './data'
import { bookHtml } from './html'
import { buildBook } from './layout'
import { bookPptx } from './pptx'

export function bookPages(db: DatabaseSync, paths: DataPaths, projectId: number): Page[] {
  return buildBook(bookData(db, paths.root, projectId))
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '') || 'Projet'

// Projets/2026/Mme Durand : toujours au même endroit, rangé par année du design book.
export function projectFolder(db: DatabaseSync, paths: DataPaths, projectId: number): string {
  const p = getProject(db, projectId)
  if (!p) throw new Error('Projet introuvable.')
  const year = (p.bookDate ?? new Date().toISOString()).slice(0, 4)
  const folder = join(paths.projects, year, safeName(projectTitle(p.clientTitle, p.clientName)))
  mkdirSync(folder, { recursive: true })
  return folder
}

// PDF : la même mise en page que l'aperçu, imprimée par Chromium (liens cliquables, police intégrée).
async function renderPdf(html: string): Promise<Buffer> {
  const tmp = join(app.getPath('temp'), `mdeko-book-${Date.now()}.html`)
  writeFileSync(tmp, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadFile(tmp)
    await win.webContents.executeJavaScript(
      'document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null)))).then(() => true)'
    )
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
  } finally {
    win.destroy()
    rmSync(tmp, { force: true })
  }
}

const LAST_FOLDER = 'last_export_dir'

const today = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

// « Design book Mme Durand (31-10-2026).pdf », numéroté s'il existe déjà : on n'écrase jamais un fichier.
function freeName(folder: string, clientLabel: string, format: BookFormat): string {
  const base = safeName(`Design book ${clientLabel} (${today()})`)
  let file = join(folder, `${base}.${format}`)
  for (let i = 2; existsSync(file); i++) file = join(folder, `${base} ${i}.${format}`)
  return file
}

async function bookContent(pages: Page[], format: BookFormat, clientLabel: string): Promise<Buffer> {
  return format === 'pdf' ? renderPdf(bookHtml(pages)) : bookPptx(pages, `Design book ${clientLabel}`)
}

// Book créé dans le dossier du projet (pièce jointe d'un mail, par exemple), sans rien demander.
export async function saveBookInProject(db: DatabaseSync, paths: DataPaths, projectId: number, format: BookFormat): Promise<string> {
  const data = bookData(db, paths.root, projectId)
  const file = freeName(projectFolder(db, paths, projectId), data.clientLabel, format)
  writeFileSync(file, await bookContent(buildBook(data), format, data.clientLabel))
  return file
}

// Dossier proposé : celui du dernier enregistrement (son cloud, par exemple), sinon le dossier du projet.
function suggestedFolder(db: DatabaseSync, paths: DataPaths, projectId: number): string {
  const last = (db.prepare('SELECT value FROM settings WHERE key = ?').get(LAST_FOLDER) as { value: string } | undefined)?.value
  try {
    if (last && statSync(last).isDirectory()) return last
  } catch {
    // Dossier supprimé ou disque débranché : on propose le dossier du projet.
  }
  return projectFolder(db, paths, projectId)
}

// « Enregistrer sous » : Mélanie choisit où ranger le book (le dernier dossier est reproposé, avec un nom daté
// qui n'écrase rien), puis le fichier est montré dans le Finder. null : elle a annulé.
export async function exportBook(
  db: DatabaseSync,
  paths: DataPaths,
  projectId: number,
  format: BookFormat,
  win: BrowserWindow | null
): Promise<string | null> {
  const data = bookData(db, paths.root, projectId)
  const suggested = freeName(suggestedFolder(db, paths, projectId), data.clientLabel, format)

  const options = {
    title: format === 'pdf' ? 'Enregistrer le design book en PDF' : 'Enregistrer le design book en PowerPoint',
    buttonLabel: 'Enregistrer',
    defaultPath: suggested,
    filters: [format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'PowerPoint', extensions: ['pptx'] }],
    properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  const file = /\.(pdf|pptx)$/i.test(result.filePath) ? result.filePath : `${result.filePath}.${format}`

  writeFileSync(file, await bookContent(buildBook(data), format, data.clientLabel))
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(LAST_FOLDER, dirname(file))
  shell.showItemInFolder(file)
  return file
}
