import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface Toast {
  id: number
  message: string
  undoable: boolean
}

interface AppContextValue {
  // Change à chaque modification des données : les écrans s'en servent pour se recharger.
  dataVersion: number
  refresh(): void
  notify(message: string, undoable?: boolean): void
  undo(): Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp doit être utilisé dans AppProvider')
  return value
}

const isEditable = (el: Element | null) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type)) ||
  (el instanceof HTMLElement && el.isContentEditable)

export function AppProvider({ children }: { children: ReactNode }) {
  const [dataVersion, setDataVersion] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const refresh = useCallback(() => setDataVersion((v) => v + 1), [])

  const notify = useCallback((message: string, undoable = false) => {
    clearTimeout(timer.current)
    setToast({ id: Date.now(), message, undoable })
    timer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  const undo = useCallback(async () => {
    const result = await window.mdeko.undo()
    if (result) {
      refresh()
      notify(result.label)
    } else {
      notify('Rien à annuler')
    }
  }, [notify, refresh])

  // ⌘Z : dans un champ de texte, on annule la frappe ; sinon la dernière action.
  useEffect(
    () =>
      window.mdeko.onMenu((command) => {
        if (command !== 'undo') return
        if (isEditable(document.activeElement)) document.execCommand('undo')
        else void undo()
      }),
    [undo]
  )

  return (
    <AppContext.Provider value={{ dataVersion, refresh, notify, undo }}>
      {children}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undoable && (
            <button
              type="button"
              onClick={() => {
                setToast(null)
                void undo()
              }}
            >
              Annuler
            </button>
          )}
        </div>
      )}
    </AppContext.Provider>
  )
}
