import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type MdekoApi, type MenuCommand } from '@shared/api'

const api: MdekoApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  backupNow: () => ipcRenderer.invoke(IPC.backupNow),
  searchArticles: (query) => ipcRenderer.invoke(IPC.searchArticles, query),
  articleFacets: (text, filters) => ipcRenderer.invoke(IPC.articleFacets, text, filters),
  getArticle: (id) => ipcRenderer.invoke(IPC.getArticle, id),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  editorChoices: () => ipcRenderer.invoke(IPC.editorChoices),
  getArticleInput: (id) => ipcRenderer.invoke(IPC.getArticleInput, id),
  saveArticle: (input) => ipcRenderer.invoke(IPC.saveArticle, input),
  uploadImage: (image) => ipcRenderer.invoke(IPC.uploadImage, image),
  downloadImage: (url) => ipcRenderer.invoke(IPC.downloadImage, url),
  trashArticle: (id) => ipcRenderer.invoke(IPC.trashArticle, id),
  restoreArticle: (id) => ipcRenderer.invoke(IPC.restoreArticle, id),
  listTrash: () => ipcRenderer.invoke(IPC.listTrash),
  undo: () => ipcRenderer.invoke(IPC.undo),
  confirm: (message, detail, action) => ipcRenderer.invoke(IPC.confirm, message, detail, action),
  onMenu: (listener) => {
    const handler = (_e: IpcRendererEvent, command: MenuCommand) => listener(command)
    ipcRenderer.on(IPC.menu, handler)
    return () => ipcRenderer.removeListener(IPC.menu, handler)
  }
}

contextBridge.exposeInMainWorld('mdeko', api)
contextBridge.exposeInMainWorld('platform', process.platform)
