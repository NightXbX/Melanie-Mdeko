import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'

export interface DataPaths {
  root: string
  database: string
  images: string
  backups: string
}

// En production : ~/Documents/Melanie Mdeko (sauvegardé par Time Machine).
// En développement : ./donnees à la racine du dépôt (ignoré par git), pour ne jamais toucher aux vraies données.
export function resolveDataPaths(): DataPaths {
  const root = process.env.MDEKO_DATA_DIR
    ? resolve(process.env.MDEKO_DATA_DIR)
    : app.isPackaged
      ? join(app.getPath('documents'), 'Melanie Mdeko')
      : resolve(process.cwd(), 'donnees')
  return dataPathsIn(root)
}

export function dataPathsIn(root: string): DataPaths {
  const paths: DataPaths = {
    root,
    database: join(root, 'mdeko.sqlite'),
    images: join(root, 'images'),
    backups: join(root, 'sauvegardes')
  }
  for (const dir of [paths.root, paths.images, paths.backups]) {
    mkdirSync(dir, { recursive: true })
  }
  return paths
}
