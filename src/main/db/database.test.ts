import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, pendingMigrations, schemaVersion } from './database'

describe('migrations', () => {
  it('crée le schéma complet sur une base vide', () => {
    const db = openDatabase(':memory:')
    const version = migrate(db)
    expect(version).toBe(MIGRATIONS.at(-1)!.version)
    const families = db.prepare('SELECT count(*) AS n FROM families').get() as { n: number }
    expect(families.n).toBe(11)
  })

  it('ne rejoue pas une migration déjà appliquée', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    expect(pendingMigrations(db)).toHaveLength(0)
    expect(() => migrate(db)).not.toThrow()
  })

  it('active les clés étrangères', () => {
    const db = openDatabase(':memory:')
    migrate(db)
    expect(() =>
      db.prepare('INSERT INTO categories (family_id, name) VALUES (999, ?)').run('Inconnue')
    ).toThrow()
  })

  it('réunit les anciennes graphies de « Bilboquet Deco »', () => {
    const db = openDatabase(':memory:')
    migrate(db, MIGRATIONS.filter((m) => m.version <= 5))
    db.exec(`INSERT INTO paint_brands (id, name, promo_code) VALUES (1, 'Bilbo Quet Deco', 'PRO'), (2, 'Farrow & Ball', NULL);
             INSERT INTO paints (brand_id, name) VALUES (1, 'Marelle'), (2, 'Lin')`)
    migrate(db)
    const rows = db.prepare('SELECT b.name, b.promo_code, p.name AS paint FROM paints p JOIN paint_brands b ON b.id = p.brand_id ORDER BY p.name').all()
    expect(rows).toEqual([
      { name: 'Farrow & Ball', promo_code: null, paint: 'Lin' },
      { name: 'Bilboquet Deco', promo_code: 'PRO', paint: 'Marelle' }
    ])
  })

  it('refuse une base créée par une version plus récente', () => {
    const db = openDatabase(':memory:')
    db.exec('PRAGMA user_version = 9999')
    expect(() => migrate(db)).toThrow(/version plus récente/)
  })

  it('annule entièrement une migration en échec', () => {
    const db = openDatabase(':memory:')
    const broken = [
      { version: 1, name: '001_ok', sql: 'CREATE TABLE a (x);' },
      { version: 2, name: '002_ko', sql: 'CREATE TABLE b (x); INSERT INTO inexistante VALUES (1);' }
    ]
    expect(() => migrate(db, broken)).toThrow(/002_ko/)
    expect(schemaVersion(db)).toBe(1)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").all()
    expect(tables).toHaveLength(0)
  })
})
