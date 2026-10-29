import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { EmptyState, Toolbar } from '../components/Toolbar'

export function ShoppingListView() {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // ⌘F place le curseur dans la recherche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="button button-primary">
          <Icon name="plus" size={14} />
          Ajouter
        </button>
      </Toolbar>
      <div className="content-body">
        <EmptyState title="Aucun article" />
      </div>
    </>
  )
}
