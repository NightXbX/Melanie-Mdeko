import { useEffect, useState } from 'react'
import type { Artisan } from '@shared/projects'
import { ArtisanForm, NEW_ARTISAN, type ArtisanDraft } from '../components/project/sections'
import { Icon } from '../components/Icon'
import { EmptyState, Toolbar } from '../components/Toolbar'

// Carnet des artisans recommandés : le même que dans l'étape « Artisans » de chaque projet.
export function ArtisansView() {
  const [artisans, setArtisans] = useState<Artisan[] | null>(null)
  const [editing, setEditing] = useState<ArtisanDraft | null>(null)
  const load = () => void window.mdeko.projects.listArtisans().then(setArtisans)
  useEffect(load, [])

  const trades = [...new Set((artisans ?? []).map((a) => a.trade))]
  return (
    <>
      <Toolbar title="Artisans">
        <button type="button" className="button button-primary" onClick={() => setEditing(NEW_ARTISAN)}>
          <Icon name="plus" size={14} />
          Nouvel artisan
        </button>
      </Toolbar>
      <div className="content-body">
        <div className="section">
          {editing && (
            <ArtisanForm
              key={editing.id ?? 'nouveau'}
              initial={editing}
              onDone={() => {
                setEditing(null)
                load()
              }}
            />
          )}
          {artisans?.length === 0 && !editing && (
            <EmptyState title="Ajoutez les artisans que vous recommandez : vous pourrez ensuite les mettre dans vos design books." />
          )}
          {trades.map((trade) => (
            <div key={trade}>
              <h3 className="section-subtitle">{trade}</h3>
              <ul className="artisan-list">
                {artisans!
                  .filter((a) => a.trade === trade)
                  .map((a) => (
                    <li key={a.id}>
                      <span className="artisan-name">
                        <strong>{a.name}</strong>
                        {a.city ? ` (${a.city})` : ''}
                        {[a.phone, a.email].filter(Boolean).length > 0 && ` · ${[a.phone, a.email].filter(Boolean).join(' · ')}`}
                      </span>
                      <button type="button" className="button button-plain" onClick={() => setEditing({ ...a })}>
                        Modifier
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
