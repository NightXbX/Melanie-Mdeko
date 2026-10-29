import { useCallback, useEffect, useState } from 'react'
import type { BookFormat, DesignerSettings, Project } from '@shared/projects'
import { useApp } from '../../app-context'
import { Icon } from '../Icon'
import { BookPreview } from './BookPreview'
import { NeedsSection } from './NeedsSection'
import { RendersSection } from './RendersSection'
import { ArtisansSection, ClientSection, PaintsSection, TextsSection, WishesSection } from './sections'

type Step = 'client' | 'wishes' | 'renders' | 'needs' | 'paints' | 'artisans' | 'texts'

export interface SectionProps {
  project: Project
  settings: DesignerSettings
  reload(): Promise<void>
}

export function ProjectEditor({ projectId, onClose }: { projectId: number; onClose(): void }) {
  const { notify, dataVersion } = useApp()
  const [project, setProject] = useState<Project | null>(null)
  const [settings, setSettings] = useState<DesignerSettings | null>(null)
  const [step, setStep] = useState<Step>('client')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const p = await window.mdeko.projects.get(projectId)
    if (p) setProject(p)
    else onClose()
  }, [projectId, onClose])

  useEffect(() => {
    void reload()
    void window.mdeko.projects.getSettings().then(setSettings)
  }, [reload, dataVersion])

  const exportBook = async (format: BookFormat) => {
    setBusy(true)
    notify('Création du design book…')
    try {
      const file = await window.mdeko.projects.export(projectId, format)
      notify(file ? 'Design book enregistré' : 'Export annulé')
    } catch (e) {
      notify(`Le design book n’a pas pu être créé : ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    } finally {
      setBusy(false)
    }
  }

  if (!project || !settings) return null
  const title = [project.clientTitle, project.clientName].filter(Boolean).join(' ')
  const steps: { id: Step; label: string; count?: number }[] = [
    { id: 'client', label: 'Client' },
    { id: 'wishes', label: 'Vos envies' },
    { id: 'renders', label: 'Plans 3D', count: project.renders.length },
    { id: 'needs', label: 'Shopping list', count: project.needs.length },
    { id: 'paints', label: 'Couleurs', count: project.paintIds.length },
    { id: 'artisans', label: 'Artisans', count: project.artisanIds.length },
    { id: 'texts', label: 'Textes' }
  ]
  const props: SectionProps = { project, settings, reload }

  return (
    <>
      <header className="toolbar">
        <button type="button" className="button button-plain" onClick={onClose}>
          <Icon name="chevronLeft" size={14} />
          Projets
        </button>
        <h1 className="toolbar-title">{title}</h1>
        <div className="toolbar-items">
          <button type="button" className={`button${preview ? ' is-active' : ''}`} onClick={() => setPreview(!preview)}>
            {preview ? 'Fermer l’aperçu' : 'Aperçu'}
          </button>
          <div className="segmented">
            <span>Exporter</span>
            <button type="button" className="button" disabled={busy} onClick={() => void exportBook('pdf')}>
              PDF
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => void exportBook('pptx')}>
              PowerPoint
            </button>
          </div>
        </div>
      </header>

      <div className="project">
        <nav className="project-steps">
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`project-step${step === s.id ? ' is-selected' : ''}`}
              onClick={() => setStep(s.id)}
            >
              <span>{s.label}</span>
              {s.count !== undefined && <span className="filter-count">{s.count}</span>}
            </button>
          ))}
        </nav>
        <div className="project-body">
          {step === 'client' && <ClientSection {...props} onDeleted={onClose} />}
          {step === 'wishes' && <WishesSection {...props} />}
          {step === 'renders' && <RendersSection {...props} />}
          {step === 'needs' && <NeedsSection {...props} />}
          {step === 'paints' && <PaintsSection {...props} />}
          {step === 'artisans' && <ArtisansSection {...props} />}
          {step === 'texts' && <TextsSection {...props} />}
        </div>
        {preview && <BookPreview projectId={projectId} version={project} />}
      </div>
    </>
  )
}
