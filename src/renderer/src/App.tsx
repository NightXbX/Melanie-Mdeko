import { useEffect, useState } from 'react'
import { AppProvider } from './app-context'
import { ImportSheet } from './components/ImportSheet'
import { SettingsSheet } from './components/SettingsSheet'
import { Sidebar, type View } from './components/Sidebar'
import { ProjectsView } from './views/ProjectsView'
import { ShoppingListView } from './views/ShoppingListView'
import { TrashView } from './views/TrashView'

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
        <Sidebar current={view} onSelect={setView} />
        <main className="content">
          {view === 'shopping' && <ShoppingListView newArticleSignal={newArticleSignal} />}
          {view === 'projects' && (
            <ProjectsView newProjectSignal={newProjectSignal} openRequest={openProject} onImport={(path) => setImporting({ path })} />
          )}
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
