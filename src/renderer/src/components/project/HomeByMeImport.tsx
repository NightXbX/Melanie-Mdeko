import { useState } from 'react'
import type { ArticleCard as Card, ArticleInput, HbmPreview, HbmPreviewObject } from '@shared/api'
import { formatPrice } from '@shared/format'
import type { Project } from '@shared/projects'
import { useApp } from '../../app-context'
import { uploadDrop } from '../../lib/images'
import { ArticleEditorSheet } from '../ArticleEditorSheet'
import { Icon } from '../Icon'
import { ArticlePicker } from './ArticlePicker'

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

// Pièce du projet où ranger les objets d'une pièce HomeByMe : une pièce existante, une nouvelle, ou aucune.
type RoomTarget = { kind: 'room'; id: number } | { kind: 'new' } | { kind: 'none' }
interface Row {
  checked: boolean
  article: Card | null
}

// Import des objets d'un projet HomeByMe dans la shopping list du projet : les produits du catalogue HomeByMe
// deviennent des articles (lien, photos, prix lus chez le vendeur) ; les objets de la communauté, qui n'ont ni
// lien ni prix, sont associés à un article de la shopping list ou créés. Chaque choix est retenu pour la suite.
export function HomeByMeImport({ project, onClose, onDone }: { project: Project; onClose(): void; onDone(): Promise<void> }) {
  const { notify, refresh } = useApp()
  const [url, setUrl] = useState(project.homebymeUrl ?? '')
  const [preview, setPreview] = useState<HbmPreview | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [targets, setTargets] = useState<Record<string, RoomTarget>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<HbmPreviewObject | null>(null)
  const [creating, setCreating] = useState<HbmPreviewObject | null>(null)

  const read = async () => {
    setError(null)
    setBusy('Lecture du projet HomeByMe…')
    try {
      const p = await window.mdeko.homebyme.read(project.id, url)
      setPreview(p)
      setRows(
        Object.fromEntries(
          p.objects.map((o) => [o.key, { article: o.article, checked: o.kind === 'product' ? !o.ignored : o.article !== null && !o.ignored }])
        )
      )
      // Pièces HomeByMe nommées : rangées dans la pièce du projet du même nom s'il y en a une.
      const names = [...new Set(p.objects.flatMap((o) => o.rooms.map((r) => r.name)).filter((n): n is string => n !== null))]
      setTargets(
        Object.fromEntries(
          names.map((n) => {
            const same = project.rooms.find((r) => plain(r.name) === plain(n))
            return [n, same ? { kind: 'room', id: same.id } : { kind: 'none' }]
          })
        )
      )
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
    }
  }

  const setRow = (key: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }))
  const choose = (o: HbmPreviewObject, article: Card) => setRow(o.key, { article, checked: true })

  // Nouvel article pour un produit du catalogue HomeByMe : on lit d'abord la page du vendeur (nom en français,
  // prix, photos) ; sinon on garde ce que donne HomeByMe. Une page sans prix n'est pas celle du produit
  // (lien périmé renvoyé vers une catégorie, par exemple) : on l'écarte.
  const createProduct = async (o: HbmPreviewObject): Promise<number> => {
    const read = o.url ? await window.mdeko.readProductPage(o.url).catch(() => null) : null
    const page = read?.priceCents ? read : null
    const name = page?.name ?? o.name
    const imageUrls = page?.imageUrls.length ? page.imageUrls : o.imageUrl ? [o.imageUrl] : []
    const images = []
    for (const imageUrl of imageUrls) images.push(...(await uploadDrop({ files: [], url: imageUrl }).catch(() => [])))
    const input: ArticleInput = {
      id: null,
      name,
      priceCents: page?.priceCents ?? null,
      priceKind: 'fixed',
      supplier: page?.supplier ?? o.brand ?? '',
      url: o.url ?? '',
      categoryId: await window.mdeko.homebyme.guessCategory(name),
      dimensions: o.size ?? '',
      colorMaterial: '',
      description: page?.description ?? '',
      tags: [],
      privateNote: 'Importé de HomeByMe',
      images
    }
    return window.mdeko.saveArticle(input)
  }

  const apply = async () => {
    if (!preview) return
    setError(null)
    try {
      // Nouvelles pièces d'abord, pour pouvoir y ranger les articles.
      const added = Object.entries(targets)
        .filter(([, t]) => t.kind === 'new')
        .map(([n]) => n)
      let rooms = project.rooms
      if (added.length) {
        setBusy('Ajout des pièces…')
        await window.mdeko.projects.setRooms(project.id, [...rooms.map((r) => r.name), ...added])
        rooms = (await window.mdeko.projects.get(project.id))?.rooms ?? rooms
      }
      const roomId = (name: string | null): number | null => {
        if (name === null) return null
        const t = targets[name]
        if (t?.kind === 'room') return t.id
        if (t?.kind === 'new') return rooms.find((r) => plain(r.name) === plain(name))?.id ?? null
        return null
      }

      const chosen = preview.objects.filter((o) => rows[o.key].checked && (rows[o.key].article || o.kind === 'product'))
      let created = 0
      let needs = 0
      for (const [i, o] of chosen.entries()) {
        setBusy(`Ajout au projet… ${i + 1} / ${chosen.length}`)
        let articleId = rows[o.key].article?.id ?? null
        if (articleId === null) {
          articleId = await createProduct(o)
          created++
        }
        await window.mdeko.homebyme.remember(o.key, articleId, false)
        // Un « Mon choix » par pièce, avec le nombre d'exemplaires ; jamais deux fois le même article dans une pièce.
        const perRoom = new Map<number | null, number>()
        for (const r of o.rooms) perRoom.set(roomId(r.name), (perRoom.get(roomId(r.name)) ?? 0) + r.count)
        const current = await window.mdeko.projects.get(project.id)
        for (const [room, count] of perRoom) {
          if (current?.needs.some((n) => n.choice?.id === articleId && n.roomId === room)) continue
          const needId = await window.mdeko.projects.addNeed(project.id, articleId, room)
          if (count > 1) await window.mdeko.projects.setNeedQuantity(needId, count)
          needs++
        }
      }
      // Ce qui a été écarté est retenu : décoché la prochaine fois.
      for (const o of preview.objects) {
        const row = rows[o.key]
        if (!row.checked) await window.mdeko.homebyme.remember(o.key, row.article?.id ?? null, !row.article)
      }
      await onDone()
      refresh()
      notify(`${needs} article${needs > 1 ? 's' : ''} ajouté${needs > 1 ? 's' : ''} au projet${created ? `, dont ${created} nouveau${created > 1 ? 'x' : ''} dans la shopping list` : ''}`)
      onClose()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
    }
  }

  const products = preview?.objects.filter((o) => o.kind === 'product') ?? []
  const community = preview?.objects.filter((o) => o.kind === 'community') ?? []
  const count = preview?.objects.filter((o) => rows[o.key]?.checked && (rows[o.key].article || o.kind === 'product')).length ?? 0
  const roomNames = Object.keys(targets)

  const line = (o: HbmPreviewObject) => {
    const row = rows[o.key]
    const ready = row.article !== null || o.kind === 'product'
    return (
      <div key={o.key} className={`hbm-row${row.checked && ready ? '' : ' is-off'}`}>
        <input
          type="checkbox"
          aria-label="Ajouter au projet"
          checked={row.checked && ready}
          disabled={!ready}
          onChange={(e) => setRow(o.key, { checked: e.target.checked })}
        />
        <div className="hbm-thumb">{o.imageUrl ? <img src={o.imageUrl} alt="" /> : <Icon name="photo" size={22} />}</div>
        <div className="hbm-info">
          <span className="hbm-name">{o.name}</span>
          <span className="hbm-meta">{[o.brand, o.size].filter(Boolean).join(' · ')}</span>
          <span className="hbm-meta">{o.rooms.map((r) => `${r.name ?? 'Sans pièce'}${r.count > 1 ? ` × ${r.count}` : ''}`).join(' · ')}</span>
        </div>
        <div className="hbm-match">
          {row.article ? (
            <>
              <span className="hbm-label">{o.kind === 'product' && !o.remembered && !o.article ? 'Article choisi' : 'Dans la shopping list'}</span>
              <MiniCard article={row.article} />
              <button type="button" className="button button-plain" onClick={() => setPicking(o)}>
                Changer
              </button>
            </>
          ) : o.kind === 'product' ? (
            <>
              <span className="hbm-label">Nouvel article {o.url ? '(lu sur le site du vendeur)' : ''}</span>
              <button type="button" className="button button-plain" onClick={() => setPicking(o)}>
                C’est un article de ma shopping list…
              </button>
            </>
          ) : (
            <>
              {o.suggestions.length > 0 && <span className="hbm-label">C’est peut-être :</span>}
              <div className="hbm-suggestions">
                {o.suggestions.map((s) => (
                  <button key={s.id} type="button" className="hbm-suggestion" title={s.name} onClick={() => choose(o, s)}>
                    {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" /> : <Icon name="photo" size={16} />}
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
              <div className="hbm-actions">
                <button type="button" className="button" onClick={() => setPicking(o)}>
                  Choisir dans la shopping list…
                </button>
                <button type="button" className="button" onClick={() => setCreating(o)}>
                  Créer l’article…
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet sheet-large hbm-sheet" onKeyDown={(e) => e.key === 'Escape' && !busy && !picking && !creating && onClose()}>
        <div className="sheet-head">
          <h2>Importer depuis HomeByMe</h2>
          <div className="sheet-actions">
            <button type="button" className="button" disabled={Boolean(busy)} onClick={onClose}>
              Annuler
            </button>
            {preview && (
              <button type="button" className="button button-primary" disabled={Boolean(busy) || count === 0} onClick={() => void apply()}>
                Ajouter {count} article{count > 1 ? 's' : ''} au projet
              </button>
            )}
          </div>
        </div>

        <div className="hbm-link">
          <label className="field field-wide">
            <span>Lien du projet HomeByMe (bouton « Partager » du projet)</span>
            <div className="field-with-button">
              <input
                autoFocus={!url}
                value={url}
                placeholder="https://home.by.me/fr/project/…"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url.trim() && void read()}
              />
              <button type="button" className={`button${preview ? '' : ' button-primary'}`} disabled={!url.trim() || Boolean(busy)} onClick={() => void read()}>
                {preview ? 'Relire' : 'Lire le projet'}
              </button>
            </div>
          </label>
        </div>

        {error && <p className="editor-error">{error}</p>}
        {busy && (
          <p className="hbm-busy">
            <span className="ai-spinner" />
            {busy}
          </p>
        )}

        {preview && (
          <div className="hbm-body">
            {roomNames.length > 0 && (
              <section>
                <h3>Pièces</h3>
                <p className="section-note">Où ranger les articles de chaque pièce HomeByMe dans la shopping list du projet.</p>
                <div className="hbm-rooms">
                  {roomNames.map((n) => {
                    const t = targets[n]
                    const value = t.kind === 'room' ? String(t.id) : t.kind
                    return (
                      <label key={n} className="hbm-room">
                        <span>{n}</span>
                        <select
                          value={value}
                          onChange={(e) => {
                            const v = e.target.value
                            setTargets((all) => ({ ...all, [n]: v === 'new' || v === 'none' ? { kind: v } : { kind: 'room', id: Number(v) } }))
                          }}
                        >
                          {project.rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                          <option value="new">Ajouter la pièce « {n} » au projet</option>
                          <option value="none">Sans pièce</option>
                        </select>
                      </label>
                    )
                  })}
                </div>
              </section>
            )}

            <section>
              <h3>Produits du catalogue HomeByMe ({products.length})</h3>
              {products.map(line)}
            </section>

            <section>
              <h3>Objets de la communauté ({community.length})</h3>
              <p className="section-note">
                HomeByMe ne donne ni leur lien ni leur prix : choisissez l’article de votre shopping list qui correspond, ou créez-le. Mdeko s’en souviendra pour vos prochains projets.
              </p>
              {community.map(line)}
            </section>
          </div>
        )}

        {picking && (
          <ArticlePicker
            title={`Article correspondant à « ${picking.name} »`}
            onCancel={() => setPicking(null)}
            onPick={async (id) => {
              const o = picking
              setPicking(null)
              const article = await window.mdeko.getArticle(id)
              if (article) choose(o, article)
            }}
          />
        )}
        {creating && (
          <ArticleEditorSheet
            articleId={null}
            initial={{ name: creating.name, dimensions: creating.size ?? '', privateNote: 'Importé de HomeByMe' }}
            initialDrop={creating.imageUrl ? { files: [], url: creating.imageUrl } : undefined}
            onClose={async (savedId) => {
              const o = creating
              setCreating(null)
              if (savedId === undefined) return
              const article = await window.mdeko.getArticle(savedId)
              if (article) choose(o, article)
            }}
          />
        )}
      </div>
    </div>
  )
}

function MiniCard({ article }: { article: Card }) {
  return (
    <span className="hbm-article">
      {article.thumbnailUrl ? <img src={article.thumbnailUrl} alt="" /> : <Icon name="photo" size={16} />}
      <span>
        {article.name}
        <small>{[formatPrice(article.price), article.supplier].filter(Boolean).join(' · ')}</small>
      </span>
    </span>
  )
}
