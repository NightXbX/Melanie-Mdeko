import { Icon, type IconName } from './Icon'
import { UpdateBar } from './UpdateBar'

export type View = 'shopping' | 'projects' | 'artisans' | 'check' | 'trash'

interface Props {
  current: View
  onSelect(view: View): void
  onSettings(): void
}

export function Sidebar({ current, onSelect, onSettings }: Props) {
  const item = (view: View, icon: IconName, label: string) => (
    <button
      type="button"
      className={`sidebar-item${current === view ? ' is-selected' : ''}`}
      aria-current={current === view ? 'page' : undefined}
      onClick={() => onSelect(view)}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-titlebar" />
      <nav className="sidebar-nav">
        <div className="sidebar-section">
          {item('shopping', 'bag', 'Shopping list')}
          {item('projects', 'folder', 'Projets')}
          {item('artisans', 'people', 'Artisans')}
        </div>
        <div className="sidebar-section sidebar-bottom">
          {item('check', 'shield', 'Vérification')}
          {item('trash', 'trash', 'Corbeille')}
          <button type="button" className="sidebar-item" onClick={onSettings}>
            <Icon name="gear" />
            <span>Réglages</span>
          </button>
          <UpdateBar />
        </div>
      </nav>
    </aside>
  )
}
