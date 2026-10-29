import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArticleCard as Card, ArticleFacets, ArticleFilters, ArticleSort } from '@shared/api'
import { ArticleCard } from '../components/ArticleCard'
import { ArticleDetail } from '../components/ArticleDetail'
import { FilterPanel } from '../components/FilterPanel'
import { Icon } from '../components/Icon'
import { Toolbar } from '../components/Toolbar'

const PAGE = 60

const SORTS: { value: ArticleSort; label: string }[] = [
  { value: 'relevance', label: 'Pertinence' },
  { value: 'category', label: 'Par catégorie' },
  { value: 'recent', label: 'Ajout récent' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
  { value: 'name', label: 'Nom (A → Z)' }
]

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

const hasFilters = (f: ArticleFilters) =>
  Boolean(f.familyId || f.categoryId || f.supplierIds?.length || f.priceMinCents !== undefined || f.priceMaxCents !== undefined)

export function ShoppingListView() {
  const [query, setQuery] = useState('')
  const text = useDebounced(query.trim(), 150)
  const [filters, setFilters] = useState<ArticleFilters>({})
  const [chosenSort, setChosenSort] = useState<ArticleSort | null>(null)
  // Par défaut : pertinence pendant une recherche, par catégorie sinon.
  const sort: ArticleSort = chosenSort && (chosenSort !== 'relevance' || text) ? chosenSort : text ? 'relevance' : 'category'

  const [items, setItems] = useState<Card[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [facets, setFacets] = useState<ArticleFacets | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const loading = useRef(false)
  const requestId = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Nouvelle recherche : on repart du début.
  useEffect(() => {
    const id = ++requestId.current
    loading.current = true
    void window.mdeko.searchArticles({ text, filters, sort, offset: 0, limit: PAGE }).then((page) => {
      if (id !== requestId.current) return
      setItems(page.items)
      setTotal(page.total)
      loading.current = false
      resultsRef.current?.scrollTo({ top: 0 })
    })
    void window.mdeko.articleFacets(text, filters).then((f) => id === requestId.current && setFacets(f))
  }, [text, filters, sort])

  const loadMore = useCallback(() => {
    if (loading.current || total === null || items.length >= total) return
    const id = requestId.current
    loading.current = true
    void window.mdeko.searchArticles({ text, filters, sort, offset: items.length, limit: PAGE }).then((page) => {
      if (id !== requestId.current) return
      setItems((prev) => [...prev, ...page.items])
      loading.current = false
    })
  }, [text, filters, sort, items.length, total])

  // Chargement progressif quand on approche du bas de la grille.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
      root: resultsRef.current,
      rootMargin: '800px'
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  // ⌘F place le curseur dans la recherche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpenId(null)
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const reset = () => {
    setQuery('')
    setFilters({})
  }
  const closeDetail = useCallback(() => setOpenId(null), [])

  return (
    <>
      <Toolbar title="Shopping list">
        <label className="search-field">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Rechercher un meuble, une matière, un site…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpenId(null)
            }}
          />
          {query && (
            <button type="button" className="search-clear" aria-label="Effacer la recherche" onClick={() => setQuery('')}>
              <Icon name="xmark" size={12} />
            </button>
          )}
        </label>
        <button type="button" className="button button-primary">
          <Icon name="plus" size={14} />
          Ajouter
        </button>
      </Toolbar>

      <div className="shopping">
        <FilterPanel facets={facets} filters={filters} onChange={setFilters} />

        <div className="results" ref={resultsRef}>
          <div className="results-bar">
            <span className="results-count">
              {total === null ? '' : `${total.toLocaleString('fr-FR')} article${total > 1 ? 's' : ''}`}
            </span>
            {(text || hasFilters(filters)) && (
              <button type="button" className="button button-plain" onClick={reset}>
                Tout effacer
              </button>
            )}
            <label className="sort">
              Trier par
              <select value={sort} onChange={(e) => setChosenSort(e.target.value as ArticleSort)}>
                {SORTS.filter((s) => s.value !== 'relevance' || text).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {total === 0 ? (
            <div className="empty-state">
              <p>Aucun article ne correspond.</p>
              <button type="button" className="button" onClick={reset}>
                Effacer la recherche et les filtres
              </button>
            </div>
          ) : (
            <div className="grid">
              {items.map((a) => (
                <ArticleCard key={a.id} article={a} onOpen={setOpenId} />
              ))}
            </div>
          )}
          <div ref={sentinelRef} className="sentinel" />
        </div>

        {openId !== null && <ArticleDetail id={openId} onClose={closeDetail} />}
      </div>
    </>
  )
}
