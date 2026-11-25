// Petit mot affectueux montré de temps en temps à l'ouverture de l'appli (tous les 7 à 14 jours, au hasard).

const DAY = 24 * 60 * 60 * 1000
export const MIN_DAYS = 7
export const MAX_DAYS = 14

// {moment} : « Bonne journée », « Bon après-midi » ou « Bonne soirée » selon l'heure.
export const KIND_WORDS = [
  '{moment} Maman ❤️',
  '{moment} Maman, je t’aime fort ❤️',
  'Coucou Maman ! {moment} 😘',
  '{moment} Maman, et bon courage pour tes projets ',
  'Petit bisou du développeur de l’appli  {moment} Maman !',
  '{moment} Maman !',
  'Tes clients ont de la chance de t’avoir. {moment} Maman ',
  '{moment} Maman, profite bien ☀️',
  'Un petit mot pour te dire que je pense à toi. {moment} Maman ❤️',
  'Coucou ! Tes design books sont les plus beaux 😍 {moment} Maman'
]

export interface KindWordState {
  next: number | null // date (ms) à partir de laquelle montrer le prochain mot
  last: number | null // indice du dernier mot montré, pour ne pas répéter
}

export function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Bonne journée'
  if (hour < 18) return 'Bon après-midi'
  return 'Bonne soirée'
}

const nextDate = (now: number, random: () => number) => now + (MIN_DAYS + random() * (MAX_DAYS - MIN_DAYS)) * DAY

// À l'ouverture : le mot à montrer (ou null) et l'état à enregistrer.
// Première ouverture : on programme seulement le premier mot.
export function pickKindWord(now: Date, state: KindWordState, random: () => number = Math.random): { text: string | null; state: KindWordState } {
  const t = now.getTime()
  if (state.next === null) return { text: null, state: { next: nextDate(t, random), last: state.last } }
  if (t < state.next) return { text: null, state }
  const choices = KIND_WORDS.map((_, i) => i).filter((i) => i !== state.last)
  const index = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]
  return {
    text: KIND_WORDS[index].replace('{moment}', greeting(now)),
    state: { next: nextDate(t, random), last: index }
  }
}
