import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutoBackup, createBackup, ensureDailyBackup, listBackups } from './backup'
import { migrate, openDatabase } from './db/database'

describe('sauvegardes', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mdeko-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const freshDb = () => {
    const db = openDatabase(':memory:')
    migrate(db)
    return db
  }

  it('produit une copie lisible de la base', () => {
    const file = createBackup(freshDb(), dir, 'manuelle')
    const copy = openDatabase(file)
    const row = copy.prepare('SELECT count(*) AS n FROM families').get() as { n: number }
    expect(row.n).toBe(11)
    copy.close()
  })

  it("ne fait qu'une sauvegarde quotidienne par jour", () => {
    const db = freshDb()
    const day = new Date(2026, 9, 29, 9, 0, 0)
    expect(ensureDailyBackup(db, dir, day)).not.toBeNull()
    expect(ensureDailyBackup(db, dir, new Date(2026, 9, 29, 18, 0, 0))).toBeNull()
    expect(ensureDailyBackup(db, dir, new Date(2026, 9, 30, 8, 0, 0))).not.toBeNull()
    expect(listBackups(dir)).toHaveLength(2)
  })

  it('garde les 30 sauvegardes quotidiennes les plus récentes', () => {
    const db = freshDb()
    for (let i = 0; i < 35; i++) {
      createBackup(db, dir, 'quotidienne', new Date(2026, 0, 1 + i, 12, 0, 0))
    }
    const kept = listBackups(dir)
    expect(kept).toHaveLength(30)
    expect(kept.at(-1)!.date).toEqual(new Date(2026, 0, 6, 12, 0, 0))
  })

  it('ne supprime pas les sauvegardes des autres types', () => {
    const db = freshDb()
    createBackup(db, dir, 'avant-mise-a-jour', new Date(2025, 0, 1))
    for (let i = 0; i < 31; i++) {
      createBackup(db, dir, 'quotidienne', new Date(2026, 0, 1 + i))
    }
    expect(listBackups(dir).filter((b) => b.reason === 'avant-mise-a-jour')).toHaveLength(1)
  })

  it('ne fait une copie automatique que si la base a changé', () => {
    const db = freshDb()
    const auto = new AutoBackup(db, dir)
    auto.start()
    expect(auto.run(new Date(2026, 9, 31, 10, 0, 0))).toBeNull()
    db.prepare("INSERT INTO suppliers (name) VALUES ('Atelier test')").run()
    expect(auto.run(new Date(2026, 9, 31, 10, 1, 0))).not.toBeNull()
    expect(auto.run(new Date(2026, 9, 31, 10, 2, 0))).toBeNull()
    expect(listBackups(dir).map((b) => b.reason)).toEqual(['automatique'])
  })
})
