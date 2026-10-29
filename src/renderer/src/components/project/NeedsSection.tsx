import { useState } from 'react'
import type { ArticleCard as Card } from '@shared/api'
import { formatPrice } from '@shared/format'
import type { ProjectNeed, Room } from '@shared/projects'
import { Icon } from '../Icon'
import { ArticlePicker } from './ArticlePicker'
import type { SectionProps } from './ProjectEditor'
import { SectionHeader } from './sections'

type Picking = { mode: 'add'; roomId: number | null } | { mode: 'choice'; need: ProjectNeed } | { mode: 'alternative'; need: ProjectNeed } | null

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

// Shopping list du projet, rangée par pièce (celles de « Vos envies ») : pour chaque besoin, « Mon choix »
// et ses autres propositions, modifiables.
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
    if (p.mode === 'add') void run(window.mdeko.projects.addNeed(project.id, id, p.roomId))
    else if (p.mode === 'choice') void run(window.mdeko.projects.setNeedChoice(p.need.id, id))
    else void run(window.mdeko.projects.setNeedAlternatives(p.need.id, [...p.need.alternatives.map((a) => a.id), id]))
  }

  // Articles sans pièce en tête (comme dans le book), puis chaque pièce dans l'ordre de « Vos envies ».
  const rooms = project.rooms
  const unplaced = project.needs.filter((n) => !rooms.some((r) => r.id === n.roomId))
  const groups: { room: Room | null; needs: ProjectNeed[] }[] = [
    ...(unplaced.length || !rooms.length ? [{ room: null, needs: unplaced }] : []),
    ...rooms.map((room) => ({ room, needs: project.needs.filter((n) => n.roomId === room.id) }))
  ]
  const ordered = groups.flatMap((g) => g.needs)

  const moveUp = (need: ProjectNeed, group: ProjectNeed[]) => {
    const previous = group[group.indexOf(need) - 1]
    const ids = ordered.map((n) => n.id)
    const a = ids.indexOf(previous.id)
    const b = ids.indexOf(need.id)
    ;[ids[a], ids[b]] = [ids[b], ids[a]]
    void run(window.mdeko.projects.reorder('needs', ids))
  }

  const needCard = (need: ProjectNeed, group: ProjectNeed[]) => (
    <div key={need.id} className="need">
      <div className="need-head">
        <h3>{need.label ?? need.category ?? 'Article'}</h3>
        <div className="need-actions">
          {rooms.length > 0 && (
            <select
              className="need-room-select"
              aria-label="Pièce"
              value={need.roomId ?? ''}
              onChange={(e) => void run(window.mdeko.projects.setNeedRoom(need.id, e.target.value ? Number(e.target.value) : null))}
            >
              <option value="">Sans pièce</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="button button-plain" disabled={group[0] === need} onClick={() => moveUp(need, group)}>
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
                  onClick={() => void run(window.mdeko.projects.setNeedAlternatives(need.id, need.alternatives.filter((x) => x.id !== a.id).map((x) => x.id)))}
                >
                  <Icon name="xmark" size={11} />
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="button button-plain" onClick={() => setPicking({ mode: 'alternative', need })}>
            + Ajouter une proposition
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="section">
      <SectionHeader title="Shopping list">
        <button type="button" className="button button-primary" onClick={() => setPicking({ mode: 'add', roomId: null })}>
          <Icon name="plus" size={14} />
          Ajouter un article
        </button>
      </SectionHeader>

      {!rooms.length && <p className="section-note">Pour ranger les articles par pièce, ajoutez les pièces dans « Vos envies ».</p>}

      {project.needs.length === 0 && !rooms.length && (
        <button type="button" className="drop-zone" onClick={() => setPicking({ mode: 'add', roomId: null })}>
          <Icon name="bag" size={40} />
          <span>Choisissez les articles que vous recommandez</span>
        </button>
      )}

      {groups.map(({ room, needs }) =>
        rooms.length ? (
          <div key={room?.id ?? 'sans-piece'} className="need-room">
            <div className="need-room-head">
              <h3>{room?.name ?? 'Sans pièce'}</h3>
              <button type="button" className="button button-plain" onClick={() => setPicking({ mode: 'add', roomId: room?.id ?? null })}>
                + Ajouter un article{room ? ` dans « ${room.name} »` : ''}
              </button>
            </div>
            {needs.length === 0 && <p className="section-note">Aucun article pour l’instant.</p>}
            {needs.map((need) => needCard(need, needs))}
          </div>
        ) : (
          needs.map((need) => needCard(need, needs))
        )
      )}

      {picking && (
        <ArticlePicker
          title={
            picking.mode === 'add'
              ? `Ajouter un article${picking.roomId ? ` dans « ${rooms.find((r) => r.id === picking.roomId)?.name} »` : ' au projet'}`
              : picking.mode === 'choice'
                ? 'Remplacer « Mon choix »'
                : 'Ajouter une proposition'
          }
          onPick={pick}
          onCancel={() => setPicking(null)}
        />
      )}
    </div>
  )
}
