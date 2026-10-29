import { useState } from 'react'
import type { ArticleFacets, ArticleFilters } from '@shared/api'

export interface PriceRange {
  label: string
  min?: number
  max?: number
}

export const PRICE_RANGES: PriceRange[] = [
  { label: 'Moins de 50 €', max: 5000 },
  { label: '50 à 150 €', min: 5000, max: 15000 },
  { label: '150 à 500 €', min: 15000, max: 50000 },
  { label: '500 à 1 500 €', min: 50000, max: 150000 },
  { label: 'Plus de 1 500 €', min: 150000 }
]

const SUPPLIERS_SHOWN = 10

interface Props {
  facets: ArticleFacets | null
  filters: ArticleFilters
  onChange(filters: ArticleFilters): void
}

// Filtres sur le côté, comme sur un site marchand : un clic suffit, le nombre d'articles est affiché.
export function FilterPanel({ facets, filters, onChange }: Props) {
  const [allSuppliers, setAllSuppliers] = useState(false)
  const families = facets?.families ?? []
  const selectedFamily = families.find(
    (f) => f.id === filters.familyId || f.categories.some((c) => c.id === filters.categoryId)
  )
  const priceIndex = PRICE_RANGES.findIndex(
    (r) => r.min === filters.priceMinCents && r.max === filters.priceMaxCents
  )
  const suppliers = facets?.suppliers ?? []
  const selectedSuppliers = new Set(filters.supplierIds ?? [])
  const shownSuppliers = allSuppliers
    ? suppliers
    : suppliers.filter((s, i) => i < SUPPLIERS_SHOWN || selectedSuppliers.has(s.id))

  const toggleSupplier = (id: number) => {
    const next = new Set(selectedSuppliers)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...filters, supplierIds: next.size ? [...next] : undefined })
  }

  return (
    <aside className="filters">
      <section>
        <h2>Catégories</h2>
        <button
          type="button"
          className={`filter-link${!selectedFamily ? ' is-selected' : ''}`}
          onClick={() => onChange({ ...filters, familyId: undefined, categoryId: undefined })}
        >
          Toutes les catégories
        </button>
        {(selectedFamily ? [selectedFamily] : families).map((f) => (
          <div key={f.id}>
            <button
              type="button"
              className={`filter-link${filters.familyId === f.id && !filters.categoryId ? ' is-selected' : ''}`}
              onClick={() => onChange({ ...filters, familyId: f.id, categoryId: undefined })}
            >
              <span>{f.name}</span>
              <span className="filter-count">{f.count}</span>
            </button>
            {selectedFamily?.id === f.id &&
              f.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`filter-link filter-sub${filters.categoryId === c.id ? ' is-selected' : ''}`}
                  onClick={() => onChange({ ...filters, familyId: undefined, categoryId: c.id })}
                >
                  <span>{c.name}</span>
                  <span className="filter-count">{c.count}</span>
                </button>
              ))}
          </div>
        ))}
      </section>

      <section>
        <h2>Prix</h2>
        <button
          type="button"
          className={`filter-link${priceIndex < 0 ? ' is-selected' : ''}`}
          onClick={() => onChange({ ...filters, priceMinCents: undefined, priceMaxCents: undefined })}
        >
          Tous les prix
        </button>
        {PRICE_RANGES.map((r, i) => (
          <button
            key={r.label}
            type="button"
            className={`filter-link${priceIndex === i ? ' is-selected' : ''}`}
            onClick={() => onChange({ ...filters, priceMinCents: r.min, priceMaxCents: r.max })}
          >
            {r.label}
          </button>
        ))}
      </section>

      <section>
        <h2>Fournisseurs</h2>
        {shownSuppliers.map((s) => (
          <label key={s.id} className="filter-check">
            <input type="checkbox" checked={selectedSuppliers.has(s.id)} onChange={() => toggleSupplier(s.id)} />
            <span>{s.name}</span>
            <span className="filter-count">{s.count}</span>
          </label>
        ))}
        {suppliers.length > SUPPLIERS_SHOWN && (
          <button type="button" className="filter-more" onClick={() => setAllSuppliers(!allSuppliers)}>
            {allSuppliers ? 'Afficher moins' : `Afficher les ${suppliers.length - SUPPLIERS_SHOWN} autres`}
          </button>
        )}
      </section>
    </aside>
  )
}
