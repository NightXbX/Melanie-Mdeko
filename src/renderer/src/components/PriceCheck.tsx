import { useEffect, useState } from 'react'
import type { Price } from '@shared/api'
import type { PriceCheckProgress, PriceCheckRow, PriceCheckScope } from '@shared/assistant'
import { formatPrice } from '@shared/format'
import { useApp } from '../app-context'
import { dollars } from './project/AiSheet'

// Vérification des prix par l'IA (écran Vérification) : elle lit chaque page produit et propose les écarts ;
// Mélanie applique ceux qu'elle veut. Rien n'est changé sans elle.

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const price = (cents: number | null, kind: string | null) =>
  cents === null && kind !== 'on_quote' ? '—' : formatPrice({ cents, kind: (kind ?? 'fixed') as Price['kind'], text: null })

const STATUS: Record<PriceCheckRow['status'], string> = {
  found: 'Prix différent',
  unavailable: 'Plus vendu',
  not_product: 'Page du produit disparue',
  unknown: 'Prix introuvable : à vérifier à la main'
}

export function PriceCheck({ onEdit }: { onEdit(articleId: number): void }) {
  const { notify, refresh } = useApp()
  const [progress, setProgress] = useState<PriceCheckProgress | null>(null)
  const [rows, setRows] = useState<PriceCheckRow[] | null>(null)
  const [applied, setApplied] = useState<Set<number>>(new Set())

  useEffect(() => window.mdeko.onPriceProgress(setProgress), [])

  const start = async (scope: PriceCheckScope, label: string) => {
    const { count, cents } = await window.mdeko.assistant.estimatePriceCheck(scope)
    if (!count) return notify('Aucun article à vérifier')
    const ok = await window.mdeko.confirm(
      `Vérifier les prix de ${count} article(s) ${label} ?`,
      `L’assistant ouvre chaque page produit et lit le prix affiché. Coût prévu : ${dollars(cents)} au plus. Rien n’est changé sans vous : les écarts vous sont proposés.`,
      'Vérifier'
    )
    if (!ok) return
    setRows(null)
    setApplied(new Set())
    setProgress({ done: 0, total: count, differences: 0 })
    try {
      const result = await window.mdeko.assistant.checkPrices(scope)
      setRows(result)
      const differences = result.filter((r) => r.status !== 'unknown').length
      notify(differences ? `${differences} écart(s) trouvé(s)` : 'Tous les prix lus sont à jour')
    } catch (e) {
      notify(cleanError(e))
    } finally {
      setProgress(null)
    }
  }

  const apply = async (rowsToApply: PriceCheckRow[]) => {
    for (const r of rowsToApply) {
      if (r.status === 'found' && r.foundCents !== null) await window.mdeko.assistant.applyPrice(r.articleId, r.foundCents, r.foundKind ?? 'fixed')
    }
    setApplied(new Set([...applied, ...rowsToApply.map((r) => r.articleId)]))
    refresh()
  }

  const toApply = (rows ?? []).filter((r) => r.status === 'found' && !applied.has(r.articleId))

  return (
    <section className="check-links check-prices">
      <div className="check-prices-head">
        <div>
          <h3>Prix des produits (avec l’IA)</h3>
          <p>
            L’assistant lit la page de chaque produit et compare le prix affiché à celui de la fiche. Les écarts vous sont proposés :
            vous choisissez ceux à appliquer (l’ancien prix reste dans l’historique).
          </p>
        </div>
        {progress ? (
          <div className="check-progress">
            <progress value={progress.done} max={Math.max(progress.total, 1)} />
            <span>
              {progress.done} / {progress.total}
              {progress.differences ? ` · ${progress.differences} écart(s)` : ''}
            </span>
            <button type="button" className="button" onClick={() => void window.mdeko.assistant.stopPriceCheck()}>
              Arrêter
            </button>
          </div>
        ) : (
          <div className="check-prices-actions">
            <button type="button" className="button button-primary" onClick={() => void start('projects', 'proposés dans les projets')}>
              Articles des projets
            </button>
            <button type="button" className="button" onClick={() => void start('stale', 'dont le prix n’a pas changé depuis un an')}>
              Prix de plus d’un an
            </button>
          </div>
        )}
      </div>

      {rows && rows.length > 0 && (
        <div className="price-rows">
          {toApply.length > 1 && (
            <button type="button" className="button button-primary price-apply-all" onClick={() => void apply(toApply)}>
              Appliquer les {toApply.length} nouveaux prix
            </button>
          )}
          {rows.map((r) => (
            <div key={r.articleId} className={`price-row is-${r.status}`}>
              <button type="button" className="price-row-name" onClick={() => onEdit(r.articleId)}>
                <strong>{r.name}</strong>
                {r.supplier && <span> · {r.supplier}</span>}
              </button>
              <span className="price-row-status">{STATUS[r.status]}</span>
              <span className="price-row-prices">
                {price(r.currentCents, r.currentKind)}
                {r.status === 'found' && <> → <strong>{price(r.foundCents, r.foundKind)}</strong></>}
              </span>
              <span className="price-row-note">{r.note}</span>
              <span className="price-row-actions">
                <button type="button" className="button button-plain" onClick={() => void window.mdeko.openExternal(r.url)}>
                  Voir la page
                </button>
                {r.status === 'found' &&
                  (applied.has(r.articleId) ? (
                    <span className="price-row-done">Appliqué</span>
                  ) : (
                    <button type="button" className="button" onClick={() => void apply([r])}>
                      Appliquer
                    </button>
                  ))}
              </span>
            </div>
          ))}
        </div>
      )}
      {rows && rows.length === 0 && <p className="section-note">Aucun écart : tous les prix lus correspondent aux fiches.</p>}
    </section>
  )
}
