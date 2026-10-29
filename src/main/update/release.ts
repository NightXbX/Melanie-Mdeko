// Mises à jour depuis les Releases GitHub du dépôt (publiques, sans compte) : la dernière version publiée
// et le fichier qui convient à cet ordinateur (zip de l'appli sur Mac, installateur sur Windows).

export const REPOSITORY = 'NightXbX/Melanie-Mdeko'
export const LATEST_RELEASE = `https://api.github.com/repos/${REPOSITORY}/releases/latest`

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  sha256: string | null
}

export interface Release {
  version: string
  notes: string
  asset: ReleaseAsset
}

interface GithubRelease {
  tag_name?: string
  body?: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: { name: string; browser_download_url: string; size: number; digest?: string | null }[]
}

// « 0.1.12 » plus récent que « 0.1.9 » (comparaison nombre par nombre).
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0)
  const a = parts(candidate)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

// Fichier à télécharger : l'appli zippée (Mac, Apple Silicon) ou l'installateur (Windows).
export function pickAsset(release: GithubRelease, platform: string): ReleaseAsset | null {
  const wanted = platform === 'darwin' ? /-arm64\.zip$/ : platform === 'win32' ? /-windows-installation\.exe$/ : null
  const a = wanted && release.assets?.find((x) => wanted.test(x.name))
  if (!a) return null
  const sha = a.digest?.startsWith('sha256:') ? a.digest.slice(7) : null
  return { name: a.name, url: a.browser_download_url, size: a.size, sha256: sha }
}

// Dernière version publiée, si elle est plus récente que celle qui tourne et a un fichier pour cet ordinateur.
export function availableUpdate(json: unknown, currentVersion: string, platform: string): Release | null {
  const r = json as GithubRelease
  if (!r?.tag_name || r.draft || r.prerelease) return null
  const version = r.tag_name.replace(/^v/, '')
  if (!isNewer(version, currentVersion)) return null
  const asset = pickAsset(r, platform)
  return asset ? { version, notes: r.body ?? '', asset } : null
}

// Script qui remplace l'appli sur Mac une fois qu'elle est fermée, puis la rouvre.
// En cas d'échec, l'ancienne version est remise en place.
export function macSwapScript(pid: number, appPath: string, newAppPath: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const app = q(appPath)
  const old = q(`${appPath}.ancienne`)
  return [
    '#!/bin/sh',
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`,
    `rm -rf ${old}`,
    `if mv ${app} ${old} && mv ${q(newAppPath)} ${app}; then rm -rf ${old}; else [ -d ${app} ] || mv ${old} ${app}; fi`,
    `open ${app}`,
    ''
  ].join('\n')
}
