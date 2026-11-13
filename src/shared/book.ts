// Modèle de page du design book, partagé entre le moteur (processus principal) et l'aperçu modifiable.
// Toutes les positions sont en millimètres sur une page A4 paysage.

export type Weight = 200 | 300 | 400 | 500

export interface ImageRef {
  url: string // mdeko:// pour l'aperçu et le PDF
  path: string // fichier, pour le PPTX
  width: number
  height: number
}

export interface TextStyle {
  size: number
  weight?: Weight
  color?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  valign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
  letterSpacing?: number // pt
  italic?: boolean
  underline?: boolean
}

export interface Run {
  text: string
  color?: string
  weight?: Weight
  italic?: boolean
  underline?: boolean
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// Texte modifiable dans l'aperçu : « intro », « wishes », « closing », « caption:<rendu> »,
// « needLabel:<besoin> », « note:<annotation> » ou « text:<page>|<élément> » (texte propre à ce book).
// Un texte vide avec `placeholder` n'est pas exporté.
export type EditKey = string

// `id` : élément que Mélanie peut déplacer et redimensionner dans l'aperçu (unique dans sa page).
// `adjusted` : elle l'a déjà fait (on peut alors le rétablir).
interface Common {
  id?: string
  adjusted?: boolean
}

export type Element = Common &
  (
    | (Box & { type: 'text'; runs: Run[]; style: TextStyle; link?: string; rotate?: number; edit?: EditKey; placeholder?: string })
    | (Box & { type: 'image'; image: ImageRef })
    | (Box & { type: 'rect'; fill?: string; line?: string; lineWidth?: number })
    | (Box & { type: 'ellipse'; fill?: string; line?: string; lineWidth?: number })
    // Trait horizontal au milieu de la boîte, tourné autour de son centre (degrés, sens des aiguilles d'une montre).
    | (Box & { type: 'line'; line?: string; lineWidth?: number; arrow?: boolean; rotate?: number })
  )

// Objets que Mélanie insère dans l'aperçu, comme dans PowerPoint.
export type ObjectKind = 'text' | 'image' | 'rect' | 'ellipse' | 'line' | 'arrow'
export const OBJECT_KINDS: ObjectKind[] = ['text', 'image', 'rect', 'ellipse', 'line', 'arrow']

// Mise en forme choisie dans la barre d'outils (texte : couleur, gras, italique, souligné, alignement ;
// forme : fond, trait, épaisseur, rotation). `fill: ''` : sans fond.
export interface ObjectStyle {
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: 'left' | 'center' | 'right'
  size?: number // pt (annotations ; ailleurs, c'est l'ajustement `size`)
  fill?: string
  line?: string
  lineWidth?: number // pt
  rotate?: number
}

// Annotation supprimée, telle qu'en base, pour la remettre (⌘Z).
export type DeletedNote = Record<string, string | number | null>

// Dessin d'un trait ou d'une flèche dans sa boîte (mm) : épaisseur, pointe, fin du trait avant la pointe.
export function lineGeometry(e: { w: number; h: number; lineWidth?: number; arrow?: boolean }) {
  const width = (e.lineWidth ?? 1.5) * 0.3528
  const head = e.arrow ? Math.max(2, width * 3.5) : 0
  return { width, head, y: e.h / 2, end: Math.max(0, e.w - head * 0.8) }
}

const COLOR = /^#[0-9a-f]{6}$/i

// Garde seulement des valeurs sûres (la mise en forme vient de l'interface et finit dans le HTML du PDF).
export function cleanStyle(input: unknown): ObjectStyle {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: ObjectStyle = {}
  for (const k of ['color', 'line'] as const) if (typeof s[k] === 'string' && COLOR.test(s[k])) out[k] = s[k]
  if (typeof s.fill === 'string' && (s.fill === '' || COLOR.test(s.fill))) out.fill = s.fill
  for (const k of ['bold', 'italic', 'underline'] as const) if (typeof s[k] === 'boolean') out[k] = s[k]
  if (s.align === 'left' || s.align === 'center' || s.align === 'right') out.align = s.align
  const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(v, max)) : undefined)
  const size = num(s.size, 5, 120)
  if (size !== undefined) out.size = size
  const lineWidth = num(s.lineWidth, 0.25, 20)
  if (lineWidth !== undefined) out.lineWidth = lineWidth
  const rotate = num(s.rotate, -3600, 3600)
  if (rotate !== undefined) out.rotate = ((rotate % 360) + 360) % 360
  return out
}

export interface Page {
  key: string // identifie la page pour y rattacher annotations et ajustements (« cover », « render:12 »…)
  elements: Element[]
  hidden?: boolean // retirée par Mélanie : montrée grisée dans l'aperçu, ni exportée ni numérotée
}

// Ajustement fait dans l'aperçu : position et taille (mm), taille du texte (pt), texte remplacé.
export interface BookAdjustment {
  x?: number
  y?: number
  w?: number
  h?: number
  size?: number
  text?: string
  style?: ObjectStyle
}

export const PAGE_SIZE = { width: 297, height: 210 }

// Clé d'édition d'un texte propre au book (sans équivalent dans la base).
export const textKey = (pageKey: string, elementId: string) => `text:${pageKey}|${elementId}`
