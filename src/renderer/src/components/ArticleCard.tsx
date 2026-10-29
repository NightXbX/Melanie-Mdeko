import type { ArticleCard as Card } from '@shared/api'
import { formatPrice } from '@shared/format'
import { Icon } from './Icon'

export function ArticleCard({ article, onOpen }: { article: Card; onOpen(id: number): void }) {
  return (
    <button type="button" className="card" onClick={() => onOpen(article.id)}>
      <div className="card-photo">
        {article.thumbnailUrl ? (
          <img src={article.thumbnailUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <Icon name="photo" size={40} />
        )}
      </div>
      <div className="card-text">
        <span className="card-name">{article.name}</span>
        <span className="card-price">{formatPrice(article.price)}</span>
        {article.supplier && <span className="card-supplier">{article.supplier}</span>}
      </div>
    </button>
  )
}
