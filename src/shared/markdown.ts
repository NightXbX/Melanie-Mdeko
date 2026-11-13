// Texte mis en forme du compte-rendu : un Markdown réduit (titres #, ##, ###, listes « - » ou « 1. »,
// gras **…**). C'est ce que ChatGPT produit quand on copie sa réponse ; l'éditeur du projet écrit le même
// format. Chaque ligne du texte est un bloc (les retours à la ligne voulus sont gardés).

export type BlockKind = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'blank'

export interface InlineRun {
  text: string
  bold: boolean
}

export interface Block {
  kind: BlockKind
  runs: InlineRun[]
  marker?: string // puce d'une liste : « • » ou « 3. »
  // Contenu du bloc dans le texte d'origine (sans « ## » ni « - ») : sert à le modifier depuis l'aperçu.
  start: number
  end: number
}

const NL = '\n'

// Nettoie un texte collé : entités HTML (« &#x20; »), échappements Markdown (« \- »), puces typographiques,
// espaces insécables et lignes de séparation.
export function cleanMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, NL)
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/ /g, ' ')
    .split(NL)
    .map((line) =>
      line
        .replace(/[ \t]+$/, '')
        .replace(/^(\s*)[•●▪◦‣·*+]\s+/, '$1- ')
        .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, '')
        .replace(/^\s*[-*+]\s*$/, '') // puce sans texte
    )
    .join(NL)
    .replace(/\n{3,}/g, NL + NL)
}

// Gras (**…** ou __…__) ; l'italique (*…*) est retiré, Poppins ExtraLight n'en ayant pas besoin ici.
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  const push = (t: string, bold: boolean) => {
    if (!t) return
    const last = runs[runs.length - 1]
    if (last && last.bold === bold) last.text += t
    else runs.push({ text: t, bold })
  }
  const re = /\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g
  let at = 0
  for (const m of text.matchAll(re)) {
    push(text.slice(at, m.index), false)
    if (m[3] !== undefined) push(m[3], false)
    else push(m[1] ?? m[2], true)
    at = m.index + m[0].length
  }
  push(text.slice(at), false)
  return runs
}

export const plainText = (runs: InlineRun[]) => runs.map((r) => r.text).join('')

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  let offset = 0
  for (const line of text.split(NL)) {
    const lineStart = offset
    offset += line.length + 1
    if (!line.trim()) {
      blocks.push({ kind: 'blank', runs: [], start: lineStart, end: lineStart })
      continue
    }
    let kind: BlockKind = 'p'
    let marker: string | undefined
    let prefix = line.match(/^\s*/)![0].length
    const heading = line.match(/^\s*(#{1,6})\s+/)
    const bullet = line.match(/^\s*[-*+]\s+/)
    const numbered = line.match(/^\s*(\d{1,3})[.)]\s+/)
    if (heading) {
      kind = heading[1].length === 1 ? 'h1' : heading[1].length === 2 ? 'h2' : 'h3'
      prefix = heading[0].length
    } else if (bullet) {
      kind = 'li'
      marker = '•'
      prefix = bullet[0].length
    } else if (numbered) {
      kind = 'li'
      marker = `${numbered[1]}.`
      prefix = numbered[0].length
    }
    let content = line.slice(prefix).replace(/\s+#+\s*$/, '')
    // Un titre écrit tout en gras (« ## **Cuisine** ») : le gras est implicite.
    if (kind !== 'p' && kind !== 'li') content = content.replace(/^\*\*(.*)\*\*$/, '$1')
    const runs = parseInline(content)
    blocks.push({ kind, runs, marker, start: lineStart + prefix, end: lineStart + prefix + content.length })
  }
  while (blocks.length && blocks[blocks.length - 1].kind === 'blank') blocks.pop()
  while (blocks.length && blocks[0].kind === 'blank') blocks.shift()
  return blocks
}

// Le bloc peut-il être modifié tel quel depuis l'aperçu (texte simple, sans gras ni balise) ?
export function editableAsPlain(text: string, block: Block): boolean {
  return block.runs.every((r) => !r.bold) && text.slice(block.start, block.end) === plainText(block.runs)
}
