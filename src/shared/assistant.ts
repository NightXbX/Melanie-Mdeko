// Assistant : discussions avec l'IA, une ou plusieurs par projet (avec le projet en mémoire) ou générales,
// et vocaux transcrits rattachés à un projet.

export interface ChatSummary {
  id: number
  projectId: number | null // null : discussion générale
  title: string
  updatedAt: string
}

export interface ChatImage {
  id: number
  url: string
}

export interface ChatMessageView {
  id: number
  role: 'user' | 'assistant'
  content: string
  images: ChatImage[]
  recording: { id: number; name: string } | null
  costCents: number
  createdAt: string
}

export interface RecordingView {
  id: number
  projectId: number
  name: string
  durationS: number | null
  transcript: string | null
  createdAt: string
}

// Vocal à transcrire : le fichier d'origine (gardé) et le son découpé en morceaux WAV (16 kHz, mono) par
// l'interface, qui sait lire tous les formats audio.
export interface RecordingInput {
  name: string
  ext: string
  bytes: Uint8Array
  durationS: number
  chunks: Uint8Array[]
}

export interface AssistantApi {
  listChats(projectId: number | null): Promise<ChatSummary[]>
  createChat(projectId: number | null): Promise<ChatSummary>
  renameChat(id: number, title: string): Promise<void>
  deleteChat(id: number): Promise<void>
  restoreChat(id: number): Promise<void>
  messages(chatId: number): Promise<ChatMessageView[]>
  // Envoie un message (texte et images jointes) ; renvoie la réponse de l'assistant.
  send(chatId: number, text: string, imageIds: number[]): Promise<ChatMessageView[]>
  cancel(): Promise<void>
  memory(projectId: number | null): Promise<string>
  saveMemory(projectId: number | null, text: string): Promise<void>
  recordings(projectId: number): Promise<RecordingView[]>
  // Transcrit un vocal du projet ; s'il est importé depuis une discussion, il y est ajouté.
  addRecording(projectId: number, input: RecordingInput, chatId: number | null): Promise<RecordingView>
  deleteRecording(id: number): Promise<void>
  listModels(): Promise<{ id: string; name: string }[]>
  // Texte de l'assistant → compte-rendu du projet (remplacé ou ajouté à la suite).
  useAsReport(projectId: number, markdown: string, mode: 'replace' | 'append'): Promise<void>
  addAsRender(projectId: number, imageId: number): Promise<void>
  // Vérification des prix : lit chaque page produit et renvoie les écarts (rien n'est changé tout seul).
  estimatePriceCheck(scope: PriceCheckScope): Promise<{ count: number; cents: number }>
  checkPrices(scope: PriceCheckScope): Promise<PriceCheckRow[]>
  stopPriceCheck(): Promise<void>
  applyPrice(articleId: number, cents: number, kind: string): Promise<void>
}

export const ASSISTANT_METHODS = [
  'listChats', 'createChat', 'renameChat', 'deleteChat', 'restoreChat', 'messages', 'send', 'cancel', 'memory', 'saveMemory',
  'recordings', 'addRecording', 'deleteRecording', 'listModels', 'useAsReport', 'addAsRender', 'estimatePriceCheck', 'checkPrices',
  'stopPriceCheck', 'applyPrice'
] as const satisfies readonly (keyof AssistantApi)[]

// --- Vérification des prix par l'IA ---

// Articles des projets (non supprimés), prix inchangés depuis un an, ou une liste d'articles.
export type PriceCheckScope = 'projects' | 'stale' | number[]

export interface PriceCheckProgress {
  done: number
  total: number
  differences: number
}

export interface PriceCheckRow {
  articleId: number
  name: string
  supplier: string | null
  url: string
  currentCents: number | null
  currentKind: string
  foundCents: number | null
  foundKind: string | null
  // found : prix lu (différent de celui de la fiche) ; unavailable : plus vendu ; not_product : la page n'est
  // plus celle du produit ; unknown : prix introuvable, à vérifier à la main.
  status: 'found' | 'unavailable' | 'not_product' | 'unknown'
  note: string
}
