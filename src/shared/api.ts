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

export interface MdekoApi {
  getAppInfo(): Promise<AppInfo>
  openDataFolder(): Promise<void>
  backupNow(): Promise<string>
  searchArticles(query: ArticleQuery): Promise<ArticlePage>
  articleFacets(text: string, filters: ArticleFilters): Promise<ArticleFacets>
  getArticle(id: number): Promise<ArticleDetail | null>
  openExternal(url: string): Promise<void>
}

export const IPC = {
  getAppInfo: 'app:get-info',
  openDataFolder: 'app:open-data-folder',
  backupNow: 'app:backup-now',
  searchArticles: 'articles:search',
  articleFacets: 'articles:facets',
  getArticle: 'articles:get',
  openExternal: 'app:open-external'
} as const
