import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './db/database'
import {
  addMarker,
  addNeed,
  adjustElement,
  deletePaint,
  normalizeHex,
  removeMarker,
  replaceRenderImage,
  updatePaint,
  updatePaintBrand,
  listAdjustments,
  resetPageAdjustments,
  setNeedImages,
  addNote,
  editBookText,
  listNotes,
  moveNote,
  createPaint,
  createProject,
  getProject,
  getSettings,
  listPaints,
  listProjects,
  saveArtisan,
  saveSettings,
  setNeedChoice,
  setNeedRoom,
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

  it('range un besoin dans une pièce, qui le garde quand on ajoute ou retire d’autres pièces', () => {
    const id = createProject(db, '', 'Durand')
    setRooms(db, id, ['Entrée', 'Salon'])
    const salon = getProject(db, id)!.rooms[1].id
    const need = addNeed(db, id, 1, salon)
    setNeedRoom(db, addNeed(db, id, 6), salon)
    setRooms(db, id, ['Salon', 'Chambre'])
    const project = getProject(db, id)!
    expect(project.rooms.map((r) => r.name)).toEqual(['Salon', 'Chambre'])
    expect(project.rooms[0].id).toBe(salon)
    expect(project.needs.map((n) => n.roomId)).toEqual([salon, salon])
    setRooms(db, id, ['Chambre'])
    expect(getProject(db, id)!.needs.find((n) => n.id === need)?.roomId).toBeNull()
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
    const paint = createPaint(db, { brand: 'Bilboquet Deco', name: 'Marelle', reference: null, hex: '#F4F2ED' })
    const artisan = saveArtisan(db, { id: null, trade: 'Peintre', name: 'Atelier', city: 'Lille', phone: null, email: null })
    setProjectLinks(db, id, 'project_paints', [paint])
    setProjectLinks(db, id, 'project_artisans', [artisan])
    expect(listPaints(db).map((p) => p.name)).toEqual(['Marelle'])
    expect(getProject(db, id)!.paintIds).toEqual([paint])
    expect(getProject(db, id)!.artisanIds).toEqual([artisan])
  })

  it('modifie et supprime une teinte', () => {
    const id = createProject(db, '', 'Durand')
    const paint = createPaint(db, { brand: 'Farrow & Ball', name: 'Marelle', reference: null, hex: 'f4f2ed' })
    setProjectLinks(db, id, 'project_paints', [paint])
    expect(listPaints(db)[0].hex).toBe('#F4F2ED')
    updatePaint(db, paint, { brand: 'Tollens', name: ' Lin ', reference: 'T-12', hex: 'pas une couleur' })
    expect(listPaints(db)).toEqual([expect.objectContaining({ brand: 'Tollens', name: 'Lin', reference: 'T-12', hex: null })])
    deletePaint(db, paint)
    expect(listPaints(db)).toEqual([])
    expect(getProject(db, id)!.paintIds).toEqual([])
  })

  it('lit un code couleur écrit à la main', () => {
    expect(normalizeHex('#e8e2d6')).toBe('#E8E2D6')
    expect(normalizeHex(' abc ')).toBe('#AABBCC')
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('')).toBeNull()
  })

  it('renomme une marque, ou la réunit à une marque existante', () => {
    const a = createPaint(db, { brand: 'Bilbo', name: 'Marelle', reference: null, hex: null })
    const b = createPaint(db, { brand: 'Unikalo', name: 'Craie', reference: null, hex: null })
    updatePaintBrand(db, 'Bilbo', { name: 'Bilboquet Deco', promoCode: 'PRO' })
    expect(listPaints(db).find((p) => p.id === a)).toMatchObject({ brand: 'Bilboquet Deco', promoCode: 'PRO' })
    updatePaintBrand(db, 'Unikalo', { name: 'bilboquet deco', promoCode: null })
    expect(listPaints(db).find((p) => p.id === b)).toMatchObject({ brand: 'Bilboquet Deco', promoCode: 'PRO' })
    expect((db.prepare('SELECT count(*) AS n FROM paint_brands').get() as { n: number }).n).toBe(1)
  })
})

describe('rendus 3D', () => {
  it('repère un objet et l’ajoute au projet s’il n’y est pas encore', () => {
    const id = createProject(db, '', 'Durand')
    db.exec("INSERT INTO images (id, rel_path) VALUES (1, 'a.jpg'), (2, 'b.jpg')")
    db.prepare('INSERT INTO renders (id, project_id, image_id) VALUES (1, ?, 1)').run(id)
    addNeed(db, id, 1)
    addMarker(db, 1, 1, 0.2, 0.3)
    const marker = addMarker(db, 1, 6, 1.4, -1)
    const p = getProject(db, id)!
    expect(p.needs.map((n) => n.choice?.id)).toEqual([1, 6])
    expect(p.renders[0].markers.map((m) => [m.article.id, m.x, m.y])).toEqual([
      [1, 0.2, 0.3],
      [6, 1, 0]
    ])
    removeMarker(db, marker)
    expect(getProject(db, id)!.renders[0].markers).toHaveLength(1)
    expect(getProject(db, id)!.needs).toHaveLength(2)
  })

  it('remplace l’image d’un rendu en gardant sa place et ses repères', () => {
    const id = createProject(db, '', 'Durand')
    db.exec("INSERT INTO images (id, rel_path) VALUES (1, 'a.jpg'), (2, 'b.jpg'), (3, 'ia.jpg')")
    db.prepare('INSERT INTO renders (id, project_id, image_id) VALUES (1, ?, 1)').run(id)
    db.exec("INSERT INTO render_versions (id, render_id, image_id) VALUES (1, 1, 3); UPDATE renders SET active_version_id = 1")
    addMarker(db, 1, 1, 0.5, 0.5)
    replaceRenderImage(db, 1, 2)
    const r = getProject(db, id)!.renders[0]
    expect(r.imageId).toBe(2)
    expect(r.edited).toBe(false)
    expect(r.markers).toHaveLength(1)
  })
})

describe('modifications dans l’aperçu', () => {
  it('met à jour textes, légendes, titres de besoin et annotations', () => {
    const id = createProject(db, 'Mme', 'Durand')
    db.exec("INSERT INTO images (id, rel_path) VALUES (1, 'a.jpg')")
    db.prepare("INSERT INTO renders (id, project_id, image_id) VALUES (1, ?, 1)").run(id)
    const needId = addNeed(db, id, 1)

    editBookText(db, id, 'intro', 'Nouvel avant-propos  ')
    editBookText(db, id, 'caption:1', 'Vue depuis l’entrée')
    editBookText(db, id, `needLabel:${needId}`, 'Fauteuils du salon')
    const p = getProject(db, id)!
    expect(p.texts.intro).toBe('Nouvel avant-propos')
    expect(p.renders[0].caption).toBe('Vue depuis l’entrée')
    expect(p.needs[0].label).toBe('Fauteuils du salon')

    const noteId = addNote(db, id, 'render:1', 40, 180)
    editBookText(db, id, `note:${noteId}`, 'Banquette sur mesure')
    moveNote(db, noteId, 60, 185)
    expect(listNotes(db, id)).toEqual([{ id: noteId, pageKey: 'render:1', x: 60, y: 185, w: 90, text: 'Banquette sur mesure' }])
    // Une annotation vidée disparaît.
    editBookText(db, id, `note:${noteId}`, '  ')
    expect(listNotes(db, id)).toEqual([])
  })

  it('garde les ajustements de l’aperçu et les textes propres au book', () => {
    const id = createProject(db, '', 'Durand')
    adjustElement(db, id, 'cover', 'logo', { x: 30, y: 70 })
    adjustElement(db, id, 'cover', 'logo', { size: 90 })
    editBookText(db, id, 'text:need:4|choice:1:name', 'Fauteuil velours')
    expect(listAdjustments(db, id)).toEqual({
      'cover|logo': { x: 30, y: 70, size: 90 },
      'need:4|choice:1:name': { text: 'Fauteuil velours' }
    })
    adjustElement(db, id, 'cover', 'logo', null)
    expect(Object.keys(listAdjustments(db, id))).toEqual(['need:4|choice:1:name'])
    // Remettre la page en place garde le texte écrit.
    adjustElement(db, id, 'need:4', 'choice:1:name', { w: 80 })
    resetPageAdjustments(db, id, 'need:4')
    expect(listAdjustments(db, id)).toEqual({ 'need:4|choice:1:name': { text: 'Fauteuil velours' } })
  })

  it('montre les photos choisies pour « Mon choix », oubliées quand le choix change', () => {
    const img = db.prepare("INSERT INTO images (rel_path) VALUES ('images/a.jpg'), ('images/b.jpg')")
    img.run()
    db.prepare('INSERT INTO article_images (article_id, image_id, sort) VALUES (1, 1, 0), (1, 2, 1)').run()
    const id = createProject(db, '', 'Durand')
    const needId = addNeed(db, id, 1)
    setNeedImages(db, needId, [2, 1])
    expect(getProject(db, id)!.needs[0].bookImageIds).toEqual([2, 1])
    expect(getProject(db, id)!.needs[0].choiceImages.map((i) => i.id)).toEqual([1, 2])
    setNeedChoice(db, needId, 5)
    expect(getProject(db, id)!.needs[0].bookImageIds).toEqual([])
  })

  it('range les teintes sans marque dans « Teintes et couleurs »', () => {
    createPaint(db, { brand: ' ', name: 'Lin', reference: null, hex: '#eeeeee' })
    expect(listPaints(db)[0].brand).toBe('Teintes et couleurs')
  })
})
