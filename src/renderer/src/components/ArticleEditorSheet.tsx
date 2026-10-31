import type { ArticleInput } from '@shared/api'
import { useApp } from '../app-context'
import type { DropContent } from '../lib/images'
import { ArticleEditor } from './ArticleEditor'

// Formulaire d'article ouvert par-dessus un autre écran (projet, vérification) : la fiche est la même
// que dans la shopping list, l'article créé ou modifié y est enregistré.
export function ArticleEditorSheet({
  articleId,
  initial,
  initialDrop,
  onClose
}: {
  articleId: number | null
  initial?: Partial<ArticleInput>
  initialDrop?: DropContent
  onClose(savedId?: number): void
}) {
  const { refresh, notify } = useApp()
  return (
    <div className="sheet-backdrop">
      <div className="sheet sheet-large sheet-editor">
        <ArticleEditor
          articleId={articleId}
          initial={initial}
          initialDrop={initialDrop}
          onClose={(savedId) => {
            if (savedId !== undefined) {
              refresh()
              notify(articleId === null ? 'Article ajouté à la shopping list' : 'Modifications enregistrées', articleId !== null)
            }
            onClose(savedId)
          }}
        />
      </div>
    </div>
  )
}
