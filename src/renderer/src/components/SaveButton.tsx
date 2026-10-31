import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../app-context'
import { flushEdits } from '../lib/autosave'

// Demande à la fiche article ouverte de s'enregistrer (⌘S ou bouton « Enregistrer »).
export const SAVE_EVENT = 'mdeko:save'

const time = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')

function savedLabel(at: Date | null, now: Date): string {
  if (!at) return 'Enregistrement automatique'
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000)
  if (minutes < 1) return 'Enregistré à l’instant'
  if (minutes < 60) return `Enregistré il y a ${minutes} min`
  const sameDay = at.toDateString() === now.toDateString()
  return sameDay ? `Enregistré à ${time(at)}` : `Enregistré le ${at.toLocaleDateString('fr-FR')} à ${time(at)}`
}

// Tout s'enregistre déjà tout seul, et une copie de sécurité est faite chaque minute après une modification.
// Ce bouton rassure : il termine la saisie en cours, fait une copie tout de suite et dit quand c'était.
export function SaveButton() {
  const { notify } = useApp()
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.mdeko.getAppInfo().then((info) => info.lastBackupAt && setSavedAt(new Date(info.lastBackupAt)))
    const off = window.mdeko.onBackupDone((at) => setSavedAt(new Date(at)))
    const t = setInterval(() => setNow(new Date()), 20000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      window.dispatchEvent(new Event(SAVE_EVENT))
      await flushEdits()
      await window.mdeko.backupNow()
      const at = new Date()
      setSavedAt(at)
      setNow(at)
      notify(`Tout est enregistré (${time(at)})`)
    } catch {
      notify('La copie de sécurité n’a pas pu être faite. Vos modifications restent enregistrées.')
    } finally {
      setSaving(false)
    }
  }, [saving, notify])

  // Fichier › Enregistrer (⌘S).
  useEffect(() => window.mdeko.onMenu((command) => command === 'save' && void save()), [save])

  return (
    <div className="save-box">
      <button type="button" className="button save-button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      <span className="save-status">{savedLabel(savedAt, now)}</span>
    </div>
  )
}
