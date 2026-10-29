import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArticleInput } from '@shared/api'
import { getArticleInput, listTrash, restoreArticle, saveArticle, trashArticle, UndoStack, uploadImage } from './article-edit'
import { ensureSearchIndex, searchArticles } from './articles'
import { migrate, openDatabase } from './db/database'

let db: DatabaseSync
let undo: UndoStack
let root: string

const input = (over: Partial<ArticleInput> = {}): ArticleInput => ({
  id: null,
  name: 'Fauteuil Ulit',
  priceCents: 37900,
  priceKind: 'fixed',
  supplier: 'Kave Home',
  url: 'https://kavehome.com/fr/fr/p/fauteuil-ulit?utm_source=google',
  categoryId: null,
  dimensions: '75 × 80 cm',
  colorMaterial: 'chenille vert',
  tags: ['Scandinave', 'Cosy'],
  privateNote: 'Existe en terracotta',
  images: [],
  ...over
})

const find = (text: string) => searchArticles(db, { text, filters: {}, sort: 'name', offset: 0, limit: 10 }).items

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  ensureSearchIndex(db)
  undo = new UndoStack()
  root = mkdtempSync(join(tmpdir(), 'mdeko-edit-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('enregistrement', () => {
  it('crée un article, son fournisseur et ses étiquettes, et le rend cherchable', () => {
    const id = saveArticle(db, input(), undo)
    const a = getArticleInput(db, id)!
    expect(a.supplier).toBe('Kave Home')
    expect(a.tags).toEqual(['Cosy', 'Scandinave'])
    expect(find('scandinave').map((x) => x.id)).toEqual([id])
    const row = db.prepare('SELECT url_clean FROM articles WHERE id = ?').get(id) as { url_clean: string }
    expect(row.url_clean).toBe('https://kavehome.com/fr/fr/p/fauteuil-ulit')
  })

  it('réutilise un fournisseur existant sans tenir compte de la casse', () => {
    saveArticle(db, input(), undo)
    saveArticle(db, input({ name: 'Autre', supplier: 'kave home' }), undo)
    expect(db.prepare('SELECT count(*) AS n FROM suppliers').get()).toEqual({ n: 1 })
  })

  it("garde l'historique des prix", () => {
    const id = saveArticle(db, input(), undo)
    saveArticle(db, { ...getArticleInput(db, id)!, priceCents: 34900 }, undo)
    expect(db.prepare('SELECT old_cents, new_cents FROM price_history').all()).toEqual([
      { old_cents: 37900, new_cents: 34900 }
    ])
  })

  it('refuse un article sans nom', () => {
    expect(() => saveArticle(db, input({ name: '  ' }), undo)).toThrow(/nom/)
  })
})

describe('corbeille et annulation', () => {
  it('met à la corbeille puis restaure', () => {
    const id = saveArticle(db, input(), undo)
    trashArticle(db, id, undo)
    expect(find('ulit')).toEqual([])
    expect(listTrash(db).map((a) => a.id)).toEqual([id])
    restoreArticle(db, id, undo)
    expect(find('ulit').map((a) => a.id)).toEqual([id])
  })

  it('annule une mise à la corbeille, une modification et un ajout', () => {
    const id = saveArticle(db, input(), undo)
    saveArticle(db, { ...getArticleInput(db, id)!, name: 'Fauteuil renommé', tags: [] }, undo)
    trashArticle(db, id, undo)

    undo.pop()!.undo()
    expect(getArticleInput(db, id)!.name).toBe('Fauteuil renommé')
    undo.pop()!.undo()
    expect(getArticleInput(db, id)!.name).toBe('Fauteuil Ulit')
    expect(getArticleInput(db, id)!.tags).toEqual(['Cosy', 'Scandinave'])
    undo.pop()!.undo()
    expect(getArticleInput(db, id)).toBeNull()
    expect(undo.pop()).toBeUndefined()
  })
})

describe('photos', () => {
  const photo = (byte: number) => ({
    bytes: new Uint8Array([byte, 1, 2, 3]),
    ext: 'jpeg',
    width: 800,
    height: 600,
    thumbnail: new Uint8Array([9, 9])
  })

  it("enregistre la photo et sa miniature une seule fois, et l'associe à l'article", () => {
    const a = uploadImage(db, root, photo(1))
    const b = uploadImage(db, root, photo(1))
    expect(b.id).toBe(a.id)
    expect(a.url).toMatch(/^mdeko:\/\/media\/images\/articles\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/)
    expect(existsSync(join(root, decodeURIComponent(a.url.replace('mdeko://media/', ''))))).toBe(true)
    const id = saveArticle(db, input({ images: [a] }), undo)
    expect(getArticleInput(db, id)!.images).toEqual([a])
  })

  it('refuse un format inconnu', () => {
    expect(() => uploadImage(db, root, { ...photo(2), ext: 'heic' })).toThrow(/format/)
  })
})
