import type { ThemeId, Weight } from '@shared/book'

// Charte des design books m·deko, relevée sur les design books PDF de Mélanie.
// Toutes les mesures sont en millimètres sur une page A4 paysage ; les tailles de texte en points.
// Les trois styles gardent la même police et restent sobres : fond blanc, filets fins, pas d'aplats.

export { PAGE_SIZE as PAGE } from '@shared/book'

export const COLORS = {
  taupe: '#BFB6A3', // « m » du logo, « Design Book »
  taupeLight: '#CCC7B9', // filets, cadres
  taupeDark: '#9C927E', // petites étiquettes : même teinte, assez foncée pour rester lisible
  disc: '#EEEAE3', // disque très clair de la 4e de couverture (style Classique)
  text: '#1F1F1F',
  textSoft: '#6B6660',
  white: '#FFFFFF',
  watermark: '#2E3233'
}

export const FONT_FACES: Record<Weight, string> = {
  200: 'Poppins ExtraLight',
  300: 'Poppins Light',
  400: 'Poppins',
  500: 'Poppins Medium'
}

export const MARGIN = 20

export const TEXT_BLOCK = { x: 40, width: 212, height: 128, size: 16, lineHeight: 1.75 }

// Rendu 3D : toujours en grand, sur toute la largeur de la page.
export const RENDER = { x: 8.5, width: 280, height: 157.5 }

export const WATERMARK = { width: 17, height: 4.2, size: 7 }

// Ce qui change d'un style à l'autre : où commence le contenu et où s'arrête la page utile.
export const THEME_FRAME: Record<ThemeId, { top: number; bottom: number; renderTop: number }> = {
  classique: { top: 0, bottom: 191, renderTop: 3 },
  epure: { top: 6, bottom: 203, renderTop: 15 },
  contemporain: { top: 0, bottom: 193, renderTop: 4 }
}
