import { POPPINS_LIGHT } from './poppins-widths'

// Mesure d'un texte en Poppins Light, sans navigateur : sert à couper un long texte en colonnes et en pages.

const PT = 25.4 / 72 // mm par point
// Marge de sécurité : PowerPoint et Chromium ne coupent pas les lignes exactement au même endroit.
const SAFETY = 0.94

const charWidth = (c: string) => POPPINS_LIGHT[c.charCodeAt(0)] ?? 650

export function textWidth(s: string, size: number): number {
  let w = 0
  for (const c of s) w += charWidth(c)
  return (w / 1000) * size * PT
}

// Ligne affichée : sa place dans le texte d'origine (début inclus, fin exclue).
export interface TextLine {
  start: number
  end: number
}

// Coupe le texte en lignes comme le navigateur (mot par mot, retours à la ligne gardés). Une ligne vide
// (entre deux paragraphes) a `start === end`.
export function wrapLines(text: string, width: number, size: number): TextLine[] {
  const max = width * SAFETY
  const space = textWidth(' ', size)
  const lines: TextLine[] = []
  let offset = 0
  for (const paragraph of text.split('\n')) {
    const words = [...paragraph.matchAll(/\S+/g)]
    if (!words.length) lines.push({ start: offset, end: offset })
    let line: TextLine | null = null
    let used = 0
    for (const m of words) {
      let start = offset + m.index
      let word = m[0]
      let w = textWidth(word, size)
      if (line && used + space + w <= max) {
        line.end = start + word.length
        used += space + w
        continue
      }
      if (line) lines.push(line)
      // Mot plus long que la ligne (adresse web…) : coupé lettre à lettre.
      while (w > max) {
        let n = 1
        while (n < word.length && textWidth(word.slice(0, n + 1), size) <= max) n++
        lines.push({ start, end: start + n })
        start += n
        word = word.slice(n)
        w = textWidth(word, size)
      }
      line = { start, end: start + word.length }
      used = w
    }
    if (line) lines.push(line)
    offset += paragraph.length + 1
  }
  return lines
}

export const lineHeightMm = (size: number, lineHeight: number) => size * PT * lineHeight
