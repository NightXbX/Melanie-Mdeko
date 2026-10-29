import { useState } from 'react'
import type { ArticleCard as Card } from '@shared/api'
import { formatPrice } from '@shared/format'
import type { ProjectNeed } from '@shared/projects'
import { Icon } from '../Icon'
import { ArticlePicker } from './ArticlePicker'
import type { SectionProps } from './ProjectEditor'
import { SectionHeader } from './sections'

type Picking = { mode: 'add' } | { mode: 'choice'; need: ProjectNeed } | { mode: 'alternative'; need: ProjectNeed } | null

function Mini({ article, big }: { article: Card; big?: boolean }) {
  return (
    <div className={`mini${big ? ' mini-big' : ''}`}>
      <div className="mini-photo">{article.thumbnailUrl ? <img src={article.thumbnailUrl} alt="" /> : <Icon name="photo" size={24} />}</div>
      <div className="mini-text">
        <span className="card-name">{article.name}</span>
        <span className="card-price">{formatPrice(article.price)}</span>
        {article.supplier && <span className="card-supplier">{article.supplier}</span>}
      </div>
    </div>
  )
}

// Un besoin du projet : « Mon choix » + 2 ou 3 alternatives proposées automatiquement, modifiables.
export function NeedsSection({ project, reload }: SectionProps) {
  const [picking, setPicking] = useState<Picking>(null)

  const run = async (action: Promise<unknown>) => {
    await action
    await reload()
  }

  const pick = (id: number) => {
    const p = picking
    setPicking(null)
    if (!p) return
    if (p.mode === 'add') void run(window.mdeko.projects.addNeed(project.id, id))
    else if (p.mode === 'choice') void run(window.mdeko.projects.setNeedChoice(p.need.id, id))
    else void run(window.mdeko.projects.setNeedAlternatives(p.need.id, [...p.need.alternatives.map((a) => a.id), id]))
  }

  return (
    <div className="section">
      <SectionHeader title="Shopping list">
        <button type="button" className="button button-primary" onClick={() => setPicking({ mode: 'add' })}>
          <Icon name="plus" size={14} />
          Ajouter un article
        </button>
      </SectionHeader>

      {project.needs.length === 0 && (
        <button type="button" className="drop-zone" onClick={() => setPicking({ mode: 'add' })}>
          <Icon name="bag" size={40} />
          <span>Choisissez les articles que vous recommandez</span>
        </button>
      )}

      {project.needs.map((need, i) => (
        <div key={need.id} className="need">
          <div className="need-head">
            <h3>{need.label ?? need.category ?? 'Article'}</h3>
            <div className="need-actions">
              <button type="button" className="button button-plain" disabled={i === 0} onClick={() => {
                const ids = project.needs.map((n) => n.id)
                ;[ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]
                void run(window.mdeko.projects.reorder('needs', ids))
              }}>
                Monter
              </button>
              <button type="button" className="button button-plain" onClick={() => setPicking({ mode: 'choice', need })}>
                Remplacer
              </button>
              <button type="button" className="button button-plain button-danger" onClick={() => void run(window.mdeko.projects.removeNeed(need.id))}>
                Retirer
              </button>
            </div>
          </div>
          <div className="need-body">
            <div className="need-choice">
              <span className="need-label">Mon choix</span>
              {need.choice && <Mini article={need.choice} big />}
            </div>
            <div className="need-alternatives">
              <span className="need-label">Autres propositions</span>
              {need.alternatives.map((a) => (
                <div key={a.id} className="need-alternative">
                  <Mini article={a} />
                  <div className="need-alt-actions">
                    <button type="button" className="button button-plain" onClick={() => void run(window.mdeko.projects.setNeedChoice(need.id, a.id))}>
                      Choisir
                    </button>
                    <button
                      type="button"
                      className="button button-plain"
                      aria-label="Retirer cette proposition"
                      onClick={() =>
                        void run(window.mdeko.projects.setNeedAlternatives(need.id, need.alternatives.filter((x) => x.id !== a.id).map((x) => x.id)))
                      }
                    >
                      <Icon name="xmark" size={11} />
                    </button>
                  </div>
                </div>
              ))}
              {need.alternatives.length < 3 && (
                <button type="button" className="button button-plain" onClick={() => setPicking({ mode: 'alternative', need })}>
                  + Ajouter une proposition
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {picking && (
        <ArticlePicker
          title={picking.mode === 'add' ? 'Ajouter un article au projet' : picking.mode === 'choice' ? 'Remplacer « Mon choix »' : 'Ajouter une proposition'}
          onPick={pick}
          onCancel={() => setPicking(null)}
        />
      )}
    </div>
  )
}
