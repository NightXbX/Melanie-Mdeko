import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { HbmObject } from '@shared/api'
import { ensureSearchIndex } from '../articles'
import { migrate, openDatabase } from '../db/database'
import { guessCategory, previewObject, rememberObject } from '.'

let db: DatabaseSync

const object = (over: Partial<HbmObject>): HbmObject => ({
  key: 'community:1',
  kind: 'community',
  name: 'Applique Nuage',
  brand: null,
  url: null,
  description: null,
  imageUrl: null,
  size: null,
  rooms: [{ name: null, count: 1 }],
  ...over
})

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  const fam = (db.prepare("SELECT id FROM families WHERE name = 'Luminaires'").get() as { id: number }).id
  db.prepare("INSERT INTO categories (id, family_id, name) VALUES (1, ?, 'Appliques')").run(fam)
  const add = db.prepare("INSERT INTO articles (id, name, category_id, price_kind, url, url_clean) VALUES (?, ?, 1, 'fixed', ?, ?)")
  for (let i = 1; i <= 5; i++) add.run(i, `Applique murale ${i}`, null, null)
  add.run(6, 'Table Oslo', 'https://exemple.fr/oslo?utm_source=x', 'https://exemple.fr/oslo')
  ensureSearchIndex(db)
})

describe('import HomeByMe', () => {
  it('reconnaît un produit déjà dans la shopping list par son lien', () => {
    const p = previewObject(db, object({ key: 'product:9', kind: 'product', name: 'Oslo table', url: 'https://exemple.fr/oslo' }))
    expect(p.article?.id).toBe(6)
    expect(p.remembered).toBe(false)
  })

  it('propose des articles au nom proche, mot par mot si besoin', () => {
    expect(previewObject(db, object({})).suggestions.map((a) => a.name)).toHaveLength(3)
    expect(previewObject(db, object({ name: 'Lampe inconnue' })).suggestions).toEqual([])
  })

  it('se souvient des choix pour les projets suivants', () => {
    rememberObject(db, 'community:1', 2, false)
    const p = previewObject(db, object({}))
    expect(p.article?.id).toBe(2)
    expect(p.remembered).toBe(true)
    rememberObject(db, 'community:7', null, true)
    expect(previewObject(db, object({ key: 'community:7', name: 'Pouf' })).ignored).toBe(true)
  })

  it('devine la catégorie seulement si elle est nette', () => {
    expect(guessCategory(db, 'Applique OLIA laiton')).toBe(1)
    expect(guessCategory(db, 'Round coffee table')).toBeNull()
  })
})
