import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MdekoApi } from '@shared/api'

const api: MdekoApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  backupNow: () => ipcRenderer.invoke(IPC.backupNow),
  searchArticles: (query) => ipcRenderer.invoke(IPC.searchArticles, query),
  articleFacets: (text, filters) => ipcRenderer.invoke(IPC.articleFacets, text, filters),
  getArticle: (id) => ipcRenderer.invoke(IPC.getArticle, id),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url)
}

contextBridge.exposeInMainWorld('mdeko', api)
contextBridge.exposeInMainWorld('platform', process.platform)
