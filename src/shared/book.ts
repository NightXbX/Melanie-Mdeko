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
}

export interface Run {
  text: string
  color?: string
  weight?: Weight
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
    | (Box & { type: 'rect'; fill?: string; line?: string })
    | (Box & { type: 'ellipse'; fill?: string; line?: string })
  )

export interface Page {
  key: string // identifie la page pour y rattacher annotations et ajustements (« cover », « render:12 »…)
  elements: Element[]
}

// Ajustement fait dans l'aperçu : position et taille (mm), taille du texte (pt), texte remplacé.
export interface BookAdjustment {
  x?: number
  y?: number
  w?: number
  h?: number
  size?: number
  text?: string
}

export const PAGE_SIZE = { width: 297, height: 210 }

// Clé d'édition d'un texte propre au book (sans équivalent dans la base).
export const textKey = (pageKey: string, elementId: string) => `text:${pageKey}|${elementId}`
