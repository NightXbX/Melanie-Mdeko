import { useEffect, useState, type FormEvent } from 'react'
import type { ProjectSummary } from '@shared/projects'
import { useApp } from '../app-context'
import { Icon } from '../components/Icon'
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

export function ProjectsView({ newProjectSignal }: { newProjectSignal: number }) {
  const { dataVersion } = useApp()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void window.mdeko.projects.list().then(setProjects)
  }, [dataVersion, openId])

  useEffect(() => {
    if (newProjectSignal) {
      setOpenId(null)
      setCreating(true)
    }
  }, [newProjectSignal])

  if (openId !== null) return <ProjectEditor projectId={openId} onClose={() => setOpenId(null)} />

  return (
    <>
      <Toolbar title="Projets">
        <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />
          Nouveau projet
        </button>
      </Toolbar>
      <div className="content-body">
        {projects?.length === 0 && (
          <div className="projects-grid">
            <button type="button" className="project-card project-new" onClick={() => setCreating(true)}>
              <div className="project-cover">
                <Icon name="plus" size={36} />
              </div>
              <span className="project-title">Nouveau projet</span>
            </button>
          </div>
        )}
        {byYear(projects ?? []).map(([year, list]) => (
          <section key={year} className="projects-year">
            <h2>{year}</h2>
            <div className="projects-grid">
              {list.map((p) => (
                <button key={p.id} type="button" className="project-card" onClick={() => setOpenId(p.id)}>
                  <div className="project-cover">{p.coverUrl ? <img src={p.coverUrl} alt="" /> : <Icon name="folder" size={36} />}</div>
                  <span className="project-title">{p.title}</span>
                  <span className="project-date">{monthLabel(p.bookDate)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {creating && (
        <NewProjectSheet
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setOpenId(id)
          }}
        />
      )}
    </>
  )
}

function NewProjectSheet({ onCancel, onCreated }: { onCancel(): void; onCreated(id: number): void }) {
  const [title, setTitle] = useState('Mme')
  const [name, setName] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onCreated(await window.mdeko.projects.create(title, name))
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="sheet" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>Nouveau projet</h2>
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
            Créer le projet
          </button>
        </div>
      </form>
    </div>
  )
}
