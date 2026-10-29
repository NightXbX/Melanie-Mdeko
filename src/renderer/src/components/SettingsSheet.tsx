import { useEffect, useState, type FormEvent } from 'react'
import type { DesignerSettings } from '@shared/projects'
import { useApp } from '../app-context'
import { uploadDrop } from '../lib/images'

// Réglages : coordonnées de Mélanie (4e de couverture) et textes modèles des design books.
export function SettingsSheet({ onClose }: { onClose(): void }) {
  const { notify, refresh } = useApp()
  const [s, setS] = useState<DesignerSettings | null>(null)
  const [qrImageId, setQrImageId] = useState<number | undefined>()

  useEffect(() => {
    void window.mdeko.projects.getSettings().then(setS)
  }, [])

  if (!s) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const { reviewQrUrl: _qr, ...rest } = s
    await window.mdeko.projects.saveSettings({ ...rest, reviewQrImageId: qrImageId })
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
  const area = (key: 'introText' | 'wishesText' | 'closingText', label: string) => (
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

          <h3>Textes modèles des design books</h3>
          {area('introText', 'Avant-propos')}
          {area('wishesText', 'Vos envies — « {pieces} » est remplacé par les pièces du projet')}
          {area('closingText', 'C’est à vous !')}
        </div>
      </form>
    </div>
  )
}
