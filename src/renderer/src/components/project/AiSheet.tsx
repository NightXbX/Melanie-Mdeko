import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AiMark, AiProposal, AiStatus, AiVersion, EditableImage } from '@shared/api'
import type { ProjectRender } from '@shared/projects'
import { useApp, useUndoHandler } from '../../app-context'
import { hasImages, readDrop, uploadDrop } from '../../lib/images'
import { isMove } from '../../lib/sortable'
import { Icon } from '../Icon'
import { ArticlePicker } from './ArticlePicker'
import { MarkupLayer, strokesToPng, type Stroke } from './MarkupLayer'

const RENDER_MARKS_WIDTH = 2048
const REFERENCE_MARKS_WIDTH = 1024

const IDEAS = [
  'Ajoute des lumières chaudes et douces',
  'Ajoute quelques objets de décoration sur les meubles',
  'Ajoute des plantes vertes',
  'Ajoute ce meuble (image de référence) dans la pièce'
]

export const dollars = (cents: number) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Assistant de retouche d'un rendu : une demande en français, des images de référence, deux propositions
// (une par moteur, à l'aveugle), comparaison avant / après, puis « Garder » ou « Réessayer ».
export function AiSheet({ render, onClose, onChanged }: { render: ProjectRender; onClose(): void; onChanged(): void }) {
  const { notify, refresh } = useApp()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [history, setHistory] = useState<AiVersion[]>([])
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<EditableImage[]>([])
  const [picking, setPicking] = useState(false)
  const [running, setRunning] = useState(false)
  const [proposals, setProposals] = useState<AiProposal[] | null>(null)
  const [compared, setCompared] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  // Traits rouges pour préciser la demande : sur le rendu (« render ») et sur chaque image de référence (son id).
  const [marks, setMarks] = useState<Record<string, Stroke[]>>({})
  const [drawing, setDrawing] = useState(false)
  const [markingRef, setMarkingRef] = useState<EditableImage | null>(null)
  const ratios = useRef<Record<string, number>>({}) // hauteur / largeur de chaque image annotée
  const fileInput = useRef<HTMLInputElement>(null)
  const stageImage = useRef<HTMLImageElement>(null)

  const setStrokes = (key: string, strokes: Stroke[]) => setMarks((m) => ({ ...m, [key]: strokes }))
  // ⌘Z retire le dernier trait de l'image qu'on est en train d'annoter.
  const markingKey = markingRef ? String(markingRef.id) : drawing ? 'render' : null
  useUndoHandler(() => {
    if (!markingKey || !marks[markingKey]?.length) return false
    setStrokes(markingKey, marks[markingKey].slice(0, -1))
    return true
  }, markingKey !== null)

  const current = history.find((v) => v.active) ?? history[0]

  const load = async () => {
    setStatus(await window.mdeko.ai.status())
    setHistory(await window.mdeko.ai.history(render.id))
  }
  useEffect(() => void load(), [render.id])

  const addRefs = async (files: Blob[], url: string | null = null) => {
    try {
      const images = await uploadDrop({ files, url })
      setRefs((r) => [...r, ...images.filter((i) => !r.some((x) => x.id === i.id))])
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const run = async () => {
    setError(null)
    setRunning(true)
    setProposals(null)
    try {
      const marked: AiMark[] = []
      for (const [key, strokes] of Object.entries(marks)) {
        if (!strokes.length || (key !== 'render' && !refs.some((r) => String(r.id) === key))) continue
        const width = key === 'render' ? RENDER_MARKS_WIDTH : REFERENCE_MARKS_WIDTH
        marked.push({ target: key === 'render' ? 'render' : Number(key), overlay: await strokesToPng(strokes, width, ratios.current[key] ?? 9 / 16) })
      }
      setDrawing(false)
      const result = await window.mdeko.ai.edit(render.id, prompt, refs.map((r) => r.id), marked)
      setProposals(result)
      setCompared(Math.max(0, result.findIndex((p) => p.imageUrl)))
      if (result.every((p) => p.error)) setError(result[0].error)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setRunning(false)
      void load()
    }
  }

  const keep = async (p: AiProposal) => {
    await window.mdeko.ai.keep(p.versionId!)
    setProposals(null)
    await load()
    onChanged()
    refresh()
    notify('Le rendu retouché remplace l’original dans le design book. L’original reste disponible ici.')
  }

  const show = async (v: AiVersion) => {
    await window.mdeko.ai.show(render.id, v.id)
    await load()
    onChanged()
  }

  const shown = proposals?.[compared]
  const remaining = status ? status.settings.capCents - status.spentCents : 0
  const count = status?.settings.models.length ?? 2

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}
      // Une image lâchée n'importe où ici devient une image de référence (et jamais un nouveau rendu du projet).
      onDragOver={(e) => {
        e.stopPropagation()
        if (isMove(e) || !hasImages(e.dataTransfer)) return
        e.preventDefault()
        if (!running && !proposals) setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDropping(false)
        if (running || proposals || isMove(e)) return
        const d = readDrop(e.dataTransfer)
        if (d.files.length || d.url) void addRefs(d.files, d.url)
      }}
    >
      <div className="sheet sheet-large ai-sheet" onKeyDown={(e) => e.key === 'Escape' && !running && !picking && onClose()}>
        <div className="sheet-head">
          <h2>Retoucher le rendu</h2>
          <div className="sheet-actions">
            {status && (
              <span className="ai-spend">
                Ce mois-ci : {dollars(status.spentCents)} sur {dollars(status.settings.capCents)}
              </span>
            )}
            <button type="button" className="button" disabled={running} onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>

        <div className="ai-body">
          <div className="ai-stage">
            {shown?.imageUrl && current ? (
              <BeforeAfter before={current.imageUrl} after={shown.imageUrl} />
            ) : (
              current && (
                <>
                  <img
                    ref={stageImage}
                    className="ai-image"
                    src={current.imageUrl}
                    alt=""
                    draggable={false}
                    onLoad={(e) => (ratios.current.render = e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
                  />
                  <MarkupLayer image={stageImage} strokes={marks.render ?? []} active={drawing && !running} onChange={(s) => setStrokes('render', s)} />
                </>
              )
            )}
            {dropping && (
              <div className="drop-overlay">
                <Icon name="photo" size={40} />
                <p>Déposez l’image : elle servira d’image de référence</p>
              </div>
            )}
            {running && (
              <div className="ai-running">
                <span className="ai-spinner" />
                <p>Création de {count > 1 ? `${count} propositions` : 'la proposition'}… environ une minute.</p>
                <button type="button" className="button" onClick={() => void window.mdeko.ai.cancel()}>
                  Arrêter
                </button>
              </div>
            )}
          </div>

          <div className="ai-panel">
            {proposals ? (
              <>
                <h3>{proposals.length > 1 ? 'Laquelle préférez-vous ?' : 'Résultat'}</h3>
                <div className="ai-proposals">
                  {proposals.map((p, i) => (
                    <div key={i} className={`ai-proposal${i === compared ? ' is-selected' : ''}`}>
                      {p.imageUrl ? (
                        <button type="button" className="ai-proposal-image" onClick={() => setCompared(i)}>
                          <img src={p.imageUrl} alt="" />
                          <span className="ai-proposal-label">Proposition {String.fromCharCode(65 + i)}</span>
                        </button>
                      ) : (
                        <p className="ai-proposal-error">{p.error}</p>
                      )}
                      {p.versionId !== null && (
                        <button type="button" className="button button-primary" onClick={() => void keep(p)}>
                          Garder celle-ci
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="section-note">Faites glisser le curseur sur l’image pour comparer avec l’avant.</p>
                <div className="ai-actions">
                  <button type="button" className="button" onClick={() => void run()}>
                    Réessayer
                  </button>
                  <button type="button" className="button button-plain" onClick={() => setProposals(null)}>
                    Aucune ne me plaît
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="ai-markup-tools">
                  <button type="button" className={`button${drawing ? ' is-active' : ''}`} disabled={running} onClick={() => setDrawing(!drawing)}>
                    <Icon name="pencil" size={13} />
                    {drawing ? 'Terminer' : 'Entourer sur le rendu'}
                  </button>
                  {(marks.render?.length ?? 0) > 0 && (
                    <button type="button" className="button button-plain" disabled={running} onClick={() => setStrokes('render', [])}>
                      Effacer les traits
                    </button>
                  )}
                </div>
                {drawing && <p className="section-note">Entourez ou soulignez sur l’image ce que l’IA doit changer, ou l’endroit où ajouter un objet.</p>}
                <label className="field">
                  <span>Que voulez-vous changer ?</span>
                  <textarea
                    rows={4}
                    autoFocus
                    value={prompt}
                    disabled={running}
                    placeholder="Par exemple : ajoute une lampe sur pied à côté du canapé"
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </label>
                <div className="ai-ideas">
                  {IDEAS.map((idea) => (
                    <button key={idea} type="button" className="tag ai-idea" disabled={running} onClick={() => setPrompt(idea)}>
                      {idea}
                    </button>
                  ))}
                </div>

                <div className="field ai-refs">
                  <span>Images de référence (un meuble à ajouter…) : glissez-les n’importe où dans cette fenêtre</span>
                  <div className="ai-refs-list">
                    {refs.map((r) => (
                      <div key={r.id} className="detail-thumb editor-thumb">
                        <button type="button" className="editor-thumb-main" title="Entourer sur cette image" onClick={() => setMarkingRef(r)}>
                          <img src={r.url} alt="" draggable={false} />
                        </button>
                        {(marks[String(r.id)]?.length ?? 0) > 0 && <span className="ai-ref-marked" />}
                        <button type="button" className="editor-thumb-remove" aria-label="Retirer l’image" onClick={() => setRefs(refs.filter((x) => x.id !== r.id))}>
                          <Icon name="xmark" size={10} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="button" disabled={running} onClick={() => setPicking(true)}>
                      <Icon name="bag" size={14} />
                      Article de la shopping list
                    </button>
                    <button type="button" className="button" disabled={running} onClick={() => fileInput.current?.click()}>
                      <Icon name="photo" size={14} />
                      Image de l’ordinateur
                    </button>
                  </div>
                </div>

                {error && <p className="editor-error">{error}</p>}
                {status && !status.hasKey && <p className="editor-error">Ajoutez d’abord la clé OpenRouter dans les Réglages (⌘,).</p>}
                {status?.hasKey && remaining < status.estimateCents && (
                  <p className="editor-error">Le plafond du mois est presque atteint : il peut être relevé dans les Réglages.</p>
                )}
                <button
                  type="button"
                  className="button button-primary button-large"
                  disabled={running || !prompt.trim() || !status?.hasKey}
                  onClick={() => void run()}
                >
                  {count > 1 ? `Créer ${count} propositions` : 'Créer la proposition'}
                  {status ? ` (environ ${dollars(status.estimateCents)})` : ''}
                </button>
              </>
            )}

            {history.length > 1 && (
              <div className="ai-history">
                <h3>Versions de ce rendu</h3>
                <p className="section-note">Celle qui est entourée apparaît dans le design book.</p>
                <div className="ai-history-list">
                  {history.map((v) => (
                    <button
                      key={v.id ?? 'original'}
                      type="button"
                      className={`ai-version${v.active ? ' is-selected' : ''}`}
                      title={v.prompt ?? 'Rendu d’origine'}
                      disabled={running}
                      onClick={() => void show(v)}
                    >
                      <img src={v.imageUrl} alt="" />
                      <span>{v.id === null ? 'Original' : (v.prompt ?? '')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addRefs([...e.target.files])
            e.target.value = ''
          }}
        />
        {markingRef && (
          <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMarkingRef(null)}>
            <div className="sheet sheet-large ai-ref-markup" onKeyDown={(e) => e.key === 'Escape' && setMarkingRef(null)}>
              <div className="sheet-head">
                <h2>Entourez le produit à utiliser</h2>
                <div className="sheet-actions">
                  {(marks[String(markingRef.id)]?.length ?? 0) > 0 && (
                    <button type="button" className="button button-plain" onClick={() => setStrokes(String(markingRef.id), [])}>
                      Effacer les traits
                    </button>
                  )}
                  <button type="button" className="button button-primary" onClick={() => setMarkingRef(null)}>
                    Terminé
                  </button>
                </div>
              </div>
              <RefMarkup
                image={markingRef}
                strokes={marks[String(markingRef.id)] ?? []}
                onRatio={(r) => (ratios.current[String(markingRef.id)] = r)}
                onChange={(st) => setStrokes(String(markingRef.id), st)}
              />
            </div>
          </div>
        )}
        {picking && (
          <ArticlePicker
            title="Choisir l’article à ajouter dans le rendu"
            onCancel={() => setPicking(false)}
            onPick={async (id) => {
              setPicking(false)
              const article = await window.mdeko.getArticleInput(id)
              const photo = article?.images[0]
              if (photo) setRefs((r) => (r.some((x) => x.id === photo.id) ? r : [...r, photo]))
              else notify('Cet article n’a pas de photo.')
            }}
          />
        )}
      </div>
    </div>
  )
}

// Image de référence en grand, pour y entourer le produit à reprendre (une photo avec plusieurs meubles).
function RefMarkup({ image, strokes, onRatio, onChange }: { image: EditableImage; strokes: Stroke[]; onRatio(r: number): void; onChange(s: Stroke[]): void }) {
  const img = useRef<HTMLImageElement>(null)
  return (
    <div className="ai-stage ai-ref-stage">
      <img
        ref={img}
        className="ai-image"
        src={image.url}
        alt=""
        draggable={false}
        onLoad={(e) => onRatio(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
      />
      <MarkupLayer image={img} strokes={strokes} active onChange={onChange} />
    </div>
  )
}

// Comparaison avant / après : on fait glisser le curseur sur l'image.
function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const move = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)))
  }
  return (
    <div
      ref={box}
      className="before-after"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && move(e)}
    >
      <img src={after} alt="" draggable={false} />
      <img src={before} alt="" draggable={false} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
      <span className="before-after-line" style={{ left: `${split}%` }}>
        <span className="before-after-knob">
          <Icon name="chevronLeft" size={12} />
          <Icon name="chevronRight" size={12} />
        </span>
      </span>
      <span className="before-after-tag is-before">Avant</span>
      <span className="before-after-tag is-after">Après</span>
    </div>
  )
}
