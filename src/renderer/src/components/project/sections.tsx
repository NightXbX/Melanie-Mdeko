import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { DEFAULT_PAINT_BRAND, type Artisan, type Paint } from '@shared/projects'
import { useApp } from '../../app-context'
import { useAutosave } from '../../lib/autosave'
import { moved, useSortable } from '../../lib/sortable'
import { Icon } from '../Icon'
import type { SectionProps } from './ProjectEditor'

export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {children}
    </div>
  )
}

// --- Client -------------------------------------------------------------------------------------

export function ClientSection({ project, reload, onDeleted }: SectionProps & { onDeleted(): void }) {
  const { refresh } = useApp()
  const [form, setForm] = useState({
    clientTitle: project.clientTitle,
    clientName: project.clientName,
    bookDate: project.bookDate ?? '',
    address: project.address,
    phone: project.phone,
    email: project.email
  })
  useAutosave(form, (f) => {
    if (!f.clientName.trim()) return
    void window.mdeko.projects.update(project.id, { ...f, bookDate: f.bookDate || null }).then(reload)
  })
  const field = (key: keyof typeof form, label: string, type = 'text') => (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  )

  const remove = async () => {
    const ok = await window.mdeko.confirm(
      `Supprimer le projet « ${[project.clientTitle, project.clientName].filter(Boolean).join(' ')} » ?`,
      'Le projet ne sera plus affiché. Les articles de la shopping list ne sont pas touchés.',
      'Supprimer le projet'
    )
    if (!ok) return
    await window.mdeko.projects.trash(project.id)
    refresh()
    onDeleted()
  }

  return (
    <div className="section">
      <SectionHeader title="Client" />
      <div className="field-row field-row-narrow">
        <label className="field">
          <span>Civilité</span>
          <select value={form.clientTitle} onChange={(e) => setForm({ ...form, clientTitle: e.target.value })}>
            <option>Mme</option>
            <option>M.</option>
            <option>Mme et M.</option>
            <option value="">—</option>
          </select>
        </label>
        {field('clientName', 'Nom')}
      </div>
      <div className="field-row">
        {field('bookDate', 'Mois du design book', 'month')}
        {field('phone', 'Téléphone', 'tel')}
      </div>
      {field('address', 'Adresse')}
      {field('email', 'E-mail', 'email')}
      <p className="section-note">Les coordonnées du client restent dans l’appli : elles n’apparaissent pas dans le design book.</p>
      <button type="button" className="button button-danger section-danger" onClick={() => void remove()}>
        Supprimer le projet…
      </button>
    </div>
  )
}

// --- Vos envies -----------------------------------------------------------------------------------

function fillTemplate(template: string, rooms: string[]): string {
  const names = rooms.map((r) => r.toLowerCase())
  const pieces = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : (names[0] ?? '')
  return template.replaceAll('{pieces}', pieces)
}

export function WishesSection({ project, settings, reload }: SectionProps) {
  const [rooms, setRooms] = useState(project.rooms.map((r) => r.name))
  const [draft, setDraft] = useState('')
  const [text, setText] = useState(project.texts.wishes)
  const shown = text ?? fillTemplate(settings.wishesText, rooms)

  useAutosave(rooms, (r) => void window.mdeko.projects.setRooms(project.id, r).then(reload), 300)
  useAutosave(text, (t) => void window.mdeko.projects.update(project.id, { texts: { ...project.texts, wishes: t } }).then(reload))

  // Les pièces se rangent en les faisant glisser : c'est l'ordre de la shopping list dans le book.
  const order = useSortable('room', {
    axis: 'horizontal',
    onDrop: (drop) => setRooms(moved(rooms.map((_, i) => i), drop).map((i) => rooms[i]))
  })

  const addRoom = (name: string) => {
    const n = name.trim().replace(/,$/, '')
    if (n && !rooms.some((r) => r.toLowerCase() === n.toLowerCase())) setRooms([...rooms, n])
    setDraft('')
  }

  return (
    <div className="section">
      <SectionHeader title="Vos envies" />
      <div className="field">
        <span>Pièces concernées</span>
        <div className="tags drop-horizontal">
          {rooms.map((r, i) => (
            <span key={r} className="tag" {...order.item(i)}>
              {r}
              <button type="button" aria-label={`Retirer ${r}`} onClick={() => setRooms(rooms.filter((x) => x !== r))}>
                <Icon name="xmark" size={9} />
              </button>
            </span>
          ))}
          <input
            value={draft}
            placeholder={rooms.length ? '' : 'Entrée, salon, chambre…'}
            onChange={(e) => (e.target.value.endsWith(',') ? addRoom(e.target.value) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addRoom(draft)
              }
            }}
            onBlur={() => draft && addRoom(draft)}
          />
        </div>
      </div>
      <label className="field">
        <span>Texte</span>
        <textarea rows={14} value={shown} onChange={(e) => setText(e.target.value)} />
      </label>
      {text !== null && (
        <button type="button" className="button button-plain section-reset" onClick={() => setText(null)}>
          Revenir au texte modèle
        </button>
      )}
    </div>
  )
}

// --- Textes ---------------------------------------------------------------------------------------

export function TextsSection({ project, settings, reload }: SectionProps) {
  const [intro, setIntro] = useState(project.texts.intro)
  const [closing, setClosing] = useState(project.texts.closing)
  useAutosave({ intro, closing }, (t) =>
    void window.mdeko.projects.update(project.id, { texts: { ...project.texts, ...t } }).then(reload)
  )
  const block = (label: string, value: string | null, fallback: string, set: (v: string | null) => void) => (
    <>
      <label className="field">
        <span>{label}</span>
        <textarea rows={10} value={value ?? fallback} onChange={(e) => set(e.target.value)} />
      </label>
      {value !== null && (
        <button type="button" className="button button-plain section-reset" onClick={() => set(null)}>
          Revenir au texte modèle
        </button>
      )}
    </>
  )
  return (
    <div className="section">
      <SectionHeader title="Textes" />
      {block('Avant-propos', intro, settings.introText, setIntro)}
      {block('C’est à vous !', closing, settings.closingText, setClosing)}
      <p className="section-note">Les textes modèles se changent dans Réglages (⌘,).</p>
    </div>
  )
}

// --- Couleurs -------------------------------------------------------------------------------------

type PaintDraft = { id: number | null; brand: string; name: string; reference: string; hex: string }

export function PaintsSection({ project, reload }: SectionProps) {
  const [paints, setPaints] = useState<Paint[]>([])
  const [editing, setEditing] = useState<PaintDraft | null>(null)
  const [editingBrand, setEditingBrand] = useState<string | null>(null)
  const selected = project.paintIds

  const load = () => void window.mdeko.projects.listPaints().then(setPaints)
  useEffect(load, [])

  const toggle = async (id: number) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    await window.mdeko.projects.setLinks(project.id, 'project_paints', next)
    await reload()
  }

  const order = useSortable('paint', {
    axis: 'horizontal',
    onDrop: (drop) => void window.mdeko.projects.setLinks(project.id, 'project_paints', moved(selected, drop)).then(reload)
  })

  const brands = [...new Set(paints.map((p) => p.brand))]
  const chosen = selected.map((id) => paints.find((p) => p.id === id)).filter((p) => p !== undefined)
  const edit = (p: Paint) => setEditing({ id: p.id, brand: p.brand, name: p.name, reference: p.reference ?? '', hex: p.hex ?? '' })

  const swatch = (p: Paint) => (
    <>
      <span className={`paint-swatch${p.hex ? '' : ' is-empty'}`} style={p.hex ? { background: p.hex } : undefined} />
      <span className="paint-name">{p.name}</span>
      {p.reference && <span className="paint-ref">{p.reference}</span>}
    </>
  )
  const editButton = (p: Paint) => (
    <button type="button" className="paint-edit" aria-label={`Modifier ${p.name}`} onClick={() => edit(p)}>
      <Icon name="pencil" size={11} />
    </button>
  )

  return (
    <div className="section">
      <SectionHeader title="Teintes et couleurs">
        <button
          type="button"
          className="button"
          onClick={() => setEditing({ id: null, brand: brands[0] ?? DEFAULT_PAINT_BRAND, name: '', reference: '', hex: '' })}
        >
          <Icon name="plus" size={14} />
          Nouvelle teinte
        </button>
      </SectionHeader>
      {editing && (
        <PaintForm
          key={editing.id ?? 'nouvelle'}
          initial={editing}
          brands={brands}
          onDone={async (id) => {
            const isNew = editing.id === null
            setEditing(null)
            load()
            if (id !== null && isNew) await toggle(id)
            else await reload()
          }}
        />
      )}
      {chosen.length > 0 && (
        <div className="paint-group">
          <h3>Dans ce design book</h3>
          <p className="section-note">Faites glisser une teinte pour changer l’ordre du nuancier.</p>
          <div className="paint-grid drop-horizontal">
            {chosen.map((p) => (
              <div key={p.id} className="paint is-selected" {...order.item(p.id)}>
                {swatch(p)}
                {editButton(p)}
                <button type="button" className="paint-remove" aria-label={`Retirer ${p.name}`} onClick={() => void toggle(p.id)}>
                  <Icon name="xmark" size={9} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {brands.map((brand) => (
        <div key={brand} className="paint-group">
          <div className="paint-group-head">
            <h3>{brand}</h3>
            <button type="button" className="button button-plain" onClick={() => setEditingBrand(brand)}>
              Modifier la marque
            </button>
          </div>
          {editingBrand === brand && (
            <BrandForm
              name={brand}
              promoCode={paints.find((p) => p.brand === brand)?.promoCode ?? null}
              onDone={async () => {
                setEditingBrand(null)
                load()
                await reload()
              }}
            />
          )}
          <div className="paint-grid">
            {paints
              .filter((p) => p.brand === brand)
              .map((p) => (
                <div key={p.id} className={`paint${selected.includes(p.id) ? ' is-selected' : ''}`}>
                  <button type="button" className="paint-toggle" aria-pressed={selected.includes(p.id)} onClick={() => void toggle(p.id)}>
                    {swatch(p)}
                  </button>
                  {editButton(p)}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Teintes proposées pour aller vite ; « Autre couleur… » ouvre le sélecteur de couleurs du Mac.
const PALETTE = [
  '#FFFFFF', '#F4F1EA', '#EDE6D8', '#E3D9C6', '#D6C9B1', '#BFB6A3', '#A39A88', '#7D7466',
  '#E9E9E6', '#D3D3CF', '#B2B3AF', '#8C8E8B', '#5F6264', '#3C4043', '#2B3840', '#1E1F21',
  '#E8D3C0', '#D9A98A', '#C27C5A', '#A35A3E', '#E6D9A8', '#C9A74B', '#9C8A4E', '#6E6A3A',
  '#D5DDCF', '#AEBBA3', '#7F9178', '#4E6450', '#CFDCE3', '#9DB4C0', '#5E7D8E', '#2F4A5C',
  '#E9D6D8', '#CFA9AE', '#A4737C', '#5E4553'
]

function PaintForm({ initial, brands, onDone }: { initial: PaintDraft; brands: string[]; onDone(id: number | null): void }) {
  const [paint, setPaint] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const hex = /^#?[0-9a-f]{6}$/i.test(paint.hex.trim()) ? `#${paint.hex.trim().replace(/^#/, '')}`.toUpperCase() : null
  const invalid = paint.hex.trim() !== '' && !hex && !/^#?[0-9a-f]{3}$/i.test(paint.hex.trim())

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!paint.name.trim() || invalid) return
    const data = { brand: paint.brand, name: paint.name, reference: paint.reference || null, hex: paint.hex || null }
    try {
      if (paint.id === null) onDone(await window.mdeko.projects.createPaint(data))
      else {
        await window.mdeko.projects.updatePaint(paint.id, data)
        onDone(paint.id)
      }
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const remove = async () => {
    if (paint.id === null) return
    const used = await window.mdeko.projects.countPaintProjects(paint.id)
    const ok = await window.mdeko.confirm(
      `Supprimer la teinte « ${initial.name} » ?`,
      used > 0
        ? `Elle sera aussi retirée ${used === 1 ? 'du projet qui l’utilise' : `des ${used} projets qui l’utilisent`}.`
        : 'Elle ne sera plus proposée dans vos projets.',
      'Supprimer la teinte'
    )
    if (!ok) return
    await window.mdeko.projects.deletePaint(paint.id)
    onDone(null)
  }

  return (
    <form className="inline-form paint-form" onSubmit={submit}>
      <label className="field">
        <span>Marque ou magasin</span>
        <input list="mdeko-paint-brands" value={paint.brand} onChange={(e) => setPaint({ ...paint, brand: e.target.value })} />
        <datalist id="mdeko-paint-brands">
          {brands.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Nom</span>
        <input autoFocus value={paint.name} onChange={(e) => setPaint({ ...paint, name: e.target.value })} />
      </label>
      <label className="field">
        <span>Référence</span>
        <input value={paint.reference} onChange={(e) => setPaint({ ...paint, reference: e.target.value })} />
      </label>
      <label className="field">
        <span>Code couleur</span>
        <span className="paint-code">
          <span className={`paint-code-swatch${hex ? '' : ' is-empty'}`} style={hex ? { background: hex } : undefined} />
          <input
            value={paint.hex}
            placeholder="#E8E2D6"
            spellCheck={false}
            aria-invalid={invalid}
            onChange={(e) => setPaint({ ...paint, hex: e.target.value })}
          />
        </span>
        {invalid && <span className="field-error">Un code couleur s’écrit avec 6 chiffres ou lettres, par exemple #E8E2D6.</span>}
      </label>
      <div className="paint-palette">
        <span>Ou choisissez dans la palette</span>
        <div className="paint-palette-grid">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`paint-palette-color${hex === c ? ' is-selected' : ''}`}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={hex === c}
              onClick={() => setPaint({ ...paint, hex: c })}
            />
          ))}
          <label className="button button-plain paint-palette-other">
            Autre couleur…
            <input type="color" value={hex ?? '#E8E2D6'} onChange={(e) => setPaint({ ...paint, hex: e.target.value.toUpperCase() })} />
          </label>
        </div>
      </div>
      {error && <p className="field-error inline-form-wide">{error}</p>}
      <div className="inline-form-actions">
        {paint.id !== null && (
          <button type="button" className="button button-danger inline-form-left" onClick={() => void remove()}>
            Supprimer la teinte
          </button>
        )}
        <button type="button" className="button" onClick={() => onDone(null)}>
          Annuler
        </button>
        <button type="submit" className="button button-primary" disabled={!paint.name.trim() || invalid}>
          {paint.id === null ? 'Ajouter' : 'Enregistrer'}
        </button>
      </div>
    </form>
  )
}

// Nom de la marque et code promo, communs à toutes ses teintes.
function BrandForm({ name, promoCode, onDone }: { name: string; promoCode: string | null; onDone(): void }) {
  const [form, setForm] = useState({ name, promoCode: promoCode ?? '' })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    await window.mdeko.projects.updatePaintBrand(name, { name: form.name, promoCode: form.promoCode || null })
    onDone()
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="field">
        <span>Nom de la marque ou du magasin</span>
        <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="field">
        <span>Code promo (facultatif)</span>
        <input value={form.promoCode} onChange={(e) => setForm({ ...form, promoCode: e.target.value })} />
      </label>
      <div className="inline-form-actions">
        <button type="button" className="button" onClick={onDone}>
          Annuler
        </button>
        <button type="submit" className="button button-primary" disabled={!form.name.trim()}>
          Enregistrer
        </button>
      </div>
    </form>
  )
}

// --- Artisans -------------------------------------------------------------------------------------

export type ArtisanDraft = Omit<Artisan, 'id'> & { id: number | null }
export const NEW_ARTISAN: ArtisanDraft = { id: null, trade: '', name: '', city: '', phone: '', email: '' }

// Fiche d'un artisan du carnet (nouveau ou à modifier) ; onDone reçoit son identifiant une fois enregistré.
export function ArtisanForm({ initial, onDone }: { initial: ArtisanDraft; onDone(id: number | null): void }) {
  const [editing, setEditing] = useState(initial)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing.trade.trim() || !editing.name.trim()) return
    onDone(await window.mdeko.projects.saveArtisan(editing))
  }
  return (
    <form className="inline-form" onSubmit={save}>
      {(['trade', 'name', 'city', 'phone', 'email'] as const).map((k) => (
        <label key={k} className="field">
          <span>{{ trade: 'Métier', name: 'Nom', city: 'Ville', phone: 'Téléphone', email: 'E-mail' }[k]}</span>
          <input autoFocus={k === 'trade'} value={editing[k] ?? ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
        </label>
      ))}
      <div className="inline-form-actions">
        <button type="button" className="button" onClick={() => onDone(null)}>
          Annuler
        </button>
        <button type="submit" className="button button-primary" disabled={!editing.trade.trim() || !editing.name.trim()}>
          Enregistrer
        </button>
      </div>
    </form>
  )
}

export function ArtisansSection({ project, reload }: SectionProps) {
  const [artisans, setArtisans] = useState<Artisan[]>([])
  const [editing, setEditing] = useState<ArtisanDraft | null>(null)
  const selected = project.artisanIds
  const load = () => void window.mdeko.projects.listArtisans().then(setArtisans)
  useEffect(load, [])

  const toggle = async (id: number) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    await window.mdeko.projects.setLinks(project.id, 'project_artisans', next)
    await reload()
  }

  const order = useSortable('artisan', {
    onDrop: (drop) => void window.mdeko.projects.setLinks(project.id, 'project_artisans', moved(selected, drop)).then(reload)
  })
  const chosen = selected.map((id) => artisans.find((a) => a.id === id)).filter((a) => a !== undefined)

  const done = async (id: number | null) => {
    const isNew = editing?.id === null
    setEditing(null)
    load()
    if (id !== null && isNew) await toggle(id)
  }

  return (
    <div className="section">
      <SectionHeader title="Artisans">
        <button
          type="button"
          className="button"
          onClick={() => setEditing(NEW_ARTISAN)}
        >
          <Icon name="plus" size={14} />
          Nouvel artisan
        </button>
      </SectionHeader>
      {editing && <ArtisanForm key={editing.id ?? 'nouveau'} initial={editing} onDone={(id) => void done(id)} />}
      {chosen.length > 0 && (
        <>
          <h3 className="section-subtitle">Dans ce design book</h3>
          {chosen.length > 1 && <p className="section-note">Faites glisser un artisan pour changer l’ordre.</p>}
          <ul className="artisan-list">
            {chosen.map((a) => (
              <li key={a.id} {...order.item(a.id)}>
                <span className="grip">
                  <Icon name="grip" size={14} />
                </span>
                <span className="artisan-name">
                  <strong>{a.trade}</strong> · {a.name}
                  {a.city ? ` (${a.city})` : ''}
                </span>
                <button type="button" className="button button-plain" onClick={() => void toggle(a.id)}>
                  Retirer
                </button>
              </li>
            ))}
          </ul>
          <h3 className="section-subtitle">Votre carnet</h3>
        </>
      )}
      <ul className="artisan-list">
        {artisans.map((a) => (
          <li key={a.id}>
            <label className="filter-check">
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => void toggle(a.id)} />
              <span>
                <strong>{a.trade}</strong> · {a.name}
                {a.city ? ` (${a.city})` : ''}
              </span>
              <span className="filter-count">{a.phone}</span>
            </label>
            <button type="button" className="button button-plain" onClick={() => setEditing({ ...a })}>
              Modifier
            </button>
          </li>
        ))}
      </ul>
      {!artisans.length && !editing && <p className="section-note">Ajoutez les artisans que vous recommandez : ils resteront dans votre carnet.</p>}
    </div>
  )
}
