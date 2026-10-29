// Liste des migrations, dans l'ordre. Pour en ajouter une : créer NNN_nom.sql et l'importer ici.
// Ne jamais modifier une migration déjà livrée.
import m001 from './001_schema_initial.sql?raw'
import m002 from './002_recherche.sql?raw'
import m003 from './003_book_edition.sql?raw'

export const SOURCES: Record<string, string> = {
  '001_schema_initial': m001,
  '002_recherche': m002,
  '003_book_edition': m003
}
