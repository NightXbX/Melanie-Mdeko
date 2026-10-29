import { useEffect, useState } from 'react'
import type { UpdateInfo } from '@shared/api'
import { useApp } from '../app-context'

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Bas de la barre latérale : numéro de version (à joindre à chaque retour) et nouvelle version à installer.
export function UpdateBar() {
  const { notify } = useApp()
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    void window.mdeko.getAppInfo().then((i) => setVersion(i.version))
    const offAvailable = window.mdeko.onUpdateAvailable(setUpdate)
    const offProgress = window.mdeko.onUpdateProgress((done, total) => setProgress(Math.round((done / Math.max(total, 1)) * 100)))
    // Menu « Rechercher une mise à jour… ».
    const offMenu = window.mdeko.onMenu(async (command) => {
      if (command !== 'check-update') return
      try {
        const found = await window.mdeko.checkUpdate()
        if (found) setUpdate(found)
        else notify('Mdeko est à jour.')
      } catch (e) {
        notify(cleanError(e))
      }
    })
    return () => {
      offAvailable()
      offProgress()
      offMenu()
    }
  }, [notify])

  const install = async () => {
    if (!update) return
    const ok = await window.mdeko.confirm(
      `Installer la version ${update.version} ?`,
      'Mdeko va télécharger la nouvelle version, se fermer quelques secondes puis se rouvrir. Vos données sont sauvegardées avant.',
      'Installer'
    )
    if (!ok) return
    setProgress(0)
    try {
      await window.mdeko.installUpdate()
    } catch (e) {
      setProgress(null)
      notify(cleanError(e))
    }
  }

  return (
    <div className="update-bar">
      {update && (
        <div className="update-card">
          <strong>Nouvelle version {update.version}</strong>
          {progress === null ? (
            <button type="button" className="button button-primary" onClick={() => void install()}>
              Installer
            </button>
          ) : (
            <>
              <progress value={progress} max={100} />
              <span>{progress < 100 ? `Téléchargement… ${progress} %` : 'Installation…'}</span>
            </>
          )}
        </div>
      )}
      {version && <span className="update-version">Version {version}</span>}
    </div>
  )
}
