import { useEffect, useState } from 'react'
import type { CheckReport, LinkCheckProgress } from '@shared/api'
import { useApp } from '../app-context'
import { ArticleCard } from '../components/ArticleCard'
import { ArticleEditorSheet } from '../components/ArticleEditorSheet'
import { Toolbar } from '../components/Toolbar'

const SEVERITY = { error: 'À corriger', warning: 'À regarder', info: 'Pour compléter' }

const size = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.ceil(bytes / 1e3)} Ko`)

// Bilan de santé de la shopping list : fichier de la base, articles incomplets, en double, disparus ou pas à jour.
// Un clic sur un article ouvre sa fiche pour le corriger.
export function CheckView() {
  const { dataVersion, refresh, notify } = useApp()
  const [report, setReport] = useState<CheckReport | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [links, setLinks] = useState<LinkCheckProgress | null>(null)

  useEffect(() => {
    void window.mdeko.checkDatabase().then(setReport)
  }, [dataVersion])

  useEffect(() => window.mdeko.onLinkProgress(setLinks), [])

  const checkLinks = async () => {
    setLinks({ done: 0, total: report?.links.toCheck ?? 0, gone: 0 })
    try {
      const result = await window.mdeko.checkLinks()
      notify(
        result.done < result.total
          ? `Vérification arrêtée : ${result.done} lien(s) vérifié(s).`
          : `${result.done} lien(s) vérifié(s)${result.gone ? `, ${result.gone} produit(s) disparu(s)` : ', aucun produit disparu'}.`
      )
    } finally {
      setLinks(null)
      refresh()
    }
  }

  if (!report) return <Toolbar title="Vérification" />
  const db = report.database
  const problems = report.groups.filter((g) => g.severity !== 'info').reduce((n, g) => n + g.count, 0)

  return (
    <>
      <Toolbar title="Vérification">
        <button type="button" className="button" onClick={() => void window.mdeko.checkDatabase().then(setReport)}>
          Vérifier à nouveau
        </button>
      </Toolbar>
      <div className="check">
        <section className={`check-summary${db.ok ? '' : ' is-error'}`}>
          <h2>{db.ok ? 'La base est en bon état' : 'La base a un problème'}</h2>
          <p>
            {report.articles.toLocaleString('fr-FR')} articles, {report.images.toLocaleString('fr-FR')} photos · {size(db.sizeBytes)} ·{' '}
            {problems ? `${problems} point(s) à regarder` : 'rien à corriger'}
          </p>
          {db.problems.map((p) => (
            <p key={p} className="check-problem">
              {p}
            </p>
          ))}
          {!db.ok && <p>Prévenez le développeur avant de continuer : une sauvegarde de chaque jour est dans « sauvegardes ».</p>}
          <p className="check-path">
            Emplacement : <code>{db.path}</code>{' '}
            <button type="button" className="button button-plain" onClick={() => void window.mdeko.showDatabase()}>
              Afficher dans le Finder
            </button>
          </p>
        </section>

        <section className="check-links">
          <div>
            <h3>Liens des produits</h3>
            <p>
              {report.links.toCheck
                ? `${report.links.toCheck.toLocaleString('fr-FR')} lien(s) jamais vérifié(s) ou vérifié(s) il y a plus de 6 mois.`
                : 'Tous les liens ont été vérifiés ces 6 derniers mois.'}{' '}
              La vérification ouvre chaque page produit pour voir si elle existe encore. Elle peut prendre plusieurs minutes.
            </p>
          </div>
          {links ? (
            <div className="check-progress">
              <progress value={links.done} max={Math.max(links.total, 1)} />
              <span>
                {links.done} / {links.total}
                {links.gone ? ` · ${links.gone} disparu(s)` : ''}
              </span>
              <button type="button" className="button" onClick={() => void window.mdeko.stopLinkCheck()}>
                Arrêter
              </button>
            </div>
          ) : (
            <button type="button" className="button button-primary" disabled={!report.links.toCheck} onClick={() => void checkLinks()}>
              Vérifier les liens
            </button>
          )}
        </section>

        {report.groups.length === 0 && <p className="section-note">Aucune anomalie trouvée dans la shopping list.</p>}
        {report.groups.map((g) => (
          <section key={g.id} className={`check-group is-${g.severity}`}>
            <button type="button" className="check-group-head" onClick={() => setOpen(open === g.id ? null : g.id)}>
              <span className="check-badge">{SEVERITY[g.severity]}</span>
              <span className="check-title">
                {g.title} <span className="filter-count">{g.count}</span>
              </span>
              <span className="check-description">{g.description}</span>
              <span className="check-toggle">{open === g.id ? 'Masquer' : 'Voir'}</span>
            </button>
            {open === g.id && (
              <>
                <div className="grid">
                  {g.articles.map((a) => (
                    <ArticleCard
                      key={a.id}
                      article={a}
                      onOpen={(id) =>
                        g.id === 'in-trash' ? notify('Remettez-le dans la shopping list depuis la corbeille, ou retirez-le du projet.') : setEditing(id)
                      }
                    />
                  ))}
                </div>
                {g.count > g.articles.length && <p className="section-note">Les {g.articles.length} premiers sont affichés.</p>}
              </>
            )}
          </section>
        ))}
      </div>
      {editing !== null && <ArticleEditorSheet articleId={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
