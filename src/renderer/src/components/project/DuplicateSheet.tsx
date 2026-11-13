import { useState, type FormEvent } from 'react'
import { DOCUMENT_NAMES, type DocumentKind } from '@shared/projects'
import { useApp } from '../../app-context'

// Dupliquer un projet : pour un autre client (même base de travail) ou pour en faire un devis.
export function DuplicateSheet({
  source,
  onCancel,
  onDone
}: {
  source: { id: number; clientTitle: string; clientName: string; kind: DocumentKind }
  onCancel(): void
  onDone(id: number): void
}) {
  const { notify, refresh } = useApp()
  const [title, setTitle] = useState(source.clientTitle)
  const [name, setName] = useState(source.clientName)
  const [kind, setKind] = useState<DocumentKind>(source.kind)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const id = await window.mdeko.projects.duplicate(source.id, { clientTitle: title, clientName: name, kind })
      refresh()
      notify('Projet dupliqué : vous êtes dans la copie')
      onDone(id)
    } catch (err) {
      notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="sheet" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <h2>Dupliquer le projet</h2>
        <p className="section-note">
          La copie reprend tout : pièces, plans 3D, shopping list, teintes, artisans, textes et compte-rendu. Le projet d’origine ne change pas.
        </p>
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
        <div className="field">
          <span>Document</span>
          <div className="segmented">
            {(['book', 'quote'] as DocumentKind[]).map((k) => (
              <button key={k} type="button" className={`button${kind === k ? ' is-active' : ''}`} onClick={() => setKind(k)}>
                {DOCUMENT_NAMES[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="sheet-actions">
          <button type="button" className="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="button button-primary" disabled={!name.trim() || busy}>
            {busy ? 'Copie…' : 'Dupliquer'}
          </button>
        </div>
      </form>
    </div>
  )
}
