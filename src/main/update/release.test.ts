import { describe, expect, it } from 'vitest'
import { availableUpdate, isNewer, macSwapScript } from './release'

const release = {
  tag_name: 'v0.1.12',
  body: 'Corrections',
  assets: [
    { name: 'Mdeko-0.1.12-arm64.dmg', browser_download_url: 'https://x/dmg', size: 10 },
    { name: 'Mdeko-0.1.12-arm64.zip', browser_download_url: 'https://x/zip', size: 20, digest: 'sha256:abc' },
    { name: 'Mdeko-0.1.12-windows-installation.exe', browser_download_url: 'https://x/exe', size: 30 }
  ]
}

describe('mises à jour', () => {
  it('compare les versions nombre par nombre', () => {
    expect(isNewer('0.1.12', '0.1.9')).toBe(true)
    expect(isNewer('v0.2.0', '0.1.40')).toBe(true)
    expect(isNewer('0.1.9', '0.1.9')).toBe(false)
    expect(isNewer('0.1.8', '0.1.9')).toBe(false)
  })

  it('choisit le fichier qui convient à l’ordinateur', () => {
    expect(availableUpdate(release, '0.1.3', 'darwin')).toEqual({
      version: '0.1.12',
      notes: 'Corrections',
      asset: { name: 'Mdeko-0.1.12-arm64.zip', url: 'https://x/zip', size: 20, sha256: 'abc' }
    })
    expect(availableUpdate(release, '0.1.3', 'win32')?.asset.url).toBe('https://x/exe')
    expect(availableUpdate(release, '0.1.12', 'darwin')).toBeNull()
    expect(availableUpdate({ ...release, draft: true }, '0.1.3', 'darwin')).toBeNull()
    expect(availableUpdate(release, '0.1.3', 'linux')).toBeNull()
  })

  it('prépare le remplacement de l’appli sur Mac, avec retour en arrière', () => {
    const script = macSwapScript(42, "/Applications/Mdeko.app", "/tmp/maj/Mdeko.app")
    expect(script).toContain('while kill -0 42')
    expect(script).toContain("mv '/Applications/Mdeko.app' '/Applications/Mdeko.app.ancienne'")
    expect(script).toContain("open '/Applications/Mdeko.app'")
  })
})
