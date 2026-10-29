import type { Weight } from '@shared/book'

// Charte des design books m·deko (style Contemporain, le seul conservé).
// Toutes les mesures sont en millimètres sur une page A4 paysage ; les tailles de texte en points.
// Fond blanc, filets fins, pas d'aplats, sauf le disque de la 4e de couverture et les échantillons de teintes.

export { PAGE_SIZE as PAGE } from '@shared/book'

export const COLORS = {
  taupe: '#BFB6A3', // « m » du logo, filets marqués
  taupeLight: '#CCC7B9', // filets, cadres
  taupeDark: '#9C927E', // petites étiquettes : même teinte, assez foncée pour rester lisible
  disc: '#BCAD8F', // disque de la 4e de couverture
  discLogo: '#D3CABA', // « m » du logo posé sur le disque
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

// Bas de la zone utile (le pied de page est en dessous).
export const BOTTOM = 193

export const TEXT_BLOCK = { x: 40, y: 34, width: 212, height: 128, size: 16, lineHeight: 1.75 }

// Rendu 3D : toujours en grand, sur toute la largeur de la page.
export const RENDER = { x: 8.5, y: 4, width: 280, height: 157.5 }

export const WATERMARK = { width: 17, height: 4.2, size: 7 }
