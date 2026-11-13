import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/api'
import { ASSISTANT_METHODS, type AssistantApi, type ChatMessageView, type ChatSummary, type RecordingView } from '@shared/assistant'
import { cleanMarkdown } from '@shared/markdown'
import { aiImages, fetchJson, requireOpenRouterKey } from '../ai'
import imageInstructions from '../ai/instructions-v2.txt?raw'
import { chatCompletion, listChatModels, openRouterProvider, type ChatContent, type ChatMessage, type ChatTool } from '../ai/openrouter'
import { applyFoundPrice, checkPrices, PRICE_CHECK_ESTIMATE_CENTS, priceCheckTargets } from '../ai/prices'
import { checkCap, checkModel, getAiSettings, recordUsage } from '../ai/versions'
import { readPageHtml } from '../ipc'
import { bookData } from '../book/data'
import { mediaUrl } from '../media-urls'
import type { DataPaths } from '../paths'
import { addRenders, getProject, updateProject } from '../projects'
import instructions from './consignes-v1.txt?raw'

const DEFAULT_TITLE = 'Nouvelle discussion'
const HISTORY = 40 // messages relus à chaque envoi
const IMAGE_HISTORY = 4 // images les plus récentes montrées à l'assistant
const IMAGE_WIDTH = 1536
const TIMEOUT = 5 * 60 * 1000
const CHAT_ESTIMATE_CENTS = 3

const TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description: 'Retouche une image de la conversation avec le moteur d’images (deux propositions en duel si deux moteurs sont réglés).',
      parameters: {
        type: 'object',
        properties: {
          image_id: { type: 'integer', description: 'Numéro de l’image à retoucher (indiqué « image n° » dans la conversation).' },
          instructions: { type: 'string', description: 'La retouche demandée, en anglais, précise.' },
          reference_image_ids: { type: 'array', items: { type: 'integer' }, description: 'Images de référence (produit à ajouter…), facultatif.' }
        },
        required: ['image_id', 'instructions']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Enregistre une information durable dans le mémo (du projet, ou de l’entreprise dans une discussion générale).',
      parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] }
    }
  }
]

interface MessageRow {
  id: number
  role: 'user' | 'assistant'
  content: string
  images: string | null
  recording_id: number | null
  recording_name: string | null
  transcript: string | null
  cost_cents: number
  created_at: string
}

const now = () => new Date().toISOString()

export function registerAssistantIpc(db: DatabaseSync, paths: DataPaths): void {
  const { dataUrl, store } = aiImages(db, paths)
  let running: AbortController | null = null
  let priceCheck: AbortController | null = null

  const imageUrl = (id: number) => {
    const row = db.prepare('SELECT rel_path FROM images WHERE id = ?').get(id) as { rel_path: string } | undefined
    return row ? { id, url: mediaUrl(row.rel_path) } : null
  }
  const imageIds = (json: string | null): number[] => {
    try {
      const v = JSON.parse(json ?? '[]') as unknown
      return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : []
    } catch {
      return []
    }
  }

  const chatSummary = (r: { id: number; project_id: number | null; title: string; updated_at: string }): ChatSummary => ({
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    updatedAt: r.updated_at
  })

  const messageRows = (chatId: number, limit = 10_000) =>
    (
      db
        .prepare(
          `SELECT * FROM (SELECT m.id, m.role, m.content, m.images, m.recording_id, r.name AS recording_name, r.transcript, m.cost_cents, m.created_at
           FROM chat_messages m LEFT JOIN project_recordings r ON r.id = m.recording_id
           WHERE m.chat_id = ? ORDER BY m.id DESC LIMIT ?) ORDER BY id`
        )
        .all(chatId, limit) as unknown as MessageRow[]
    )

  const view = (m: MessageRow): ChatMessageView => ({
    id: m.id,
    role: m.role,
    content: m.content,
    images: imageIds(m.images)
      .map(imageUrl)
      .filter((i) => i !== null),
    recording: m.recording_id && m.recording_name ? { id: m.recording_id, name: m.recording_name } : null,
    costCents: m.cost_cents,
    createdAt: m.created_at
  })

  const getMemory = (projectId: number | null): string => {
    if (projectId === null) return getAiSettings(db).companyMemory
    const r = db.prepare('SELECT ai_memory FROM projects WHERE id = ?').get(projectId) as { ai_memory: string | null } | undefined
    return r?.ai_memory ?? ''
  }
  const setMemory = (projectId: number | null, text: string) => {
    if (projectId === null) db.prepare("INSERT INTO settings (key, value) VALUES ('ai_company_memory', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(text.trim())
    else db.prepare('UPDATE projects SET ai_memory = ? WHERE id = ?').run(text.trim() || null, projectId)
  }

  // Ce que l'assistant sait du projet : relu à chaque message, donc toujours à jour. Ni adresse, ni téléphone,
  // ni e-mail du client.
  const projectContext = (projectId: number): string => {
    const d = bookData(db, paths.root, projectId)
    const project = getProject(db, projectId)
    const lines: string[] = [`# Projet : ${d.clientLabel} (${d.kind === 'quote' ? 'devis' : 'design book'}, ${d.dateLabel})`]
    if (project?.rooms.length) lines.push(`Pièces : ${project.rooms.map((r) => r.name).join(', ')}`)
    if (d.wishes.trim()) lines.push('', '## Vos envies (texte du book)', d.wishes.trim())
    if (d.needs.length) {
      lines.push('', '## Shopping list du projet')
      let room: string | null | undefined
      for (const n of d.needs) {
        if (n.room?.name !== room) {
          room = n.room?.name
          lines.push(`### ${room ?? 'Sans pièce'}`)
        }
        const c = n.choice
        const article = c ? `${c.name}${c.supplier ? ` (${c.supplier})` : ''}${c.price ? `, ${c.price}` : ''}` : 'pas encore choisi'
        lines.push(`- ${n.title}${n.quantity > 1 ? ` × ${n.quantity}` : ''} : ${article}${n.alternatives.length ? ` ; ${n.alternatives.length} autre(s) proposition(s) : ${n.alternatives.map((a) => a.name).join(', ')}` : ''}`)
      }
    }
    if (d.paints.length) {
      lines.push('', '## Teintes')
      for (const g of d.paints) lines.push(`- ${g.brand} : ${g.items.map((i) => [i.name, i.reference].filter(Boolean).join(' ')).join(', ')}`)
    }
    if (d.artisans.length) lines.push('', '## Artisans', ...d.artisans.map((a) => `- ${a.trade} : ${a.name}${a.city ? ` (${a.city})` : ''}`))
    if (d.report.trim()) lines.push('', '## Compte-rendu actuel du projet', cleanMarkdown(d.report).slice(0, 12_000))
    const recordings = db
      .prepare('SELECT name, created_at FROM project_recordings WHERE project_id = ? AND deleted_at IS NULL ORDER BY id')
      .all(projectId) as { name: string; created_at: string }[]
    if (recordings.length) lines.push('', '## Vocaux du projet', ...recordings.map((r) => `- « ${r.name} » (${r.created_at.slice(0, 10)})`))
    return lines.join('\n')
  }

  const systemPrompt = (projectId: number | null): string => {
    const parts = [instructions.trim(), `Nous sommes le ${new Date().toLocaleDateString('fr-FR', { dateStyle: 'full' })}.`]
    const company = getAiSettings(db).companyMemory
    if (company) parts.push(`# Mémo de l'entreprise (écrit par Mélanie)\n${company}`)
    if (projectId !== null) {
      parts.push('Cette discussion concerne le projet ci-dessous ; ses informations sont à jour.', projectContext(projectId))
      const memory = getMemory(projectId)
      if (memory) parts.push(`# Mémo de ce projet (ce qu'il faut retenir)\n${memory}`)
    } else {
      parts.push('Cette discussion est générale : elle ne concerne pas un projet en particulier.')
    }
    return parts.join('\n\n')
  }

  // Conversation envoyée au modèle : les derniers messages, les images récentes et les vocaux transcrits.
  const conversation = (chatId: number): ChatMessage[] => {
    const rows = messageRows(chatId, HISTORY)
    const recentImages = new Set(rows.flatMap((r) => imageIds(r.images)).slice(-IMAGE_HISTORY))
    return rows.map((r): ChatMessage => {
      const ids = imageIds(r.images)
      let text = r.content
      if (r.recording_id) text = `[Vocal « ${r.recording_name} », transcription]\n${r.transcript ?? '(transcription vide)'}\n\n${text}`.trim()
      if (ids.length) text += `\n${ids.map((id) => `[image n° ${id}${recentImages.has(id) ? '' : ', plus montrée'}]`).join(' ')}`
      if (r.role === 'assistant') return { role: 'assistant', content: text }
      const content: ChatContent = [{ type: 'text', text }]
      for (const id of ids) if (recentImages.has(id)) content.push({ type: 'image_url', image_url: { url: dataUrl(id, IMAGE_WIDTH) } })
      return { role: 'user', content }
    })
  }

  const insertMessage = (chatId: number, m: { role: 'user' | 'assistant'; content: string; images?: number[]; recordingId?: number | null; model?: string; costCents?: number }) => {
    const id = Number(
      db
        .prepare('INSERT INTO chat_messages (chat_id, role, content, images, recording_id, model, cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(chatId, m.role, m.content, m.images?.length ? JSON.stringify(m.images) : null, m.recordingId ?? null, m.model ?? null, m.costCents ?? 0)
        .lastInsertRowid
    )
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now(), chatId)
    return id
  }

  const chatOf = (chatId: number) => {
    const c = db.prepare('SELECT id, project_id, title FROM chats WHERE id = ?').get(chatId) as { id: number; project_id: number | null; title: string } | undefined
    if (!c) throw new Error('Cette discussion n’existe plus.')
    return c
  }

  // Retouche demandée par l'assistant : les moteurs d'images des Réglages, en même temps.
  const editImage = async (key: string, args: { image_id: number; instructions: string; reference_image_ids?: number[] }, signal: AbortSignal) => {
    const { models } = getAiSettings(db)
    checkCap(db, models.length * 10)
    const images = [dataUrl(args.image_id, 2048), ...(args.reference_image_ids ?? []).map((id) => dataUrl(id, 1024))]
    const description = ['Image 1 is the image to edit.', ...images.slice(1).map((_, i) => `Image ${i + 2} is a reference product.`)].join('\n')
    const prompt = `${imageInstructions}\n${description}\nRequest:\n${args.instructions}`
    const provider = openRouterProvider(key, fetchJson)
    const results = await Promise.all(
      models.map(async (model) => {
        try {
          const out = await provider.edit({ model, prompt, images }, signal)
          recordUsage(db, 'image', model, out.costCents)
          return { id: store(out.bytes, out.mimeType).id, error: null }
        } catch (e) {
          return { id: null, error: (e as Error).message }
        }
      })
    )
    return results
  }

  const api: AssistantApi = {
    listChats: async (projectId) =>
      (
        db
          .prepare(
            `SELECT id, project_id, title, updated_at FROM chats WHERE deleted_at IS NULL AND ${projectId === null ? 'project_id IS NULL' : 'project_id = ?'} ORDER BY updated_at DESC`
          )
          .all(...(projectId === null ? [] : [projectId])) as { id: number; project_id: number | null; title: string; updated_at: string }[]
      ).map(chatSummary),
    createChat: async (projectId) => {
      const id = Number(db.prepare('INSERT INTO chats (project_id, title) VALUES (?, ?)').run(projectId, DEFAULT_TITLE).lastInsertRowid)
      return chatSummary(db.prepare('SELECT id, project_id, title, updated_at FROM chats WHERE id = ?').get(id) as never)
    },
    renameChat: async (id, title) => {
      if (title.trim()) db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title.trim(), id)
    },
    deleteChat: async (id) => void db.prepare('UPDATE chats SET deleted_at = ? WHERE id = ?').run(now(), id),
    restoreChat: async (id) => void db.prepare('UPDATE chats SET deleted_at = NULL WHERE id = ?').run(id),
    messages: async (chatId) => messageRows(chatId).map(view),

    send: async (chatId, text, imageIdsIn) => {
      if (running) throw new Error('L’assistant répond déjà à une demande.')
      const chat = chatOf(chatId)
      const content = text.trim()
      if (!content && !imageIdsIn.length) throw new Error('Écrivez votre demande.')
      const key = requireOpenRouterKey(db)
      checkCap(db, CHAT_ESTIMATE_CENTS)
      const { chatModel } = getAiSettings(db)
      const firstId = insertMessage(chatId, { role: 'user', content, images: imageIdsIn })
      if (chat.title === DEFAULT_TITLE && content) {
        const title = content.replace(/\s+/g, ' ').slice(0, 60)
        db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title.length === 60 ? `${title.replace(/\s\S*$/, '')}…` : title, chatId)
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT)
      running = controller
      let cost = 0
      const produced: number[] = []
      const notes: string[] = []
      try {
        const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(chat.project_id) }, ...conversation(chatId)]
        let answer = ''
        let model = chatModel
        for (let round = 0; round < 4; round++) {
          const out = await chatCompletion(key, fetchJson, { model: chatModel, messages, tools: TOOLS }, controller.signal)
          cost += out.costCents
          model = out.model
          answer = out.text
          if (!out.toolCalls.length) break
          messages.push({ role: 'assistant', content: out.text || null, tool_calls: out.toolCalls })
          for (const call of out.toolCalls) {
            let result = ''
            try {
              const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
              if (call.function.name === 'remember' && typeof args.fact === 'string') {
                const memory = getMemory(chat.project_id)
                setMemory(chat.project_id, `${memory}\n- ${args.fact.trim()}`.trim())
                notes.push(`Retenu : ${args.fact.trim()}`)
                result = 'Enregistré.'
              } else if (call.function.name === 'edit_image') {
                const results = await editImage(key, args as never, controller.signal)
                const ok = results.filter((r) => r.id !== null).map((r) => r.id as number)
                produced.push(...ok)
                const errors = results.filter((r) => r.error).map((r) => r.error)
                result = ok.length
                  ? `${ok.length} image(s) produite(s) : ${ok.map((id) => `image n° ${id}`).join(', ')}.${errors.length ? ` Échec d'un moteur : ${errors[0]}` : ''}`
                  : `La retouche a échoué : ${errors[0] ?? 'raison inconnue'}`
              } else result = 'Outil inconnu.'
            } catch (e) {
              result = `Erreur : ${(e as Error).message}`
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: result })
          }
        }
        recordUsage(db, 'chat', model, cost)
        const final = [answer.trim() || (produced.length ? 'Voici la retouche.' : '…'), ...notes.map((n) => `*${n}*`)].join('\n\n')
        insertMessage(chatId, { role: 'assistant', content: final, images: produced, model, costCents: cost })
      } catch (e) {
        recordUsage(db, 'chat', chatModel, cost)
        if (controller.signal.aborted) throw new Error('La demande a été arrêtée ou a pris trop de temps.')
        throw e
      } finally {
        clearTimeout(timer)
        running = null
      }
      return messageRows(chatId)
        .filter((m) => m.id >= firstId)
        .map(view)
    },
    cancel: async () => running?.abort(),

    memory: async (projectId) => getMemory(projectId),
    saveMemory: async (projectId, text) => setMemory(projectId, text),

    recordings: async (projectId) =>
      (
        db
          .prepare('SELECT id, project_id, name, duration_s, transcript, created_at FROM project_recordings WHERE project_id = ? AND deleted_at IS NULL ORDER BY id DESC')
          .all(projectId) as { id: number; project_id: number; name: string; duration_s: number | null; transcript: string | null; created_at: string }[]
      ).map((r) => ({ id: r.id, projectId: r.project_id, name: r.name, durationS: r.duration_s, transcript: r.transcript, createdAt: r.created_at })),

    addRecording: async (projectId, input, chatId) => {
      if (running) throw new Error('L’assistant est déjà occupé : attendez la fin de la demande en cours.')
      const key = requireOpenRouterKey(db)
      // Environ 0,1 centime par minute d'écoute avec un modèle Flash : marge large.
      checkCap(db, Math.ceil(input.durationS / 60) * 0.5)
      const { audioModel } = getAiSettings(db)
      const id = Number(
        db.prepare('INSERT INTO project_recordings (project_id, name, duration_s) VALUES (?, ?, ?)').run(projectId, input.name, input.durationS).lastInsertRowid
      )
      // Le fichier d'origine est gardé dans le dossier de données.
      const dir = join(paths.root, 'vocaux')
      mkdirSync(dir, { recursive: true })
      const ext = input.ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'm4a'
      writeFileSync(join(dir, `${id}.${ext}`), input.bytes)
      db.prepare('UPDATE project_recordings SET rel_path = ? WHERE id = ?').run(`vocaux/${id}.${ext}`, id)

      const controller = new AbortController()
      running = controller
      try {
        const parts: string[] = new Array(input.chunks.length).fill('')
        let next = 0
        let cost = 0
        const worker = async () => {
          while (next < input.chunks.length) {
            const i = next++
            const minutes = (start: number) => `${Math.floor(start / 60)} min`
            const out = await chatCompletion(
              key,
              fetchJson,
              {
                model: audioModel,
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text:
                          'Transcris fidèlement cet extrait audio (réunion d’une décoratrice d’intérieur avec un client ou un artisan), en français. ' +
                          'Va à la ligne à chaque changement de personne. Garde tous les chiffres, cotes, matériaux, couleurs et prix. ' +
                          'Ne résume pas, n’ajoute aucun commentaire ; si l’extrait est silencieux, ne réponds rien.' +
                          (input.chunks.length > 1 ? ` (Extrait ${i + 1} sur ${input.chunks.length}, à partir de ${minutes(i * 300)}.)` : '')
                      },
                      { type: 'input_audio', input_audio: { data: Buffer.from(input.chunks[i]).toString('base64'), format: 'wav' } }
                    ]
                  }
                ]
              },
              controller.signal
            )
            cost += out.costCents
            parts[i] = out.text.trim()
          }
        }
        try {
          await Promise.all([worker(), worker(), worker()])
        } finally {
          recordUsage(db, 'transcription', audioModel, cost)
        }
        const transcript = parts.filter(Boolean).join('\n\n')
        db.prepare('UPDATE project_recordings SET transcript = ? WHERE id = ?').run(transcript, id)
        if (chatId !== null) insertMessage(chatId, { role: 'user', content: '', recordingId: id })
      } catch (e) {
        // Le vocal reste, sans transcription : on peut le supprimer et recommencer.
        db.prepare('UPDATE project_recordings SET transcript = NULL WHERE id = ?').run(id)
        if (controller.signal.aborted) throw new Error('La transcription a été arrêtée.')
        throw new Error(`La transcription a échoué : ${(e as Error).message}`)
      } finally {
        running = null
      }
      const r = db.prepare('SELECT id, project_id, name, duration_s, transcript, created_at FROM project_recordings WHERE id = ?').get(id) as {
        id: number
        project_id: number
        name: string
        duration_s: number | null
        transcript: string | null
        created_at: string
      }
      return { id: r.id, projectId: r.project_id, name: r.name, durationS: r.duration_s, transcript: r.transcript, createdAt: r.created_at } satisfies RecordingView
    },
    deleteRecording: async (id) => void db.prepare('UPDATE project_recordings SET deleted_at = ? WHERE id = ?').run(now(), id),
    listModels: async () => listChatModels(requireOpenRouterKey(db), fetchJson),

    useAsReport: async (projectId, markdown, mode) => {
      const project = getProject(db, projectId)
      if (!project) throw new Error('Ce projet n’existe plus.')
      const text = cleanMarkdown(markdown).trim()
      updateProject(db, projectId, { report: mode === 'append' && project.report.trim() ? `${project.report.trim()}\n\n${text}` : text })
    },
    addAsRender: async (projectId, imageId) => addRenders(db, projectId, [imageId], 'plans'),

    estimatePriceCheck: async (scope) => {
      const count = priceCheckTargets(db, scope).length
      return { count, cents: count * PRICE_CHECK_ESTIMATE_CENTS }
    },
    checkPrices: async (scope) => {
      if (priceCheck) throw new Error('Une vérification des prix est déjà en cours.')
      const key = requireOpenRouterKey(db)
      priceCheck = new AbortController()
      try {
        const sender = BrowserWindow.getAllWindows()[0]?.webContents
        return await checkPrices(db, key, checkModel(db), fetchJson, scope, readPageHtml, (p) => sender && !sender.isDestroyed() && sender.send(IPC.priceProgress, p), priceCheck.signal)
      } finally {
        priceCheck = null
      }
    },
    stopPriceCheck: async () => priceCheck?.abort(),
    applyPrice: async (articleId, cents, kind) => applyFoundPrice(db, articleId, cents, kind)
  }

  ipcMain.handle(IPC.assistant, (_e, method: string, ...args: unknown[]) => {
    if (!(ASSISTANT_METHODS as readonly string[]).includes(method)) throw new Error(`Méthode inconnue : ${method}`)
    return (api[method as keyof AssistantApi] as (...a: unknown[]) => unknown)(...args)
  })
}
