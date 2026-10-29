import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ArticleCard, CheckGroup, CheckReport, LinkCheckProgress, LinkStatus } from '@shared/api'
import { CARD_COLUMNS, toCard } from './articles'
import type { DataPaths } from './paths'

type Row = Record<string, unknown>

const SHOWN = 120 // articles listés par anomalie (le nombre total est toujours donné)
const DAY = 24 * 60 * 60 * 1000

// Bilan de santé de la base : fichier, cohérence, articles incomplets, en double ou plus à jour.
export function checkDatabase(db: DatabaseSync, paths: DataPaths, now = new Date()): CheckReport {
  const integrity = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check)
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString()

  const articles = (where: string, ...params: (string | number)[]) => {
    const total = (db.prepare(`SELECT count(*) AS n FROM articles a WHERE a.deleted_at IS NULL AND (${where})`).get(...params) as { n: number }).n
    const items = (
      db
        .prepare(
          `SELECT ${CARD_COLUMNS} FROM articles a LEFT JOIN suppliers s ON s.id = a.supplier_id
           WHERE a.deleted_at IS NULL AND (${where}) ORDER BY sans_accents(a.name) LIMIT ${SHOWN}`
        )
        .all(...params) as Row[]
    ).map(toCard)
    return { total, items }
  }

  const groups: CheckGroup[] = []
  const add = (g: Omit<CheckGroup, 'count' | 'articles'>, found: { total: number; items: ArticleCard[] }) => {
    if (found.total) groups.push({ ...g, count: found.total, articles: found.items })
  }

  // Photos enregistrées en base dont le fichier n'est plus dans le dossier.
  const images = db.prepare('SELECT id, rel_path FROM images').all() as { id: number; rel_path: string }[]
  const missing = images.filter((i) => !existsSync(join(paths.root, i.rel_path))).map((i) => i.id)
  if (missing.length) {
    const list = missing.slice(0, 900).join(', ')
    add(
      { id: 'missing-files', severity: 'error', title: 'Photos introuvables', description: `${missing.length} photo${missing.length > 1 ? 's' : ''} manque${missing.length > 1 ? 'nt' : ''} dans le dossier des données.` },
      articles(`EXISTS (SELECT 1 FROM article_images ai WHERE ai.article_id = a.id AND ai.image_id IN (${list}))`)
    )
  }

  add(
    { id: 'gone', severity: 'error', title: 'Produits disparus', description: 'Le lien ne mène plus au produit : il n’est sans doute plus vendu.' },
    articles("a.link_status = 'gone'")
  )
  add(
    { id: 'in-trash', severity: 'warning', title: 'Dans un projet mais à la corbeille', description: 'Ces articles sont encore proposés dans un design book.' },
    {
      total: (db.prepare('SELECT count(DISTINCT na.article_id) AS n FROM need_articles na JOIN articles a ON a.id = na.article_id WHERE a.deleted_at IS NOT NULL').get() as { n: number }).n,
      items: (
        db
          .prepare(
            `SELECT DISTINCT ${CARD_COLUMNS} FROM need_articles na JOIN articles a ON a.id = na.article_id
             LEFT JOIN suppliers s ON s.id = a.supplier_id WHERE a.deleted_at IS NOT NULL LIMIT ${SHOWN}`
          )
          .all() as Row[]
      ).map(toCard)
    }
  )
  add(
    { id: 'duplicates', severity: 'warning', title: 'Doublons possibles', description: 'Plusieurs articles mènent au même produit.' },
    articles('a.url_clean IS NOT NULL AND EXISTS (SELECT 1 FROM articles b WHERE b.url_clean = a.url_clean AND b.id <> a.id AND b.deleted_at IS NULL)')
  )
  add(
    { id: 'stale-price', severity: 'warning', title: 'Prix à revoir', description: 'Prix inchangé depuis plus d’un an.' },
    articles('a.price_cents IS NOT NULL AND a.updated_at < ?', ago(365))
  )
  add(
    { id: 'no-photo', severity: 'info', title: 'Sans photo', description: 'Ajoutez une photo pour qu’ils apparaissent bien dans le book.' },
    articles('NOT EXISTS (SELECT 1 FROM article_images ai WHERE ai.article_id = a.id)')
  )
  add(
    { id: 'no-price', severity: 'info', title: 'Sans prix', description: 'Ni prix, ni « sur devis ».' },
    articles("a.price_cents IS NULL AND a.price_kind <> 'on_quote' AND a.price_text IS NULL")
  )
  add({ id: 'no-link', severity: 'info', title: 'Sans lien', description: 'Aucune adresse du produit.' }, articles('a.url IS NULL'))
  add({ id: 'no-category', severity: 'info', title: 'Sans catégorie', description: 'Ils n’apparaissent dans aucun filtre.' }, articles('a.category_id IS NULL'))
  add(
    { id: 'unverifiable', severity: 'info', title: 'Liens à vérifier à la main', description: 'Le site refuse les vérifications automatiques.' },
    articles("a.link_status = 'unverifiable'")
  )

  const count = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number }).n
  const total = count('SELECT count(*) AS n FROM articles WHERE deleted_at IS NULL')
  return {
    checkedAt: now.toISOString(),
    database: {
      path: paths.database,
      sizeBytes: existsSync(paths.database) ? statSync(paths.database).size : 0,
      ok: integrity.length === 1 && integrity[0] === 'ok' && foreignKeys === 0,
      problems: [...integrity.filter((m) => m !== 'ok'), ...(foreignKeys ? [`${foreignKeys} lien(s) cassé(s) entre les tables`] : [])]
    },
    articles: total,
    images: images.length,
    links: {
      // Lien jamais vérifié, ou vérifié il y a plus de 6 mois.
      toCheck: count(
        "SELECT count(*) AS n FROM articles WHERE deleted_at IS NULL AND url IS NOT NULL AND (link_checked_at IS NULL OR link_checked_at < ?)",
        ago(182)
      ),
      ok: count("SELECT count(*) AS n FROM articles WHERE deleted_at IS NULL AND link_status = 'ok'")
    },
    groups
  }
}

// --- Vérification des liens en ligne ---------------------------------------------------------------

// Statut d'un lien d'après la réponse du site. Les sites qui refusent les robots restent « à vérifier à la main ».
export function linkStatusFor(status: number | null, url: string, finalUrl: string | null): LinkStatus {
  if (status === 404 || status === 410) return 'gone'
  if (status !== null && status >= 200 && status < 300) {
    // Renvoyé vers la page d'accueil : le produit n'existe plus.
    const path = (u: string) => {
      try {
        return new URL(u).pathname.replace(/\/+$/, '')
      } catch {
        return ''
      }
    }
    if (finalUrl && path(url) !== '' && path(finalUrl) === '') return 'gone'
    return 'ok'
  }
  return 'unverifiable'
}

export interface LinkResponse {
  status: number | null // null : pas de réponse (site injoignable, délai dépassé)
  finalUrl: string | null
}

// Vérifie les liens (jamais vérifiés ou vérifiés il y a plus de 6 mois), quelques sites à la fois.
export async function checkLinks(
  db: DatabaseSync,
  fetchLink: (url: string) => Promise<LinkResponse>,
  onProgress: (p: LinkCheckProgress) => void,
  stopped: () => boolean,
  now = () => new Date()
): Promise<LinkCheckProgress> {
  const limit = new Date(now().getTime() - 182 * DAY).toISOString()
  const rows = db
    .prepare(
      "SELECT id, url FROM articles WHERE deleted_at IS NULL AND url IS NOT NULL AND (link_checked_at IS NULL OR link_checked_at < ?) ORDER BY link_checked_at IS NOT NULL, link_checked_at, id"
    )
    .all(limit) as { id: number; url: string }[]
  const progress: LinkCheckProgress = { done: 0, total: rows.length, gone: 0 }
  const update = db.prepare('UPDATE articles SET link_status = ?, link_checked_at = ? WHERE id = ?')
  let next = 0
  const worker = async () => {
    while (next < rows.length && !stopped()) {
      const r = rows[next++]
      let status: LinkStatus
      try {
        const res = await fetchLink(r.url)
        status = linkStatusFor(res.status, r.url, res.finalUrl)
      } catch {
        status = 'unverifiable'
      }
      update.run(status, now().toISOString(), r.id)
      progress.done++
      if (status === 'gone') progress.gone++
      onProgress({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return progress
}
