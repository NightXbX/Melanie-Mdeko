import { describe, expect, it } from 'vitest'
import { KIND_WORDS, MAX_DAYS, MIN_DAYS, greeting, pickKindWord } from './kind-word'

const DAY = 24 * 60 * 60 * 1000

describe('petit mot à l’ouverture', () => {
  it('ne montre rien à la première ouverture, mais programme le premier mot dans 7 à 14 jours', () => {
    const now = new Date(2026, 10, 25, 9)
    for (const r of [0, 0.5, 0.999]) {
      const { text, state } = pickKindWord(now, { next: null, last: null }, () => r)
      expect(text).toBeNull()
      const days = (state.next! - now.getTime()) / DAY
      expect(days).toBeGreaterThanOrEqual(MIN_DAYS)
      expect(days).toBeLessThanOrEqual(MAX_DAYS)
    }
  })

  it('attend la date prévue', () => {
    const now = new Date(2026, 10, 25, 9)
    const state = { next: now.getTime() + DAY, last: 2 }
    expect(pickKindWord(now, state)).toEqual({ text: null, state })
  })

  it('montre un mot une fois la date passée, jamais deux fois le même de suite, puis reprogramme', () => {
    const now = new Date(2026, 10, 25, 20)
    const { text, state } = pickKindWord(now, { next: now.getTime() - 1, last: 0 }, () => 0)
    expect(text).toBe(KIND_WORDS[1].replace('{moment}', 'Bonne soirée'))
    expect(state.last).toBe(1)
    expect(state.next! - now.getTime()).toBe(MIN_DAYS * DAY)
    expect(text).not.toContain('{moment}')
  })

  it('salue selon l’heure', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Bonne journée')
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Bon après-midi')
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Bonne soirée')
  })
})
