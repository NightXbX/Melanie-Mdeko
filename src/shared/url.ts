// Lien sans paramètres de suivi publicitaire (mêmes règles que tools/migration/regles.py).
const TRACKING = new Set([
  'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'dclid', 'gad_source', 'gad_campaignid',
  '_gl', 'srsltid', 'cmpid', 'queryid', 'shoppingtool', 'searchkeyword', 'kclkid', 'kvsid',
  'cod', 'kard', 'at_medium', 'at_source', 'at_campaign', 'at_placement', 'at_market',
  'at_section', 'megaboost', 'gqt', 'id_c', 'docid'
])

export function cleanUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase()
    if (k.startsWith('utm_') || TRACKING.has(k)) url.searchParams.delete(key)
  }
  // Les ancres « #/… » désignent une variante (couleur, taille) ; les autres sont du suivi.
  if (!url.hash.startsWith('#/')) url.hash = ''
  url.protocol = 'https:'
  return url.toString()
}

// Ajoute https:// si Mélanie colle « www.site.fr/… ».
export function normalizeUrlInput(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}
