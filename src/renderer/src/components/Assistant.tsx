import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessageView, ChatSummary, RecordingView } from '@shared/assistant'
import { useApp } from '../app-context'
import { durationLabel, isAudio, prepareRecording } from '../lib/audio'
import { uploadDrop } from '../lib/images'
import { Icon } from './Icon'
import { markdownToHtml } from './RichText'

// Assistant : discussions avec l'IA. Dans un projet, elle connaît tout le projet (relu à chaque message) et
// son mémo ; les vocaux importés y sont transcrits. Sans projet : discussions générales.

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const IDEAS_PROJECT = [
  'Rédige le compte-rendu de la réunion à partir du dernier vocal.',
  'Propose un texte « Vos envies » pour ce projet.',
  'Fais la liste de ce qu’il reste à choisir dans la shopping list.',
  'Prépare un mail au client pour lui présenter le design book.'
]
const IDEAS_GENERAL = [
  'Aide-moi à rédiger un mail à un artisan pour demander un devis.',
  'Quelles questions poser lors d’un premier rendez-vous client ?',
  'Reformule ce texte pour qu’il soit plus professionnel :'
]

interface Pending {
  text: string
  images: { id: number; url: string }[]
}

export function Assistant({ projectId, onReportChanged }: { projectId: number | null; onReportChanged?: () => void }) {
  const { notify } = useApp()
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatId, setChatId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessageView[]>([])
  const [draft, setDraft] = useState<Pending>({ text: '', images: [] })
  const [busy, setBusy] = useState<string | null>(null) // « L'assistant écrit… », « Transcription… »
  const [error, setError] = useState<string | null>(null)
  const [recordings, setRecordings] = useState<RecordingView[]>([])
  const [shownTranscript, setShownTranscript] = useState<RecordingView | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const thread = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const loadChats = useCallback(async () => {
    const list = await window.mdeko.assistant.listChats(projectId)
    setChats(list)
    return list
  }, [projectId])

  const loadRecordings = useCallback(async () => {
    if (projectId !== null) setRecordings(await window.mdeko.assistant.recordings(projectId))
  }, [projectId])

  useEffect(() => {
    void loadChats().then((list) => setChatId(list[0]?.id ?? null))
    void loadRecordings()
  }, [loadChats, loadRecordings])

  useEffect(() => {
    setError(null)
    if (chatId === null) setMessages([])
    else void window.mdeko.assistant.messages(chatId).then(setMessages)
  }, [chatId])

  // Toujours en bas de la discussion quand un message arrive.
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const ensureChat = async (): Promise<number> => {
    if (chatId !== null) return chatId
    const chat = await window.mdeko.assistant.createChat(projectId)
    setChats((c) => [chat, ...c])
    setChatId(chat.id)
    return chat.id
  }

  const newChat = async () => {
    const chat = await window.mdeko.assistant.createChat(projectId)
    setChats((c) => [chat, ...c])
    setChatId(chat.id)
    setMessages([])
    input.current?.focus()
  }

  const send = async (text = draft.text) => {
    if (busy || (!text.trim() && !draft.images.length)) return
    const id = await ensureChat()
    const images = draft.images
    setDraft({ text: '', images: [] })
    setError(null)
    // Le message de Mélanie s'affiche tout de suite.
    setMessages((m) => [...m, { id: -1, role: 'user', content: text.trim(), images, recording: null, costCents: 0, createdAt: '' }])
    setBusy('L’assistant écrit…')
    try {
      await window.mdeko.assistant.send(id, text, images.map((i) => i.id))
    } catch (e) {
      setError(cleanError(e))
      setDraft({ text, images })
    } finally {
      setBusy(null)
      setMessages(await window.mdeko.assistant.messages(id))
      void loadChats()
    }
  }

  const addFiles = async (files: File[]) => {
    const audio = files.filter(isAudio)
    const pictures = files.filter((f) => f.type.startsWith('image/'))
    if (pictures.length) {
      const uploaded = await uploadDrop({ files: pictures, url: null })
      setDraft((d) => ({ ...d, images: [...d.images, ...uploaded] }))
    }
    for (const file of audio) await importRecording(file)
  }

  const importRecording = async (file: File) => {
    if (projectId === null) {
      notify('Les vocaux s’importent dans la discussion d’un projet')
      return
    }
    setError(null)
    setBusy(`Lecture du vocal « ${file.name} »…`)
    try {
      const recording = await prepareRecording(file)
      setBusy(`Transcription de « ${recording.name} » (${durationLabel(recording.durationS)}) : environ ${Math.max(1, Math.ceil(recording.durationS / 600))} min…`)
      const id = await ensureChat()
      await window.mdeko.assistant.addRecording(projectId, recording, id)
      setMessages(await window.mdeko.assistant.messages(id))
      void loadChats()
      notify('Vocal transcrit')
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
      void loadRecordings()
    }
  }

  const useAsReport = async (content: string) => {
    if (projectId === null) return
    const project = await window.mdeko.projects.get(projectId)
    let mode: 'replace' | 'append' = 'replace'
    if (project?.report.trim()) {
      const replace = await window.mdeko.confirm(
        'Remplacer le compte-rendu actuel ?',
        'Le compte-rendu du projet contient déjà du texte. « Remplacer » le remplace par cette réponse ; « Annuler » l’ajoute à la suite.',
        'Remplacer'
      )
      mode = replace ? 'replace' : 'append'
    }
    await window.mdeko.assistant.useAsReport(projectId, content, mode)
    onReportChanged?.()
    notify(mode === 'replace' ? 'Compte-rendu remplacé (étape « Compte-rendu »)' : 'Ajouté à la fin du compte-rendu')
  }

  const deleteChat = async (chat: ChatSummary) => {
    const ok = await window.mdeko.confirm(`Supprimer la discussion « ${chat.title} » ?`, 'Ses messages ne seront plus affichés.', 'Supprimer')
    if (!ok) return
    await window.mdeko.assistant.deleteChat(chat.id)
    const list = await loadChats()
    if (chat.id === chatId) setChatId(list[0]?.id ?? null)
  }

  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null)
  const renameChat = (chat: ChatSummary) => setRenaming({ id: chat.id, title: chat.title })
  const finishRename = async () => {
    if (!renaming) return
    setRenaming(null)
    if (renaming.title.trim()) await window.mdeko.assistant.renameChat(renaming.id, renaming.title)
    void loadChats()
  }

  const ideas = projectId === null ? IDEAS_GENERAL : IDEAS_PROJECT

  return (
    <div
      className={`assistant${dropping ? ' is-dropping' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        void addFiles([...e.dataTransfer.files])
      }}
    >
      <aside className="assistant-side">
        <button type="button" className="button button-primary" onClick={() => void newChat()}>
          <Icon name="plus" size={14} />
          Nouvelle discussion
        </button>
        <div className="assistant-chats">
          {chats.map((c) => (
            <div key={c.id} className={`assistant-chat${c.id === chatId ? ' is-selected' : ''}`}>
              {renaming?.id === c.id ? (
                <input
                  className="assistant-rename"
                  autoFocus
                  value={renaming.title}
                  onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                  onBlur={() => void finishRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void finishRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <button type="button" className="assistant-chat-title" onClick={() => setChatId(c.id)} onDoubleClick={() => renameChat(c)}>
                  {c.title}
                </button>
              )}
              <button type="button" className="assistant-icon" title="Renommer" onClick={() => renameChat(c)}>
                <Icon name="pencil" size={13} />
              </button>
              <button type="button" className="assistant-icon" title="Supprimer" onClick={() => void deleteChat(c)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
          {!chats.length && <p className="section-note">Aucune discussion pour l’instant.</p>}
        </div>
        {projectId !== null && (
          <div className="assistant-recordings">
            <h4>Vocaux du projet</h4>
            {recordings.map((r) => (
              <div key={r.id} className="assistant-recording">
                <button type="button" className="assistant-chat-title" onClick={() => setShownTranscript(r)}>
                  {r.name}
                  <small>{[durationLabel(r.durationS), r.transcript ? null : 'non transcrit'].filter(Boolean).join(' · ')}</small>
                </button>
                <button
                  type="button"
                  className="assistant-icon"
                  title="Supprimer"
                  onClick={async () => {
                    if (!(await window.mdeko.confirm(`Supprimer le vocal « ${r.name} » ?`, 'Sa transcription ne sera plus utilisée par l’assistant.', 'Supprimer'))) return
                    await window.mdeko.assistant.deleteRecording(r.id)
                    void loadRecordings()
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
            <label className="button">
              Importer un vocal…
              <input type="file" accept="audio/*,.m4a" hidden onChange={(e) => e.target.files?.[0] && void importRecording(e.target.files[0])} />
            </label>
            <p className="section-note">Sur le Mac, les vocaux de l’iPhone sont dans l’app Dictaphone : glissez-les ici.</p>
          </div>
        )}
        <button type="button" className="button button-plain" onClick={() => setMemoryOpen(true)}>
          {projectId === null ? 'Mémo de l’entreprise…' : 'Mémo du projet…'}
        </button>
      </aside>

      <section className="assistant-main">
        <div className="assistant-thread" ref={thread}>
          {!messages.length && !busy && (
            <div className="assistant-empty">
              <h3>{projectId === null ? 'Posez votre question' : 'L’assistant connaît ce projet'}</h3>
              <p className="section-note">
                {projectId === null
                  ? 'Comme dans ChatGPT : écrivez, joignez des images, demandez une retouche.'
                  : 'Client, pièces, shopping list, teintes, compte-rendu et vocaux : il les relit à chaque message. Glissez un vocal ou une image ici.'}
              </p>
              <div className="assistant-ideas">
                {ideas.map((idea) => (
                  <button key={idea} type="button" className="ai-idea" onClick={() => setDraft((d) => ({ ...d, text: idea }))}>
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id === -1 ? `pending-${i}` : m.id} className={`assistant-message is-${m.role}`}>
              {m.recording && (
                <button type="button" className="assistant-recording-chip" onClick={() => setShownTranscript(recordings.find((r) => r.id === m.recording!.id) ?? null)}>
                  🎙 Vocal « {m.recording.name} » transcrit — voir le texte
                </button>
              )}
              {m.content &&
                (m.role === 'assistant' ? (
                  <div className="assistant-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(m.content) }} />
                ) : (
                  <div className="assistant-text">{m.content}</div>
                ))}
              {m.images.length > 0 && (
                <div className="assistant-images">
                  {m.images.map((img) => (
                    <figure key={img.id}>
                      <img src={img.url} alt="" />
                      <figcaption>
                        <button type="button" className="button button-plain" onClick={() => setDraft((d) => ({ ...d, images: [...d.images, img] }))}>
                          Retoucher
                        </button>
                        {projectId !== null && m.role === 'assistant' && (
                          <button
                            type="button"
                            className="button button-plain"
                            onClick={async () => {
                              await window.mdeko.assistant.addAsRender(projectId, img.id)
                              onReportChanged?.()
                              notify('Ajoutée aux plans 3D du projet')
                            }}
                          >
                            Ajouter aux plans 3D
                          </button>
                        )}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && m.content && (
                <div className="assistant-actions">
                  <button
                    type="button"
                    className="button button-plain"
                    onClick={() => {
                      void navigator.clipboard.writeText(m.content)
                      notify('Texte copié')
                    }}
                  >
                    Copier
                  </button>
                  {projectId !== null && (
                    <button type="button" className="button button-plain" onClick={() => void useAsReport(m.content)}>
                      Mettre dans le compte-rendu
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="assistant-message is-assistant is-busy">
              <span className="assistant-dots" />
              {busy}
              <button type="button" className="button button-plain" onClick={() => void window.mdeko.assistant.cancel()}>
                Arrêter
              </button>
            </div>
          )}
          {error && <p className="editor-error">{error}</p>}
        </div>

        <div className="assistant-composer">
          {draft.images.length > 0 && (
            <div className="assistant-attachments">
              {draft.images.map((img) => (
                <span key={img.id} className="assistant-attachment">
                  <img src={img.url} alt="" />
                  <button type="button" title="Retirer" onClick={() => setDraft((d) => ({ ...d, images: d.images.filter((i) => i.id !== img.id) }))}>
                    <Icon name="xmark" size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="assistant-input">
            <label className="assistant-icon" title="Joindre une image ou un vocal">
              <Icon name="plus" />
              <input
                type="file"
                multiple
                accept={projectId === null ? 'image/*' : 'image/*,audio/*,.m4a'}
                hidden
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])])
                  e.target.value = ''
                }}
              />
            </label>
            <textarea
              ref={input}
              rows={Math.min(8, Math.max(2, draft.text.split('\n').length))}
              value={draft.text}
              placeholder={projectId === null ? 'Écrivez votre question…' : 'Demandez quelque chose sur ce projet…'}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              onPaste={(e) => {
                const files = [...e.clipboardData.files]
                if (files.length) {
                  e.preventDefault()
                  void addFiles(files)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button type="button" className="button button-primary" disabled={!!busy || (!draft.text.trim() && !draft.images.length)} onClick={() => void send()}>
              Envoyer
            </button>
          </div>
          <p className="section-note">Entrée pour envoyer, Maj + Entrée pour aller à la ligne.</p>
        </div>
      </section>

      {shownTranscript && <TranscriptSheet recording={shownTranscript} onClose={() => setShownTranscript(null)} />}
      {memoryOpen && <MemorySheet projectId={projectId} onClose={() => setMemoryOpen(false)} />}
    </div>
  )
}

function TranscriptSheet({ recording, onClose }: { recording: RecordingView; onClose(): void }) {
  const { notify } = useApp()
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet-large" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="sheet-head">
          <h2>Vocal « {recording.name} »</h2>
          <div className="detail-actions">
            <button
              type="button"
              className="button"
              disabled={!recording.transcript}
              onClick={() => {
                void navigator.clipboard.writeText(recording.transcript ?? '')
                notify('Transcription copiée')
              }}
            >
              Copier
            </button>
            <button type="button" className="button button-primary" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
        <div className="assistant-transcript">{recording.transcript || 'Ce vocal n’a pas pu être transcrit. Supprimez-le et importez-le à nouveau.'}</div>
      </div>
    </div>
  )
}

function MemorySheet({ projectId, onClose }: { projectId: number | null; onClose(): void }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    void window.mdeko.assistant.memory(projectId).then(setText)
  }, [projectId])
  if (text === null) return null
  const save = async () => {
    await window.mdeko.assistant.saveMemory(projectId, text)
    onClose()
  }
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="sheet-head">
          <h2>{projectId === null ? 'Mémo de l’entreprise' : 'Mémo du projet'}</h2>
          <div className="detail-actions">
            <button type="button" className="button" onClick={onClose}>
              Annuler
            </button>
            <button type="button" className="button button-primary" onClick={() => void save()}>
              Enregistrer
            </button>
          </div>
        </div>
        <p className="section-note">
          {projectId === null
            ? 'Ce que l’assistant doit savoir de votre entreprise : il le relit dans toutes les discussions.'
            : 'Ce que l’assistant a retenu de ce projet (il le complète tout seul). Vous pouvez le corriger.'}
        </p>
        <label className="field">
          <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
      </div>
    </div>
  )
}
