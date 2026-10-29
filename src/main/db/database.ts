import { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  sql: string
}

// Chaque fichier migrations/NNN_nom.sql est appliqué une seule fois, dans l'ordre.
// Ne jamais modifier une migration déjà livrée : en ajouter une nouvelle.
const files = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true
})

export const MIGRATIONS: Migration[] = Object.entries(files)
  .map(([path, sql]) => {
    const name = path.split('/').pop()!.replace(/\.sql$/, '')
    const version = Number.parseInt(name, 10)
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`Migration mal nommée : ${path}`)
    }
    return { version, name, sql }
  })
  .sort((a, b) => a.version - b.version)

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
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
