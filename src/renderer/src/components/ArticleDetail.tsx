import { useEffect, useState } from 'react'
import type { ArticleDetail as Detail } from '@shared/api'
import { formatPrice } from '@shared/format'
import { useApp } from '../app-context'
import { Icon } from './Icon'

interface Props {
  id: number
  onClose(): void
  onEdit(id: number): void
}

// Page détail d'un article, par-dessus la grille (Échap ou « Shopping list » pour revenir).
export function ArticleDetail({ id, onClose, onEdit }: Props) {
  const { dataVersion, refresh, notify } = useApp()
  const [article, setArticle] = useState<Detail | null>(null)
  const [photo, setPhoto] = useState(0)

  useEffect(() => {
    setPhoto(0)
  }, [id])

  useEffect(() => {
    let current = true
    void window.mdeko.getArticle(id).then((a) => {
      if (!current) return
      if (a) setArticle(a)
      else onClose() // article mis à la corbeille entre-temps
    })
    return () => {
      current = false
    }
  }, [id, dataVersion, onClose])

  const remove = async () => {
    if (!article) return
    const ok = await window.mdeko.confirm(
      `Mettre « ${article.name} » à la corbeille ?`,
      'Vous pourrez le récupérer depuis la Corbeille.',
      'Mettre à la corbeille'
    )
    if (!ok) return
    await window.mdeko.trashArticle(article.id)
    onClose()
    refresh()
    notify(`« ${article.name} » a été mis à la corbeille`, true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!article) return <div className="detail" />

  const images = article.imageUrls
  const infos: [string, string | null][] = [
    ['Dimensions', article.dimensions],
    ['Couleur / matière', article.colorMaterial],
    ['Style', article.tags.join(', ') || null],
    ['Note privée', article.privateNote]
  ]

  return (
    <div className="detail" role="dialog" aria-label={article.name}>
      <div className="detail-bar">
        <button type="button" className="button button-plain" onClick={onClose}>
          <Icon name="chevronLeft" size={14} />
          Shopping list
        </button>
        <div className="detail-actions">
          <button type="button" className="button" onClick={() => onEdit(article.id)}>
            Modifier
          </button>
          <button type="button" className="button button-icon" aria-label="Mettre à la corbeille" title="Mettre à la corbeille" onClick={() => void remove()}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
      <div className="detail-body">
        <div className="detail-photos">
          <div className="detail-photo">
            {images.length ? <img src={images[photo]} alt="" /> : <Icon name="photo" size={64} />}
          </div>
          {images.length > 1 && (
            <div className="detail-thumbs">
              {images.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  className={`detail-thumb${i === photo ? ' is-selected' : ''}`}
                  onClick={() => setPhoto(i)}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-info">
          {article.family && (
            <p className="detail-path">
              {article.family}
              {article.category && (
                <>
                  <Icon name="chevronRight" size={11} />
                  {article.category}
                </>
              )}
            </p>
          )}
          <h1 className="detail-name">{article.name}</h1>
          <p className="detail-price">{formatPrice(article.price)}</p>
          {article.supplier && <p className="detail-supplier">{article.supplier}</p>}

          {article.url && (
            <button
              type="button"
              className="button button-primary button-large"
              onClick={() => void window.mdeko.openExternal(article.url!)}
            >
              Voir le produit
              <Icon name="external" size={15} />
            </button>
          )}
          {article.linkStatus === 'gone' && <p className="detail-warning">Ce lien ne semble plus fonctionner.</p>}

          {infos.some(([, value]) => value) && (
            <dl className="detail-list">
              {infos
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}
