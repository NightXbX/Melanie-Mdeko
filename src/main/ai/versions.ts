import type { DatabaseSync } from 'node:sqlite'
import type { AiSettings, AiVersion } from '@shared/api'
import { mediaUrl } from '../media-urls'

// Versions retouchées des rendus (render_versions) : chaque proposition est gardée avec son moteur, sa demande
// et son coût ; celle que Mélanie garde devient l'image du rendu dans le book, l'original reste toujours disponible.

// Duel de la première semaine : Nano Banana 2 contre GPT Image 2. Modifiable dans les Réglages.
export const DEFAULT_MODELS = ['google/gemini-3.1-flash-image', 'openai/gpt-image-2']
export const DEFAULT_CAP_CENTS = 1000 // 10 $ par mois
// Modèles de l'assistant (OpenRouter) : modifiables dans les Réglages, les identifiants changent souvent.
export const DEFAULT_CHAT_MODEL = 'openai/gpt-5.4'
// Vérification des prix : un modèle économique suffit (réglage caché « ai_check_model »).
export const DEFAULT_CHECK_MODEL = 'openai/gpt-5.4-mini'
export const DEFAULT_AUDIO_MODEL = 'google/gemini-2.5-flash'
const DEFAULT_ESTIMATE_CENTS = 10 // coût supposé d'une image tant qu'on n'a rien mesuré

const setting = (db: DatabaseSync, key: string) =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string | null } | undefined)?.value ?? null
const setSetting = (db: DatabaseSync, key: string, value: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)

export function getAiSettings(db: DatabaseSync): AiSettings {
  let models = DEFAULT_MODELS
  try {
    const saved = JSON.parse(setting(db, 'ai_models') ?? 'null') as unknown
    if (Array.isArray(saved) && saved.every((m) => typeof m === 'string') && saved.length) models = saved
  } catch {
    // réglage illisible : moteurs par défaut
  }
  const cap = Number(setting(db, 'ai_monthly_cap_cents'))
  return {
    models,
    capCents: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_CAP_CENTS,
    chatModel: setting(db, 'ai_chat_model') || DEFAULT_CHAT_MODEL,
    audioModel: setting(db, 'ai_audio_model') || DEFAULT_AUDIO_MODEL,
    companyMemory: setting(db, 'ai_company_memory') ?? ''
  }
}

export function saveAiSettings(db: DatabaseSync, s: Partial<AiSettings>): void {
  if (s.models) {
    const models = [...new Set(s.models.map((m) => m.trim()).filter(Boolean))].slice(0, 2)
    if (models.length) setSetting(db, 'ai_models', JSON.stringify(models))
  }
  if (s.capCents !== undefined && Number.isFinite(s.capCents) && s.capCents > 0) setSetting(db, 'ai_monthly_cap_cents', String(Math.round(s.capCents)))
  if (s.chatModel !== undefined) setSetting(db, 'ai_chat_model', s.chatModel.trim())
  if (s.audioModel !== undefined) setSetting(db, 'ai_audio_model', s.audioModel.trim())
  if (s.companyMemory !== undefined) setSetting(db, 'ai_company_memory', s.companyMemory.trim())
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

// Dépense du mois : retouches d'images, discussion, transcriptions et vérifications partagent le même plafond.
export function monthSpentCents(db: DatabaseSync, now = new Date()): number {
  const since = monthStart(now)
  const images = (db.prepare('SELECT coalesce(sum(cost_cents), 0) AS c FROM render_versions WHERE created_at >= ?').get(since) as { c: number }).c
  const other = (db.prepare('SELECT coalesce(sum(cost_cents), 0) AS c FROM ai_usage WHERE created_at >= ?').get(since) as { c: number }).c
  return images + other
}

export function recordUsage(db: DatabaseSync, kind: 'chat' | 'transcription' | 'check' | 'image', model: string, costCents: number): void {
  if (costCents > 0) db.prepare('INSERT INTO ai_usage (kind, model, cost_cents) VALUES (?, ?, ?)').run(kind, model, costCents)
}

export function checkCap(db: DatabaseSync, estimateCents = 0): void {
  const { capCents } = getAiSettings(db)
  if (monthSpentCents(db) + estimateCents > capCents) {
    throw new Error(`Le budget de ${(capCents / 100).toLocaleString('fr-FR')} $ de ce mois est atteint. Il peut être relevé dans les Réglages.`)
  }
}

// Coût probable d'une image avec ce moteur : moyenne des dernières, sinon une estimation prudente.
export function estimateCents(db: DatabaseSync, model: string): number {
  const r = db
    .prepare('SELECT avg(cost_cents) AS c FROM (SELECT cost_cents FROM render_versions WHERE model = ? AND cost_cents > 0 ORDER BY id DESC LIMIT 10)')
    .get(model) as { c: number | null }
  return r.c ?? DEFAULT_ESTIMATE_CENTS
}

// Duel : nombre de fois où la proposition de chaque moteur a été gardée.
export function duelScore(db: DatabaseSync): { model: string; kept: number; proposed: number }[] {
  return db
    .prepare('SELECT model, sum(kept) AS kept, count(*) AS proposed FROM render_versions WHERE model IS NOT NULL GROUP BY model ORDER BY kept DESC')
    .all() as { model: string; kept: number; proposed: number }[]
}

// Image actuellement montrée pour ce rendu (version gardée, sinon l'original).
export function currentImage(db: DatabaseSync, renderId: number): { imageId: number; versionId: number | null } {
  const r = db
    .prepare(
      `SELECT r.image_id, r.active_version_id, v.image_id AS version_image FROM renders r
       LEFT JOIN render_versions v ON v.id = r.active_version_id WHERE r.id = ?`
    )
    .get(renderId) as { image_id: number; active_version_id: number | null; version_image: number | null } | undefined
  if (!r) throw new Error('Ce rendu n’existe plus.')
  return { imageId: r.version_image ?? r.image_id, versionId: r.version_image ? r.active_version_id : null }
}

export function addProposal(
  db: DatabaseSync,
  p: { renderId: number; parentId: number | null; imageId: number; prompt: string; model: string; costCents: number }
): number {
  return Number(
    db
      .prepare('INSERT INTO render_versions (render_id, parent_id, image_id, prompt, model, cost_cents) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.renderId, p.parentId, p.imageId, p.prompt, p.model, p.costCents).lastInsertRowid
  )
}

// « Garder » : la proposition devient l'image du rendu.
export function keepVersion(db: DatabaseSync, versionId: number): void {
  const v = db.prepare('SELECT render_id FROM render_versions WHERE id = ?').get(versionId) as { render_id: number } | undefined
  if (!v) throw new Error('Cette proposition n’existe plus.')
  db.prepare('UPDATE render_versions SET kept = 1 WHERE id = ?').run(versionId)
  db.prepare('UPDATE renders SET active_version_id = ? WHERE id = ?').run(versionId, v.render_id)
}

// Montrer une autre version déjà gardée, ou l'original (null).
export function showVersion(db: DatabaseSync, renderId: number, versionId: number | null): void {
  db.prepare('UPDATE renders SET active_version_id = ? WHERE id = ?').run(versionId, renderId)
}

// Historique d'un rendu : l'original puis les versions gardées.
export function renderHistory(db: DatabaseSync, renderId: number): AiVersion[] {
  const r = db
    .prepare('SELECT r.active_version_id, i.rel_path FROM renders r JOIN images i ON i.id = r.image_id WHERE r.id = ?')
    .get(renderId) as { active_version_id: number | null; rel_path: string }
  const kept = db
    .prepare(
      `SELECT v.id, v.prompt, v.created_at, i.rel_path FROM render_versions v JOIN images i ON i.id = v.image_id
       WHERE v.render_id = ? AND v.kept = 1 ORDER BY v.id`
    )
    .all(renderId) as { id: number; prompt: string | null; created_at: string; rel_path: string }[]
  return [
    { id: null, imageUrl: mediaUrl(r.rel_path), prompt: null, createdAt: null, active: r.active_version_id === null },
    ...kept.map((v) => ({ id: v.id, imageUrl: mediaUrl(v.rel_path), prompt: v.prompt, createdAt: v.created_at, active: v.id === r.active_version_id }))
  ]
}

export const checkModel = (db: DatabaseSync) => setting(db, 'ai_check_model') || DEFAULT_CHECK_MODEL
