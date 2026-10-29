// Contrat entre le processus principal et l'interface (exposé via le preload).

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

export type MenuCommand = 'undo' | 'new-article'

export interface MdekoApi {
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
  menu: 'menu:command'
} as const
