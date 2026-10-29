// Modèle de page du design book, partagé entre le moteur (processus principal) et l'aperçu modifiable.
// Toutes les positions sont en millimètres sur une page A4 paysage.

export type Weight = 200 | 300 | 400 | 500

export type ThemeId = 'classique' | 'epure' | 'contemporain'

export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'classique', name: 'Classique' },
  { id: 'epure', name: 'Épuré' },
  { id: 'contemporain', name: 'Contemporain' }
]

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
// « needLabel:<besoin> » ou « note:<annotation> ». Un texte vide avec `placeholder` n'est pas exporté.
export type EditKey = string

export type Element =
  | (Box & { type: 'text'; runs: Run[]; style: TextStyle; link?: string; rotate?: number; edit?: EditKey; placeholder?: string })
  | (Box & { type: 'image'; image: ImageRef })
  | (Box & { type: 'rect'; fill?: string; line?: string })
  | (Box & { type: 'ellipse'; fill?: string; line?: string })

export interface Page {
  key: string // identifie la page pour y rattacher les annotations (« cover », « render:12 »…)
  elements: Element[]
}

export const PAGE_SIZE = { width: 297, height: 210 }
