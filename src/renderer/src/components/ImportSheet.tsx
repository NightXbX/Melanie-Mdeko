import { useEffect, useRef, useState } from 'react'
import type { ImportSummary } from '@shared/api'
import { useApp } from '../app-context'

interface Props {
  path?: string // PDF glissé ; sinon l'appli demande de choisir le fichier
  onClose(): void
  onOpenProject(id: number): void
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

// Import d'un design book (nouveau projet) ou d'une shopping list (nouveaux articles), avec sa progression.
export function ImportSheet({ path, onClose, onOpenProject }: Props) {
  const { refresh } = useApp()
  const [progress, setProgress] = useState<{ page: number; total: number } | null>(null)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => window.mdeko.onImportProgress((page, total) => setProgress({ page, total })), [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    window.mdeko
      .importPdf(path)
      .then((summary) => {
        if (!summary) return onClose() // choix du fichier annulé
        setResult(summary)
        refresh()
      })
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }, [path, onClose, refresh])

  if (!progress && !result && !error) return null
  return (
    <div className="sheet-backdrop">
      <div className="sheet import-sheet">
        {error ? (
          <>
            <h2>L’import n’a pas abouti</h2>
            <p>{error}</p>
            <p className="section-note">Rien n’a été modifié dans vos données.</p>
            <div className="sheet-actions">
              <button type="button" className="button button-primary" onClick={onClose}>
                OK
              </button>
            </div>
          </>
        ) : result ? (
          <>
            <h2>{result.projectId !== null ? `Projet « ${result.projectTitle} » importé` : 'Shopping list mise à jour'}</h2>
            <ul className="import-summary">
              {result.projectId !== null && (
                <li>
                  {plural(result.renders, 'rendu')} 3D et {plural(result.needs, 'besoin')} dans la shopping list du projet
                </li>
              )}
              <li>
                {result.added
                  ? `${plural(result.added, 'nouvel article')} ajouté${result.added > 1 ? 's' : ''} à votre shopping list`.replace('nouvels', 'nouveaux')
                  : 'Aucun nouvel article : tout était déjà dans votre shopping list'}
              </li>
              {result.reused > 0 && <li>{plural(result.reused, 'article')} déjà présent{result.reused > 1 ? 's' : ''}, réutilisé{result.reused > 1 ? 's' : ''}</li>}
            </ul>
            <div className="sheet-actions">
              <button type="button" className="button" onClick={onClose}>
                Fermer
              </button>
              {result.projectId !== null && (
                <button type="button" className="button button-primary" onClick={() => onOpenProject(result.projectId!)}>
                  Ouvrir le projet
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2>Import en cours…</h2>
            <progress max={progress!.total} value={progress!.page} />
            <p className="section-note">
              Page {progress!.page} sur {progress!.total}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
