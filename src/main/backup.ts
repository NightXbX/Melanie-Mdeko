import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export type BackupReason = 'quotidienne' | 'avant-mise-a-jour' | 'manuelle' | 'automatique'

// « automatique » : copie faite chaque minute après une modification ; on garde la dernière demi-heure.
const KEEP: Record<BackupReason, number> = {
  quotidienne: 30,
  'avant-mise-a-jour': 10,
  manuelle: 10,
  automatique: 30
}

export interface BackupFile {
  file: string
  reason: BackupReason
  date: Date
}

const NAME = /^mdeko_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_(quotidienne|avant-mise-a-jour|manuelle|automatique)(?:-\d+)?\.sqlite$/

const pad = (n: number): string => String(n).padStart(2, '0')

function stamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  )
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function listBackups(dir: string): BackupFile[] {
  return readdirSync(dir)
    .map((name) => {
      const m = NAME.exec(name)
      if (!m) return null
      const [, y, mo, d, h, mi, s, reason] = m
      const date = new Date(+y, +mo - 1, +d, +h, +mi, +s)
      return { file: join(dir, name), reason: reason as BackupReason, date }
    })
    .filter((b): b is BackupFile => b !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
}

// Copie cohérente de la base, même pendant son utilisation.
export function createBackup(db: DatabaseSync, dir: string, reason: BackupReason, now = new Date()): string {
  let file = join(dir, `mdeko_${stamp(now)}_${reason}.sqlite`)
  for (let i = 2; existsSync(file); i++) {
    file = join(dir, `mdeko_${stamp(now)}_${reason}-${i}.sqlite`)
  }
  db.prepare('VACUUM INTO ?').run(file)
  prune(dir, reason)
  return file
}

export function ensureDailyBackup(db: DatabaseSync, dir: string, now = new Date()): string | null {
  const doneToday = listBackups(dir).some((b) => b.reason === 'quotidienne' && sameDay(b.date, now))
  return doneToday ? null : createBackup(db, dir, 'quotidienne', now)
}

// Copie automatique, seulement si la base a changé depuis la précédente (total_changes compte les écritures de la connexion).
export class AutoBackup {
  private lastChanges = -1

  constructor(
    private db: DatabaseSync,
    private dir: string
  ) {}

  private changes(): number {
    return (this.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
  }

  // Point de départ : rien à copier tant que rien n'a changé.
  start(): void {
    this.lastChanges = this.changes()
  }

  run(now = new Date()): string | null {
    const n = this.changes()
    if (n === this.lastChanges) return null
    const file = createBackup(this.db, this.dir, 'automatique', now)
    this.lastChanges = n
    return file
  }
}

function prune(dir: string, reason: BackupReason): void {
  listBackups(dir)
    .filter((b) => b.reason === reason)
    .slice(KEEP[reason])
    .forEach((b) => rmSync(b.file, { force: true }))
}
