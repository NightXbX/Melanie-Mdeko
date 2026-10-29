import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, dialog, shell } from 'electron'
import type { BookFormat } from '@shared/projects'
import { bookData } from './data'
import { bookHtml } from './html'
import { buildBook } from './layout'
import { bookPptx } from './pptx'

export function previewHtml(db: DatabaseSync, dataRoot: string, projectId: number): string {
  return bookHtml(buildBook(bookData(db, dataRoot, projectId)), true)
}

// PDF : la même page HTML que l'aperçu, imprimée par Chromium (liens cliquables, police intégrée).
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

// Demande où enregistrer, écrit le fichier et le montre dans le Finder. Renvoie le chemin, ou null si annulé.
export async function exportBook(
  db: DatabaseSync,
  dataRoot: string,
  projectId: number,
  format: BookFormat,
  parent: BrowserWindow | null
): Promise<string | null> {
  const data = bookData(db, dataRoot, projectId)
  const lastDir = (db.prepare("SELECT value FROM settings WHERE key = 'export_dir'").get() as { value: string } | undefined)?.value
  const name = `Design book ${data.clientLabel}.${format}`
  const options = {
    title: 'Enregistrer le design book',
    defaultPath: join(lastDir ?? app.getPath('documents'), name),
    filters: [format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'PowerPoint', extensions: ['pptx'] }]
  }
  const { canceled, filePath } = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return null

  const pages = buildBook(data)
  const content = format === 'pdf' ? await renderPdf(bookHtml(pages)) : await bookPptx(pages, `Design book ${data.clientLabel}`)
  writeFileSync(filePath, content)
  db.prepare("INSERT INTO settings (key, value) VALUES ('export_dir', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    join(filePath, '..')
  )
  shell.showItemInFolder(filePath)
  return filePath
}
