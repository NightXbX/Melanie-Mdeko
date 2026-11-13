import { useEffect, useRef } from 'react'
import { cleanMarkdown, parseMarkdown, type Block, type InlineRun } from '@shared/markdown'

// Éditeur de texte mis en forme (titres, listes, gras), enregistré en Markdown. Un texte collé depuis
// ChatGPT (avec ses « ## » et « ** », ou déjà mis en forme) arrive directement mis en forme.

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (runs: InlineRun[]) => runs.map((r) => (r.bold ? `<strong>${escape(r.text)}</strong>` : escape(r.text))).join('')

export function markdownToHtml(md: string): string {
  const blocks = parseMarkdown(cleanMarkdown(md))
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const close = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (const b of blocks) {
    if (b.kind === 'li') {
      const kind = b.marker === '•' ? 'ul' : 'ol'
      if (list !== kind) {
        close()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${inline(b.runs) || '<br>'}</li>`)
      continue
    }
    close()
    out.push(blockHtml(b))
  }
  close()
  return out.join('') || '<p><br></p>'
}

function blockHtml(b: Block): string {
  if (b.kind === 'blank') return '<p><br></p>'
  const tag = b.kind === 'h1' ? 'h2' : b.kind === 'h2' ? 'h3' : b.kind === 'h3' ? 'h4' : 'p'
  return `<${tag}>${inline(b.runs) || '<br>'}</${tag}>`
}

// Contenu HTML (de l'éditeur, ou collé) → Markdown. Tolère le HTML d'autres logiciels.
export function htmlToMarkdown(root: Node): string {
  const lines: string[] = []
  const inlineText = (node: Node, bold = false): string => {
    let out = ''
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ')
        const m = t.match(/^(\s*)(.*?)(\s*)$/)!
        out += bold && m[2] ? `${m[1]}**${m[2]}**${m[3]}` : t
      } else if (n instanceof HTMLElement) {
        if (n.tagName === 'BR') out += '\n'
        else {
          const style = n.getAttribute('style') ?? ''
          const isBold = ['B', 'STRONG'].includes(n.tagName) || /font-weight:\s*(bold|[6-9]00)/.test(style)
          out += inlineText(n, bold || isBold)
        }
      }
    })
    return out.replace(/\*\*\*\*/g, '')
  }
  const pushText = (prefix: string, text: string) => {
    text.split('\n').forEach((line, i) => lines.push((i ? '' : prefix) + line.trim()))
  }
  const walk = (node: Node) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.textContent?.trim()) pushText('', n.textContent)
        return
      }
      if (!(n instanceof HTMLElement)) return
      const tag = n.tagName
      if (/^H[1-6]$/.test(tag)) {
        // Dans l'éditeur, h2/h3/h4 = titre, sous-titre, intertitre ; ailleurs h1/h2/h3.
        const level = Math.max(1, Math.min(3, Number(tag[1]) - (root instanceof HTMLElement && root.isContentEditable ? 1 : 0)))
        pushText('#'.repeat(level) + ' ', inlineText(n).replace(/\*\*/g, ''))
      } else if (tag === 'UL' || tag === 'OL') {
        let i = 0
        n.querySelectorAll(':scope > li').forEach((li) => {
          i++
          pushText(tag === 'OL' ? `${i}. ` : '- ', inlineText(li))
        })
      } else if (tag === 'P' || tag === 'LI') {
        const text = inlineText(n)
        if (text.trim()) pushText(tag === 'LI' ? '- ' : '', text)
        else lines.push('')
      } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'BLOCKQUOTE') {
        // Un div sans bloc à l'intérieur est une ligne (Chromium en crée à chaque Entrée).
        if (n.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol')) walk(n)
        else {
          const text = inlineText(n)
          if (text.trim()) pushText('', text)
          else lines.push('')
        }
      } else if (tag === 'TABLE') {
        n.querySelectorAll('tr').forEach((tr) => lines.push([...tr.children].map((c) => (c.textContent ?? '').trim()).join(' · ')))
      } else if (!['STYLE', 'SCRIPT', 'META'].includes(tag)) {
        const text = inlineText(n)
        if (text.trim()) pushText('', text)
      }
    })
  }
  walk(root)
  return cleanMarkdown(lines.join('\n')).replace(/^\n+|\n+$/g, '')
}

interface Props {
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
}

export function RichText({ value, onChange, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef<string | null>(null)

  // Texte changé ailleurs (aperçu du book, assistant) : on le reprend, sauf pendant la saisie ici.
  useEffect(() => {
    const el = ref.current
    if (!el || value === last.current || document.activeElement === el) return
    el.innerHTML = markdownToHtml(value)
    el.classList.toggle('is-empty', !value.trim())
    last.current = value
  }, [value])

  const emit = () => {
    if (!ref.current) return
    const md = htmlToMarkdown(ref.current)
    ref.current.classList.toggle('is-empty', !md.trim())
    last.current = md
    onChange(md)
  }

  const command = (name: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(name, false, arg)
    emit()
  }

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const plain = e.clipboardData.getData('text/plain')
    let md = plain
    // Le texte brut de ChatGPT est déjà en Markdown ; sinon on lit la mise en forme du HTML.
    if (html && !/(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s)|\*\*/.test(plain)) {
      md = htmlToMarkdown(new DOMParser().parseFromString(html, 'text/html').body)
    }
    md = cleanMarkdown(md)
    if (!md.includes('\n') && !/[#*]/.test(md)) document.execCommand('insertText', false, md)
    else document.execCommand('insertHTML', false, markdownToHtml(md))
    emit()
  }

  return (
    <div className="richtext">
      <div className="richtext-toolbar">
        <button type="button" className="button" onMouseDown={(e) => e.preventDefault()} onClick={() => command('formatBlock', 'h2')}>
          Titre
        </button>
        <button type="button" className="button" onMouseDown={(e) => e.preventDefault()} onClick={() => command('formatBlock', 'h3')}>
          Sous-titre
        </button>
        <button type="button" className="button" onMouseDown={(e) => e.preventDefault()} onClick={() => command('formatBlock', 'p')}>
          Texte
        </button>
        <span className="richtext-sep" />
        <button type="button" className="button richtext-bold" onMouseDown={(e) => e.preventDefault()} onClick={() => command('bold')}>
          Gras
        </button>
        <button type="button" className="button" onMouseDown={(e) => e.preventDefault()} onClick={() => command('insertUnorderedList')}>
          • Liste
        </button>
      </div>
      <div
        ref={ref}
        className="richtext-area"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.metaKey && e.key.toLowerCase() === 'b') {
            e.preventDefault()
            command('bold')
          }
        }}
      />
    </div>
  )
}
