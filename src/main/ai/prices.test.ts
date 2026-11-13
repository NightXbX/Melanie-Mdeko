import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../db/database'
import type { Fetch } from './openrouter'
import { applyFoundPrice, checkPrices, pageDigest } from './prices'
import { monthSpentCents } from './versions'

let db: DatabaseSync

beforeEach(() => {
  db = openDatabase(':memory:')
  migrate(db)
  db.prepare("INSERT INTO articles (id, name, url, price_cents, price_kind) VALUES (1, 'Fauteuil Lina', 'https://exemple.fr/lina', 29900, 'fixed')").run()
  db.prepare("INSERT INTO articles (id, name, url, price_cents, price_kind) VALUES (2, 'Lampe Opale', 'https://exemple.fr/opale', 8900, 'fixed')").run()
})

const answer = (content: unknown, cost = 0.002): Fetch => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost } })
})

describe('vérification des prix par l’IA', () => {
  it('garde le texte utile de la page', () => {
    const html =
      '<html><head><title>Lampe Opale | Exemple</title><meta property="product:price:amount" content="79.00">' +
      '<script>var x = 1</script><script type="application/ld+json">{"@type":"Product","offers":{"price":"79"}}</script></head>' +
      '<body><nav>Menu</nav><h1>Lampe Opale</h1><p>79,00&nbsp;€</p></body></html>'
    const digest = pageDigest(html)
    expect(digest).toContain('Titre : Lampe Opale')
    expect(digest).toContain('product:price:amount = 79.00')
    expect(digest).toContain('"price":"79"')
    expect(digest).toContain('79,00')
    expect(digest).not.toContain('var x')
    expect(digest).not.toContain('Menu')
  })

  it('propose les écarts sans rien changer, puis applique avec l’historique', async () => {
    const rows = await checkPrices(
      db,
      'cle',
      'modele',
      answer({ status: 'found', price_eur: 79, price_kind: 'fixed', same_product: true, note: 'Soldé' }),
      [1, 2],
      async () => '<title>Produit</title>',
      () => undefined,
      new AbortController().signal
    )
    expect(rows.map((r) => [r.articleId, r.foundCents])).toEqual([
      [1, 7900],
      [2, 7900]
    ])
    expect((db.prepare('SELECT price_cents FROM articles WHERE id = 1').get() as { price_cents: number }).price_cents).toBe(29900)
    // Le coût compte dans le budget du mois.
    expect(monthSpentCents(db)).toBeCloseTo(0.4)

    applyFoundPrice(db, 1, 7900, 'fixed')
    expect(db.prepare('SELECT old_cents, new_cents, origin FROM price_history').all()).toEqual([{ old_cents: 29900, new_cents: 7900, origin: 'verification-ia' }])
  })

  it('signale une page qui n’est plus celle du produit, et ignore un autre produit', async () => {
    const gone = await checkPrices(db, 'k', 'm', answer({ status: 'not_product' }), [1], async () => '<title>Accueil</title>', () => undefined, new AbortController().signal)
    expect(gone[0].status).toBe('not_product')
    const other = await checkPrices(db, 'k', 'm', answer({ status: 'found', price_eur: 10, same_product: false }), [1], async () => 'x', () => undefined, new AbortController().signal)
    expect(other[0]).toMatchObject({ status: 'unknown', foundCents: null })
  })
})
