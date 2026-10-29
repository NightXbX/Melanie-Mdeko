import { useRef, useState } from 'react'
import type { ProjectRender, RenderSection } from '@shared/projects'
import { useApp } from '../../app-context'
import { hasImages, readDrop, uploadDrop, type DropContent } from '../../lib/images'
import { Icon } from '../Icon'
import type { SectionProps } from './ProjectEditor'
import { SectionHeader } from './sections'

// Rendus HomeByMe : on les glisse ici, on les range dans l'ordre du book en les faisant glisser.
export function RendersSection({ project, reload }: SectionProps) {
  const { notify } = useApp()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [moving, setMoving] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const insetFor = useRef<number | null>(null)
  const insetInput = useRef<HTMLInputElement>(null)

  const add = async (drop: DropContent) => {
    setUploading(true)
    try {
      const images = await uploadDrop(drop)
      if (images.length) await window.mdeko.projects.addRenders(project.id, images.map((i) => i.id), 'plans')
      await reload()
    } catch (e) {
      notify((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setUploading(false)
    }
  }

  const move = async (from: number, to: number) => {
    const ids = project.renders.map((r) => r.id)
    const [id] = ids.splice(from, 1)
    ids.splice(to, 0, id)
    await window.mdeko.projects.reorder('renders', ids)
    await reload()
  }

  const update = async (r: ProjectRender, patch: { section?: RenderSection; insetImageId?: number | null }) => {
    await window.mdeko.projects.updateRender(r.id, patch)
    await reload()
  }

  return (
    <div
      className={`section${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        if (moving !== null || !hasImages(e.dataTransfer)) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        if (moving !== null) return
        e.preventDefault()
        setDragging(false)
        void add(readDrop(e.dataTransfer))
      }}
    >
      <SectionHeader title="Plans 3D">
        {uploading && <span className="editor-status">Ajout des rendus…</span>}
        <button type="button" className="button" onClick={() => fileInput.current?.click()}>
          <Icon name="plus" size={14} />
          Ajouter des rendus
        </button>
      </SectionHeader>

      {project.renders.length === 0 ? (
        <button type="button" className="drop-zone" onClick={() => fileInput.current?.click()}>
          <Icon name="photo" size={40} />
          <span>Glissez ici les rendus HomeByMe</span>
        </button>
      ) : (
        <div className="render-grid">
          {project.renders.map((r, i) => (
            <div
              key={r.id}
              className={`render${moving === i ? ' is-moving' : ''}`}
              draggable
              onDragStart={(e) => {
                setMoving(i)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setMoving(null)}
              onDragOver={(e) => moving !== null && e.preventDefault()}
              onDrop={(e) => {
                if (moving === null) return
                e.preventDefault()
                e.stopPropagation()
                const from = moving
                setMoving(null)
                if (from !== i) void move(from, i)
              }}
            >
              <div className="render-image">
                <img src={r.thumbnailUrl} alt="" draggable={false} />
                <span className="render-number">{i + 1}</span>
                <button type="button" className="editor-thumb-remove render-remove" aria-label="Retirer ce rendu" onClick={async () => {
                  await window.mdeko.projects.removeRender(r.id)
                  await reload()
                }}>
                  <Icon name="xmark" size={10} />
                </button>
              </div>
              <div className="render-tools">
                <select value={r.section} onChange={(e) => void update(r, { section: e.target.value as RenderSection })}>
                  <option value="plans">Plans</option>
                  <option value="changes">Modifications</option>
                </select>
                {r.insetUrl ? (
                  <button type="button" className="render-inset" title="Retirer la vignette" onClick={() => void update(r, { insetImageId: null })}>
                    <img src={r.insetUrl} alt="" />
                    <Icon name="xmark" size={9} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button-plain"
                    onClick={() => {
                      insetFor.current = r.id
                      insetInput.current?.click()
                    }}
                  >
                    + Vignette
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void add({ files: [...e.target.files], url: null })
          e.target.value = ''
        }}
      />
      <input
        ref={insetInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (e) => {
          const render = project.renders.find((r) => r.id === insetFor.current)
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!render || !file) return
          const [image] = await uploadDrop({ files: [file], url: null })
          if (image) await update(render, { insetImageId: image.id })
        }}
      />
    </div>
  )
}
