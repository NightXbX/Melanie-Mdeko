import { useEffect, useState } from 'react'
import { AppProvider } from './app-context'
import { Sidebar, type View } from './components/Sidebar'
import { ProjectsView } from './views/ProjectsView'
import { ShoppingListView } from './views/ShoppingListView'
import { TrashView } from './views/TrashView'

export function App() {
  const [view, setView] = useState<View>('shopping')
  const [newArticleSignal, setNewArticleSignal] = useState(0)

  // Fichier › Nouvel article : on revient sur la shopping list et on ouvre le formulaire.
  useEffect(
    () =>
      window.mdeko.onMenu((command) => {
        if (command !== 'new-article') return
        setView('shopping')
        setNewArticleSignal((n) => n + 1)
      }),
    []
  )

  return (
    <AppProvider>
      <div className="app">
        <Sidebar current={view} onSelect={setView} />
        <main className="content">
          {view === 'shopping' && <ShoppingListView newArticleSignal={newArticleSignal} />}
          {view === 'projects' && <ProjectsView />}
          {view === 'trash' && <TrashView />}
        </main>
      </div>
    </AppProvider>
  )
}
