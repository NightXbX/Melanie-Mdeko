import { useEffect, useState } from 'react'
import type { ArticleCard as Card } from '@shared/api'
import { formatPrice } from '@shared/format'
import type { ProjectNeed, Room } from '@shared/projects'
import { useApp } from '../../app-context'
import { moved, useSortable } from '../../lib/sortable'
import { ArticleEditorSheet } from '../ArticleEditorSheet'
import { Icon } from '../Icon'
import { ArticlePicker } from './ArticlePicker'
import { HomeByMeImport } from './HomeByMeImport'
import type { SectionProps } from './ProjectEditor'
import { SectionHeader } from './sections'

type Picking = { mode: 'add'; roomId: number | null } | { mode: 'choice'; need: ProjectNeed } | { mode: 'alternative'; need: ProjectNeed }
// Fiche article ouverte depuis le projet : nouvel article (puis ajouté au projet) ou article à modifier.
type Editing = { articleId: number | null; then?: Picking } | null

function Mini({ article, big }: { article: Card; big?: boolean }) {
  return (
    <div className={`mini${big ? ' mini-big' : ''}`}>
      <div className="mini-photo">{article.thumbnailUrl ? <img src={article.thumbnailUrl} alt="" draggable={false} /> : <Icon name="photo" size={24} />}</div>
      <div className="mini-text">
        <span className="card-name">{article.name}</span>
        <span className="card-price">{formatPrice(article.price)}</span>
        {article.supplier && <span className="card-supplier">{article.supplier}</span>}
        {article.description && <span className="mini-description">{article.description}</span>}
      </div>
    </div>
  )
}

const zoneOf = (roomId: number | null) => (roomId === null ? 'sans-piece' : String(roomId))

// Shopping list du projet, rangée par pièce (celles de « Vos envies ») : pour chaque besoin, « Mon choix »
// et ses autres propositions. Tout se range en faisant glisser : les besoins d'une pièce à l'autre,
// les propositions entre elles ou sur « Mon choix », et d'un besoin à l'autre (elles restent aussi à leur place).
export function NeedsSection({ project, reload }: SectionProps) {
  const [picking, setPicking] = useState<Picking | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [importing, setImporting] = useState(false)

  const run = async (action: Promise<unknown>) => {
    await action
    await reload()
  }

  const apply = (p: Picking, id: number) => {
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

  const needs = useSortable('need', {
    onDrop: (drop) => {
      const need = project.needs.find((n) => n.id === drop.id)
      if (!need) return
      const target = drop.target === null ? null : project.needs.find((n) => n.id === drop.target)
      const zone = drop.zone ?? zoneOf(target?.roomId ?? null)
      const roomId = zone === 'sans-piece' ? null : Number(zone)
      // Lâché sur la pièce : en fin de pièce.
      const last = groups.find((g) => zoneOf(g.room?.id ?? null) === zone)?.needs.filter((n) => n.id !== need.id).at(-1)
      const ids = moved(
        ordered.map((n) => n.id),
        drop.target === null ? { ...drop, target: last?.id ?? null, after: true } : drop
      )
      void run(
        (async () => {
          if (roomId !== need.roomId) await window.mdeko.projects.setNeedRoom(need.id, roomId)
          await window.mdeko.projects.reorder('needs', ids)
        })()
      )
    }
  })

  const pickerTitle = (p: Picking) =>
    p.mode === 'add'
      ? `Ajouter un article${p.roomId ? ` dans « ${rooms.find((r) => r.id === p.roomId)?.name} »` : ' au projet'}`
      : p.mode === 'choice'
        ? 'Remplacer « Mon choix »'
        : 'Ajouter une proposition'

  const addButtons = (roomId: number | null, label: string) => (
    <div className="need-add">
      <button type="button" className="button button-plain" onClick={() => setPicking({ mode: 'add', roomId })}>
        + {label}
      </button>
      <button type="button" className="button button-plain" onClick={() => setEditing({ articleId: null, then: { mode: 'add', roomId } })}>
        + Créer un nouvel article
      </button>
    </div>
  )

  return (
    <div className="section">
      <SectionHeader title="Shopping list">
        <button type="button" className="button" onClick={() => setImporting(true)}>
          Importer depuis HomeByMe
        </button>
        <button type="button" className="button" onClick={() => setEditing({ articleId: null, then: { mode: 'add', roomId: null } })}>
          <Icon name="plus" size={14} />
          Nouvel article
        </button>
        <button type="button" className="button button-primary" onClick={() => setPicking({ mode: 'add', roomId: null })}>
          <Icon name="plus" size={14} />
          Ajouter un article
        </button>
      </SectionHeader>

      <div className="need-options">
        <label className="filter-check">
          <input
            type="checkbox"
            checked={project.showPrices}
            onChange={(e) => void run(window.mdeko.projects.update(project.id, { showPrices: e.target.checked }))}
          />
          <span>Afficher les prix dans le design book</span>
        </label>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={project.groupSingleChoices}
            onChange={(e) => void run(window.mdeko.projects.update(project.id, { groupSingleChoices: e.target.checked }))}
          />
          <span>Réunir sur une même page les choix d’une pièce qui n’ont pas d’autre proposition</span>
        </label>
      </div>
      {!rooms.length && <p className="section-note">Pour ranger les articles par pièce, ajoutez les pièces dans « Vos envies ».</p>}
      {project.needs.length > 1 && <p className="section-note">Faites glisser un article pour le déplacer, d’une pièce à l’autre si besoin.</p>}

      {project.needs.length === 0 && !rooms.length && (
        <button type="button" className="drop-zone" onClick={() => setPicking({ mode: 'add', roomId: null })}>
          <Icon name="bag" size={40} />
          <span>Choisissez les articles que vous recommandez</span>
        </button>
      )}

      {groups.map(({ room, needs: list }) => {
        const cards = list.map((need) => (
          <NeedCard
            key={need.id}
            projectId={project.id}
            need={need}
            rooms={rooms}
            drag={needs.item(need.id, zoneOf(need.roomId))}
            run={run}
            onPick={setPicking}
            onEdit={(articleId) => setEditing({ articleId })}
          />
        ))
        return rooms.length ? (
          <div key={room?.id ?? 'sans-piece'} className="need-room" {...needs.zone(zoneOf(room?.id ?? null))}>
            <div className="need-room-head">
              <h3>{room?.name ?? 'Sans pièce'}</h3>
              {addButtons(room?.id ?? null, `Ajouter un article${room ? ` dans « ${room.name} »` : ''}`)}
            </div>
            {list.length === 0 && <p className="section-note">Aucun article pour l’instant : faites-en glisser un ici.</p>}
            {cards}
          </div>
        ) : (
          <div key="tous" className="need-room" {...needs.zone('sans-piece')}>
            {cards}
          </div>
        )
      })}

      {picking && (
        <ArticlePicker
          title={pickerTitle(picking)}
          onPick={(id) => {
            setPicking(null)
            apply(picking, id)
          }}
          onCreate={() => {
            setPicking(null)
            setEditing({ articleId: null, then: picking })
          }}
          onCancel={() => setPicking(null)}
        />
      )}
      {importing && <HomeByMeImport project={project} onClose={() => setImporting(false)} onDone={reload} />}
      {editing && (
        <ArticleEditorSheet
          articleId={editing.articleId}
          onClose={(savedId) => {
            const then = editing.then
            setEditing(null)
            if (savedId === undefined) return
            if (then) apply(then, savedId)
            else void reload()
          }}
        />
      )}
    </div>
  )
}

interface NeedCardProps {
  projectId: number
  need: ProjectNeed
  rooms: Room[]
  drag: ReturnType<ReturnType<typeof useSortable>['item']>
  run(action: Promise<unknown>): Promise<void>
  onPick(p: Picking): void
  onEdit(articleId: number): void
}

function NeedCard({ projectId, need, rooms, drag, run, onPick, onEdit }: NeedCardProps) {
  const { notify } = useApp()
  const altZone = `alts:${need.id}`
  const choiceZone = `choice:${need.id}`
  const altIds = need.alternatives.map((a) => a.id)
  const title = need.label ?? need.category ?? 'Article'

  // Les propositions de tous les besoins se partagent le même glisser-déposer : on les range dans leur besoin,
  // on les lâche sur « Mon choix » pour les choisir, ou sur un autre besoin pour les y proposer aussi (copie).
  const alternatives = useSortable('alternative', {
    onDrop: (drop) => {
      const own = drop.from === altZone
      if (drop.zone === choiceZone) {
        if (own) return void run(window.mdeko.projects.setNeedChoice(need.id, drop.id))
        if (drop.id === need.choice?.id) return
        // Copie venue d'un autre besoin : elle devient le choix, l'ancien choix passe en tête des propositions.
        void run(
          (async () => {
            await window.mdeko.projects.setNeedAlternatives(need.id, [drop.id, ...altIds.filter((id) => id !== drop.id)])
            await window.mdeko.projects.setNeedChoice(need.id, drop.id)
          })()
        )
        notify(`Nouveau choix pour « ${title} » (l’article reste aussi dans l’autre besoin)`)
        return
      }
      if (!own && (drop.id === need.choice?.id || altIds.includes(drop.id))) return
      void run(window.mdeko.projects.setNeedAlternatives(need.id, moved(altIds, drop)))
      if (!own) notify(`Proposition ajoutée à « ${title} » (elle reste aussi dans l’autre besoin)`)
    }
  })

  return (
    <div className="need" {...drag}>
      <div className="need-head">
        <span className="grip" title="Faire glisser pour déplacer">
          <Icon name="grip" size={14} />
        </span>
        <NeedTitle projectId={projectId} need={need} run={run} />
        <div className="need-actions">
          <Quantity need={need} run={run} />
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
          <button type="button" className="button button-plain" onClick={() => onPick({ mode: 'choice', need })}>
            Remplacer
          </button>
          <button type="button" className="button button-plain button-danger" onClick={() => void run(window.mdeko.projects.removeNeed(need.id))}>
            Retirer
          </button>
        </div>
      </div>
      <div className="need-body">
        <div className="need-choice" {...alternatives.zone(choiceZone)}>
          <span className="need-label">Mon choix</span>
          {need.choice && (
            <>
              <Mini article={need.choice} big />
              <button type="button" className="button button-plain need-edit" onClick={() => onEdit(need.choice!.id)}>
                <Icon name="pencil" size={12} />
                Modifier l’article
              </button>
            </>
          )}
          {need.choiceImages.length > 1 && <BookPhotos need={need} run={run} />}
        </div>
        <div className="need-alternatives" {...alternatives.zone(altZone)}>
          <span className="need-label">Autres propositions</span>
          {need.alternatives.map((a) => (
            <div key={a.id} className="need-alternative" {...alternatives.item(a.id, altZone)}>
              <Mini article={a} />
              <div className="need-alt-actions">
                <button type="button" className="button button-plain" onClick={() => void run(window.mdeko.projects.setNeedChoice(need.id, a.id))}>
                  Choisir
                </button>
                <button type="button" className="button button-plain" aria-label="Modifier l’article" onClick={() => onEdit(a.id)}>
                  <Icon name="pencil" size={12} />
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
          <button type="button" className="button button-plain" onClick={() => onPick({ mode: 'alternative', need })}>
            + Ajouter une proposition
          </button>
        </div>
      </div>
    </div>
  )
}

// Titre du besoin (« Bureaux », « Table à manger »…) : il se change sur place, comme dans l'aperçu du book.
// Vidé, il reprend le nom de la catégorie de l'article.
function NeedTitle({ projectId, need, run }: { projectId: number; need: ProjectNeed; run(action: Promise<unknown>): Promise<void> }) {
  const shown = need.label ?? need.category ?? 'Article'
  const [value, setValue] = useState(shown)
  useEffect(() => setValue(shown), [shown])
  const save = () => {
    const text = value.trim()
    if (text === shown) return
    if (!text && !need.label) return setValue(shown)
    void run(window.mdeko.projects.editText(projectId, `needLabel:${need.id}`, text))
  }
  return (
    <label className="need-title">
      <input
        aria-label="Nom du besoin"
        value={value}
        size={Math.max(8, value.length + 1)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            setValue(shown)
            e.currentTarget.blur()
          }
        }}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
      <Icon name="pencil" size={12} />
    </label>
  )
}

// Nombre d'exemplaires de « Mon choix » à acheter (compté dans le récapitulatif du book).
function Quantity({ need, run }: { need: ProjectNeed; run(action: Promise<unknown>): Promise<void> }) {
  const [value, setValue] = useState(String(need.quantity))
  useEffect(() => setValue(String(need.quantity)), [need.quantity])
  const save = () => {
    const n = Math.max(1, Math.min(999, Math.round(Number(value)) || 1))
    setValue(String(n))
    if (n !== need.quantity) void run(window.mdeko.projects.setNeedQuantity(need.id, n))
  }
  return (
    <label className="need-quantity">
      Quantité
      <input
        type="number"
        min={1}
        max={999}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
    </label>
  )
}

// Photos de « Mon choix » montrées dans le book : un clic en ajoute ou en retire une, on les range en les faisant glisser.
function BookPhotos({ need, run }: { need: ProjectNeed; run(action: Promise<unknown>): Promise<void> }) {
  const shown = need.bookImageIds.length ? need.bookImageIds : [need.choiceImages[0].id]
  const save = (ids: number[]) => void run(window.mdeko.projects.setNeedImages(need.id, ids))
  const photos = useSortable(`photo:${need.id}`, { axis: 'horizontal', onDrop: (drop) => save(moved(shown, drop)) })
  const ordered = [...shown.map((id) => need.choiceImages.find((i) => i.id === id)!).filter(Boolean), ...need.choiceImages.filter((i) => !shown.includes(i.id))]
  return (
    <div className="need-photos">
      <span className="need-photos-label">Photos dans le book ({shown.length}{need.choiceImages.length > 4 ? ', 4 au plus' : ''})</span>
      <div className="need-photos-list drop-horizontal">
        {ordered.map((img) => {
          const on = shown.includes(img.id)
          return (
            <button
              key={img.id}
              type="button"
              className={`need-photo${on ? ' is-selected' : ''}`}
              title={on ? 'Retirer du book' : 'Montrer dans le book'}
              onClick={() => save(on ? shown.filter((id) => id !== img.id) : [...shown, img.id])}
              {...(on ? photos.item(img.id) : {})}
            >
              <img src={img.url} alt="" draggable={false} />
              {on && <span className="need-photo-number">{shown.indexOf(img.id) + 1}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
