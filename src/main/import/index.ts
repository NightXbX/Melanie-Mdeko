import type { DatabaseSync } from 'node:sqlite'
import type { ImportSummary } from '@shared/api'
import { BookImporter } from './apply'
import { readBook } from './read-pdf'

export type { ImportSummary }

// Importe un design book PDF (nouveau projet + articles) ou une shopping list PDF (articles seuls).
// Tout se fait dans une transaction : en cas d'erreur, la base reste telle qu'avant.
export async function importPdf(
  db: DatabaseSync,
  dataRoot: string,
  pdf: Uint8Array,
  onProgress: (page: number, total: number) => void = () => {}
): Promise<ImportSummary> {
  const mupdf = await import('mupdf')
  const importer = new BookImporter(db, dataRoot)
  let total = 0
  db.exec('BEGIN')
  try {
    for await (const event of readBook(mupdf, pdf)) {
      if (event.kind === 'start') total = event.pages
      if (event.kind === 'progress') onProgress(event.page, total)
      else importer.handle(event)
    }
    const summary = importer.finish()
    db.exec('COMMIT')
    return summary
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
