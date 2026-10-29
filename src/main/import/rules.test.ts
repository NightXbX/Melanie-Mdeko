import { describe, expect, it } from 'vitest'
import { category, colorMaterial, dimensions, isRoomSection, paintName, price, roomName, supplier } from './rules'

// Mêmes cas que tools/migration/test_regles.py : l'appli et l'outil Python doivent classer pareil.
describe('règles d’import', () => {
  it('lit les prix', () => {
    const cases: [string, number | null, string][] = [
      ['249,99', 24999, 'fixed'],
      ['1 449', 144900, 'fixed'],
      ['1.449', 144900, 'fixed'],
      ['19.90', 1990, 'fixed'],
      ['à partir de 19,90', 1990, 'from'],
      ['27,90/m2', 2790, 'per_m2'],
      ['27,90 le m²', 2790, 'per_m2'],
      ['89/rouleau', 8900, 'per_roll'],
      ['sur devis', null, 'on_quote'],
      ['voir tarif magasin', null, 'on_quote'],
      ['', null, 'unknown'],
      ['no', null, 'unknown']
    ]
    for (const [text, cents, kind] of cases) expect([text, price(text).cents, price(text).kind]).toEqual([text, cents, kind])
  })

  it('trouve dimensions, couleurs et matières', () => {
    expect(dimensions('Besta banc tv 180x42x38cm')).toBe('180 × 42 × 38cm')
    expect(dimensions('Table basse marbre et bois diam. 85 cm')).toBe('Ø 85 cm')
    expect(dimensions('Tapis 200 x 300')).toBe('200 × 300')
    expect(dimensions('Fauteuil bouclette')).toBeNull()
    expect(colorMaterial('Table basse marbre et bois')).toBe('bois, marbre')
    expect(colorMaterial('Applique, métal noir')).toBe('métal, noir')
    expect(colorMaterial('Pinceau')).toBeNull()
  })

  it('unifie les fournisseurs', () => {
    for (const raw of ['Ikea', 'IKEA', ' ikea ']) expect(supplier(raw)).toBe('IKEA')
    expect(supplier('MAISON DU MONDE')).toBe('Maisons du Monde')
    expect(supplier('La redoute')).toBe('La Redoute')
    expect(supplier('Atmosphèra')).toBe('Atmosphera')
    expect(supplier('SOMEWHERE NEW')).toBe('Somewhere New')
    expect(supplier('  ')).toBeNull()
  })

  it('range dans les familles et sous-catégories', () => {
    expect(category('FAUTEUILS', 'Fauteuil Ulit')).toEqual(['Assises', 'Fauteuils'])
    expect(category('ÉTAGÈRES', 'Étagère murale')).toEqual(['Rangements', 'Bibliothèques & étagères'])
    expect(category('TABLES & CHAISES', 'Chaise Visby')).toEqual(['Assises', 'Chaises'])
    expect(category('TABLES & CHAISES', 'Table à manger')).toEqual(['Tables & bureaux', 'Tables à manger'])
    expect(category('LUMINAIRES', 'Suspension grappe')).toEqual(['Luminaires', 'Suspensions'])
    expect(category('LITERIE', 'Le matelas en latex')).toEqual(['Chambre', 'Matelas & sommiers'])
    expect(category('LITERIE', 'Tête de lit')).toEqual(['Chambre', 'Têtes de lit'])
    expect(category('COUSSINS - PLAID', 'Plaid blanc cassé')).toEqual(['Textiles', 'Plaids'])
    expect(category('COUSSINS', 'Housse')).toEqual(['Textiles', 'Coussins'])
    expect(category('NOUVEAUTÉ', 'Truc')).toEqual(['Décoration', 'Divers'])
  })

  it('reconnaît les intercalaires de pièces', () => {
    for (const s of ['ENTRÉE', 'CUISINE – SALLE À MANGER', 'CHAMBRE PARENTALE', 'SALLE CINÉMA', 'PALIER']) expect(isRoomSection(s)).toBe(true)
    for (const s of ['LUMINAIRES', 'SHOPPING LIST', 'RIDEAUX - STORE', 'CUISINE EXTERIEURE', 'DRESSING']) expect(isRoomSection(s)).toBe(false)
    expect(roomName('CUISINE – SALLE À MANGER')).toBe('Cuisine – salle à manger')
    expect(roomName('CHAMBRE  LOUISE')).toBe('Chambre Louise')
    expect(roomName('CHAMBRE PARENTALE')).toBe('Chambre parentale')
    expect(roomName('SALLE DE BAIN ')).toBe('Salle de bain')
  })

  it('lit le nom et la référence des teintes', () => {
    expect(paintName('ALL WHITE N ° 2005 FORROW&BALL')).toEqual(['All white', 'N° 2005'])
    expect(paintName('SCHOOL HOUSE 291 FORROW&BALL')).toEqual(['School house', 'N° 291'])
    expect(paintName('SAUTE DANS LES FLAQUES')).toEqual(['Saute dans les flaques', null])
    expect(paintName('RAL7021')).toEqual(['RAL 7021', null])
  })
})
