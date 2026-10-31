import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { ArticleQuery } from '@shared/api'
import { articleFacets, ensureSearchIndex, ftsQuery, getArticle, reindexArticle, searchArticles } from './articles'
import { migrate, openDatabase } from './db/database'

let db: DatabaseSync

function seed(): void {
  const fam = (name: string) => (db.prepare('SELECT id FROM families WHERE name = ?').get(name) as { id: number }).id
  db.prepare('INSERT INTO categories (id, family_id, name) VALUES (1, ?, ?)').run(fam('Assises'), 'Fauteuils')
  db.prepare('INSERT INTO categories (id, family_id, name) VALUES (2, ?, ?)').run(fam('Rangements'), 'Bibliothèques & étagères')
  db.exec("INSERT INTO suppliers (id, name) VALUES (1, 'Sklum'), (2, 'IKEA')")
  const add = db.prepare(
    'INSERT INTO articles (id, name, category_id, supplier_id, price_cents, price_kind, color_material) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  add.run(1, 'Fauteuil terracotta', 1, 1, 30995, 'fixed', 'velours')
  add.run(2, 'Fauteuil en chêne', 1, 2, 14900, 'fixed', 'chêne')
  add.run(3, 'Étagère murale', 2, 2, 1699, 'fixed', null)
  add.run(4, 'Bibliothèque sur mesure', 2, 1, null, 'on_quote', null)
  db.exec("INSERT INTO images (id, rel_path, sha256) VALUES (1, 'images/articles/ab/abc.jpg', 'abc')")
  db.exec('INSERT INTO article_images (article_id, image_id) VALUES (1, 1)')
  ensureSearchIndex(db)
}

const query = (q: Partial<ArticleQuery>): ArticleQuery => ({
  text: '',
  filters: {},
  sort: 'recent',
  offset: 0,
  limit: 50,
  ...q
})
const names = (q: Partial<ArticleQuery>) => searchArticles(db, query(q)).items.map((a) => a.name)

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  seed()
})

describe('recherche', () => {
  it('ignore les accents et la casse, et accepte les débuts de mots', () => {
    expect(names({ text: 'etagere mur' })).toEqual(['Étagère murale'])
    expect(names({ text: 'CHENE' })).toEqual(['Fauteuil en chêne'])
    expect(names({ text: 'terra' })).toEqual(['Fauteuil terracotta'])
  })

  it('cherche aussi dans le fournisseur, la catégorie et les matières', () => {
    expect(names({ text: 'sklum', sort: 'name' })).toEqual(['Bibliothèque sur mesure', 'Fauteuil terracotta'])
    expect(names({ text: 'bibliotheques', sort: 'name' })).toEqual(['Bibliothèque sur mesure', 'Étagère murale'])
    expect(names({ text: 'velours' })).toEqual(['Fauteuil terracotta'])
  })

  it('exige tous les mots', () => {
    expect(names({ text: 'fauteuil ikea' })).toEqual(['Fauteuil en chêne'])
  })

  it('résiste aux caractères spéciaux', () => {
    expect(ftsQuery('  "fauteuil" (d\'or) * ')).toBe('"fauteuil"* AND "or"*')
    expect(ftsQuery(' ;; ')).toBeNull()
    expect(() => names({ text: 'AND OR NOT "' })).not.toThrow()
  })
})

describe('recherche tolérante', () => {
  const add = (id: number, name: string, category: number | null = null) => {
    db.prepare('INSERT INTO articles (id, name, category_id, price_kind) VALUES (?, ?, ?, ?)').run(id, name, category, 'fixed')
    reindexArticle(db, id)
  }

  it('ignore les petits mots et le pluriel', () => {
    db.prepare('INSERT INTO categories (id, family_id, name) VALUES (3, 2, ?)').run('Tables à manger')
    add(10, 'Table ronde Oslo', 3)
    add(11, 'Tables gigognes')
    expect(names({ text: 'table a manger' })).toEqual(['Table ronde Oslo'])
    expect(names({ text: 'tables', sort: 'name' })).toEqual(['Table ronde Oslo', 'Tables gigognes'])
    expect(names({ text: 'bibliotheques', sort: 'name' })).toEqual(['Bibliothèque sur mesure', 'Étagère murale'])
  })

  it('accepte une faute de frappe dans la recherche', () => {
    expect(names({ text: 'fauteiul', sort: 'name' })).toEqual(['Fauteuil en chêne', 'Fauteuil terracotta'])
    expect(names({ text: 'etagre', sort: 'name' })).toEqual(['Bibliothèque sur mesure', 'Étagère murale'])
    expect(names({ text: 'terracota' })).toEqual(['Fauteuil terracotta'])
  })

  it('retrouve un article dont le nom a été mal écrit', () => {
    add(12, 'Fauteuill rotin')
    expect(names({ text: 'fauteuil', sort: 'name' })).toEqual(['Fauteuil en chêne', 'Fauteuil terracotta', 'Fauteuill rotin'])
    // Un mot proche mais différent et courant n'est pas confondu.
    add(13, 'Porte-revues')
    add(14, 'Poste radio')
    add(15, 'Poste murale')
    expect(names({ text: 'porte' })).toEqual(['Porte-revues'])
  })
})

describe('filtres et tri', () => {
  it('filtre par famille, catégorie, fournisseur et prix', () => {
    const famille = (db.prepare("SELECT id FROM families WHERE name = 'Assises'").get() as { id: number }).id
    expect(names({ filters: { familyId: famille }, sort: 'name' })).toEqual(['Fauteuil en chêne', 'Fauteuil terracotta'])
    expect(names({ filters: { categoryId: 2 }, sort: 'name' })).toEqual(['Bibliothèque sur mesure', 'Étagère murale'])
    expect(names({ filters: { supplierIds: [2] }, sort: 'name' })).toEqual(['Étagère murale', 'Fauteuil en chêne'])
    expect(names({ filters: { priceMinCents: 10000, priceMaxCents: 20000 } })).toEqual(['Fauteuil en chêne'])
  })

  it('trie par prix en laissant les prix sur devis à la fin', () => {
    expect(names({ sort: 'price_asc' })).toEqual([
      'Étagère murale',
      'Fauteuil en chêne',
      'Fauteuil terracotta',
      'Bibliothèque sur mesure'
    ])
    expect(names({ sort: 'price_desc' })[0]).toBe('Fauteuil terracotta')
  })

  it('trie par catégorie comme un catalogue', () => {
    expect(names({ sort: 'category' })).toEqual([
      'Fauteuil terracotta',
      'Fauteuil en chêne',
      'Étagère murale',
      'Bibliothèque sur mesure'
    ])
  })

  it('pagine et donne le total', () => {
    const page = searchArticles(db, query({ limit: 2, offset: 2 }))
    expect(page.total).toBe(4)
    expect(page.items).toHaveLength(2)
  })

  it("compte chaque filtre sans s'appliquer lui-même", () => {
    const f = articleFacets(db, '', { supplierIds: [2] })
    expect(f.suppliers.map((s) => [s.name, s.count])).toEqual([
      ['IKEA', 2],
      ['Sklum', 2]
    ])
    expect(f.families.map((x) => [x.name, x.count])).toEqual([
      ['Assises', 1],
      ['Rangements', 1]
    ])
  })
})

describe('fiche article', () => {
  it('renvoie le détail avec les liens vers les images', () => {
    const a = getArticle(db, 1)!
    expect(a.category).toBe('Fauteuils')
    expect(a.family).toBe('Assises')
    expect(a.thumbnailUrl).toBe('mdeko://miniature/abc')
    expect(a.imageUrls).toEqual(['mdeko://media/images/articles/ab/abc.jpg'])
  })

  it("n'affiche plus un article mis à la corbeille", () => {
    db.exec("UPDATE articles SET deleted_at = '2026-10-29' WHERE id = 3")
    reindexArticle(db, 3)
    expect(getArticle(db, 3)).toBeNull()
    expect(names({ text: 'murale' })).toEqual([])
  })
})
