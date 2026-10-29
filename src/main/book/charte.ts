// Charte des design books m·deko, relevée sur les design books PDF de Mélanie.
// Toutes les mesures sont en millimètres sur une page A4 paysage ; les tailles de texte en points.

export const PAGE = { width: 297, height: 210 }

export const COLORS = {
  taupe: '#BFB6A3', // « m » du logo, « Design Book », titres de section
  taupeLight: '#CCC7B9', // filets, cadres
  disc: '#DCD5C8', // disque de la 4e de couverture
  text: '#1F1F1F',
  textSoft: '#6B6660',
  white: '#FFFFFF',
  watermark: '#2E3233'
}

// Poppins : ExtraLight pour le style m·deko, un peu plus de graisse pour les petits textes et les prix.
export type Weight = 200 | 300 | 400 | 500

export const FONT_FACES: Record<Weight, string> = {
  200: 'Poppins ExtraLight',
  300: 'Poppins Light',
  400: 'Poppins',
  500: 'Poppins Medium'
}

export const MARGIN = 20

export const FOOTER = { right: 275, y: 193, height: 8, size: 12 }

export const SECTION_TITLE = { size: 47, right: 284, bottom: 202, length: 190, thickness: 20 }

export const TEXT_BLOCK = { x: 40, y: 34, width: 212, height: 150, size: 16, lineHeight: 1.75 }

export const RENDER = { x: 8.5, y: 3, width: 280, height: 157.5, insetY: 163, insetHeight: 28 }

export const WATERMARK = { width: 17, height: 4.2, size: 7 }
