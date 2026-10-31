import { useEffect, useState } from 'react'
import { fillMail, type BookFormat } from '@shared/projects'
import { useApp } from '../../app-context'
import type { SectionProps } from './ProjectEditor'
import { SectionHeader } from './sections'

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function monthOf(bookDate: string | null): string {
  const [y, m] = (bookDate ?? new Date().toISOString().slice(0, 7)).split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

// Envoi du design book au client : le mail type (Réglages) rempli pour ce projet, modifiable, puis préparé
// dans Mail avec le book en pièce jointe. Mélanie relit et clique sur « Envoyer » dans Mail.
export function SendSection({ project, settings, reload }: SectionProps) {
  const { notify } = useApp()
  const client = [project.clientTitle, project.clientName].filter(Boolean).join(' ')
  const values = { client, mois: monthOf(project.bookDate), signature: settings.designerName }
  const [to, setTo] = useState(project.email)
  const [subject, setSubject] = useState(() => fillMail(settings.mailSubject, values))
  const [body, setBody] = useState(() => fillMail(settings.mailBody, values))
  const [formats, setFormats] = useState<BookFormat[]>(['pdf'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setTo(project.email), [project.email])

  const resetText = () => {
    setSubject(fillMail(settings.mailSubject, values))
    setBody(fillMail(settings.mailBody, values))
  }
  const toggle = (f: BookFormat, on: boolean) => setFormats((all) => (on ? [...all.filter((x) => x !== f), f] : all.filter((x) => x !== f)))

  const send = async () => {
    setError(null)
    setBusy(true)
    try {
      const result = await window.mdeko.projects.prepareMail(project.id, { to, subject, body, formats })
      await reload()
      notify(result.inMail ? 'Le mail est prêt dans Mail : relisez-le puis cliquez sur « Envoyer ».' : 'Le mail est ouvert : ajoutez le design book (dossier affiché) en pièce jointe.')
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  const mailed = project.mailedAt ? new Date(project.mailedAt) : null

  return (
    <div className="section">
      <SectionHeader title="Envoyer au client" />
      {mailed && (
        <p className="section-note">
          Dernier mail préparé le {mailed.toLocaleDateString('fr-FR')} à {mailed.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')}.
        </p>
      )}

      <div className="send-form">
        <label className="field">
          <span>À</span>
          <input type="email" multiple value={to} placeholder="adresse@exemple.fr" onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="field">
          <span>Objet</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <button type="button" className="button button-plain send-reset" onClick={resetText}>
          Revenir au mail type
        </button>

        <div className="send-attachments">
          <span className="send-label">Pièces jointes</span>
          <label className="filter-check">
            <input type="checkbox" checked={formats.includes('pdf')} onChange={(e) => toggle('pdf', e.target.checked)} />
            <span>Le design book en PDF</span>
          </label>
          <label className="filter-check">
            <input type="checkbox" checked={formats.includes('pptx')} onChange={(e) => toggle('pptx', e.target.checked)} />
            <span>Le design book en PowerPoint</span>
          </label>
          <p className="section-note">
            Le book est créé maintenant, avec les dernières modifications, et rangé dans le dossier du projet. S’il est trop lourd pour un mail, Mail propose de l’envoyer avec Mail Drop (un lien iCloud valable 30 jours).
          </p>
        </div>

        {error && <p className="editor-error">{error}</p>}
        <button type="button" className="button button-primary button-large" disabled={busy || !subject.trim()} onClick={() => void send()}>
          {busy ? 'Création du design book…' : 'Préparer le mail dans Mail'}
        </button>
      </div>
    </div>
  )
}
