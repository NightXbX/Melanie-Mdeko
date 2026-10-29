import type { ReactNode } from 'react'

// Barre du haut : sert aussi de poignée pour déplacer la fenêtre.
export function Toolbar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="toolbar">
      <h1 className="toolbar-title">{title}</h1>
      <div className="toolbar-items">{children}</div>
    </header>
  )
}

export function EmptyState({ title }: { title: string }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
    </div>
  )
}
