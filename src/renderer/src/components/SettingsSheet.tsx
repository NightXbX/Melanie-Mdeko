import { useEffect, useState, type FormEvent } from 'react'
import type { AiStatus } from '@shared/api'
import type { DesignerSettings } from '@shared/projects'
import { useApp } from '../app-context'
import { uploadDrop } from '../lib/images'
import { dollars } from './project/AiSheet'

// Réglages : coordonnées de Mélanie (4e de couverture) et textes modèles des design books.
export function SettingsSheet({ onClose }: { onClose(): void }) {
  const { notify, refresh } = useApp()
  const [s, setS] = useState<DesignerSettings | null>(null)
  const [qrImageId, setQrImageId] = useState<number | undefined>()
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [cap, setCap] = useState('')
  const [key, setKey] = useState('')
  const [catalog, setCatalog] = useState<{ id: string; name: string }[]>([])

  const loadAi = async () => {
    const status = await window.mdeko.ai.status()
    setAi(status)
    setModels([status.settings.models[0] ?? '', status.settings.models[1] ?? ''])
    setCap(String(status.settings.capCents / 100))
    // Liste des moteurs d'images proposés par OpenRouter (quand la clé est là).
    if (status.hasKey) void window.mdeko.ai.listModels().then(setCatalog, () => setCatalog([]))
  }

  useEffect(() => {
    void window.mdeko.projects.getSettings().then(setS)
    void loadAi()
  }, [])

  if (!s) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const { reviewQrUrl: _qr, ...rest } = s
    await window.mdeko.projects.saveSettings({ ...rest, reviewQrImageId: qrImageId })
    const capCents = Math.round(Number(cap.replace(',', '.')) * 100)
    await window.mdeko.ai.saveSettings({ models, ...(capCents > 0 ? { capCents } : {}) })
    if (key.trim()) {
      try {
        await window.mdeko.ai.setKey(key)
      } catch (err) {
        notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
        return
      }
    }
    refresh()
    notify('Réglages enregistrés')
    onClose()
  }

  const input = (key: 'designerName' | 'address' | 'phone' | 'email', label: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
    </label>
  )
  const area = (key: 'introText' | 'wishesText' | 'closingText' | 'mailBody', label: string) => (
    <label className="field">
      <span>{label}</span>
      <textarea rows={6} value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
    </label>
  )

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet sheet-large settings" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="sheet-head">
          <h2>Réglages</h2>
          <div className="detail-actions">
            <button type="button" className="button" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="button button-primary">
              Enregistrer
            </button>
          </div>
        </div>
        <div className="settings-body">
          <h3>Mes coordonnées</h3>
          <div className="field-row">
            {input('designerName', 'Nom')}
            {input('phone', 'Téléphone')}
          </div>
          <div className="field-row">
            {input('address', 'Adresse')}
            {input('email', 'E-mail')}
          </div>
          <div className="field">
            <span>QR code « Laisser un avis »</span>
            <div className="settings-qr">
              {s.reviewQrUrl && <img src={s.reviewQrUrl} alt="" />}
              <label className="button">
                Choisir une image…
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const [img] = await uploadDrop({ files: [file], url: null })
                    if (img) {
                      setQrImageId(img.id)
                      setS({ ...s, reviewQrUrl: img.url })
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <h3>Assistant de retouche (IA)</h3>
          {ai && (
            <>
              <label className="field">
                <span>
                  Clé OpenRouter {ai.hasKey ? '— enregistrée dans le Trousseau' : ''}
                  {!ai.canStoreKey ? ' — le Trousseau n’est pas disponible sur cet ordinateur' : ''}
                </span>
                <div className="settings-key">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={ai.hasKey ? '•••••••••••• (laisser vide pour la garder)' : 'sk-or-…'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                  {ai.hasKey && (
                    <button
                      type="button"
                      className="button button-plain button-danger"
                      onClick={async () => {
                        const ok = await window.mdeko.confirm('Retirer la clé OpenRouter ?', 'L’assistant ne pourra plus retoucher les rendus tant qu’une clé n’est pas ajoutée.', 'Retirer la clé')
                        if (!ok) return
                        await window.mdeko.ai.setKey(null)
                        await loadAi()
                      }}
                    >
                      Retirer
                    </button>
                  )}
                </div>
              </label>
              <div className="field-row">
                {[0, 1].map((i) => (
                  <label key={i} className="field">
                    <span>{i === 0 ? 'Moteur 1' : 'Moteur 2 (vide : un seul moteur, sans duel)'}</span>
                    <input
                      list="mdeko-ai-models"
                      value={models[i] ?? ''}
                      onChange={(e) => setModels(models.map((m, j) => (j === i ? e.target.value : m)))}
                    />
                  </label>
                ))}
              </div>
              <datalist id="mdeko-ai-models">
                {catalog.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
              <div className="field-row">
                <label className="field">
                  <span>Plafond par mois, en dollars</span>
                  <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
                </label>
                <div className="field">
                  <span>Dépensé ce mois-ci</span>
                  <p className="settings-value">{dollars(ai.spentCents)}</p>
                </div>
              </div>
              {ai.score.length > 0 && (
                <div className="field">
                  <span>Duel : propositions gardées</span>
                  <p className="settings-value">
                    {ai.score.map((m) => `${m.model} : ${m.kept} sur ${m.proposed}`).join(' · ')}
                  </p>
                </div>
              )}
            </>
          )}

          <h3>Textes modèles des design books</h3>
          {area('introText', 'Avant-propos')}
          {area('wishesText', 'Vos envies — « {pieces} » est remplacé par les pièces du projet')}
          {area('closingText', 'C’est à vous !')}

          <h3>Mail type pour envoyer le design book</h3>
          <p className="section-note">
            « {'{client}'} » est remplacé par le nom du client, « {'{mois}'} » par le mois du design book, « {'{signature}'} » par votre nom.
          </p>
          <label className="field">
            <span>Objet</span>
            <input value={s.mailSubject} onChange={(e) => setS({ ...s, mailSubject: e.target.value })} />
          </label>
          {area('mailBody', 'Message')}
        </div>
      </form>
    </div>
  )
}
