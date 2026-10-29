import { useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { ProjectsView } from './views/ProjectsView'
import { ShoppingListView } from './views/ShoppingListView'
import { TrashView } from './views/TrashView'

export function App() {
  const [view, setView] = useState<View>('shopping')

  return (
    <div className="app">
      <Sidebar current={view} onSelect={setView} />
      <main className="content">
        {view === 'shopping' && <ShoppingListView />}
        {view === 'projects' && <ProjectsView />}
        {view === 'trash' && <TrashView />}
      </main>
    </div>
  )
}
