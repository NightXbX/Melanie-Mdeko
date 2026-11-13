import { useEffect, useState, type FormEvent } from 'react'
import type { DocumentKind, ProjectSummary } from '@shared/projects'

// Deux catégories de projets, comme ses dossiers : les design books et les devis (retenu d'une fois sur l'autre).
const TAB_KEY = 'mdeko.projects.tab'
const readTab = (): DocumentKind => {
  try {
    return localStorage.getItem(TAB_KEY) === 'quote' ? 'quote' : 'book'
  } catch {
    return 'book'
  }
}
import { useApp } from '../app-context'
import { Icon } from '../components/Icon'
import { DuplicateSheet } from '../components/project/DuplicateSheet'
import { ProjectEditor } from '../components/project/ProjectEditor'
import { Toolbar } from '../components/Toolbar'

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const monthLabel = (d: string | null) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '')

// Projets rangés par année du design book, la plus récente d'abord (comme le dossier Projets).
function byYear(projects: ProjectSummary[]): [string, ProjectSummary[]][] {
  const groups = new Map<string, ProjectSummary[]>()
  for (const p of [...projects].sort((a, b) => (b.bookDate ?? '').localeCompare(a.bookDate ?? '') || b.updatedAt.localeCompare(a.updatedAt))) {
    const year = p.bookDate?.slice(0, 4) ?? 'Sans date'
    groups.set(year, [...(groups.get(year) ?? []), p])
  }
  return [...groups.entries()]
}

interface Props {
  newProjectSignal: number
  openRequest: { id: number } | null
  onImport(path?: string): void
}

export function ProjectsView({ newProjectSignal, openRequest, onImport }: Props) {
  const { dataVersion } = useApp()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState<DocumentKind | null>(null)
  const [tab, setTabState] = useState<DocumentKind>(readTab)
  const [duplicating, setDuplicating] = useState<{ id: number; clientTitle: string; clientName: string; kind: DocumentKind } | null>(null)
  const setTab = (kind: DocumentKind) => {
    setTabState(kind)
    try {
      localStorage.setItem(TAB_KEY, kind)
    } catch {
      // réglage d'affichage seulement
    }
  }
  const startDuplicate = async (id: number) => {
    const p = await window.mdeko.projects.get(id)
    if (p) setDuplicating({ id, clientTitle: p.clientTitle, clientName: p.clientName, kind: p.kind })
  }
  const shown = (projects ?? []).filter((p) => p.kind === tab)
  const count = (kind: DocumentKind) => (projects ?? []).filter((p) => p.kind === kind).length

  useEffect(() => {
    void window.mdeko.projects.list().then(setProjects)
  }, [dataVersion, openId])

  // Projet à ouvrir (par exemple juste après un import).
  useEffect(() => {
    if (openRequest) setOpenId(openRequest.id)
  }, [openRequest])

  useEffect(() => {
    if (newProjectSignal) {
      setOpenId(null)
      setCreating('book')
    }
  }, [newProjectSignal])

  if (openId !== null) return <ProjectEditor key={openId} projectId={openId} onClose={() => setOpenId(null)} onOpenProject={setOpenId} />

  return (
    <>
      <Toolbar title="Projets">
        <button type="button" className="button" onClick={() => onImport()}>
          Importer…
        </button>
        <button type="button" className="button" onClick={() => setCreating('quote')}>
          <Icon name="plus" size={14} />
          Nouveau devis
        </button>
        <button type="button" className="button button-primary" onClick={() => setCreating('book')}>
          <Icon name="plus" size={14} />
          Nouveau projet
        </button>
      </Toolbar>
      <div
        className="content-body"
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.type === 'application/pdf')) e.preventDefault()
        }}
        onDrop={(e) => {
          const pdf = [...e.dataTransfer.files].find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
          if (!pdf) return
          e.preventDefault()
          onImport(window.mdeko.pathForFile(pdf))
        }}
      >
        <div className="segmented projects-tabs" role="tablist">
          {(['book', 'quote'] as DocumentKind[]).map((kind) => (
            <button key={kind} type="button" role="tab" aria-selected={tab === kind} className={`button${tab === kind ? ' is-active' : ''}`} onClick={() => setTab(kind)}>
              {kind === 'book' ? 'Design books' : 'Devis'}
              <span className="filter-count">{count(kind)}</span>
            </button>
          ))}
        </div>
        {projects && shown.length === 0 && (
          <div className="projects-grid">
            <button type="button" className="project-card project-new" onClick={() => setCreating(tab)}>
              <div className="project-cover">
                <Icon name="plus" size={36} />
              </div>
              <span className="project-title">{tab === 'quote' ? 'Nouveau devis' : 'Nouveau projet'}</span>
            </button>
          </div>
        )}
        {byYear(shown).map(([year, list]) => (
          <section key={year} className="projects-year">
            <h2>{year}</h2>
            <div className="projects-grid">
              {list.map((p) => (
                <div key={p.id} className="project-card-wrap">
                  <button type="button" className="project-card" onClick={() => setOpenId(p.id)}>
                    <div className="project-cover">{p.coverUrl ? <img src={p.coverUrl} alt="" /> : <Icon name="folder" size={36} />}</div>
                    <span className="project-title">{p.title}</span>
                    <span className="project-date">{p.kind === 'quote' ? `Devis · ${monthLabel(p.bookDate)}` : monthLabel(p.bookDate)}</span>
                  </button>
                  <button type="button" className="button project-duplicate" onClick={() => void startDuplicate(p.id)}>
                    Dupliquer…
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {duplicating && (
        <DuplicateSheet
          source={duplicating}
          onCancel={() => setDuplicating(null)}
          onDone={(id) => {
            setDuplicating(null)
            setOpenId(id)
          }}
        />
      )}
      {creating && (
        <NewProjectSheet
          kind={creating}
          onCancel={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null)
            setOpenId(id)
          }}
        />
      )}
    </>
  )
}

function NewProjectSheet({ kind, onCancel, onCreated }: { kind: DocumentKind; onCancel(): void; onCreated(id: number): void }) {
  const [title, setTitle] = useState('Mme')
  const [name, setName] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onCreated(await window.mdeko.projects.create(title, name, kind))
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="sheet" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>{kind === 'quote' ? 'Nouveau devis' : 'Nouveau projet'}</h2>
        <div className="field-row field-row-narrow">
          <label className="field">
            <span>Civilité</span>
            <select value={title} onChange={(e) => setTitle(e.target.value)}>
              <option>Mme</option>
              <option>M.</option>
              <option>Mme et M.</option>
              <option value="">—</option>
            </select>
          </label>
          <label className="field">
            <span>Nom du client</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="sheet-actions">
          <button type="button" className="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="button button-primary" disabled={!name.trim()}>
            {kind === 'quote' ? 'Créer le devis' : 'Créer le projet'}
          </button>
        </div>
      </form>
    </div>
  )
}
