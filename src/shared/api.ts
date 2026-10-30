// Contrat entre le processus principal et l'interface (exposé via le preload).
import type { BookAdjustment, Page } from './book'
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
  updateRender(renderId: number, patch: { section?: RenderSection; insetImageId?: number | null; caption?: string | null }): Promise<void>
  removeRender(renderId: number): Promise<void>
  reorder(table: 'renders' | 'needs', ids: number[]): Promise<void>
  addNeed(id: number, articleId: number, roomId?: number | null): Promise<number>
  setNeedRoom(needId: number, roomId: number | null): Promise<void>
  setNeedChoice(needId: number, articleId: number): Promise<void>
  setNeedAlternatives(needId: number, articleIds: number[]): Promise<void>
  setNeedImages(needId: number, imageIds: number[]): Promise<void>
  removeNeed(needId: number): Promise<void>
  setNeedQuantity(needId: number, quantity: number): Promise<void>
  setTrendImages(id: number, imageIds: number[]): Promise<void>
  listInspirationImages(): Promise<{ id: number; url: string; title: string }[]>
  listPaints(): Promise<Paint[]>
  createPaint(paint: Omit<Paint, 'id' | 'promoCode'>): Promise<number>
  listArtisans(): Promise<Artisan[]>
  saveArtisan(artisan: Omit<Artisan, 'id'> & { id: number | null }): Promise<number>
  setLinks(id: number, table: 'project_paints' | 'project_artisans', ids: number[]): Promise<void>
  getSettings(): Promise<DesignerSettings>
  saveSettings(settings: Partial<Omit<DesignerSettings, 'reviewQrUrl'>> & { reviewQrImageId?: number }): Promise<void>
  pages(id: number): Promise<Page[]>
  editText(id: number, key: string, text: string): Promise<void>
  addNote(id: number, pageKey: string, x: number, y: number): Promise<number>
  moveNote(noteId: number, x: number, y: number, w?: number): Promise<void>
  adjust(id: number, pageKey: string, elementId: string, patch: BookAdjustment | null): Promise<void>
  resetPage(id: number, pageKey: string): Promise<void>
  deleteNote(noteId: number): Promise<void>
  export(id: number, format: BookFormat): Promise<string>
  openFolder(id: number): Promise<void>
}

// --- Assistant IA (retouche des rendus) ---

export interface AiSettings {
  models: string[] // 1 moteur, ou 2 pour le duel
  capCents: number // plafond de dépense du mois
}

export interface AiStatus {
  hasKey: boolean
  canStoreKey: boolean // le Trousseau (Mac) ou le coffre de Windows est disponible
  settings: AiSettings
  spentCents: number // ce mois-ci
  estimateCents: number // coût probable d'une demande (toutes propositions comprises)
  score: { model: string; kept: number; proposed: number }[]
}

// Proposition d'un moteur ; le nom du moteur n'est pas montré pendant le duel, pour ne pas influencer le choix.
export interface AiProposal {
  versionId: number | null
  imageUrl: string | null
  costCents: number
  error: string | null
}

export interface AiVersion {
  id: number | null // null : l'original
  imageUrl: string
  prompt: string | null
  createdAt: string | null
  active: boolean
}

export interface AiApi {
  status(): Promise<AiStatus>
  setKey(key: string | null): Promise<void>
  saveSettings(settings: Partial<AiSettings>): Promise<void>
  listModels(): Promise<{ id: string; name: string }[]>
  edit(renderId: number, prompt: string, referenceImageIds: number[]): Promise<AiProposal[]>
  cancel(): Promise<void>
  keep(versionId: number): Promise<void>
  history(renderId: number): Promise<AiVersion[]>
  show(renderId: number, versionId: number | null): Promise<void>
}

export const AI_METHODS = ['status', 'setKey', 'saveSettings', 'listModels', 'edit', 'cancel', 'keep', 'history', 'show'] as const satisfies readonly (keyof AiApi)[]

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

export type MenuCommand = 'undo' | 'new-article' | 'new-project' | 'settings' | 'import' | 'check-update'

// Nouvelle version publiée sur GitHub.
export interface UpdateInfo {
  version: string
  notes: string
  sizeBytes: number
}

// Bilan d'un import de PDF (design book ou shopping list).
export interface ImportSummary {
  projectId: number | null
  projectTitle: string | null
  added: number
  reused: number
  renders: number
  needs: number
}

// Vérification de la base (écran « Vérification »).
export interface CheckGroup {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  count: number
  articles: ArticleCard[] // les premiers seulement
}

export interface CheckReport {
  checkedAt: string
  database: { path: string; sizeBytes: number; ok: boolean; problems: string[] }
  articles: number
  images: number
  links: { toCheck: number; ok: number }
  groups: CheckGroup[]
}

export interface LinkCheckProgress {
  done: number
  total: number
  gone: number
}

export interface MdekoApi {
  projects: ProjectsApi
  ai: AiApi
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
  importPdf(path?: string): Promise<ImportSummary | null>
  onImportProgress(listener: (page: number, total: number) => void): () => void
  pathForFile(file: File): string
  checkDatabase(): Promise<CheckReport>
  checkLinks(): Promise<LinkCheckProgress>
  stopLinkCheck(): Promise<void>
  onLinkProgress(listener: (progress: LinkCheckProgress) => void): () => void
  showDatabase(): Promise<void>
  checkUpdate(): Promise<UpdateInfo | null>
  installUpdate(): Promise<void>
  onUpdateAvailable(listener: (update: UpdateInfo) => void): () => void
  onUpdateProgress(listener: (done: number, total: number) => void): () => void
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
  importPdf: 'import:pdf',
  importProgress: 'import:progress',
  checkDatabase: 'check:database',
  checkLinks: 'check:links',
  stopLinkCheck: 'check:stop-links',
  linkProgress: 'check:link-progress',
  showDatabase: 'app:show-database',
  checkUpdate: 'update:check',
  installUpdate: 'update:install',
  updateAvailable: 'update:available',
  updateProgress: 'update:progress',
  // Projets : un canal unique, la méthode appelée est passée en premier argument.
  projects: 'projects:call',
  ai: 'ai:call'
} as const

export const PROJECT_METHODS = [
  'list', 'create', 'get', 'update', 'trash', 'restore', 'setRooms', 'addRenders', 'updateRender', 'removeRender',
  'reorder', 'addNeed', 'setNeedRoom', 'setNeedChoice', 'setNeedAlternatives', 'setNeedImages', 'removeNeed', 'setNeedQuantity', 'setTrendImages', 'listInspirationImages', 'listPaints', 'createPaint',
  'listArtisans', 'saveArtisan', 'setLinks', 'getSettings', 'saveSettings', 'pages', 'editText', 'addNote', 'moveNote',
  'deleteNote', 'adjust', 'resetPage', 'export', 'openFolder'
] as const satisfies readonly (keyof ProjectsApi)[]
