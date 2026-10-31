// Liste des migrations, dans l'ordre. Pour en ajouter une : créer NNN_nom.sql et l'importer ici.
// Ne jamais modifier une migration déjà livrée.
import m001 from './001_schema_initial.sql?raw'
import m002 from './002_recherche.sql?raw'
import m003 from './003_book_edition.sql?raw'
import m004 from './004_book_ajustements.sql?raw'
import m005 from './005_quantites_options_tendance.sql?raw'
import m006 from './006_teintes_reperes.sql?raw'
import m007 from './007_description_article.sql?raw'

export const SOURCES: Record<string, string> = {
  '001_schema_initial': m001,
  '002_recherche': m002,
  '003_book_edition': m003,
  '004_book_ajustements': m004,
  '005_quantites_options_tendance': m005,
  '006_teintes_reperes': m006,
  '007_description_article': m007
}
