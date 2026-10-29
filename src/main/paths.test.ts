import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_FILES, dataPathsIn, PROJECTS } from './paths'

describe('dossiers de données', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mdeko-paths-'))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('ne montre que Projets et le dossier technique', () => {
    const paths = dataPathsIn(home)
    expect(readdirSync(home).sort()).toEqual([APP_FILES, PROJECTS].sort())
    expect(paths.database).toBe(join(home, APP_FILES, 'mdeko.sqlite'))
  })

  it("range l'ancienne organisation dans le dossier technique", () => {
    writeFileSync(join(home, 'mdeko.sqlite'), 'base')
    mkdirSync(join(home, 'images', 'articles'), { recursive: true })
    writeFileSync(join(home, 'images', 'articles', 'a.jpg'), 'x')
    const paths = dataPathsIn(home)
    expect(existsSync(paths.database)).toBe(true)
    expect(existsSync(join(paths.images, 'articles', 'a.jpg'))).toBe(true)
    expect(existsSync(join(home, 'mdeko.sqlite'))).toBe(false)
  })
})
