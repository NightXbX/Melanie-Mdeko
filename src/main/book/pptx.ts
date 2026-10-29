import PptxGenJS from 'pptxgenjs'
import { COLORS, FONT_FACES, PAGE } from './charte'
import type { Element, Page } from './layout'

const MM_PER_INCH = 25.4
const inch = (mm: number) => mm / MM_PER_INCH
const hex = (color: string | undefined) => (color ?? COLORS.text).replace('#', '')

function position(e: { x: number; y: number; w: number; h: number }) {
  return { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h) }
}

function addElement(pptx: PptxGenJS, slide: PptxGenJS.Slide, e: Element): void {
  switch (e.type) {
    case 'image':
      slide.addImage({ path: e.image.path, ...position(e) })
      return
    case 'rect':
    case 'ellipse':
      slide.addShape(e.type === 'rect' ? pptx.ShapeType.rect : pptx.ShapeType.ellipse, {
        ...position(e),
        fill: e.fill ? { color: hex(e.fill) } : { type: 'none' },
        line: e.line ? { color: hex(e.line), width: 0.5 } : { type: 'none' }
      })
      return
    case 'text': {
      const s = e.style
      const runs = e.runs.map((r) => ({
        text: r.text,
        options: {
          color: hex(r.color ?? s.color),
          fontFace: FONT_FACES[r.weight ?? s.weight ?? 200],
          ...(e.link ? { hyperlink: { url: e.link } } : {})
        }
      }))
      slide.addText(runs, {
        ...position(e),
        fontSize: s.size,
        fontFace: FONT_FACES[s.weight ?? 200],
        color: hex(s.color),
        align: s.align ?? 'left',
        valign: s.valign ?? 'top',
        lineSpacingMultiple: s.lineHeight ?? 1.3,
        charSpacing: s.letterSpacing,
        rotate: e.rotate,
        margin: 0,
        fit: 'none',
        wrap: true
      })
    }
  }
}

// PowerPoint modifiable : chaque texte et chaque image est un élément séparé, placé comme dans le PDF.
export async function bookPptx(pages: Page[], title: string): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'A4_PAYSAGE', width: inch(PAGE.width), height: inch(PAGE.height) })
  pptx.layout = 'A4_PAYSAGE'
  pptx.title = title
  pptx.company = 'm·deko'
  for (const page of pages) {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    for (const e of page.elements) addElement(pptx, slide, e)
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}
