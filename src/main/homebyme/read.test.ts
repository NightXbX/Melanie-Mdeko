import { describe, expect, it } from 'vitest'
import { insidePolygon, isHomeByMeUrl, projectIdFromPage, readHomeByMeProject } from './read'

// Projet fictif : un salon carré de 4 m, et une « Pièce 2 » sans nom à côté.
const wall = (uuid: string, a: [number, number], b: [number, number]) => ({ uuid, edge: { vertices: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }] } })
const at = (x: number, y: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1]
const document = {
  core: {
    buildingDocument: {
      buildings: [
        {
          levels: [
            {
              walls: [
                wall('w1', [0, 0], [4000, 0]),
                wall('w2', [4000, 0], [4000, 4000]),
                wall('w3', [4000, 4000], [0, 4000]),
                wall('w4', [0, 4000], [0, 0]),
                wall('w5', [4000, 0], [8000, 0]),
                wall('w6', [8000, 0], [8000, 4000]),
                wall('w7', [8000, 4000], [4000, 4000])
              ],
              rooms: [
                { label: 'Salon', idOrigin: ['w1', 'w2', 'w3', 'w4'].map((uuid) => ({ uuid })) },
                { label: 'Pièce 2', idOrigin: ['w5', 'w6', 'w7', 'w2'].map((uuid) => ({ uuid })) }
              ],
              furnitures: [
                { dbId: '100', transfo: at(1000, 1000), boundingBox: { min: { x: -1000, y: -450, z: 0 }, max: { x: 1000, y: 450, z: 750 } } },
                { dbId: '200', isUserProduct: true, transfo: at(2000, 2000), resourceInfo: { baseURL: 'ABC' }, parametersConfig: [{ paramID: 'width', value: 550 }], boundingBox: { min: { x: -250, y: -250, z: 0 }, max: { x: 250, y: 250, z: 800 } } },
                { dbId: '200', isUserProduct: true, transfo: at(2500, 2500), resourceInfo: { baseURL: 'ABC' } },
                { dbId: '200', isUserProduct: true, transfo: at(6000, 2000), resourceInfo: { baseURL: 'ABC' } },
                { dbId: 'gen_forme_libre_01', transfo: at(1000, 1000) }
              ]
            }
          ]
        }
      ]
    }
  }
}

const json: Record<string, unknown> = {
  'https://home.by.me/ajax/project/42?alpha=true': { projectName: 'Mme Durand', bmProjURL: 'https://stockage/projet.BMPROJ' },
  'https://home.by.me/ajax/project/42/rooms-furnitures?alpha=true': {
    rooms: [
      {
        id: 0,
        furnitures: [
          {
            id: '100',
            name: 'Oak dining table',
            brand: { name: 'Maison Exemple' },
            storeUrl: 'https://exemple.fr/table-chene',
            description: 'Table en chêne massif',
            presentation: { thumbnail: { largeResolutionURL: 'https://cdn.exemple.fr/table.jpg' } }
          }
        ]
      }
    ]
  },
  'https://stockage/projet.BMPROJ': document,
  'https://home.by.me/ajax/user-product/200?alpha=true': { name: 'Chair', translations: [{ language: 'fr-FR', name: 'Chaise en rotin' }] }
}

const getJson = async (url: string) => {
  if (!(url in json)) throw new Error(`absent : ${url}`)
  return json[url]
}
const getText = async () => '<script>var page = {"projectId":42,"projectUuid":"X"}</script>'

describe('lecture d’un projet HomeByMe', () => {
  it('reconnaît les liens de projet', () => {
    expect(isHomeByMeUrl('https://home.by.me/fr/project/abc123/durand/liste-course')).toBe(true)
    expect(isHomeByMeUrl('https://exemple.fr/project/1')).toBe(false)
    expect(projectIdFromPage('https://home.by.me/fr/project/abc/durand', '"projectId":42')).toBe(42)
    expect(projectIdFromPage('https://home.by.me/fr/project/42/medias', '')).toBe(42)
  })

  it('sait si un point est dans une pièce', () => {
    const square: [{ x: number; y: number }, { x: number; y: number }][] = [
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 10, y: 10 }, { x: 0, y: 10 }],
      [{ x: 10, y: 0 }, { x: 10, y: 10 }],
      [{ x: 0, y: 10 }, { x: 0, y: 0 }]
    ]
    expect(insidePolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(insidePolygon({ x: 15, y: 5 }, square)).toBe(false)
  })

  it('liste les produits et les objets de la communauté, par pièce', async () => {
    const project = await readHomeByMeProject('https://home.by.me/fr/project/abc123/durand/liste-course', getText, getJson)
    expect(project.title).toBe('Mme Durand')
    expect(project.objects).toEqual([
      {
        key: 'product:100',
        kind: 'product',
        name: 'Oak dining table',
        brand: 'Maison Exemple',
        url: 'https://exemple.fr/table-chene',
        description: 'Table en chêne massif',
        imageUrl: 'https://cdn.exemple.fr/table.jpg',
        size: '200 × 90 × 75 cm',
        rooms: [{ name: 'Salon', count: 1 }]
      },
      {
        key: 'community:200',
        kind: 'community',
        name: 'Chaise en rotin',
        brand: null,
        url: null,
        description: null,
        imageUrl: expect.stringContaining('/data/geometries/ABC/Thumbnails/512.jpg'),
        size: '55 × 50 × 80 cm',
        rooms: [
          { name: 'Salon', count: 2 },
          { name: null, count: 1 }
        ]
      }
    ])
  })

  it('refuse un lien qui n’est pas HomeByMe', async () => {
    await expect(readHomeByMeProject('https://exemple.fr', getText, getJson)).rejects.toThrow('HomeByMe')
  })
})
