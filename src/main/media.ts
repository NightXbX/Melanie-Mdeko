import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_SCHEME, thumbnailPath } from './media-urls'

// À appeler avant app.whenReady().
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

// mdeko://media/<chemin relatif>  -> fichier du dossier de données
// mdeko://miniature/<sha256>      -> miniature, ou l'image complète si la miniature n'existe pas
export function handleMedia(dataRoot: string, imagePathBySha: (sha: string) => string | null): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url)
    let file: string | null = null
    if (url.host === 'media') {
      file = inside(dataRoot, decodeURIComponent(url.pathname.slice(1)))
    } else if (url.host === 'miniature') {
      const sha = url.pathname.slice(1)
      if (/^[0-9a-f]{64}$/.test(sha)) {
        const thumb = thumbnailPath(dataRoot, sha)
        const rel = existsSync(thumb) ? null : imagePathBySha(sha)
        file = rel ? inside(dataRoot, rel) : thumb
      }
    }
    if (!file || !existsSync(file)) return new Response('Introuvable', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

// Refuse tout chemin qui sortirait du dossier de données (« ../ »).
function inside(root: string, rel: string): string | null {
  const full = normalize(join(root, rel))
  const r = relative(root, full)
  return r && !r.startsWith('..') && !isAbsolute(r) ? full : null
}
