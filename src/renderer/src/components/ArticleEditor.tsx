import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ArticleInput, EditableImage, EditorChoices, PriceKind } from '@shared/api'
import { parsePriceInput, priceInputText } from '@shared/format'
import { normalizeUrlInput } from '@shared/url'
import { hasImages, readDrop, uploadDrop, type DropContent } from '../lib/images'
import { useViewActive } from '../lib/keep-alive'
import { moved, useSortable } from '../lib/sortable'
import { Icon } from './Icon'
import { SAVE_EVENT } from './SaveButton'

const PRICE_KINDS: { value: PriceKind; label: string }[] = [
  { value: 'fixed', label: 'Prix' },
  { value: 'from', label: 'À partir de' },
  { value: 'per_m2', label: 'Prix au m²' },
  { value: 'per_roll', label: 'Prix au rouleau' },
  { value: 'on_quote', label: 'Sur devis' }
]

const EMPTY: ArticleInput = {
  id: null,
  name: '',
  priceCents: null,
  priceKind: 'fixed',
  supplier: '',
  url: '',
  categoryId: null,
  dimensions: '',
  colorMaterial: '',
  description: '',
  tags: [],
  privateNote: '',
  images: []
}

interface Props {
  articleId: number | null
  initialDrop?: DropContent
  initial?: Partial<ArticleInput> // nouvel article prérempli (objet importé de HomeByMe, par exemple)
  onClose(savedId?: number): void
}

export function ArticleEditor({ articleId, initialDrop, initial, onClose }: Props) {
  const [form, setForm] = useState<ArticleInput | null>(articleId === null ? { ...EMPTY, ...initial } : null)
  const [priceText, setPriceText] = useState('')
  const [choices, setChoices] = useState<EditorChoices | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const active = useViewActive()
  const latest = useRef({ form, priceText })
  latest.current = { form, priceText }
  const dirty = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    void window.mdeko.editorChoices().then(setChoices)
    if (articleId !== null) {
      void window.mdeko.getArticleInput(articleId).then((a) => {
        if (!a) return closeRef.current()
        setForm(a)
        setPriceText(priceInputText(a.priceCents))
      })
    } else {
      nameInput.current?.focus()
    }
  }, [articleId])

  const update = (patch: Partial<ArticleInput>) => {
    dirty.current = true
    setForm((f) => (f ? { ...f, ...patch } : f))
  }

  const addImages = async (drop: DropContent) => {
    setError(null)
    setUploading((n) => n + 1)
    try {
      const added = await uploadDrop(drop)
      if (added.length) {
        dirty.current = true
        setForm((f) => (f ? { ...f, images: [...f.images, ...added.filter((a) => !f.images.some((i) => i.id === a.id))] } : f))
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setUploading((n) => n - 1)
    }
  }

  // Photo déposée sur la grille pour créer l'article (une seule fois, à l'ouverture).
  const initialDone = useRef(false)
  useEffect(() => {
    if (initialDrop && !initialDone.current) {
      initialDone.current = true
      void addImages(initialDrop)
    }
  })

  const cancel = async () => {
    if (dirty.current) {
      const ok = await window.mdeko.confirm(
        'Abandonner les modifications ?',
        'Ce que vous avez saisi ne sera pas enregistré.',
        'Abandonner'
      )
      if (!ok) return
    }
    onClose()
  }

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form || saving || uploading) return
    const priceCents = form.priceKind === 'on_quote' ? null : parsePriceInput(priceText)
    if (priceText.trim() && priceCents === null && form.priceKind !== 'on_quote') {
      setError('Le prix n’est pas lisible. Exemple : 249,99')
      return
    }
    setSaving(true)
    try {
      const id = await window.mdeko.saveArticle({ ...form, priceCents, url: normalizeUrlInput(form.url) })
      onClose(id)
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setSaving(false)
    }
  }

  // Fichier › Enregistrer (⌘S) enregistre aussi la fiche ouverte.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onSave = () => active && void saveRef.current()
    window.addEventListener(SAVE_EVENT, onSave)
    return () => window.removeEventListener(SAVE_EVENT, onSave)
  }, [active])

  // Remplit les champs encore vides d'après la page du produit (nom, prix, fournisseur, description, photos).
  const fillFromLink = async (raw: string) => {
    const url = normalizeUrlInput(raw)
    if (!/^https?:\/\/[^/]+\.[^/]+/i.test(url) || reading) return
    setReading(true)
    setError(null)
    setNotice(null)
    try {
      const info = await window.mdeko.readProductPage(url)
      if (!info) {
        setError('Impossible de lire la page de ce produit. Remplissez la fiche à la main.')
        return
      }
      // La fiche a pu changer pendant la lecture : on part de ce qui est saisi maintenant.
      const f = latest.current.form
      if (!f) return
      const patch: Partial<ArticleInput> = {}
      if (!f.name.trim() && info.name) patch.name = info.name
      if (!f.supplier.trim() && info.supplier) patch.supplier = info.supplier
      if (!f.description.trim() && info.description) patch.description = info.description
      const price = !latest.current.priceText.trim() && info.priceCents !== null
      if (price) setPriceText(priceInputText(info.priceCents))
      update(patch)
      const photos = !f.images.length && info.imageUrls.length > 0
      for (const imageUrl of photos ? info.imageUrls : []) await addImages({ files: [], url: imageUrl })
      const filled = Object.keys(patch).length > 0 || price || photos
      setNotice(filled ? 'Fiche remplie d’après la page du produit : vérifiez les informations.' : 'La fiche était déjà remplie : rien n’a été changé.')
    } catch {
      setError('Impossible d’ouvrir la page de ce produit. Remplissez la fiche à la main.')
    } finally {
      setReading(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      void cancel()
    }
  }

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '')
    if (tag && form && !form.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) update({ tags: [...form.tags, tag] })
    setTagDraft('')
  }

  const setMainImage = (img: EditableImage) => form && update({ images: [img, ...form.images.filter((i) => i.id !== img.id)] })
  const removeImage = (img: EditableImage) => form && update({ images: form.images.filter((i) => i.id !== img.id) })

  // Les photos se rangent en les faisant glisser ; la première est la photo principale.
  const photoOrder = useSortable('editor-photo', {
    axis: 'horizontal',
    onDrop: (drop) => {
      if (!form) return
      update({ images: moved(form.images.map((i) => i.id), drop).map((id) => form.images.find((i) => i.id === id)!) })
    }
  })

  if (!form) return <div className="detail" />

  return (
    <form
      className="detail editor"
      onSubmit={save}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        const drop = readDrop(e.clipboardData)
        if (drop.files.length) {
          e.preventDefault()
          void addImages(drop)
        }
      }}
    >
      <div className="detail-bar">
        <span className="editor-title">{articleId === null ? 'Nouvel article' : 'Modifier l’article'}</span>
        <div className="detail-actions">
          <button type="button" className="button" onClick={() => void cancel()}>
            Annuler
          </button>
          <button type="submit" className="button button-primary" disabled={!form.name.trim() || saving || uploading > 0}>
            Enregistrer
          </button>
        </div>
      </div>

      <div className="detail-body">
        <div
          className={`editor-photos${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            if (!hasImages(e.dataTransfer)) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void addImages(readDrop(e.dataTransfer))
          }}
        >
          {form.images.length ? (
            <div className="detail-photo">
              <img src={form.images[0].url} alt="" />
            </div>
          ) : (
            <button type="button" className="detail-photo editor-drop" onClick={() => fileInput.current?.click()}>
              <Icon name="photo" size={48} />
              <span>Glissez une photo ici</span>
              <span className="editor-drop-hint">ou cliquez pour en choisir une</span>
            </button>
          )}
          <div className="detail-thumbs drop-horizontal">
            {form.images.map((img, i) => (
              <div key={img.id} className={`detail-thumb editor-thumb${i === 0 ? ' is-selected' : ''}`} {...photoOrder.item(img.id)}>
                <button type="button" className="editor-thumb-main" title="Photo principale" onClick={() => setMainImage(img)}>
                  <img src={img.url} alt="" draggable={false} />
                </button>
                <button type="button" className="editor-thumb-remove" aria-label="Retirer la photo" onClick={() => removeImage(img)}>
                  <Icon name="xmark" size={10} />
                </button>
              </div>
            ))}
            {form.images.length > 0 && (
              <button type="button" className="detail-thumb editor-add" aria-label="Ajouter une photo" onClick={() => fileInput.current?.click()}>
                <Icon name="plus" size={18} />
              </button>
            )}
            {uploading > 0 && <span className="editor-status">Ajout de la photo…</span>}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void addImages({ files: [...e.target.files], url: null })
              e.target.value = ''
            }}
          />
        </div>

        <div className="editor-fields">
          {error && <p className="editor-error">{error}</p>}
          {notice && !error && <p className="editor-notice">{notice}</p>}
          <label className="field field-wide">
            <span>Nom</span>
            <input ref={nameInput} value={form.name} onChange={(e) => update({ name: e.target.value })} required />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Prix</span>
              <select value={form.priceKind} onChange={(e) => update({ priceKind: e.target.value as PriceKind })}>
                {PRICE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {form.priceKind !== 'on_quote' && (
              <label className="field">
                <span>Montant en €</span>
                <input
                  inputMode="decimal"
                  value={priceText}
                  placeholder="249,99"
                  onChange={(e) => {
                    dirty.current = true
                    setPriceText(e.target.value)
                  }}
                />
              </label>
            )}
          </div>

          <div className="field-row">
            <label className="field">
              <span>Fournisseur</span>
              <input list="mdeko-suppliers" value={form.supplier} onChange={(e) => update({ supplier: e.target.value })} />
            </label>
            <label className="field">
              <span>Catégorie</span>
              <select
                value={form.categoryId ?? ''}
                onChange={(e) => update({ categoryId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {choices?.categories.map((f) => (
                  <optgroup key={f.id} label={f.name}>
                    {f.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          <div className="field field-wide">
            <label htmlFor="article-url">Lien du produit</label>
            <div className="field-with-button">
              <input
                id="article-url"
                value={form.url}
                placeholder="Collez le lien : la fiche se remplit toute seule"
                onChange={(e) => update({ url: e.target.value })}
                onPaste={(e) => {
                  // Lien collé dans une fiche encore vide : on la remplit tout de suite.
                  const pasted = e.clipboardData.getData('text').trim()
                  if (pasted && !form.name.trim()) void fillFromLink(pasted)
                }}
              />
              <button type="button" className="button" disabled={reading || !form.url.trim()} onClick={() => void fillFromLink(form.url)}>
                {reading ? 'Lecture de la page…' : 'Remplir avec ce lien'}
              </button>
            </div>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Dimensions</span>
              <input value={form.dimensions} placeholder="200 × 300 cm" onChange={(e) => update({ dimensions: e.target.value })} />
            </label>
            <label className="field">
              <span>Couleur / matière</span>
              <input value={form.colorMaterial} onChange={(e) => update({ colorMaterial: e.target.value })} />
            </label>
          </div>

          <label className="field field-wide">
            <span>Description (montrée dans le design book)</span>
            <textarea rows={2} value={form.description} onChange={(e) => update({ description: e.target.value })} />
          </label>

          <div className="field field-wide">
            <span>Style</span>
            <div className="tags">
              {form.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                  <button type="button" aria-label={`Retirer ${t}`} onClick={() => update({ tags: form.tags.filter((x) => x !== t) })}>
                    <Icon name="xmark" size={9} />
                  </button>
                </span>
              ))}
              <input
                list="mdeko-tags"
                value={tagDraft}
                placeholder={form.tags.length ? '' : 'Bohème, scandinave…'}
                onChange={(e) => (e.target.value.endsWith(',') ? addTag(e.target.value) : setTagDraft(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag(tagDraft)
                  } else if (e.key === 'Backspace' && !tagDraft && form.tags.length) {
                    update({ tags: form.tags.slice(0, -1) })
                  }
                }}
                onBlur={() => tagDraft && addTag(tagDraft)}
              />
            </div>
          </div>

          <label className="field field-wide">
            <span>Note privée</span>
            <textarea rows={3} value={form.privateNote} onChange={(e) => update({ privateNote: e.target.value })} />
          </label>
        </div>
      </div>

      <datalist id="mdeko-suppliers">
        {choices?.suppliers.map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id="mdeko-tags">
        {choices?.tags.map((t) => <option key={t} value={t} />)}
      </datalist>
    </form>
  )
}
