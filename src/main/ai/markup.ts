// Traits dessinés par Mélanie (calque PNG transparent) posés sur une image, pour montrer à l'IA
// où agir ou quel objet prendre. On mélange les pixels nous-mêmes : nativeImage ne sait pas superposer.

export interface Bitmap {
  width: number
  height: number
  data: Uint8Array // 4 octets par pixel, couleurs prémultipliées par l'opacité (format de nativeImage)
}

// Calque par-dessus l'image : chaque pixel du calque masque l'image selon son opacité.
export function overlay(base: Bitmap, layer: Bitmap): Uint8Array {
  if (base.width !== layer.width || base.height !== layer.height) throw new Error('Le calque n’a pas la taille de l’image.')
  const out = new Uint8Array(base.data)
  // L'ordre des couleurs (BGRA ou RGBA) est le même dans les deux images : seule l'opacité est à sa place fixe.
  for (let i = 0; i < out.length; i += 4) {
    const a = layer.data[i + 3]
    if (a === 0) continue
    const keep = 255 - a
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, layer.data[i + c] + Math.round((base.data[i + c] * keep) / 255))
    out[i + 3] = 255
  }
  return out
}
