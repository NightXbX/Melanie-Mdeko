import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArticleCard as Card } from '@shared/api'
import { ArticleCard } from '../ArticleCard'
import { Icon } from '../Icon'

const PAGE = 60

// Choisir un article de la shopping list (même recherche que l'écran principal) : toute la liste est là,
// chargée au fil du défilement.
// « featured » : articles montrés en premier tant que rien n'est tapé (ceux du projet, par exemple).
export function ArticlePicker({
  title,
  featured,
  onPick,
  onCreate,
  onCancel
}: {
  title: string
  featured?: { title: string; items: Card[] }
  onPick(id: number): void
  onCreate?(): void
  onCancel(): void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Card[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const request = useRef(0)
  const loading = useRef(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const text = query.trim()
  const sort = text ? 'relevance' : 'category'

  useEffect(() => {
    const id = ++request.current
    const t = setTimeout(() => {
      loading.current = true
      void window.mdeko.searchArticles({ text, filters: {}, sort, offset: 0, limit: PAGE }).then((page) => {
        if (id !== request.current) return
        setItems(page.items)
        setTotal(page.total)
        loading.current = false
        resultsRef.current?.scrollTo({ top: 0 })
      })
    }, 150)
    return () => clearTimeout(t)
  }, [text, sort])

  const loadMore = useCallback(() => {
    if (loading.current || total === null || items.length >= total) return
    const id = request.current
    loading.current = true
    void window.mdeko.searchArticles({ text, filters: {}, sort, offset: items.length, limit: PAGE }).then((page) => {
      if (id !== request.current) return
      setItems((prev) => [...prev, ...page.items])
      loading.current = false
    })
  }, [text, sort, items.length, total])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
      root: resultsRef.current,
      rootMargin: '600px'
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const count = total === null ? '' : `${total.toLocaleString('fr-FR')} article${total > 1 ? 's' : ''}`

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet sheet-large" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <div className="sheet-actions">
            {onCreate && (
              <button type="button" className="button" onClick={onCreate}>
                <Icon name="plus" size={14} />
                Créer un nouvel article
              </button>
            )}
            <button type="button" className="button" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </div>
        <label className="search-field picker-search">
          <Icon name="search" size={15} />
          <input autoFocus type="search" placeholder="Rechercher dans la shopping list…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="picker-results" ref={resultsRef}>
          {featured && featured.items.length > 0 && !query.trim() && (
            <>
              <h3 className="picker-heading">{featured.title}</h3>
              <div className="grid">
                {featured.items.map((a) => (
                  <ArticleCard key={a.id} article={a} onOpen={onPick} />
                ))}
              </div>
              <h3 className="picker-heading">Toute la shopping list ({count})</h3>
            </>
          )}
          {!(featured && featured.items.length > 0 && !text) && <p className="picker-count">{total === 0 ? 'Aucun article ne correspond.' : count}</p>}
          <div className="grid">
            {items.map((a) => (
              <ArticleCard key={a.id} article={a} onOpen={onPick} />
            ))}
          </div>
          <div ref={sentinelRef} className="sentinel" />
        </div>
      </div>
    </div>
  )
}
