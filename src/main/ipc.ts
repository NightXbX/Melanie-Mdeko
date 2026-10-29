import type { DatabaseSync } from 'node:sqlite'
import { app, ipcMain, shell } from 'electron'
import { IPC, type AppInfo, type ArticleFilters, type ArticleQuery } from '@shared/api'
import { articleFacets, getArticle, searchArticles } from './articles'
import { listBackups } from './backup'
import { schemaVersion } from './db/database'
import type { DataPaths } from './paths'

const MAX_PAGE = 200

export function registerIpc(db: DatabaseSync, paths: DataPaths, backupNow: () => string): void {
  ipcMain.handle(IPC.getAppInfo, (): AppInfo => {
    const last = listBackups(paths.backups)[0]
    return {
      version: app.getVersion(),
      platform: process.platform,
      dataDir: paths.root,
      schemaVersion: schemaVersion(db),
      lastBackupAt: last ? last.date.toISOString() : null
    }
  })
  ipcMain.handle(IPC.openDataFolder, async () => {
    await shell.openPath(paths.root)
  })
  ipcMain.handle(IPC.backupNow, () => backupNow())

  ipcMain.handle(IPC.searchArticles, (_e, q: ArticleQuery) =>
    searchArticles(db, { ...q, limit: Math.min(Math.max(q.limit, 1), MAX_PAGE), offset: Math.max(q.offset, 0) })
  )
  ipcMain.handle(IPC.articleFacets, (_e, text: string, filters: ArticleFilters) => articleFacets(db, text, filters))
  ipcMain.handle(IPC.getArticle, (_e, id: number) => getArticle(db, id))

  // Seuls les liens web s'ouvrent, dans le navigateur par défaut.
  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
}
