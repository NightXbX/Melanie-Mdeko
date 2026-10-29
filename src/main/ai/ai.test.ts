import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../db/database'
import { createProject, getProject } from '../projects'
import { openRouterProvider, type Fetch } from './openrouter'
import { addProposal, currentImage, duelScore, estimateCents, getAiSettings, keepVersion, monthSpentCents, renderHistory, saveAiSettings, showVersion } from './versions'

let db: DatabaseSync
let renderId: number

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  db.prepare("INSERT INTO images (id, rel_path) VALUES (1, 'images/rendu.jpg'), (2, 'images/a.png'), (3, 'images/b.png')").run()
  const projectId = createProject(db, 'Mme', 'Durand')
  renderId = Number(db.prepare('INSERT INTO renders (project_id, image_id) VALUES (?, 1)').run(projectId).lastInsertRowid)
})

const reply = (status: number, body: unknown): ReturnType<Fetch> => Promise.resolve({ ok: status < 300, status, json: async () => body })

describe('assistant IA : connecteur OpenRouter', () => {
  it('envoie le rendu et les références, lit l’image et son coût', async () => {
    const calls: Record<string, unknown>[] = []
    const fetch: Fetch = (url, init) => {
      calls.push(JSON.parse(init.body!))
      expect(url).toBe('https://openrouter.ai/api/v1/images')
      expect(init.headers.Authorization).toBe('Bearer cle')
      return reply(200, { data: [{ b64_json: Buffer.from('PNG').toString('base64'), media_type: 'image/png' }], usage: { cost: 0.04 } })
    }
    const out = await openRouterProvider('cle', fetch).edit({ model: 'm', prompt: 'Ajoute des lampes', images: ['data:a', 'data:b'] })
    expect(Buffer.from(out.bytes).toString()).toBe('PNG')
    expect(out.costCents).toBeCloseTo(4)
    expect(calls[0]).toMatchObject({
      model: 'm',
      aspect_ratio: '16:9',
      input_references: [
        { type: 'image_url', image_url: { url: 'data:a' } },
        { type: 'image_url', image_url: { url: 'data:b' } }
      ]
    })
  })

  it('relance sans les options de format si le moteur les refuse', async () => {
    const calls: Record<string, unknown>[] = []
    const fetch: Fetch = (_url, init) => {
      calls.push(JSON.parse(init.body!))
      return calls.length === 1 ? reply(400, { error: { message: 'unsupported' } }) : reply(200, { data: [{ b64_json: 'AA==' }] })
    }
    await openRouterProvider('cle', fetch).edit({ model: 'm', prompt: 'p', images: ['data:a'] })
    expect(calls[1].aspect_ratio).toBeUndefined()
  })

  it('traduit les erreurs en français', async () => {
    await expect(openRouterProvider('cle', () => reply(402, {})).edit({ model: 'm', prompt: 'p', images: [] })).rejects.toThrow('plus de crédit')
    await expect(openRouterProvider('cle', () => reply(200, { data: [] })).edit({ model: 'm', prompt: 'p', images: [] })).rejects.toThrow('pas renvoyé d’image')
  })
})

describe('assistant IA : versions des rendus', () => {
  it('garde une proposition : elle remplace l’original dans le projet, l’original reste disponible', () => {
    const a = addProposal(db, { renderId, parentId: null, imageId: 2, prompt: 'Lampes', model: 'google/x', costCents: 4 })
    addProposal(db, { renderId, parentId: null, imageId: 3, prompt: 'Lampes', model: 'openai/y', costCents: 1.2 })
    expect(currentImage(db, renderId)).toEqual({ imageId: 1, versionId: null })
    keepVersion(db, a)
    expect(currentImage(db, renderId)).toEqual({ imageId: 2, versionId: a })
    const render = getProject(db, 1)!.renders[0]
    expect([render.imageId, render.edited]).toEqual([2, true])
    expect(renderHistory(db, renderId).map((v) => [v.id, v.active])).toEqual([[null, false], [a, true]])
    showVersion(db, renderId, null)
    expect(getProject(db, 1)!.renders[0].imageId).toBe(1)
    expect(duelScore(db)).toEqual([
      { model: 'google/x', kept: 1, proposed: 1 },
      { model: 'openai/y', kept: 0, proposed: 1 }
    ])
  })

  it('compte la dépense du mois et estime le coût d’une demande', () => {
    expect(estimateCents(db, 'google/x')).toBe(10)
    addProposal(db, { renderId, parentId: null, imageId: 2, prompt: 'p', model: 'google/x', costCents: 4 })
    addProposal(db, { renderId, parentId: null, imageId: 3, prompt: 'p', model: 'google/x', costCents: 6 })
    expect(monthSpentCents(db)).toBe(10)
    expect(monthSpentCents(db, new Date('2099-01-15'))).toBe(0)
    expect(estimateCents(db, 'google/x')).toBe(5)
  })

  it('enregistre les moteurs et le plafond', () => {
    expect(getAiSettings(db)).toEqual({ models: ['google/gemini-3.1-flash-image', 'openai/gpt-image-2'], capCents: 1000 })
    saveAiSettings(db, { models: [' openai/gpt-image-2 ', '', 'openai/gpt-image-2'], capCents: 500 })
    expect(getAiSettings(db)).toEqual({ models: ['openai/gpt-image-2'], capCents: 500 })
  })
})
