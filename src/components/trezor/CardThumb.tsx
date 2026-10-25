import { cx } from './cx';

export interface CardThumbProps {
  /** Malý obrázek karty; bez něj zástupná plocha v barvě `color` */
  image?: string;
  /** Barva zástupné plochy, např. tmavý odstín kategorie */
  color?: string;
  /** sm = 32 px, md = 40 px (výchozí), lg = 64 px na šířku, vždy v poměru 63 : 88 */
  size?: 'sm' | 'md' | 'lg';
  /** Velký obrázek karty, který se ukáže po najetí myší (jen zařízení s myší) */
  preview?: string;
  className?: string;
}

// Malý náhled karty vlevo v řádku seznamu. Dekorativní, název karty je vždy vedle textem.
export function CardThumb({ image, color, size = 'md', preview, className }: CardThumbProps) {
  return (
    <span
      className={cx('tz-thumb', size !== 'md' ? `tz-thumb-${size}` : null, className)}
      style={image ? undefined : { background: color || 'var(--surface-sunken)' }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : null}
      {/* Větší náhled po najetí myší; načte se až při zobrazení. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && preview ? <img className="tz-thumb-pop" src={preview} alt="" loading="lazy" decoding="async" /> : null}
    </span>
  );
}
