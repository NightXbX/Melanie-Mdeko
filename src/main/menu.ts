import { app, Menu, type MenuItemConstructorOptions } from 'electron'

export interface MenuActions {
  backupNow(): void
  openDataFolder(): void
}

// Menus natifs en français avec les raccourcis Mac habituels.
export function buildMenu(actions: MenuActions): void {
  const isMac = process.platform === 'darwin'
  const name = app.name
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: name,
            submenu: [
              { role: 'about', label: `À propos de ${name}` },
              sep,
              { role: 'hide', label: `Masquer ${name}` },
              { role: 'hideOthers', label: 'Masquer les autres' },
              { role: 'unhide', label: 'Tout afficher' },
              sep,
              { role: 'quit', label: `Quitter ${name}` }
            ] as MenuItemConstructorOptions[]
          }
        ]
      : []),
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouveau projet', accelerator: 'CmdOrCtrl+N', enabled: false },
        sep,
        { label: 'Faire une sauvegarde maintenant', click: actions.backupNow },
        { label: 'Afficher le dossier des données', click: actions.openDataFolder },
        sep,
        { role: 'close', label: 'Fermer la fenêtre' },
        ...(isMac ? [] : [{ role: 'quit', label: 'Quitter' } as MenuItemConstructorOptions])
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        sep,
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      ]
    },
    {
      label: 'Présentation',
      submenu: [
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        sep,
        { role: 'togglefullscreen', label: 'Plein écran' },
        ...(app.isPackaged
          ? []
          : [
              sep,
              { role: 'reload', label: 'Recharger' },
              { role: 'toggleDevTools', label: 'Outils de développement' }
            ] as MenuItemConstructorOptions[])
      ]
    },
    {
      label: 'Fenêtre',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: 'Placer dans le Dock' },
        { role: 'zoom', label: 'Agrandir/réduire' },
        ...(isMac ? [sep, { role: 'front', label: 'Tout ramener au premier plan' } as MenuItemConstructorOptions] : [])
      ]
    },
    {
      label: 'Aide',
      role: 'help',
      submenu: [{ label: 'Signaler un problème ou une idée…', enabled: false }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
