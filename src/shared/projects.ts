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
  markers: RenderMarker[]
}

// Objet repéré sur un rendu : position de 0 à 1 sur l'image (0,0 = en haut à gauche).
export interface RenderMarker {
  id: number
  x: number
  y: number
  article: ArticleCard
}

export interface ProjectNeed {
  id: number
  roomId: number | null
  label: string | null
  category: string | null
  choice: ArticleCard | null
  alternatives: ArticleCard[]
  quantity: number // nombre d'exemplaires de « Mon choix » à acheter
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
  showPrices: boolean // prix affichés dans le design book
  groupSingleChoices: boolean // choix sans autre proposition regroupés sur une même page
  trendImages: { id: number; url: string }[] // planche tendance (aucune photo : pas de planche)
  homebymeUrl: string | null // dernier lien HomeByMe importé
  mailedAt: string | null // dernier mail préparé pour envoyer le book
}

export type ProjectPatch = Partial<
  Pick<Project, 'clientTitle' | 'clientName' | 'address' | 'phone' | 'email' | 'bookDate' | 'showPrices' | 'groupSingleChoices'> & { texts: ProjectTexts }
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
  mailSubject: string // mail type pour envoyer le book : {client}, {mois} et {signature} sont remplacés
  mailBody: string
}

export const DEFAULT_MAIL_SUBJECT = 'Votre design book – {client}'
export const DEFAULT_MAIL_BODY =
  'Bonjour {client},\n\nVous trouverez ci-joint votre design book ({mois}).\n\nJe reste à votre disposition pour en parler ou pour toute modification.\n\nBelle journée,\n{signature}'

// Mail type rempli pour un projet.
export function fillMail(template: string, values: { client: string; mois: string; signature: string }): string {
  return template.replaceAll('{client}', values.client).replaceAll('{mois}', values.mois).replaceAll('{signature}', values.signature)
}

// « a@x.fr; b@y.fr » → « a@x.fr,b@y.fr » (les adresses mal écrites sont laissées de côté).
export const mailAddresses = (to: string) =>
  to
    .split(/[,;\s]+/)
    .filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))
    .join(',')

// Mail préparé dans l'étape « Envoyer au client ».
export interface MailRequest {
  to: string
  subject: string
  body: string
  formats: BookFormat[]
}

export type BookFormat = 'pdf' | 'pptx'
