import type { ArticleCard } from './api'

// Types des projets et du design book, partagés entre le processus principal et l'interface.

export type RenderSection = 'plans' | 'changes'

// Teintes dont la marque n'est pas précisée.
export const DEFAULT_PAINT_BRAND = 'Teintes et couleurs'

export interface ProjectSummary {
  id: number
  title: string // « Mme Durand »
  bookDate: string | null // AAAA-MM
  coverUrl: string | null
  updatedAt: string
}

export interface Room {
  id: number
  name: string
}

export interface ProjectRender {
  id: number
  imageId: number
  imageUrl: string
  thumbnailUrl: string
  insetUrl: string | null
  section: RenderSection
  caption: string | null
  edited: boolean // une version retouchée par l'assistant remplace l'original dans le book
}

export interface ProjectNeed {
  id: number
  roomId: number | null
  label: string | null
  category: string | null
  choice: ArticleCard | null
  alternatives: ArticleCard[]
  // Photos de « Mon choix » : toutes celles de l'article, et celles retenues pour le book (vide = la première).
  choiceImages: { id: number; url: string }[]
  bookImageIds: number[]
}

export interface Paint {
  id: number
  brand: string
  name: string
  reference: string | null
  hex: string | null
  promoCode: string | null
}

export interface Artisan {
  id: number
  trade: string
  name: string
  city: string | null
  phone: string | null
  email: string | null
}

export interface ProjectTexts {
  intro: string | null // null = texte modèle des réglages
  wishes: string | null
  closing: string | null
}

export interface Project {
  id: number
  clientTitle: string
  clientName: string
  address: string
  phone: string
  email: string
  bookDate: string | null
  rooms: Room[]
  texts: ProjectTexts
  renders: ProjectRender[]
  needs: ProjectNeed[]
  paintIds: number[]
  artisanIds: number[]
}

export type ProjectPatch = Partial<
  Pick<Project, 'clientTitle' | 'clientName' | 'address' | 'phone' | 'email' | 'bookDate'> & { texts: ProjectTexts }
>

// Réglages de Mélanie : coordonnées et textes modèles (dans ses données, jamais dans le code).
export interface DesignerSettings {
  designerName: string
  address: string
  phone: string
  email: string
  reviewQrUrl: string | null
  introText: string
  wishesText: string // « {pieces} » est remplacé par les pièces du projet
  closingText: string
}

export type BookFormat = 'pdf' | 'pptx'
