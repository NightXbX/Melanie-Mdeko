import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MdekoApi } from '@shared/api'

const api: MdekoApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  backupNow: () => ipcRenderer.invoke(IPC.backupNow)
}

contextBridge.exposeInMainWorld('mdeko', api)
contextBridge.exposeInMainWorld('platform', process.platform)
