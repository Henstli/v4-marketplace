import Link from 'next/link';
import { Price } from './Price';
import { Trend } from './Trend';

export interface CardTileProps {
  name: string;
  set?: string;
  /** Kategorie verzálkami, např. "POKÉMON" */
  game?: string;
  /** Barva zástupné plochy obrázku */
  color?: string;
  /** Skutečný obrázek karty místo zástupné plochy */
  image?: string;
  /** Nejnižší cena; null = karta je v katalogu, ale nikdo ji neprodává */
  price: number | null;
  trend?: number;
  href?: string;
}

export function CardTile({ name, set, game, color, image, price, trend, href = '#' }: CardTileProps) {
  return (
    <Link className="tz-tile" href={href}>
      <div className="tz-tile-art" style={{ background: color || 'var(--surface-sunken)' }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" loading="lazy" className="tz-tile-img" />
        ) : (
          <div className="tz-tile-frame">{game || ''}</div>
        )}
      </div>
      <div>
        <div className="tz-tile-name">{name}</div>
        {set ? <div className="tz-tile-set">{set}</div> : null}
      </div>
      <div className="tz-tile-row">
        {price != null ? <Price amount={price} prefix="od" /> : <span className="tz-tile-empty">Bez nabídky</span>}
        {price != null && trend != null ? <Trend value={trend} /> : null}
      </div>
    </Link>
  );
}
