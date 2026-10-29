// Contrat entre le processus principal et l'interface (exposé via le preload).
import type {
  Artisan,
  BookFormat,
  DesignerSettings,
  Paint,
  Project,
  ProjectPatch,
  ProjectSummary,
  RenderSection
} from './projects'

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
  schemaVersion: number
  lastBackupAt: string | null
}

export type PriceKind = 'fixed' | 'from' | 'per_m2' | 'per_roll' | 'on_quote' | 'unknown'
export type LinkStatus = 'unchecked' | 'ok' | 'gone' | 'unverifiable'
export type ArticleSort = 'relevance' | 'category' | 'recent' | 'price_asc' | 'price_desc' | 'name'

export interface Price {
  cents: number | null
  kind: PriceKind
  text: string | null
}

export interface ArticleCard {
  id: number
  name: string
  price: Price
  supplier: string | null
  thumbnailUrl: string | null
}

export interface ArticleDetail extends ArticleCard {
  family: string | null
  category: string | null
  url: string | null
  dimensions: string | null
  colorMaterial: string | null
  privateNote: string | null
  linkStatus: LinkStatus
  imageUrls: string[]
  tags: string[]
}

export interface ArticleFilters {
  familyId?: number
  categoryId?: number
  supplierIds?: number[]
  priceMinCents?: number
  priceMaxCents?: number
}

export interface ArticleQuery {
  text: string
  filters: ArticleFilters
  sort: ArticleSort
  offset: number
  limit: number
}

export interface ArticlePage {
  items: ArticleCard[]
  total: number
}

export interface FacetCount {
  id: number
  name: string
  count: number
}

export interface FamilyFacet extends FacetCount {
  categories: FacetCount[]
}

export interface ArticleFacets {
  families: FamilyFacet[]
  suppliers: FacetCount[]
}

// --- Projets ---

export interface ProjectsApi {
  list(): Promise<ProjectSummary[]>
  create(clientTitle: string, clientName: string): Promise<number>
  get(id: number): Promise<Project | null>
  update(id: number, patch: ProjectPatch): Promise<void>
  trash(id: number): Promise<void>
  restore(id: number): Promise<void>
  setRooms(id: number, names: string[]): Promise<void>
  addRenders(id: number, imageIds: number[], section: RenderSection): Promise<void>
  updateRender(renderId: number, patch: { section?: RenderSection; insetImageId?: number | null }): Promise<void>
  removeRender(renderId: number): Promise<void>
  reorder(table: 'renders' | 'needs', ids: number[]): Promise<void>
  addNeed(id: number, articleId: number): Promise<number>
  setNeedChoice(needId: number, articleId: number): Promise<void>
  setNeedAlternatives(needId: number, articleIds: number[]): Promise<void>
  removeNeed(needId: number): Promise<void>
  listPaints(): Promise<Paint[]>
  createPaint(paint: Omit<Paint, 'id' | 'promoCode'>): Promise<number>
  listArtisans(): Promise<Artisan[]>
  saveArtisan(artisan: Omit<Artisan, 'id'> & { id: number | null }): Promise<number>
  setLinks(id: number, table: 'project_paints' | 'project_artisans', ids: number[]): Promise<void>
  getSettings(): Promise<DesignerSettings>
  saveSettings(settings: Partial<Omit<DesignerSettings, 'reviewQrUrl'>> & { reviewQrImageId?: number }): Promise<void>
  preview(id: number): Promise<string>
  export(id: number, format: BookFormat): Promise<string | null>
}

// --- Édition ---

export interface CategoryOption {
  id: number
  name: string
  categories: { id: number; name: string }[]
}

export interface EditableImage {
  id: number
  url: string
}

export interface ArticleInput {
  id: number | null
  name: string
  priceCents: number | null
  priceKind: PriceKind
  supplier: string
  url: string
  categoryId: number | null
  dimensions: string
  colorMaterial: string
  tags: string[]
  privateNote: string
  images: EditableImage[]
}

export interface EditorChoices {
  categories: CategoryOption[]
  suppliers: string[]
  tags: string[]
}

// Photo préparée par l'interface : fichier d'origine + miniature JPEG sur fond blanc.
export interface ImageUpload {
  bytes: Uint8Array
  ext: string
  width: number
  height: number
  thumbnail: Uint8Array
}

export interface DownloadedImage {
  bytes: Uint8Array
  mimeType: string
}

export interface UndoResult {
  label: string
  articleId: number
}

export type MenuCommand = 'undo' | 'new-article' | 'new-project' | 'settings'

export interface MdekoApi {
  projects: ProjectsApi
  getAppInfo(): Promise<AppInfo>
  openDataFolder(): Promise<void>
  backupNow(): Promise<string>
  searchArticles(query: ArticleQuery): Promise<ArticlePage>
  articleFacets(text: string, filters: ArticleFilters): Promise<ArticleFacets>
  getArticle(id: number): Promise<ArticleDetail | null>
  openExternal(url: string): Promise<void>
  editorChoices(): Promise<EditorChoices>
  getArticleInput(id: number): Promise<ArticleInput | null>
  saveArticle(input: ArticleInput): Promise<number>
  uploadImage(image: ImageUpload): Promise<EditableImage>
  downloadImage(url: string): Promise<DownloadedImage>
  trashArticle(id: number): Promise<void>
  restoreArticle(id: number): Promise<void>
  listTrash(): Promise<ArticleCard[]>
  emptyTrash(): Promise<{ deleted: number; keptInProjects: number }>
  undo(): Promise<UndoResult | null>
  confirm(message: string, detail: string, action: string): Promise<boolean>
  onMenu(listener: (command: MenuCommand) => void): () => void
}

export const IPC = {
  getAppInfo: 'app:get-info',
  openDataFolder: 'app:open-data-folder',
  backupNow: 'app:backup-now',
  searchArticles: 'articles:search',
  articleFacets: 'articles:facets',
  getArticle: 'articles:get',
  openExternal: 'app:open-external',
  editorChoices: 'articles:editor-choices',
  getArticleInput: 'articles:get-input',
  saveArticle: 'articles:save',
  uploadImage: 'images:upload',
  downloadImage: 'images:download',
  trashArticle: 'articles:trash',
  restoreArticle: 'articles:restore',
  listTrash: 'articles:list-trash',
  emptyTrash: 'articles:empty-trash',
  undo: 'app:undo',
  confirm: 'app:confirm',
  menu: 'menu:command',
  // Projets : un canal unique, la méthode appelée est passée en premier argument.
  projects: 'projects:call'
} as const

export const PROJECT_METHODS = [
  'list', 'create', 'get', 'update', 'trash', 'restore', 'setRooms', 'addRenders', 'updateRender', 'removeRender',
  'reorder', 'addNeed', 'setNeedChoice', 'setNeedAlternatives', 'removeNeed', 'listPaints', 'createPaint',
  'listArtisans', 'saveArtisan', 'setLinks', 'getSettings', 'saveSettings', 'preview', 'export'
] as const satisfies readonly (keyof ProjectsApi)[]
