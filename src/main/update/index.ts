import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, ipcMain, net } from 'electron'
import { IPC, type UpdateInfo } from '@shared/api'
import { createBackup } from '../backup'
import type { DataPaths } from '../paths'
import { availableUpdate, LATEST_RELEASE, macSwapScript, type Release } from './release'

const HOUR = 60 * 60 * 1000
const run = promisify(execFile)

const info = (r: Release): UpdateInfo => ({ version: r.version, notes: r.notes, sizeBytes: r.asset.size })

// Mise à jour intégrée : l'appli regarde la dernière Release GitHub, la télécharge elle-même
// (elle n'est donc pas mise en quarantaine sur Mac), fait une sauvegarde, s'installe et se relance.
export function registerUpdates(db: DatabaseSync, paths: DataPaths): void {
  let latest: Release | null = null
  let installing = false

  const check = async (): Promise<UpdateInfo | null> => {
    if (!app.isPackaged) return null // en développement, on lance le code directement
    const res = await net.fetch(LATEST_RELEASE, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Mdeko' } })
    if (res.status === 404) return null // aucune version publiée pour l'instant
    if (!res.ok) throw new Error('Impossible de vérifier les mises à jour pour l’instant (pas de connexion ?).')
    latest = availableUpdate(await res.json(), app.getVersion(), process.platform)
    return latest && info(latest)
  }

  // Vérification discrète au démarrage puis toutes les 6 heures ; l'interface affiche un bandeau.
  const notify = async () => {
    try {
      const found = await check()
      if (found) for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.updateAvailable, found)
    } catch {
      // pas de connexion : on réessaiera plus tard
    }
  }
  setTimeout(() => void notify(), 15_000)
  setInterval(() => void notify(), 6 * HOUR)

  ipcMain.handle(IPC.checkUpdate, () => check())

  ipcMain.handle(IPC.installUpdate, async (e) => {
    if (installing) return
    const release = latest ?? (await check(), latest)
    if (!release) throw new Error('Mdeko est déjà à jour.')

    // Sur Mac, l'appli doit être dans Applications pour pouvoir se remplacer.
    const appPath = resolve(process.execPath, '../../..')
    if (process.platform === 'darwin') {
      if (!appPath.endsWith('.app') || appPath.includes('/AppTranslocation/') || appPath.startsWith('/Volumes/')) {
        throw new Error('Glissez d’abord Mdeko dans le dossier Applications, puis relancez-la.')
      }
      try {
        accessSync(dirname(appPath), constants.W_OK)
      } catch {
        throw new Error('Mdeko n’a pas le droit de se remplacer dans Applications.')
      }
    }

    installing = true
    try {
      const dir = join(app.getPath('temp'), `mdeko-mise-a-jour-${release.version}`)
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      const file = join(dir, release.asset.name)
      await download(release, file, (done) => !e.sender.isDestroyed() && e.sender.send(IPC.updateProgress, done, release.asset.size))

      // Les données ne sont jamais en danger : une copie de la base avant d'installer.
      createBackup(db, paths.backups, 'avant-mise-a-jour')

      if (process.platform === 'darwin') {
        await run('/usr/bin/ditto', ['-x', '-k', file, dir])
        const bundle = readdirSync(dir).find((n) => n.endsWith('.app'))
        if (!bundle) throw new Error('La mise à jour téléchargée est incomplète.')
        const script = join(dir, 'remplacer.sh')
        writeFileSync(script, macSwapScript(process.pid, appPath, join(dir, bundle)))
        spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref()
      } else {
        // Installateur Windows en silence ; il relance Mdeko à la fin.
        spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
      }
      setTimeout(() => app.quit(), 300)
    } catch (error) {
      installing = false
      throw error
    }
  })
}

// Téléchargement avec progression, puis contrôle de la taille et de l'empreinte annoncées par GitHub.
async function download(release: Release, file: string, onProgress: (done: number) => void): Promise<void> {
  const res = await net.fetch(release.asset.url, { headers: { 'User-Agent': 'Mdeko' } })
  if (!res.ok || !res.body) throw new Error('Le téléchargement de la mise à jour a échoué.')
  const hash = createHash('sha256')
  const out = createWriteStream(file)
  const reader = res.body.getReader()
  let done = 0
  let last = 0
  try {
    for (;;) {
      const { value, done: finished } = await reader.read()
      if (finished) break
      hash.update(value)
      done += value.byteLength
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      if (done - last > 1_000_000) {
        last = done
        onProgress(done)
      }
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
  onProgress(done)
  if (done !== release.asset.size || (release.asset.sha256 && hash.digest('hex') !== release.asset.sha256)) {
    throw new Error('La mise à jour téléchargée est abîmée : réessayez.')
  }
}
