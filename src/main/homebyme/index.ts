import type { DatabaseSync } from 'node:sqlite'
import { ipcMain, net } from 'electron'
import { HOMEBYME_METHODS, IPC, type ArticleCard, type HbmObject, type HbmPreviewObject, type HomeByMeApi } from '@shared/api'
import { cleanUrl } from '@shared/url'
import { CARD_COLUMNS, searchArticles, toCard } from '../articles'
import { readHomeByMeProject } from './read'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Accept-Language': 'fr-FR,fr;q=0.9'
}
const SUGGESTIONS = 3

async function get(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await net.fetch(url, { headers: HEADERS, signal: controller.signal })
    if (!res.ok) throw new Error(res.status === 404 ? 'Ce projet HomeByMe est introuvable : vérifiez qu’il est bien partagé.' : `HomeByMe ne répond pas (erreur ${res.status}).`)
    return res
  } catch (e) {
    if (controller.signal.aborted) throw new Error('HomeByMe met trop de temps à répondre. Réessayez dans un moment.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function card(db: DatabaseSync, where: string, value: string | number): ArticleCard | null {
  const FROM = 'FROM articles a LEFT JOIN suppliers s ON s.id = a.supplier_id'
  const row = db.prepare(`SELECT ${CARD_COLUMNS} ${FROM} WHERE ${where} = ? AND a.deleted_at IS NULL LIMIT 1`).get(value)
  return row ? toCard(row as Record<string, unknown>) : null
}

// Ce que Mdeko sait déjà de chaque objet : association retenue, même lien qu'un article, ou noms proches.
export function previewObject(db: DatabaseSync, o: HbmObject): HbmPreviewObject {
  const link = db.prepare('SELECT article_id, ignored FROM homebyme_links WHERE object_key = ?').get(o.key) as
    | { article_id: number | null; ignored: number }
    | undefined
  const remembered = link?.article_id ? card(db, 'a.id', link.article_id) : null
  const clean = o.url ? cleanUrl(o.url) : null
  const article = remembered ?? (clean ? card(db, 'a.url_clean', clean) : null)
  const suggestions = article || o.kind === 'product' ? [] : suggest(db, o.name)
  return { ...o, article, remembered: remembered !== null, ignored: !article && link?.ignored === 1, suggestions }
}

// Articles au nom proche : le nom entier d'abord, sinon chacun de ses mots (« Applique OLIA » → les appliques).
function suggest(db: DatabaseSync, name: string): ArticleCard[] {
  const find = (text: string) => searchArticles(db, { text, filters: {}, sort: 'relevance', offset: 0, limit: SUGGESTIONS }).items
  const all = find(name)
  if (all.length) return all
  for (const word of name.match(/\p{L}{4,}/gu) ?? []) {
    const found = find(word)
    if (found.length) return found
  }
  return []
}

export function rememberObject(db: DatabaseSync, key: string, articleId: number | null, ignored: boolean): void {
  db.prepare(
    `INSERT INTO homebyme_links (object_key, article_id, ignored) VALUES (?, ?, ?)
     ON CONFLICT (object_key) DO UPDATE SET article_id = excluded.article_id, ignored = excluded.ignored`
  ).run(key, articleId, ignored ? 1 : 0)
}

// « Canapé droit LEONARD velours » : on cherche chacun des premiers mots dans la shopping list et on garde
// la catégorie très majoritaire (« Canapés »). Rien de sûr : pas de catégorie (mieux qu'une fausse).
export function guessCategory(db: DatabaseSync, name: string): number | null {
  const words = (name.match(/\p{L}{4,}/gu) ?? []).slice(0, 3)
  for (const word of words) {
    const ids = searchArticles(db, { text: word, filters: {}, sort: 'relevance', offset: 0, limit: 20 }).items.map((a) => a.id)
    if (ids.length < 3) continue
    const rows = db
      .prepare(`SELECT category_id AS id, count(*) AS n FROM articles WHERE id IN (${ids.map(() => '?').join(', ')}) AND category_id IS NOT NULL GROUP BY category_id ORDER BY n DESC LIMIT 1`)
      .all(...ids) as { id: number; n: number }[]
    if (rows[0] && rows[0].n >= 4 && rows[0].n * 10 >= ids.length * 7) return rows[0].id
  }
  return null
}

// Implémentation côté processus principal de window.mdeko.homebyme.
export function registerHomeByMeIpc(db: DatabaseSync): void {
  const api: HomeByMeApi = {
    read: async (projectId, url) => {
      const project = await readHomeByMeProject(
        url,
        async (u) => (await get(u)).text(),
        async (u) => (await get(u)).json()
      )
      db.prepare('UPDATE projects SET homebyme_url = ? WHERE id = ?').run(url.trim(), projectId)
      return { title: project.title, objects: project.objects.map((o) => previewObject(db, o)) }
    },
    remember: async (key, articleId, ignored) => rememberObject(db, key, articleId, ignored),
    guessCategory: async (name) => guessCategory(db, name)
  }

  ipcMain.handle(IPC.homebyme, (_e, method: string, ...args: unknown[]) => {
    if (!(HOMEBYME_METHODS as readonly string[]).includes(method)) throw new Error(`Méthode inconnue : ${method}`)
    return (api[method as keyof HomeByMeApi] as (...a: unknown[]) => unknown)(...args)
  })
}
