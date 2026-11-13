import { useEffect, useState } from 'react'
import type { ArticleCard as Card, CheckGroup, CheckReport, LinkCheckProgress } from '@shared/api'
import { useApp } from '../app-context'
import { ArticleCard } from '../components/ArticleCard'
import { ArticleEditorSheet } from '../components/ArticleEditorSheet'
import { Icon } from '../components/Icon'
import { PriceCheck } from '../components/PriceCheck'
import { Toolbar } from '../components/Toolbar'

const SEVERITY = { error: 'À corriger', warning: 'À regarder', info: 'Pour compléter' }

// Anomalies qu'on peut lever en notant « vérifié à la main » : le lien, ou le prix.
const VERIFY: Record<string, 'link' | 'price' | undefined> = { unverifiable: 'link', 'stale-price': 'price', gone: 'link' }

export interface AiRequest {
  ids: number[]
  label: string
  nonce: number
}

const size = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo` : `${Math.ceil(bytes / 1e3)} Ko`)

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

// Bilan de santé de la shopping list : fichier de la base, articles incomplets, en double, disparus ou pas à jour.
// Un clic sur un article ouvre sa fiche pour le corriger. Pour un article, une sélection ou toute une anomalie :
// mettre à la corbeille, retirer des projets, remettre dans la shopping list, marquer « vérifié à la main »
// ou faire vérifier par l'IA. Chaque action groupée s'annule d'un seul ⌘Z.
export function CheckView() {
  const { dataVersion, refresh, notify } = useApp()
  const [report, setReport] = useState<CheckReport | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [links, setLinks] = useState<LinkCheckProgress | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [aiRequest, setAiRequest] = useState<AiRequest | null>(null)

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

  // Met des articles à la corbeille après confirmation ; ceux d'un projet y restent proposés.
  const trash = async (ids: number[], question: string, detail: string) => {
    if (!ids.length || busy) return
    const inProjects = await window.mdeko.countInProjects(ids)
    const note = inProjects
      ? ids.length === 1
        ? ' Il est proposé dans un projet : il y restera.'
        : ` ${plural(inProjects, 'est proposé', 'sont proposés')} dans un projet : ils y resteront.`
      : ''
    const ok = await window.mdeko.confirm(question, detail + note, 'Mettre à la corbeille')
    if (!ok) return
    setBusy(true)
    try {
      await window.mdeko.trashArticles(ids)
      setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))))
      refresh()
      notify(ids.length === 1 ? 'L’article a été mis à la corbeille' : `${plural(ids.length, 'article', 'articles')} mis à la corbeille`, true)
    } finally {
      setBusy(false)
    }
    // Pour tout enlever d'un coup : on propose aussitôt de les retirer aussi des projets.
    if (inProjects) {
      const also = await window.mdeko.confirm(
        ids.length === 1 ? 'Le retirer aussi de ses projets ?' : `Les retirer aussi de leurs projets ?`,
        'Sinon, ils restent proposés dans les design books, et reviennent ici dans « Dans un projet mais à la corbeille ». Un « Mon choix » retiré laisse la place à la première proposition.',
        'Retirer des projets'
      )
      if (also) await removeFromProjects(ids, false)
    }
  }

  // Retire des articles de tous les projets (un « Mon choix » laisse la place à la première proposition).
  const removeFromProjects = async (ids: number[], ask = true) => {
    if (!ids.length || busy) return
    if (ask) {
      const ok = await window.mdeko.confirm(
        ids.length === 1 ? 'Retirer cet article de ses projets ?' : `Retirer ${plural(ids.length, 'article', 'articles')} de leurs projets ?`,
        'Ils ne seront plus proposés dans les design books (ni repérés sur les plans 3D). Un « Mon choix » retiré laisse la place à la première proposition ; un besoin vide disparaît. ⌘Z annule.',
        'Retirer des projets'
      )
      if (!ok) return
    }
    setBusy(true)
    try {
      const projects = await window.mdeko.removeFromProjects(ids)
      setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))))
      refresh()
      notify(projects ? `Retiré de ${plural(projects, 'projet', 'projets')}` : 'Ces articles n’étaient dans aucun projet', true)
    } finally {
      setBusy(false)
    }
  }

  const verified = async (ids: number[], what: 'link' | 'price') => {
    if (!ids.length || busy) return
    setBusy(true)
    try {
      await window.mdeko.markVerified(ids, what)
      setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))))
      refresh()
      notify(ids.length === 1 ? 'Noté : vérifié à la main' : `${plural(ids.length, 'article noté', 'articles notés')} « vérifié à la main »`, true)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (ids: number[]) => {
    for (const id of ids) await window.mdeko.restoreArticle(id)
    refresh()
    notify(ids.length === 1 ? 'L’article est revenu dans la shopping list' : `${plural(ids.length, 'article est revenu', 'articles sont revenus')} dans la shopping list`)
  }

  const askAi = async (g: CheckGroup) => {
    const ids = await window.mdeko.checkGroupIds(g.id)
    setAiRequest({ ids, label: `« ${g.title} »`, nonce: Date.now() })
    document.querySelector('.check-prices')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const trashOne = (a: Card) => trash([a.id], `Mettre « ${a.name} » à la corbeille ?`, 'Vous pourrez le récupérer depuis la Corbeille.')

  const trashSelection = () =>
    trash(
      [...selected],
      `Mettre ${plural(selected.size, 'article', 'articles')} à la corbeille ?`,
      'Vous pourrez les récupérer depuis la Corbeille, ou annuler tout de suite avec ⌘Z.'
    )

  const trashGroup = async (g: CheckGroup) => {
    const ids = await window.mdeko.checkGroupIds(g.id)
    if (g.id === 'duplicates') {
      return trash(
        ids,
        'Garder un seul article par produit ?',
        `${plural(ids.length, 'doublon ira', 'doublons iront')} à la corbeille. Pour chaque produit, on garde celui qui est dans un projet, sinon celui qui a une photo.`
      )
    }
    return trash(
      ids,
      `Mettre à la corbeille ${ids.length > 1 ? `les ${ids.length.toLocaleString('fr-FR')} articles` : 'l’article'} « ${g.title} » ?`,
      'Vous pourrez les récupérer depuis la Corbeille, ou annuler tout de suite avec ⌘Z.'
    )
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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

        <PriceCheck
          onEdit={setEditing}
          request={aiRequest}
          onTrash={(a) => void trash([a.articleId], `Mettre « ${a.name} » à la corbeille ?`, 'Vous pourrez le récupérer depuis la Corbeille.')}
          onRemoveFromProjects={(a) => void removeFromProjects([a.articleId])}
          onVerified={(a) => void verified([a.articleId], 'price')}
        />

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
                {g.id === 'in-trash' && (
                  <div className="check-group-actions">
                    <button type="button" className="button button-danger" disabled={busy} onClick={() => void window.mdeko.checkGroupIds(g.id).then((ids) => removeFromProjects(ids))}>
                      Tout retirer des projets ({g.count.toLocaleString('fr-FR')})
                    </button>
                    <button type="button" className="button" disabled={busy} onClick={() => void window.mdeko.checkGroupIds(g.id).then(restore)}>
                      Tout remettre dans la shopping list
                    </button>
                  </div>
                )}
                {g.id !== 'in-trash' && (
                  <div className="check-group-actions">
                    {(() => {
                      const all = g.articles.every((a) => selected.has(a.id))
                      return (
                        <button
                          type="button"
                          className="button button-plain"
                          onClick={() =>
                            setSelected((s) => {
                              const next = new Set(s)
                              for (const a of g.articles) {
                                if (all) next.delete(a.id)
                                else next.add(a.id)
                              }
                              return next
                            })
                          }
                        >
                          {all ? 'Tout désélectionner' : g.count > g.articles.length ? `Sélectionner les ${g.articles.length} affichés` : 'Tout sélectionner'}
                        </button>
                      )
                    })()}
                    {(g.id === 'unverifiable' || g.id === 'stale-price' || g.id === 'gone') && (
                      <button type="button" className="button button-primary" disabled={busy} onClick={() => void askAi(g)}>
                        Faire vérifier par l’IA
                      </button>
                    )}
                    {VERIFY[g.id] && g.id !== 'gone' && (
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={async () => {
                          const ids = await window.mdeko.checkGroupIds(g.id)
                          const ok = await window.mdeko.confirm(
                            `Tout noter « vérifié à la main » (${ids.length.toLocaleString('fr-FR')}) ?`,
                            'Ils disparaîtront de cette liste. ⌘Z annule.',
                            'Tout noter vérifié'
                          )
                          if (ok) await verified(ids, VERIFY[g.id]!)
                        }}
                      >
                        Tout noter vérifié
                      </button>
                    )}
                    {g.inProjectIds.length > 0 && g.id !== 'duplicates' && (
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={async () => {
                          const ids = await window.mdeko.checkGroupIds(g.id)
                          await removeFromProjects(ids)
                        }}
                      >
                        Tout retirer des projets
                      </button>
                    )}
                    <button type="button" className="button button-danger" disabled={busy} onClick={() => void trashGroup(g)}>
                      <Icon name="trash" size={14} />
                      {g.id === 'duplicates' ? 'Garder un seul article par produit' : g.count > 1 ? `Tout mettre à la corbeille (${g.count.toLocaleString('fr-FR')})` : 'Mettre à la corbeille'}
                    </button>
                  </div>
                )}
                <div className="grid">
                  {g.articles.map((a) => (
                    <div key={a.id} className={`check-card${selected.has(a.id) ? ' is-selected' : ''}${selected.size ? ' is-selecting' : ''}`}>
                      <ArticleCard
                        article={a}
                        onOpen={(id) =>
                          g.id === 'in-trash' ? notify('Remettez-le dans la shopping list depuis la corbeille, ou retirez-le du projet.') : setEditing(id)
                        }
                      />
                      <div className="check-card-actions">
                        {g.id === 'in-trash' ? (
                          <>
                            <button type="button" className="button button-small" disabled={busy} onClick={() => void removeFromProjects([a.id])}>
                              Retirer des projets
                            </button>
                            <button type="button" className="button button-small" disabled={busy} onClick={() => void restore([a.id])}>
                              Remettre dans la shopping list
                            </button>
                          </>
                        ) : (
                          <>
                            {(g.id === 'unverifiable' || g.id === 'gone') && g.links[a.id] && (
                              <button type="button" className="button button-small" onClick={() => void window.mdeko.openExternal(g.links[a.id])}>
                                Ouvrir le lien
                              </button>
                            )}
                            {VERIFY[g.id] && (
                              <button type="button" className="button button-small" disabled={busy} onClick={() => void verified([a.id], VERIFY[g.id]!)}>
                                {g.id === 'gone' ? 'Toujours en vente' : VERIFY[g.id] === 'price' ? 'Prix vérifié' : 'Vérifié à la main'}
                              </button>
                            )}
                            {g.inProjectIds.includes(a.id) && (
                              <button type="button" className="button button-small" disabled={busy} onClick={() => void removeFromProjects([a.id])}>
                                Retirer des projets
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {g.id !== 'in-trash' && (
                        <>
                          <label className="check-select" title="Sélectionner">
                            <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Sélectionner « ${a.name} »`} />
                          </label>
                          <button
                            type="button"
                            className="check-trash"
                            title="Mettre à la corbeille"
                            aria-label={`Mettre « ${a.name} » à la corbeille`}
                            disabled={busy}
                            onClick={() => void trashOne(a)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {g.count > g.articles.length && <p className="section-note">Les {g.articles.length} premiers sont affichés.</p>}
              </>
            )}
          </section>
        ))}
      </div>
      {selected.size > 0 && (
        <div className="check-selection">
          <span>{plural(selected.size, 'article sélectionné', 'articles sélectionnés')}</span>
          <button type="button" className="button button-plain" onClick={() => setSelected(new Set())}>
            Tout désélectionner
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void verified([...selected], 'link')}>
            Vérifié à la main
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void removeFromProjects([...selected])}>
            Retirer des projets
          </button>
          <button type="button" className="button button-danger" disabled={busy} onClick={() => void trashSelection()}>
            <Icon name="trash" size={14} />
            Mettre la sélection à la corbeille
          </button>
        </div>
      )}
      {editing !== null && <ArticleEditorSheet articleId={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
