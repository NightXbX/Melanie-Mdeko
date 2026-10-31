import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

// Clic droit (ou clic à deux doigts) : corrections proposées pour un mot souligné, puis couper, copier, coller.
export function attachContextMenu(win: BrowserWindow): void {
  const contents = win.webContents
  contents.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = []
    const sep: MenuItemConstructorOptions = { type: 'separator' }

    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 5)
      if (suggestions.length) {
        for (const word of suggestions) items.push({ label: word, click: () => contents.replaceMisspelling(word) })
      } else {
        items.push({ label: 'Aucune correction proposée', enabled: false })
      }
      items.push(
        {
          label: 'Ajouter au dictionnaire',
          click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        },
        sep
      )
    }

    const { editFlags } = params
    if (params.isEditable) {
      items.push(
        { role: 'cut', label: 'Couper', enabled: editFlags.canCut },
        { role: 'copy', label: 'Copier', enabled: editFlags.canCopy },
        { role: 'paste', label: 'Coller', enabled: editFlags.canPaste },
        sep,
        { role: 'selectAll', label: 'Tout sélectionner' }
      )
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy', label: 'Copier' })
    }

    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}
