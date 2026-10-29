import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkDatabase, checkLinks, linkStatusFor } from './check'
import { migrate, openDatabase } from './db/database'
import type { DataPaths } from './paths'

let db: DatabaseSync
let dir: string
let paths: DataPaths

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mdeko-check-'))
  paths = { home: dir, root: dir, database: join(dir, 'mdeko.sqlite'), images: join(dir, 'images'), backups: dir, projects: dir }
  db = openDatabase(':memory:')
  migrate(db)
  const add = db.prepare('INSERT INTO articles (id, name, price_cents, url, url_clean, link_status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  add.run(1, 'Fauteuil', 30000, 'https://a.fr/p/1', 'https://a.fr/p/1', 'ok', '2026-10-01T00:00:00Z')
  add.run(2, 'Fauteuil bis', 30000, 'https://a.fr/p/1?c=2', 'https://a.fr/p/1', 'gone', '2026-10-01T00:00:00Z')
  add.run(3, 'Lampe', 9000, 'https://b.fr/lampe', 'https://b.fr/lampe', 'unchecked', '2024-01-01T00:00:00Z')
  db.prepare("INSERT INTO images (id, rel_path) VALUES (1, 'images/la.jpg'), (2, 'images/absente.jpg')").run()
  db.prepare('INSERT INTO article_images (article_id, image_id) VALUES (1, 1), (3, 2)').run()
  mkdirSync(join(dir, 'images'))
  writeFileSync(join(dir, 'images', 'la.jpg'), '')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('vérification de la base', () => {
  it('signale photos absentes, produits disparus, doublons, prix anciens et articles incomplets', () => {
    const report = checkDatabase(db, paths, new Date('2026-10-29T00:00:00Z'))
    expect(report.database.ok).toBe(true)
    const ids = (id: string) => report.groups.find((g) => g.id === id)?.articles.map((a) => a.id)
    expect(ids('missing-files')).toEqual([3])
    expect(ids('gone')).toEqual([2])
    expect(ids('duplicates')?.sort()).toEqual([1, 2])
    expect(ids('stale-price')).toEqual([3])
    expect(ids('no-photo')).toEqual([2])
    expect(report.links.toCheck).toBe(3)
  })

  it('reconnaît un produit disparu d’après la réponse du site', () => {
    expect(linkStatusFor(404, 'https://a.fr/p/1', null)).toBe('gone')
    expect(linkStatusFor(200, 'https://a.fr/p/1', 'https://a.fr/')).toBe('gone')
    expect(linkStatusFor(200, 'https://a.fr/p/1', 'https://a.fr/p/1-bis')).toBe('ok')
    expect(linkStatusFor(403, 'https://a.fr/p/1', null)).toBe('unverifiable')
    expect(linkStatusFor(null, 'https://a.fr/p/1', null)).toBe('unverifiable')
  })

  it('vérifie les liens et enregistre leur statut', async () => {
    const seen: number[] = []
    const result = await checkLinks(
      db,
      async (url) => ({ status: url.includes('lampe') ? 404 : 200, finalUrl: url }),
      (p) => seen.push(p.done),
      () => false
    )
    expect(result).toEqual({ done: 3, total: 3, gone: 1 })
    expect(seen.at(-1)).toBe(3)
    const status = db.prepare('SELECT link_status FROM articles WHERE id = 3').get() as { link_status: string }
    expect(status.link_status).toBe('gone')
    expect((await checkLinks(db, async () => ({ status: 200, finalUrl: null }), () => {}, () => false)).total).toBe(0)
  })
})
