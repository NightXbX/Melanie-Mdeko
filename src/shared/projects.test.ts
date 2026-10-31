import { describe, expect, it } from 'vitest'
import { DEFAULT_MAIL_BODY, fillMail, mailAddresses } from './projects'

describe('mail type', () => {
  it('remplace le client, le mois et la signature', () => {
    const text = fillMail(DEFAULT_MAIL_BODY, { client: 'Mme Durand', mois: 'octobre 2026', signature: 'm·deko' })
    expect(text).toContain('Bonjour Mme Durand,')
    expect(text).toContain('design book (octobre 2026)')
    expect(text.endsWith('m·deko')).toBe(true)
  })

  it('lit plusieurs adresses et ignore celles qui sont mal écrites', () => {
    expect(mailAddresses(' a@exemple.fr; b@exemple.fr , pas-une-adresse ')).toBe('a@exemple.fr,b@exemple.fr')
    expect(mailAddresses('')).toBe('')
  })
})
