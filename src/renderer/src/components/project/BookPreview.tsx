import { useEffect, useRef, useState } from 'react'

const PAGE_WIDTH_PX = 1123 // 297 mm à 96 ppp

// Aperçu fidèle du book : exactement le HTML qui sert au PDF, réduit à la largeur du panneau.
export function BookPreview({ projectId, version }: { projectId: number; version: unknown }) {
  const [html, setHtml] = useState('')
  const [zoom, setZoom] = useState(0.4)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    const t = setTimeout(() => void window.mdeko.projects.preview(projectId).then((h) => current && setHtml(h)), 300)
    return () => {
      current = false
      clearTimeout(t)
    }
  }, [projectId, version])

  useEffect(() => {
    const el = panel.current
    if (!el) return
    const observer = new ResizeObserver(() => setZoom((el.clientWidth - 40) / PAGE_WIDTH_PX))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const doc = html.replace('</style>', `body{zoom:${zoom.toFixed(3)}}</style>`)
  return (
    <div className="book-preview" ref={panel}>
      {html ? <iframe title="Aperçu du design book" sandbox="allow-same-origin" srcDoc={doc} /> : null}
    </div>
  )
}
