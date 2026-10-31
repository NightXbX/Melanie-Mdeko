import { useEffect, useState } from 'react'
import { AppProvider } from './app-context'
import { ImportSheet } from './components/ImportSheet'
import { SettingsSheet } from './components/SettingsSheet'
import { Sidebar, type View } from './components/Sidebar'
import { ArtisansView } from './views/ArtisansView'
import { CheckView } from './views/CheckView'
import { ProjectsView } from './views/ProjectsView'
import { ShoppingListView } from './views/ShoppingListView'
import { TrashView } from './views/TrashView'
import { KeepAlive } from './lib/keep-alive'

export function App() {
  const [view, setView] = useState<View>('shopping')
  const [newArticleSignal, setNewArticleSignal] = useState(0)
  const [newProjectSignal, setNewProjectSignal] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importing, setImporting] = useState<{ path?: string } | null>(null)
  const [openProject, setOpenProject] = useState<{ id: number } | null>(null)

  // Commandes des menus : Nouvel article (⌘N), Nouveau projet (⇧⌘N), Réglages (⌘,).
  useEffect(
    () =>
      window.mdeko.onMenu((command) => {
        if (command === 'new-article') {
          setView('shopping')
          setNewArticleSignal((n) => n + 1)
        } else if (command === 'new-project') {
          setView('projects')
          setNewProjectSignal((n) => n + 1)
        } else if (command === 'settings') {
          setSettingsOpen(true)
        } else if (command === 'import') {
          setImporting({})
        }
      }),
    []
  )

  return (
    <AppProvider>
      <div className="app">
        <Sidebar current={view} onSelect={setView} onSettings={() => setSettingsOpen(true)} />
        {/* La shopping list et les projets restent ouverts : on y revient exactement où on en était. */}
        <main className="content">
          <KeepAlive active={view === 'shopping'}>
            <ShoppingListView newArticleSignal={newArticleSignal} />
          </KeepAlive>
          <KeepAlive active={view === 'projects'}>
            <ProjectsView newProjectSignal={newProjectSignal} openRequest={openProject} onImport={(path) => setImporting({ path })} />
          </KeepAlive>
          {view === 'artisans' && <ArtisansView />}
          {view === 'check' && <CheckView />}
          {view === 'trash' && <TrashView />}
        </main>
      </div>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {importing && (
        <ImportSheet
          path={importing.path}
          onClose={() => setImporting(null)}
          onOpenProject={(id) => {
            setImporting(null)
            setView('projects')
            setOpenProject({ id })
          }}
        />
      )}
    </AppProvider>
  )
}
