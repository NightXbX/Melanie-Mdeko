import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { AI_METHODS, HOMEBYME_METHODS, IPC, PROJECT_METHODS, type AiApi, type HomeByMeApi, type LinkCheckProgress, type MdekoApi, type MenuCommand, type ProjectsApi, type UpdateInfo } from '@shared/api'

const projects = Object.fromEntries(
  PROJECT_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(IPC.projects, method, ...args)])
) as unknown as ProjectsApi

const ai = Object.fromEntries(AI_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(IPC.ai, method, ...args)])) as unknown as AiApi

const homebyme = Object.fromEntries(
  HOMEBYME_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(IPC.homebyme, method, ...args)])
) as unknown as HomeByMeApi

const api: MdekoApi = {
  projects,
  ai,
  homebyme,
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  backupNow: () => ipcRenderer.invoke(IPC.backupNow),
  onBackupDone: (listener) => {
    const handler = (_e: IpcRendererEvent, at: string) => listener(at)
    ipcRenderer.on(IPC.backupDone, handler)
    return () => ipcRenderer.removeListener(IPC.backupDone, handler)
  },
  searchArticles: (query) => ipcRenderer.invoke(IPC.searchArticles, query),
  articleFacets: (text, filters) => ipcRenderer.invoke(IPC.articleFacets, text, filters),
  getArticle: (id) => ipcRenderer.invoke(IPC.getArticle, id),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  editorChoices: () => ipcRenderer.invoke(IPC.editorChoices),
  getArticleInput: (id) => ipcRenderer.invoke(IPC.getArticleInput, id),
  saveArticle: (input) => ipcRenderer.invoke(IPC.saveArticle, input),
  uploadImage: (image) => ipcRenderer.invoke(IPC.uploadImage, image),
  downloadImage: (url) => ipcRenderer.invoke(IPC.downloadImage, url),
  readProductPage: (url) => ipcRenderer.invoke(IPC.readProductPage, url),
  trashArticle: (id) => ipcRenderer.invoke(IPC.trashArticle, id),
  restoreArticle: (id) => ipcRenderer.invoke(IPC.restoreArticle, id),
  listTrash: () => ipcRenderer.invoke(IPC.listTrash),
  emptyTrash: () => ipcRenderer.invoke(IPC.emptyTrash),
  undo: () => ipcRenderer.invoke(IPC.undo),
  confirm: (message, detail, action) => ipcRenderer.invoke(IPC.confirm, message, detail, action),
  onMenu: (listener) => {
    const handler = (_e: IpcRendererEvent, command: MenuCommand) => listener(command)
    ipcRenderer.on(IPC.menu, handler)
    return () => ipcRenderer.removeListener(IPC.menu, handler)
  },
  importPdf: (path) => ipcRenderer.invoke(IPC.importPdf, path),
  onImportProgress: (listener) => {
    const handler = (_e: IpcRendererEvent, page: number, total: number) => listener(page, total)
    ipcRenderer.on(IPC.importProgress, handler)
    return () => ipcRenderer.removeListener(IPC.importProgress, handler)
  },
  // Chemin d'un fichier glissé depuis le Finder (le PDF à importer).
  pathForFile: (file) => webUtils.getPathForFile(file),
  checkDatabase: () => ipcRenderer.invoke(IPC.checkDatabase),
  checkLinks: () => ipcRenderer.invoke(IPC.checkLinks),
  stopLinkCheck: () => ipcRenderer.invoke(IPC.stopLinkCheck),
  onLinkProgress: (listener) => {
    const handler = (_e: IpcRendererEvent, progress: LinkCheckProgress) => listener(progress)
    ipcRenderer.on(IPC.linkProgress, handler)
    return () => ipcRenderer.removeListener(IPC.linkProgress, handler)
  },
  showDatabase: () => ipcRenderer.invoke(IPC.showDatabase),
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  onUpdateAvailable: (listener) => {
    const handler = (_e: IpcRendererEvent, update: UpdateInfo) => listener(update)
    ipcRenderer.on(IPC.updateAvailable, handler)
    return () => ipcRenderer.removeListener(IPC.updateAvailable, handler)
  },
  onUpdateProgress: (listener) => {
    const handler = (_e: IpcRendererEvent, done: number, total: number) => listener(done, total)
    ipcRenderer.on(IPC.updateProgress, handler)
    return () => ipcRenderer.removeListener(IPC.updateProgress, handler)
  }
}

contextBridge.exposeInMainWorld('mdeko', api)
contextBridge.exposeInMainWorld('platform', process.platform)
