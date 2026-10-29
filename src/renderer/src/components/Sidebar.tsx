import { Icon, type IconName } from './Icon'

export type View = 'shopping' | 'projects' | 'trash'

interface Props {
  current: View
  onSelect(view: View): void
}

export function Sidebar({ current, onSelect }: Props) {
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
        </div>
        <div className="sidebar-section sidebar-bottom">{item('trash', 'trash', 'Corbeille')}</div>
      </nav>
    </aside>
  )
}
