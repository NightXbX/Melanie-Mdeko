import { useEffect, useState } from 'react'
import type { ArticleDetail as Detail } from '@shared/api'
import { formatPrice } from '@shared/format'
import { Icon } from './Icon'

interface Props {
  id: number
  onClose(): void
}

// Page détail d'un article, par-dessus la grille (Échap ou « Shopping list » pour revenir).
export function ArticleDetail({ id, onClose }: Props) {
  const [article, setArticle] = useState<Detail | null>(null)
  const [photo, setPhoto] = useState(0)

  useEffect(() => {
    let current = true
    setPhoto(0)
    void window.mdeko.getArticle(id).then((a) => current && setArticle(a))
    return () => {
      current = false
    }
  }, [id])

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
        </div>
      </div>
    </div>
  )
}
