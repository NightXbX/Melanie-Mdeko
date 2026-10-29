import { useEffect, useState } from 'react'
import type { ArticleCard } from '@shared/api'
import { formatPrice } from '@shared/format'
import { useApp } from '../app-context'
import { Icon } from '../components/Icon'
import { EmptyState, Toolbar } from '../components/Toolbar'

export function TrashView() {
  const { dataVersion, refresh, notify } = useApp()
  const [items, setItems] = useState<ArticleCard[] | null>(null)

  useEffect(() => {
    void window.mdeko.listTrash().then(setItems)
  }, [dataVersion])

  const restore = async (a: ArticleCard) => {
    await window.mdeko.restoreArticle(a.id)
    refresh()
    notify(`« ${a.name} » est de retour dans la shopping list`, true)
  }

  // Suppression définitive : seule action irréversible de l'appli, donc confirmation explicite.
  const empty = async () => {
    if (!items?.length) return
    const n = items.length
    const ok = await window.mdeko.confirm(
      'Vider la corbeille ?',
      `${n > 1 ? `Les ${n} articles seront supprimés` : 'L’article sera supprimé'} définitivement. Cette action ne peut pas être annulée.`,
      'Vider la corbeille'
    )
    if (!ok) return
    const result = await window.mdeko.emptyTrash()
    refresh()
    notify(
      result.keptInProjects
        ? `Corbeille vidée. ${result.keptInProjects} article(s) utilisé(s) dans un projet ont été gardés.`
        : 'Corbeille vidée'
    )
  }

  return (
    <>
      <Toolbar title="Corbeille">
        {items && items.length > 0 && (
          <button type="button" className="button button-danger" onClick={() => void empty()}>
            Vider la corbeille
          </button>
        )}
      </Toolbar>
      <div className="content-body">
        {items?.length === 0 && <EmptyState title="La corbeille est vide" />}
        {items && items.length > 0 && (
          <div className="trash">
            <div className="grid">
              {items.map((a) => (
                <div key={a.id} className="card card-static">
                  <div className="card-photo">
                    {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" loading="lazy" /> : <Icon name="photo" size={40} />}
                  </div>
                  <div className="card-text">
                    <span className="card-name">{a.name}</span>
                    <span className="card-price">{formatPrice(a.price)}</span>
                  </div>
                  <button type="button" className="button" onClick={() => void restore(a)}>
                    Remettre dans la shopping list
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
