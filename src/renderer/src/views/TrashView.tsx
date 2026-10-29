import { EmptyState, Toolbar } from '../components/Toolbar'

export function TrashView() {
  return (
    <>
      <Toolbar title="Corbeille" />
      <div className="content-body">
        <EmptyState title="La corbeille est vide" />
      </div>
    </>
  )
}
