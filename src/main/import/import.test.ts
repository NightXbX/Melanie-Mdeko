import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ensureSearchIndex, searchArticles } from '../articles'
import { migrate, openDatabase } from '../db/database'
import { getProject } from '../projects'
import { importPdf } from '.'

// Les design books de Mélanie ne sont jamais publiés : ce test ne tourne que si l'un d'eux a été copié
// sous ce nom dans ressources/ (dossier ignoré par git).
const BOOK = resolve(__dirname, '../../../ressources/design-book-test.pdf')
const root = mkdtempSync(join(tmpdir(), 'mdeko-import-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.skipIf(!existsSync(BOOK))('import d’un design book PDF', () => {
  it('crée le projet complet et ajoute les articles à la shopping list', { timeout: 120_000 }, async () => {
    const db = openDatabase(':memory:')
    migrate(db)
    ensureSearchIndex(db)
    const pdf = new Uint8Array(readFileSync(BOOK))
    const pages: number[] = []
    const summary = await importPdf(db, root, pdf, (page) => pages.push(page))

    expect(pages.at(-1)).toBe(49)
    expect(summary.projectTitle).toMatch(/^Mme /)
    const project = getProject(db, summary.projectId!)!
    expect(project.bookDate).toBe('2026-09')
    expect(project.rooms.map((r) => r.name)).toEqual(['Entrée', 'Salon', 'Chambre'])
    expect(project.renders).toHaveLength(10)
    expect(project.needs.length).toBeGreaterThanOrEqual(10)
    expect(project.needs.every((n) => n.choice !== null)).toBe(true)
    expect(project.paintIds).toHaveLength(3)
    expect(project.artisanIds).toHaveLength(3)
    expect(summary.added).toBeGreaterThan(50)

    // Les articles importés sont cherchables, et un second import ne crée pas de doublons.
    expect(searchArticles(db, { text: 'fauteuil', filters: {}, sort: 'relevance', offset: 0, limit: 5 }).total).toBeGreaterThan(0)
    const again = await importPdf(db, root, pdf)
    expect(again.added).toBe(0)
    expect(again.reused).toBe(summary.added + summary.reused)
  })
})
