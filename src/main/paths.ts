import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'

// Ce que Mélanie voit dans Documents/Melanie Mdeko :
//   Projets/2026/Mme Durand/…        ses design books exportés, rangés par année
//   Fichiers de l'application/       la base, les images et les sauvegardes (à ne pas toucher)
export const APP_FILES = 'Fichiers de l’application'
export const PROJECTS = 'Projets'

export interface DataPaths {
  home: string
  root: string // dossier technique : base, images, sauvegardes
  database: string
  images: string
  backups: string
  projects: string
}

// En production : ~/Documents/Melanie Mdeko (sauvegardé par Time Machine).
// En développement : ./donnees à la racine du dépôt (ignoré par git), pour ne jamais toucher aux vraies données.
export function resolveDataPaths(): DataPaths {
  const home = process.env.MDEKO_DATA_DIR
    ? resolve(process.env.MDEKO_DATA_DIR)
    : app.isPackaged
      ? join(app.getPath('documents'), 'Melanie Mdeko')
      : resolve(process.cwd(), 'donnees')
  return dataPathsIn(home)
}

export function dataPathsIn(home: string): DataPaths {
  const root = join(home, APP_FILES)
  moveLegacyLayout(home, root)
  const paths: DataPaths = {
    home,
    root,
    database: join(root, 'mdeko.sqlite'),
    images: join(root, 'images'),
    backups: join(root, 'sauvegardes'),
    projects: join(home, PROJECTS)
  }
  for (const dir of [paths.root, paths.images, paths.backups, paths.projects]) {
    mkdirSync(dir, { recursive: true })
  }
  return paths
}

// Première organisation (base et images directement dans le dossier) : on range tout dans le dossier technique.
function moveLegacyLayout(home: string, root: string): void {
  if (!existsSync(join(home, 'mdeko.sqlite')) || existsSync(join(root, 'mdeko.sqlite'))) return
  mkdirSync(root, { recursive: true })
  for (const name of readdirSync(home)) {
    if (name !== APP_FILES && name !== PROJECTS) renameSync(join(home, name), join(root, name))
  }
}
