// Lecture d'un projet HomeByMe partagé (lien public, sans connexion) : les produits du catalogue HomeByMe
// et les objets du contenu communautaire, avec leur pièce et leur nombre.
// Ce ne sont pas des services officiels : ce sont les fichiers que charge la page « Liste de course » du site.
// Si HomeByMe change son site, c'est ici qu'il faut corriger.

import type { HbmObject } from '@shared/api'

const SITE = 'https://home.by.me'
const STORAGE = 'https://byme-prod-697c4ef6b5ec31e272ee67749bea4b727f31d5b0.s3.eu-west-1.amazonaws.com'
const PARALLEL = 6

export type GetJson = (url: string) => Promise<unknown>
export type GetText = (url: string) => Promise<string>

export interface HbmProject {
  title: string
  objects: HbmObject[]
}

type Json = Record<string, unknown>
type Point = { x: number; y: number }

const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// Lien collé par Mélanie : n'importe quelle page du projet (aperçu, liste de course, médias…).
export function isHomeByMeUrl(url: string): boolean {
  return /^https:\/\/(www\.)?home\.by\.me\/[a-z]{2}\/project\//i.test(url.trim())
}

// Le numéro interne du projet est écrit dans la page ; certains liens le donnent directement.
export function projectIdFromPage(url: string, html: string): number | null {
  const direct = /\/project\/(\d+)(?:[/?#]|$)/.exec(url)
  const found = direct?.[1] ?? /"projectId"\s*:\s*(\d+)/.exec(html)?.[1]
  return found ? Number(found) : null
}

// Pièces sans nom donné par Mélanie (« Pièce 12 ») : on ne s'en sert pas pour ranger.
const roomName = (label: unknown): string | null => {
  const name = str(label)
  return name && !/^pi[eè]ce\s*\d*$/i.test(name) ? name : null
}

// Un point est dans une pièce si une demi-droite partant de lui croise ses murs un nombre impair de fois.
export function insidePolygon(p: Point, segments: [Point, Point][]): boolean {
  let inside = false
  for (const [a, b] of segments) {
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// Dimensions de l'objet tel qu'il est posé (largeur × profondeur × hauteur), en cm.
function sizeOf(f: Json): string | null {
  const params = new Map(arr(f.parametersConfig).map((p) => [obj(p).paramID, obj(p).value]))
  const box = obj(f.boundingBox)
  const extent = (axis: 'x' | 'y' | 'z') => {
    const max = obj(box.max)[axis]
    const min = obj(box.min)[axis]
    return typeof max === 'number' && typeof min === 'number' ? max - min : null
  }
  const dims = [params.get('width') ?? extent('x'), params.get('depth') ?? extent('y'), params.get('height') ?? extent('z')]
  if (dims.some((d) => typeof d !== 'number')) return null
  return `${dims.map((d) => Math.max(1, Math.round((d as number) / 10))).join(' × ')} cm`
}

interface Placed {
  key: string
  kind: 'product' | 'community'
  dbId: string
  room: string | null
  size: string | null
  thumbnail: string | null
}

// Objets posés dans le projet (fichier 3D), avec la pièce où ils se trouvent. Les objets génériques de
// HomeByMe (portes, formes, plinthes…) sont écartés : seuls comptent les produits de marque et la communauté.
export function placedObjects(document: unknown, productIds: Set<string>): Placed[] {
  const out: Placed[] = []
  for (const building of arr(obj(obj(obj(document).core).buildingDocument).buildings)) {
    for (const level of arr(obj(building).levels)) {
      const walls = new Map(
        arr(obj(level).walls).map((w) => {
          const v = arr(obj(obj(w).edge).vertices).map((p) => obj(p) as unknown as Point)
          return [obj(w).uuid, v.length === 2 ? ([v[0], v[1]] as [Point, Point]) : null]
        })
      )
      const rooms = arr(obj(level).rooms).map((r) => ({
        name: roomName(obj(r).label),
        segments: [...new Set(arr(obj(r).idOrigin).map((o) => obj(o).uuid))]
          .map((uuid) => walls.get(uuid))
          .filter((s): s is [Point, Point] => Boolean(s))
      }))
      for (const item of arr(obj(level).furnitures)) {
        const f = obj(item)
        const dbId = str(f.dbId)
        if (!dbId) continue
        const community = f.isUserProduct === true
        if (!community && !productIds.has(dbId)) continue
        const t = arr(f.transfo)
        const at = typeof t[12] === 'number' && typeof t[13] === 'number' ? { x: t[12] as number, y: t[13] as number } : null
        const room = at ? rooms.find((r) => r.segments.length >= 3 && insidePolygon(at, r.segments)) : undefined
        const base = str(obj(f.resourceInfo).baseURL)
        out.push({
          key: `${community ? 'community' : 'product'}:${dbId}`,
          kind: community ? 'community' : 'product',
          dbId,
          room: room?.name ?? null,
          size: sizeOf(f),
          thumbnail: base ? `${STORAGE}/data/geometries/${base}/Thumbnails/512.jpg` : null
        })
      }
    }
  }
  return out
}

// Regroupe les objets identiques : un objet par produit, avec le nombre posé dans chaque pièce.
function grouped(placed: Placed[]): Map<string, { first: Placed; rooms: Map<string | null, number> }> {
  const groups = new Map<string, { first: Placed; rooms: Map<string | null, number> }>()
  for (const p of placed) {
    const g = groups.get(p.key) ?? { first: p, rooms: new Map() }
    g.rooms.set(p.room, (g.rooms.get(p.room) ?? 0) + 1)
    groups.set(p.key, g)
  }
  return groups
}

// Nom d'un objet de la communauté : en français s'il existe.
function communityName(info: Json): string | null {
  const translations = arr(info.translations).map(obj)
  const fr = translations.find((t) => String(t.language ?? '').startsWith('fr'))
  return str(fr?.name) ?? str(info.name) ?? str(translations[0]?.name)
}

async function inBatches<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += PARALLEL) results.push(...(await Promise.all(items.slice(i, i + PARALLEL).map(work))))
  return results
}

export async function readHomeByMeProject(url: string, getText: GetText, getJson: GetJson): Promise<HbmProject> {
  if (!isHomeByMeUrl(url)) throw new Error('Ce lien n’est pas celui d’un projet HomeByMe.')
  const id = projectIdFromPage(url, await getText(url.trim()))
  if (!id) throw new Error('Ce projet HomeByMe ne peut pas être lu : vérifiez qu’il est bien partagé.')

  const project = obj(await getJson(`${SITE}/ajax/project/${id}?alpha=true`))
  const documentUrl = str(project.bmProjURL)
  if (!documentUrl) throw new Error('Le plan 3D de ce projet HomeByMe est introuvable.')
  const catalog = obj(await getJson(`${SITE}/ajax/project/${id}/rooms-furnitures?alpha=true`))
  const all = obj(arr(catalog.rooms).find((r) => obj(r).id === 0))
  const products = new Map(arr(all.furnitures).map((f) => [String(obj(f).id), obj(f)]))
  const groups = grouped(placedObjects(await getJson(documentUrl), new Set(products.keys())))
  // Produits qui ne sont pas des meubles posés (moulures, plinthes…) : pièces d'après la liste de course.
  for (const id of products.keys()) {
    const key = `product:${id}`
    if (groups.has(key)) continue
    const rooms = new Map<string | null, number>()
    for (const r of arr(catalog.rooms).map(obj)) {
      if (r.id !== 0 && arr(r.furnitures).some((f) => String(obj(f).id) === id)) rooms.set(roomName(r.name), (rooms.get(roomName(r.name)) ?? 0) + 1)
    }
    groups.set(key, { first: { key, kind: 'product', dbId: id, room: null, size: null, thumbnail: null }, rooms: rooms.size ? rooms : new Map([[null, 1]]) })
  }

  const objects = await inBatches([...groups.values()], async ({ first, rooms }): Promise<HbmObject | null> => {
    const common = {
      key: first.key,
      kind: first.kind,
      size: first.size,
      rooms: [...rooms.entries()].map(([name, count]) => ({ name, count }))
    }
    if (first.kind === 'product') {
      const p = products.get(first.dbId)!
      const sheet = Object.values(obj(p.translations)).map(obj)[0] ?? {}
      const thumbnail = obj(obj(p.presentation).thumbnail)
      return {
        ...common,
        name: str(p.name) ?? str(sheet.name) ?? str(p.reference) ?? 'Produit HomeByMe',
        brand: str(obj(p.brand).name),
        url: str(p.storeUrl) ?? str(sheet.productSheetUrl),
        description: str(p.description) ?? str(sheet.commercialDescription),
        imageUrl: str(thumbnail.largeResolutionURL) ?? str(p.mediaUrl) ?? first.thumbnail
      }
    }
    let info: Json = {}
    try {
      info = obj(await getJson(`${SITE}/ajax/user-product/${first.dbId}?alpha=true`))
    } catch {
      // Objet retiré de la communauté : on le montre quand même, avec sa vignette.
    }
    return {
      ...common,
      name: communityName(info) ?? 'Objet de la communauté',
      brand: null,
      url: str(info.storeUrl),
      description: null,
      imageUrl: first.thumbnail ?? str(info.mediaUrl)
    }
  })

  return {
    title: str(project.projectName) ?? 'Projet HomeByMe',
    // Produits du catalogue d'abord, puis la communauté ; chacun par nom.
    objects: objects
      .filter((o): o is HbmObject => o !== null)
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'fr') : a.kind === 'product' ? -1 : 1))
  }
}
