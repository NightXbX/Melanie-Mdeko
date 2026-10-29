import type { DatabaseSync } from 'node:sqlite'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC, PROJECT_METHODS, type ProjectsApi } from '@shared/api'
import { bookPages, exportBook, projectFolder } from './book/export'
import type { DataPaths } from './paths'
import * as p from './projects'

// Implémentation côté processus principal de window.mdeko.projects.
export function registerProjectsIpc(db: DatabaseSync, paths: DataPaths): void {
  const api: { [K in keyof ProjectsApi]: (sender: BrowserWindow | null, ...args: Parameters<ProjectsApi[K]>) => unknown } = {
    list: () => p.listProjects(db),
    create: (_w, title, name) => p.createProject(db, title, name),
    get: (_w, id) => p.getProject(db, id),
    update: (_w, id, patch) => p.updateProject(db, id, patch),
    trash: (_w, id) => p.setProjectDeleted(db, id, true),
    restore: (_w, id) => p.setProjectDeleted(db, id, false),
    setRooms: (_w, id, names) => p.setRooms(db, id, names),
    addRenders: (_w, id, imageIds, section) => p.addRenders(db, id, imageIds, section),
    updateRender: (_w, renderId, patch) => p.updateRender(db, renderId, patch),
    removeRender: (_w, renderId) => p.removeRender(db, renderId),
    reorder: (_w, table, ids) => p.reorder(db, table === 'needs' ? 'needs' : 'renders', ids),
    addNeed: (_w, id, articleId, roomId) => p.addNeed(db, id, articleId, roomId ?? null),
    setNeedRoom: (_w, needId, roomId) => p.setNeedRoom(db, needId, roomId),
    setNeedChoice: (_w, needId, articleId) => p.setNeedChoice(db, needId, articleId),
    setNeedAlternatives: (_w, needId, ids) => p.setNeedAlternatives(db, needId, ids),
    setNeedImages: (_w, needId, ids) => p.setNeedImages(db, needId, ids),
    removeNeed: (_w, needId) => p.removeNeed(db, needId),
    listPaints: () => p.listPaints(db),
    createPaint: (_w, paint) => p.createPaint(db, paint),
    listArtisans: () => p.listArtisans(db),
    saveArtisan: (_w, artisan) => p.saveArtisan(db, artisan),
    setLinks: (_w, id, table, ids) => p.setProjectLinks(db, id, table === 'project_artisans' ? 'project_artisans' : 'project_paints', ids),
    getSettings: () => p.getSettings(db),
    saveSettings: (_w, settings) => p.saveSettings(db, settings),
    pages: (_w, id) => bookPages(db, paths, id),
    editText: (_w, id, key, text) => p.editBookText(db, id, key, text),
    addNote: (_w, id, pageKey, x, y) => p.addNote(db, id, pageKey, x, y),
    moveNote: (_w, noteId, x, y, w) => p.moveNote(db, noteId, x, y, w),
    adjust: (_w, id, pageKey, elementId, patch) => p.adjustElement(db, id, pageKey, elementId, patch),
    resetPage: (_w, id, pageKey) => p.resetPageAdjustments(db, id, pageKey),
    deleteNote: (_w, noteId) => p.deleteNote(db, noteId),
    export: (_w, id, format) => exportBook(db, paths, id, format),
    openFolder: async (_w, id) => {
      await shell.openPath(projectFolder(db, paths, id))
    }
  }

  ipcMain.handle(IPC.projects, (e, method: string, ...args: unknown[]) => {
    if (!(PROJECT_METHODS as readonly string[]).includes(method)) throw new Error(`Méthode inconnue : ${method}`)
    const fn = api[method as keyof ProjectsApi] as (sender: BrowserWindow | null, ...a: unknown[]) => unknown
    return fn(BrowserWindow.fromWebContents(e.sender), ...args)
  })
}
