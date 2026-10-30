import { useEffect, useRef, useState } from 'react'
import type { ArticleCard as Card } from '@shared/api'
import { ArticleCard } from '../ArticleCard'
import { Icon } from '../Icon'

// Choisir un article de la shopping list (même recherche que l'écran principal).
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
  const request = useRef(0)

  useEffect(() => {
    const id = ++request.current
    const t = setTimeout(() => {
      void window.mdeko
        .searchArticles({ text: query.trim(), filters: {}, sort: query.trim() ? 'relevance' : 'category', offset: 0, limit: 60 })
        .then((page) => id === request.current && setItems(page.items))
    }, 150)
    return () => clearTimeout(t)
  }, [query])

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
        <div className="picker-results">
          {featured && featured.items.length > 0 && !query.trim() && (
            <>
              <h3 className="picker-heading">{featured.title}</h3>
              <div className="grid">
                {featured.items.map((a) => (
                  <ArticleCard key={a.id} article={a} onOpen={onPick} />
                ))}
              </div>
              <h3 className="picker-heading">Toute la shopping list</h3>
            </>
          )}
          <div className="grid">
            {items.map((a) => (
              <ArticleCard key={a.id} article={a} onOpen={onPick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
