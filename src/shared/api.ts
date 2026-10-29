// Contrat entre le processus principal et l'interface (exposé via le preload).

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
  schemaVersion: number
  lastBackupAt: string | null
}

export interface MdekoApi {
  getAppInfo(): Promise<AppInfo>
  openDataFolder(): Promise<void>
  backupNow(): Promise<string>
}

export const IPC = {
  getAppInfo: 'app:get-info',
  openDataFolder: 'app:open-data-folder',
  backupNow: 'app:backup-now'
} as const
