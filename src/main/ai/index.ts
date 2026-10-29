import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ipcMain, nativeImage, net, safeStorage } from 'electron'
import { AI_METHODS, IPC, type AiApi, type AiProposal } from '@shared/api'
import { uploadImage } from '../article-edit'
import type { DataPaths } from '../paths'
import instructions from './instructions-v1.txt?raw'
import { listImageModels, openRouterProvider, type Fetch } from './openrouter'
import {
  addProposal,
  currentImage,
  duelScore,
  estimateCents,
  getAiSettings,
  keepVersion,
  monthSpentCents,
  renderHistory,
  saveAiSettings,
  showVersion
} from './versions'

const KEY_SETTING = 'openrouter_key' // chiffrée par le Trousseau (Mac) ou le coffre de Windows
const RENDER_WIDTH = 2048 // le rendu 4K est envoyé en 2K : assez pour le moteur, et l'envoi reste léger
const REFERENCE_WIDTH = 1024
const TIMEOUT = 4 * 60 * 1000

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

const fetchJson: Fetch = async (url, init) => {
  const res = await net.fetch(url, init)
  return { ok: res.ok, status: res.status, json: () => res.json() }
}

// Implémentation côté processus principal de window.mdeko.ai.
export function registerAiIpc(db: DatabaseSync, paths: DataPaths): void {
  let running: AbortController | null = null

  const getKey = (): string | null => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_SETTING) as { value: string | null } | undefined
    if (!row?.value || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(row.value, 'base64'))
    } catch {
      return null
    }
  }
  const requireKey = () => {
    const key = getKey()
    if (!key) throw new Error('Ajoutez d’abord la clé OpenRouter dans les Réglages (⌘,).')
    return key
  }

  // Image de la base en JPEG, réduite, prête à être envoyée.
  const dataUrl = (imageId: number, width: number): string => {
    const row = db.prepare('SELECT rel_path FROM images WHERE id = ?').get(imageId) as { rel_path: string } | undefined
    if (!row) throw new Error('Image introuvable.')
    let img = nativeImage.createFromPath(join(paths.root, row.rel_path))
    if (img.isEmpty()) throw new Error('Cette image ne peut pas être lue.')
    if (img.getSize().width > width) img = img.resize({ width, quality: 'best' })
    return `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`
  }

  // Image reçue : enregistrée comme les autres photos (fichier, miniature, une seule copie par contenu).
  const store = (bytes: Uint8Array, mimeType: string) => {
    const img = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (img.isEmpty()) throw new Error('L’image reçue est illisible.')
    const { width, height } = img.getSize()
    return uploadImage(db, paths.root, {
      bytes,
      ext: EXTENSIONS[mimeType] ?? 'png',
      width,
      height,
      thumbnail: new Uint8Array(img.resize({ width: 360, quality: 'best' }).toJPEG(85))
    })
  }

  const api: AiApi = {
    status: async () => {
      const settings = getAiSettings(db)
      return {
        hasKey: getKey() !== null,
        canStoreKey: safeStorage.isEncryptionAvailable(),
        settings,
        spentCents: monthSpentCents(db),
        estimateCents: settings.models.reduce((sum, m) => sum + estimateCents(db, m), 0),
        score: duelScore(db)
      }
    },
    setKey: async (key) => {
      if (key === null || !key.trim()) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(KEY_SETTING)
        return
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Le Trousseau n’est pas disponible : la clé ne peut pas être enregistrée.')
      const value = safeStorage.encryptString(key.trim()).toString('base64')
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY_SETTING, value)
    },
    saveSettings: async (settings) => saveAiSettings(db, settings),
    listModels: async () => listImageModels(requireKey(), fetchJson),

    // Une demande = une proposition par moteur, en même temps ; l'ordre est tiré au sort (duel à l'aveugle).
    edit: async (renderId, prompt, referenceImageIds) => {
      if (running) throw new Error('Une retouche est déjà en cours.')
      const text = prompt.trim()
      if (!text) throw new Error('Écrivez ce que vous voulez changer.')
      const key = requireKey()
      const { models, capCents } = getAiSettings(db)
      const estimate = models.reduce((sum, m) => sum + estimateCents(db, m), 0)
      if (monthSpentCents(db) + estimate > capCents) {
        throw new Error(`Le plafond de ${(capCents / 100).toLocaleString('fr-FR')} $ de ce mois est atteint. Il peut être relevé dans les Réglages.`)
      }
      const source = currentImage(db, renderId)
      const images = [dataUrl(source.imageId, RENDER_WIDTH), ...referenceImageIds.map((id) => dataUrl(id, REFERENCE_WIDTH))]
      const full = `${instructions}\nRequest from the interior designer (in French):\n${text}`
      const provider = openRouterProvider(key, fetchJson)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT)
      running = controller
      try {
        const results = await Promise.all(
          models.map(async (model): Promise<AiProposal> => {
            try {
              const out = await provider.edit({ model, prompt: full, images }, controller.signal)
              const image = store(out.bytes, out.mimeType)
              const versionId = addProposal(db, { renderId, parentId: source.versionId, imageId: image.id, prompt: text, model, costCents: out.costCents })
              return { versionId, imageUrl: image.url, costCents: out.costCents, error: null }
            } catch (e) {
              const error = controller.signal.aborted ? 'La retouche a été arrêtée ou a pris trop de temps.' : (e as Error).message
              return { versionId: null, imageUrl: null, costCents: 0, error }
            }
          })
        )
        return results.sort(() => Math.random() - 0.5)
      } finally {
        clearTimeout(timer)
        running = null
      }
    },
    cancel: async () => running?.abort(),
    keep: async (versionId) => keepVersion(db, versionId),
    history: async (renderId) => renderHistory(db, renderId),
    show: async (renderId, versionId) => showVersion(db, renderId, versionId)
  }

  ipcMain.handle(IPC.ai, (_e, method: string, ...args: unknown[]) => {
    if (!(AI_METHODS as readonly string[]).includes(method)) throw new Error(`Méthode inconnue : ${method}`)
    return (api[method as keyof AiApi] as (...a: unknown[]) => unknown)(...args)
  })
}
