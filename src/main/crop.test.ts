import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImageUpload } from '@shared/api'
import { getArticleInput, purgeOrphanImages, saveArticle, UndoStack, uploadImage } from './article-edit'
import { ensureSearchIndex } from './articles'
import { cropSource, readImage, saveCrop } from './crop'
import { migrate, openDatabase } from './db/database'
import { addMarker, addNeed, createProject, cropRender, getProject, setNeedImages } from './projects'

let db: DatabaseSync
let root: string

const upload = (text: string): ImageUpload => ({
  bytes: new TextEncoder().encode(text),
  ext: 'jpg',
  width: 100,
  height: 50,
  thumbnail: new TextEncoder().encode(`miniature ${text}`)
})

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  ensureSearchIndex(db)
  root = mkdtempSync(join(tmpdir(), 'mdeko-crop-'))
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('rognage', () => {
  it('garde l’image d’origine et le cadre, pour rogner à nouveau', () => {
    const original = uploadImage(db, root, upload('rendu entier'))
    const half = { x: 0.5, y: 0, w: 0.5, h: 1 }
    const cropped = saveCrop(db, root, original.id, half, upload('moitié droite'))
    expect(cropped.id).not.toBe(original.id)
    // On rouvre l'outil sur l'image rognée : il montre l'original entier avec le cadre choisi.
    expect(cropSource(db, cropped.id)).toEqual({ id: original.id, url: original.url, crop: half })
    expect(new TextDecoder().decode(readImage(db, root, original.id).bytes)).toBe('rendu entier')
    // Rogner à nouveau part toujours de l'original ; le cadre entier le redonne.
    const again = saveCrop(db, root, cropped.id, { x: 0, y: 0, w: 0.5, h: 1 }, upload('moitié gauche'))
    expect(cropSource(db, again.id).id).toBe(original.id)
    expect(saveCrop(db, root, again.id, { x: 0, y: 0, w: 1, h: 1 }, null).id).toBe(original.id)
  })

  it('ne supprime pas l’original tant que l’image rognée sert', () => {
    const original = uploadImage(db, root, upload('photo'))
    const cropped = saveCrop(db, root, original.id, { x: 0, y: 0, w: 0.5, h: 0.5 }, upload('coin'))
    const undo = new UndoStack()
    saveArticle(
      db,
      {
        id: null, name: 'Vase', priceCents: null, priceKind: 'unknown', supplier: '', url: '', categoryId: null,
        dimensions: '', colorMaterial: '', description: '', tags: [], privateNote: '', images: [cropped]
      },
      undo
    )
    expect(purgeOrphanImages(db, root)).toBe(0)
    const file = (id: number) => join(root, (db.prepare('SELECT rel_path FROM images WHERE id = ?').get(id) as { rel_path: string }).rel_path)
    expect(existsSync(file(original.id))).toBe(true)
  })

  it('remplace une photo d’article rognée aussi dans « Mon choix »', () => {
    const photo = uploadImage(db, root, upload('fauteuil'))
    const undo = new UndoStack()
    const base = {
      id: null, name: 'Fauteuil', priceCents: null, priceKind: 'unknown' as const, supplier: '', url: '', categoryId: null,
      dimensions: '', colorMaterial: '', description: '', tags: [], privateNote: '', images: [photo]
    }
    const articleId = saveArticle(db, base, undo)
    const projectId = createProject(db, '', 'Durand')
    const needId = addNeed(db, projectId, articleId)
    setNeedImages(db, needId, [photo.id])
    const cropped = saveCrop(db, root, photo.id, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, upload('fauteuil rogné'))
    saveArticle(db, { ...getArticleInput(db, articleId)!, images: [cropped] }, undo)
    const chosen = db.prepare('SELECT image_id FROM need_images WHERE need_id = ?').all(needId) as { image_id: number }[]
    expect(chosen.map((r) => r.image_id)).toEqual([cropped.id])
  })

  it('rogne un rendu : les repères suivent le cadre, ceux qui en sortent sont cachés', () => {
    const projectId = createProject(db, '', 'Durand')
    const image = uploadImage(db, root, upload('rendu'))
    db.prepare('INSERT INTO articles (id, name) VALUES (1, ?), (2, ?)').run('Lampe', 'Canapé')
    db.prepare('INSERT INTO renders (id, project_id, image_id) VALUES (1, ?, ?)').run(projectId, image.id)
    addMarker(db, 1, 1, 0.75, 0.5) // dans la moitié droite
    addMarker(db, 1, 2, 0.25, 0.5) // dans la moitié gauche
    const right = saveCrop(db, root, image.id, { x: 0.5, y: 0, w: 0.5, h: 1 }, upload('rendu, moitié droite'))
    cropRender(db, 1, right.id)
    let r = getProject(db, projectId)!.renders[0]
    expect(r.imageId).toBe(right.id)
    expect(r.markers.map((m) => [m.article.id, m.x, m.y])).toEqual([[1, 0.5, 0.5]])
    // Retour à l'image entière : le repère caché revient à sa place.
    cropRender(db, 1, saveCrop(db, root, right.id, { x: 0, y: 0, w: 1, h: 1 }, null).id)
    r = getProject(db, projectId)!.renders[0]
    expect(r.imageId).toBe(image.id)
    expect(r.markers.map((m) => [m.article.id, m.x])).toEqual([
      [1, 0.75],
      [2, 0.25]
    ])
  })

  it('rogne la version retouchée gardée, pas l’original du rendu', () => {
    const projectId = createProject(db, '', 'Durand')
    const original = uploadImage(db, root, upload('rendu'))
    const retouched = uploadImage(db, root, upload('rendu retouché'))
    db.prepare('INSERT INTO renders (id, project_id, image_id) VALUES (1, ?, ?)').run(projectId, original.id)
    db.prepare('INSERT INTO render_versions (id, render_id, image_id, kept) VALUES (1, 1, ?, 1)').run(retouched.id)
    db.exec('UPDATE renders SET active_version_id = 1')
    const cropped = saveCrop(db, root, retouched.id, { x: 0, y: 0, w: 0.5, h: 0.5 }, upload('retouche rognée'))
    cropRender(db, 1, cropped.id)
    const r = getProject(db, projectId)!.renders[0]
    expect(r.imageId).toBe(cropped.id)
    expect(r.edited).toBe(true)
    expect((db.prepare('SELECT image_id FROM renders WHERE id = 1').get() as { image_id: number }).image_id).toBe(original.id)
    // Une image qui ne vient pas de ce rendu est refusée.
    expect(() => cropRender(db, 1, original.id)).toThrow()
  })
})
