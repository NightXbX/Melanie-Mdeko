import { Icon } from '../components/Icon'
import { EmptyState, Toolbar } from '../components/Toolbar'

export function ProjectsView() {
  return (
    <>
      <Toolbar title="Projets">
        <button type="button" className="button button-primary">
          <Icon name="plus" size={14} />
          Nouveau projet
        </button>
      </Toolbar>
      <div className="content-body">
        <EmptyState title="Aucun projet" />
      </div>
    </>
  )
}
