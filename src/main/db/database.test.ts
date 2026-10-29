import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, pendingMigrations, schemaVersion } from './database'

describe('migrations', () => {
  it('crée le schéma complet sur une base vide', () => {
    const db = openDatabase(':memory:')
    const version = migrate(db)
    expect(version).toBe(MIGRATIONS.at(-1)!.version)
    const families = db.prepare('SELECT count(*) AS n FROM families').get() as { n: number }
    expect(families.n).toBe(10)
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
