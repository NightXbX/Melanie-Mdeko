import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../app-context'
import { hasImages, readDrop, uploadDrop, type DropContent } from '../../lib/images'
import { moved, useSortable } from '../../lib/sortable'
import { Icon } from '../Icon'
import type { SectionProps } from './ProjectEditor'
import { SectionHeader } from './sections'

// Planche tendance, au début du book : photos d'ambiance glissées ici ou prises dans les inspirations.
// Sans photo, la planche n'apparaît pas.
export function TrendSection({ project, reload }: SectionProps) {
  const { notify } = useApp()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [picking, setPicking] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const ids = project.trendImages.map((i) => i.id)

  const save = async (next: number[]) => {
    await window.mdeko.projects.setTrendImages(project.id, next)
    await reload()
  }

  const add = async (drop: DropContent) => {
    setUploading(true)
    try {
      const images = await uploadDrop(drop)
      if (images.length) await save([...ids, ...images.map((i) => i.id)])
    } catch (e) {
      notify((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setUploading(false)
    }
  }

  const order = useSortable('trend', { axis: 'horizontal', onDrop: (drop) => void save(moved(ids, drop)) })

  return (
    <div
      className={`section${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        if (!hasImages(e.dataTransfer)) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        if (!hasImages(e.dataTransfer)) return
        e.preventDefault()
        setDragging(false)
        void add(readDrop(e.dataTransfer))
      }}
    >
      <SectionHeader title="Planche tendance">
        {uploading && <span className="editor-status">Ajout des photos…</span>}
        <button type="button" className="button" onClick={() => setPicking(true)}>
          Choisir dans les inspirations
        </button>
        <button type="button" className="button" onClick={() => fileInput.current?.click()}>
          <Icon name="plus" size={14} />
          Ajouter des photos
        </button>
      </SectionHeader>
      <p className="section-note">
        La planche tendance ouvre le design book, juste après le sommaire. Sans photo, elle n’apparaît pas. 6 photos par page.
      </p>

      {ids.length === 0 ? (
        <button type="button" className="drop-zone" onClick={() => fileInput.current?.click()}>
          <Icon name="photo" size={40} />
          <span>Glissez ici des photos d’ambiance</span>
        </button>
      ) : (
        <>
          {ids.length > 1 && <p className="section-note">Faites glisser une photo pour changer l’ordre.</p>}
          <div className="trend-grid drop-horizontal">
            {project.trendImages.map((img) => (
              <div key={img.id} className="trend-photo" {...order.item(img.id)}>
                <img src={img.url} alt="" draggable={false} />
                <button
                  type="button"
                  className="editor-thumb-remove"
                  aria-label="Retirer cette photo"
                  onClick={() => void save(ids.filter((id) => id !== img.id))}
                >
                  <Icon name="xmark" size={10} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {picking && (
        <InspirationPicker
          selected={ids}
          onToggle={(id) => void save(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])}
          onClose={() => setPicking(false)}
        />
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
    </div>
  )
}

// Photos des inspirations, rangées par thème : un clic ajoute la photo à la planche ou l'en retire.
function InspirationPicker({ selected, onToggle, onClose }: { selected: number[]; onToggle(id: number): void; onClose(): void }) {
  const [images, setImages] = useState<{ id: number; url: string; title: string }[] | null>(null)
  useEffect(() => void window.mdeko.projects.listInspirationImages().then(setImages), [])
  const titles = [...new Set((images ?? []).map((i) => i.title))]

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet-large" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="sheet-head">
          <h2>Inspirations</h2>
          <div className="sheet-actions">
            <button type="button" className="button button-primary" onClick={onClose}>
              Terminé
            </button>
          </div>
        </div>
        <div className="picker-results">
          {images?.length === 0 && <p className="section-note">Aucune inspiration pour l’instant.</p>}
          {titles.map((title) => (
            <div key={title} className="trend-pick-group">
              <h3>{title}</h3>
              <div className="trend-grid">
                {images!
                  .filter((i) => i.title === title)
                  .map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className={`trend-photo trend-pick${selected.includes(i.id) ? ' is-selected' : ''}`}
                      aria-pressed={selected.includes(i.id)}
                      onClick={() => onToggle(i.id)}
                    >
                      <img src={i.url} alt="" draggable={false} loading="lazy" />
                      {selected.includes(i.id) && <span className="need-photo-number">{selected.indexOf(i.id) + 1}</span>}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
