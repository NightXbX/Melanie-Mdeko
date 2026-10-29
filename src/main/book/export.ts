import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, shell } from 'electron'
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

// Enregistre le book dans le dossier du projet, daté, sans jamais écraser un fichier existant
// (Mélanie retouche parfois le PowerPoint), puis le montre dans le Finder.
export async function exportBook(db: DatabaseSync, paths: DataPaths, projectId: number, format: BookFormat): Promise<string> {
  const data = bookData(db, paths.root, projectId)
  const pages = buildBook(data)
  const content = format === 'pdf' ? await renderPdf(bookHtml(pages)) : await bookPptx(pages, `Design book ${data.clientLabel}`)

  const folder = projectFolder(db, paths, projectId)
  const d = new Date()
  const date = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
  const base = safeName(`Design book ${data.clientLabel} (${date})`)
  let file = join(folder, `${base}.${format}`)
  for (let i = 2; existsSync(file); i++) file = join(folder, `${base} ${i}.${format}`)
  writeFileSync(file, content)
  shell.showItemInFolder(file)
  return file
}
