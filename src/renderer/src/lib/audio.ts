import type { RecordingInput } from '@shared/assistant'

// Prépare un vocal (Dictaphone de l'iPhone : .m4a, ou tout autre format audio) pour la transcription :
// le son est lu par Chromium, ramené à 16 kHz en mono, puis découpé en morceaux WAV de 5 minutes.

const RATE = 16_000
const CHUNK_SECONDS = 300

export const isAudio = (f: File) => f.type.startsWith('audio/') || /\.(m4a|mp3|wav|aac|caf|ogg|opus|flac|aif|aiff|webm)$/i.test(f.name)

function wav(samples: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, RATE, true)
  v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

export async function prepareRecording(file: File): Promise<RecordingInput> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Un contexte à 16 kHz : le son est rééchantillonné dès la lecture (moins de mémoire pour un long vocal).
  const context = new AudioContext({ sampleRate: RATE })
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(bytes.slice().buffer)
  } catch {
    throw new Error('Ce fichier audio ne peut pas être lu.')
  } finally {
    void context.close()
  }
  const length = decoded.length
  const mono = new Float32Array(length)
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c)
    for (let i = 0; i < length; i++) mono[i] += data[i] / decoded.numberOfChannels
  }
  const chunks: Uint8Array[] = []
  for (let start = 0; start < length; start += CHUNK_SECONDS * RATE) chunks.push(wav(mono.subarray(start, start + CHUNK_SECONDS * RATE)))
  const dot = file.name.lastIndexOf('.')
  return {
    name: (dot > 0 ? file.name.slice(0, dot) : file.name) || 'Vocal',
    ext: dot > 0 ? file.name.slice(dot + 1).toLowerCase() : 'm4a',
    bytes,
    durationS: decoded.duration,
    chunks
  }
}

export const durationLabel = (s: number | null) => {
  if (!s) return ''
  const m = Math.round(s / 60)
  return m < 1 ? 'moins d’une minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
