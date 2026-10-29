import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './db/database'
import {
  addNeed,
  createPaint,
  createProject,
  getProject,
  getSettings,
  listPaints,
  listProjects,
  saveArtisan,
  saveSettings,
  setNeedChoice,
  setProjectLinks,
  setRooms,
  suggestAlternatives,
  updateProject,
  wishesText
} from './projects'

let db: DatabaseSync

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  const assises = (db.prepare("SELECT id FROM families WHERE name = 'Assises'").get() as { id: number }).id
  db.prepare("INSERT INTO categories (id, family_id, name) VALUES (1, ?, 'Fauteuils'), (2, ?, 'Chaises')").run(assises, assises)
  const add = db.prepare('INSERT INTO articles (id, name, category_id, price_cents, url_clean) VALUES (?, ?, ?, ?, ?)')
  add.run(1, 'Fauteuil choisi', 1, 30000, 'https://a/1')
  add.run(2, 'Fauteuil proche', 1, 32000, 'https://a/2')
  add.run(3, 'Fauteuil même lien', 1, 30500, 'https://a/1')
  add.run(4, 'Fauteuil cher', 1, 120000, 'https://a/4')
  add.run(5, 'Fauteuil moyen', 1, 45000, 'https://a/5')
  add.run(6, 'Chaise', 2, 30000, 'https://a/6')
})

describe('projets', () => {
  it('crée, liste et modifie un projet', () => {
    const id = createProject(db, 'Mme', 'Durand')
    updateProject(db, id, { phone: '01 02', texts: { intro: null, wishes: 'Texte perso', closing: null } })
    expect(listProjects(db).map((p) => p.title)).toEqual(['Mme Durand'])
    const p = getProject(db, id)!
    expect(p.phone).toBe('01 02')
    expect(p.texts.wishes).toBe('Texte perso')
    expect(p.bookDate).toMatch(/^\d{4}-\d{2}$/)
  })

  it('remplit le texte « Vos envies » avec les pièces du projet', () => {
    const id = createProject(db, 'Mme', 'Durand')
    setRooms(db, id, ['Entrée', 'Salon', ' ', 'Chambre'])
    saveSettings(db, { wishesText: 'Le relooking concerne votre {pieces}.' })
    expect(wishesText(getProject(db, id)!, getSettings(db))).toBe('Le relooking concerne votre entrée, salon et chambre.')
  })
})

describe('besoins', () => {
  it('propose des alternatives de la même catégorie au prix le plus proche, sans doublon de lien', () => {
    expect(suggestAlternatives(db, 1)).toEqual([2, 5, 4])
  })

  it('ajoute un besoin avec « Mon choix » et ses alternatives', () => {
    const id = createProject(db, '', 'Durand')
    addNeed(db, id, 1)
    const need = getProject(db, id)!.needs[0]
    expect(need.category).toBe('Fauteuils')
    expect(need.choice?.name).toBe('Fauteuil choisi')
    expect(need.alternatives.map((a) => a.id)).toEqual([2, 5, 4])
  })

  it('échange « Mon choix » avec une alternative', () => {
    const id = createProject(db, '', 'Durand')
    const needId = addNeed(db, id, 1)
    setNeedChoice(db, needId, 5)
    const need = getProject(db, id)!.needs[0]
    expect(need.choice?.id).toBe(5)
    expect(need.alternatives.map((a) => a.id)).toEqual([2, 1, 4])
  })
})

describe('teintes et artisans', () => {
  it('crée une teinte et la rattache au projet', () => {
    const id = createProject(db, '', 'Durand')
    const paint = createPaint(db, { brand: 'Bilbo Quet Deco', name: 'Marelle', reference: null, hex: '#F4F2ED' })
    const artisan = saveArtisan(db, { id: null, trade: 'Peintre', name: 'Atelier', city: 'Lille', phone: null, email: null })
    setProjectLinks(db, id, 'project_paints', [paint])
    setProjectLinks(db, id, 'project_artisans', [artisan])
    expect(listPaints(db).map((p) => p.name)).toEqual(['Marelle'])
    expect(getProject(db, id)!.paintIds).toEqual([paint])
    expect(getProject(db, id)!.artisanIds).toEqual([artisan])
  })
})
