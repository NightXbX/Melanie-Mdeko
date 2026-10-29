import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArticleCard as Card, ArticleFacets, ArticleFilters, ArticleSort } from '@shared/api'
import { useApp } from '../app-context'
import { ArticleCard } from '../components/ArticleCard'
import { ArticleDetail } from '../components/ArticleDetail'
import { ArticleEditor } from '../components/ArticleEditor'
import { FilterPanel } from '../components/FilterPanel'
import { Icon } from '../components/Icon'
import { Toolbar } from '../components/Toolbar'
import { hasImages, readDrop, type DropContent } from '../lib/images'

const PAGE = 60

const SORTS: { value: ArticleSort; label: string }[] = [
  { value: 'relevance', label: 'Pertinence' },
  { value: 'category', label: 'Par catégorie' },
  { value: 'recent', label: 'Ajout récent' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
  { value: 'name', label: 'Nom (A → Z)' }
]

// Ce qui s'affiche par-dessus la grille : une fiche ou le formulaire.
type Overlay = { kind: 'detail'; id: number } | { kind: 'edit'; id: number | null; drop?: DropContent } | null

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

export function ShoppingListView({ newArticleSignal }: { newArticleSignal: number }) {
  const { dataVersion, refresh, notify } = useApp()
  const [query, setQuery] = useState('')
  const text = useDebounced(query.trim(), 150)
  const [filters, setFilters] = useState<ArticleFilters>({})
  const [chosenSort, setChosenSort] = useState<ArticleSort | null>(null)
  // Par défaut : pertinence pendant une recherche, par catégorie sinon.
  const sort: ArticleSort = chosenSort && (chosenSort !== 'relevance' || text) ? chosenSort : text ? 'relevance' : 'category'

  const [items, setItems] = useState<Card[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [facets, setFacets] = useState<ArticleFacets | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [dropping, setDropping] = useState(false)
  const loading = useRef(false)
  const requestId = useRef(0)
  const loadedCount = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  loadedCount.current = items.length

  const load = useCallback(
    (limit: number, scrollTop: boolean) => {
      const id = ++requestId.current
      loading.current = true
      void window.mdeko.searchArticles({ text, filters, sort, offset: 0, limit }).then((page) => {
        if (id !== requestId.current) return
        setItems(page.items)
        setTotal(page.total)
        loading.current = false
        if (scrollTop) resultsRef.current?.scrollTo({ top: 0 })
      })
      void window.mdeko.articleFacets(text, filters).then((f) => id === requestId.current && setFacets(f))
    },
    [text, filters, sort]
  )

  // Nouvelle recherche : on repart du début.
  useEffect(() => load(PAGE, true), [load])

  // Données modifiées (ajout, modification, corbeille, ⌘Z) : on recharge sans perdre sa place.
  const firstVersion = useRef(dataVersion)
  useEffect(() => {
    // load est volontairement absent des dépendances : seul un changement de données doit recharger ici.
    if (dataVersion !== firstVersion.current) load(Math.max(loadedCount.current, PAGE), false)
  }, [dataVersion])

  // Fichier › Nouvel article (⌘N).
  const firstSignal = useRef(newArticleSignal)
  useEffect(() => {
    if (newArticleSignal !== firstSignal.current) setOverlay({ kind: 'edit', id: null })
  }, [newArticleSignal])

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && overlay?.kind !== 'edit') {
        e.preventDefault()
        setOverlay(null)
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlay])

  const reset = () => {
    setQuery('')
    setFilters({})
  }
  const closeOverlay = useCallback(() => setOverlay(null), [])
  const openDetail = useCallback((id: number) => setOverlay({ kind: 'detail', id }), [])
  const openEditor = useCallback((id: number | null) => setOverlay({ kind: 'edit', id }), [])

  const closeEditor = (savedId?: number, isNew?: boolean) => {
    if (savedId === undefined) {
      setOverlay(overlay?.kind === 'edit' && overlay.id !== null ? { kind: 'detail', id: overlay.id } : null)
      return
    }
    refresh()
    notify(isNew ? 'Article ajouté à la shopping list' : 'Modifications enregistrées', true)
    setOverlay({ kind: 'detail', id: savedId })
  }

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
              if (overlay?.kind === 'detail') setOverlay(null)
            }}
          />
          {query && (
            <button type="button" className="search-clear" aria-label="Effacer la recherche" onClick={() => setQuery('')}>
              <Icon name="xmark" size={12} />
            </button>
          )}
        </label>
        <button type="button" className="button button-primary" onClick={() => openEditor(null)}>
          <Icon name="plus" size={14} />
          Ajouter
        </button>
      </Toolbar>

      <div
        className="shopping"
        onDragOver={(e) => {
          if (overlay || !hasImages(e.dataTransfer)) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
        }}
        onDrop={(e) => {
          if (overlay) return
          e.preventDefault()
          setDropping(false)
          const drop = readDrop(e.dataTransfer)
          if (drop.files.length || drop.url) setOverlay({ kind: 'edit', id: null, drop })
        }}
      >
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
                <ArticleCard key={a.id} article={a} onOpen={openDetail} />
              ))}
            </div>
          )}
          <div ref={sentinelRef} className="sentinel" />
        </div>

        {dropping && (
          <div className="drop-overlay">
            <Icon name="photo" size={40} />
            <p>Déposez la photo pour créer un article</p>
          </div>
        )}

        {overlay?.kind === 'detail' && <ArticleDetail id={overlay.id} onClose={closeOverlay} onEdit={openEditor} />}
        {overlay?.kind === 'edit' && (
          <ArticleEditor
            key={overlay.id ?? 'new'}
            articleId={overlay.id}
            initialDrop={overlay.drop}
            onClose={(savedId) => closeEditor(savedId, overlay.id === null)}
          />
        )}
      </div>
    </>
  )
}
