// Connecteur OpenRouter (API d'images) : une demande, une image d'origine et des images de référence,
// une image en retour avec son coût. Le moteur (modèle) est un réglage, jamais écrit en dur ici.

export interface ImageEditRequest {
  model: string
  prompt: string
  images: string[] // data URL : l'image à retoucher en premier, puis les références
}

export interface ImageEditResult {
  bytes: Uint8Array
  mimeType: string
  costCents: number
}

// Interface commune : d'autres connecteurs (Gemini, OpenAI, FLUX directement) pourront s'y brancher.
export interface ImageEditProvider {
  edit(request: ImageEditRequest, signal?: AbortSignal): Promise<ImageEditResult>
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

const API = 'https://openrouter.ai/api/v1'

// Messages d'erreur compréhensibles par Mélanie.
function errorMessage(status: number, detail: string): string {
  if (status === 401) return 'La clé OpenRouter n’est pas valable. Vérifiez-la dans les Réglages.'
  if (status === 402) return 'Il n’y a plus de crédit sur le compte OpenRouter.'
  if (status === 403) return 'Le compte OpenRouter refuse la demande (plafond de dépense atteint ?).'
  if (status === 404) return 'Ce moteur d’images n’existe plus : choisissez-en un autre dans les Réglages.'
  if (status === 413) return 'L’image est trop lourde pour être envoyée.'
  if (status === 429) return 'Trop de demandes en même temps : réessayez dans une minute.'
  if (status >= 500) return 'Le service d’images ne répond pas pour l’instant : réessayez un peu plus tard.'
  return detail ? `La retouche a échoué : ${detail}` : 'La retouche a échoué.'
}

interface ApiResponse {
  data?: { b64_json?: string; media_type?: string }[]
  usage?: { cost?: number }
  error?: { code?: number; message?: string }
}

export function openRouterProvider(apiKey: string, fetch: Fetch): ImageEditProvider {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Mdeko' }
  const call = async (body: Record<string, unknown>, signal?: AbortSignal) => {
    const res = await fetch(`${API}/images`, { method: 'POST', headers, body: JSON.stringify(body), signal })
    const json = (await res.json().catch(() => ({}))) as ApiResponse
    return { res, json }
  }
  return {
    async edit({ model, prompt, images }, signal) {
      const base = {
        model,
        prompt,
        n: 1,
        input_references: images.map((url) => ({ type: 'image_url', image_url: { url } }))
      }
      // Format des rendus (16:9, 2K) ; un moteur qui refuse ces options est relancé sans elles.
      let { res, json } = await call({ ...base, aspect_ratio: '16:9', resolution: '2K' }, signal)
      if (res.status === 400) ({ res, json } = await call(base, signal))
      if (!res.ok) throw new Error(errorMessage(res.status, json.error?.message ?? ''))
      const image = json.data?.find((d) => d.b64_json)
      if (!image?.b64_json) throw new Error('Le moteur n’a pas renvoyé d’image : reformulez la demande ou réessayez.')
      return {
        bytes: new Uint8Array(Buffer.from(image.b64_json, 'base64')),
        mimeType: image.media_type ?? 'image/png',
        costCents: (json.usage?.cost ?? 0) * 100
      }
    }
  }
}

// Moteurs d'images proposés dans les Réglages.
export async function listImageModels(apiKey: string, fetch: Fetch): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${API}/images/models`, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res.ok) throw new Error(errorMessage(res.status, ''))
  const json = (await res.json()) as { data?: { id: string; name?: string; architecture?: { input_modalities?: string[] } }[] }
  return (json.data ?? [])
    .filter((m) => m.architecture?.input_modalities?.includes('image') ?? true)
    .map((m) => ({ id: m.id, name: m.name ?? m.id }))
}
