import { DatabaseSync } from 'node:sqlite'
import { SOURCES } from './migrations'

export interface Migration {
  version: number
  name: string
  sql: string
}

// Chaque migration est appliquée une seule fois, dans l'ordre (voir migrations/index.ts).
export const MIGRATIONS: Migration[] = Object.entries(SOURCES)
  .map(([name, sql]) => {
    const version = Number.parseInt(name, 10)
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`Migration mal nommée : ${name}`)
    }
    return { version, name, sql }
  })
  .sort((a, b) => a.version - b.version)

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  // Tri « dictionnaire » : Étagère avec les E, pas après les Z.
  db.function('sans_accents', { deterministic: true }, (texte) =>
    typeof texte === 'string' ? texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : texte
  )
  return db
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

export function pendingMigrations(db: DatabaseSync, migrations = MIGRATIONS): Migration[] {
  const current = schemaVersion(db)
  const latest = migrations.at(-1)?.version ?? 0
  // Une base plus récente que l'appli : on refuse plutôt que de risquer de l'abîmer.
  if (current > latest) {
    throw new Error(
      `Les données ont été créées par une version plus récente de l'application (schéma ${current} > ${latest}).`
    )
  }
  return migrations.filter((m) => m.version > current)
}

export function migrate(db: DatabaseSync, migrations = MIGRATIONS): number {
  for (const m of pendingMigrations(db, migrations)) {
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`Échec de la migration ${m.name} : ${(error as Error).message}`)
    }
  }
  return schemaVersion(db)
}
