import { describe, expect, it } from 'vitest'
import { cleanMarkdown, editableAsPlain, parseInline, parseMarkdown } from './markdown'

const NL = String.fromCharCode(10)

describe('Markdown du compte-rendu', () => {
  it('nettoie un texte collé depuis ChatGPT', () => {
    const pasted = ['a voir&#x20;', String.fromCharCode(92) + '-', '• Peinture', '* Sol', '---', '', '', '', 'Fin'].join(NL)
    expect(cleanMarkdown(pasted)).toBe(['a voir', '', '- Peinture', '- Sol', '', 'Fin'].join(NL))
  })

  it('reconnaît titres, listes, gras et lignes vides', () => {
    const text = ['# Titre', '**Date :** 5 novembre', '', '## 1. Entrée', '- Dressing', '2. Porte', '### **Cuisine**'].join(NL)
    const blocks = parseMarkdown(text)
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'p', 'blank', 'h2', 'li', 'li', 'h3'])
    expect(blocks[1].runs).toEqual([
      { text: 'Date :', bold: true },
      { text: ' 5 novembre', bold: false }
    ])
    expect(blocks[4].marker).toBe('•')
    expect(blocks[5].marker).toBe('2.')
    expect(blocks[6].runs).toEqual([{ text: 'Cuisine', bold: false }])
    // La place du texte dans l'original sert à le modifier depuis l'aperçu.
    expect(text.slice(blocks[4].start, blocks[4].end)).toBe('Dressing')
    expect(editableAsPlain(text, blocks[4])).toBe(true)
    expect(editableAsPlain(text, blocks[1])).toBe(false)
  })

  it('retire l’italique sans toucher aux astérisques isolés', () => {
    expect(parseInline('un *mot* ici')).toEqual([{ text: 'un mot ici', bold: false }])
    expect(parseInline('3 * 4')).toEqual([{ text: '3 * 4', bold: false }])
  })
})
