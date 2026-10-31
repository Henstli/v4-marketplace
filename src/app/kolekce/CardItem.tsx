import Link from 'next/link';
import type { AlbumCard } from '@/lib/collection';
import { formatNumber } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import s from './kolekce.module.css';

const Kc = ({ n }: { n: number }) => <>{formatNumber(Math.round(n))}&nbsp;Kč</>;

/** Karta v mřížce Moje kolekce (Všechny karty, Chybějící, Chybí ti a jsou v nabídce). */
export function CardItem({ c, missing, extra }: { c: AlbumCard; missing?: boolean; extra?: string }) {
  const src = c.image ? thumbUrl(c.image) ?? c.image : null;
  return (
    <Link href={`/karty/${c.slug}`} className={s.mc}>
      <div className={`${s.mcImg} ${missing ? s.missing : ''}`}>
        {/* alt prázdný: když se obrázek nenačte, nepřekryje název přes místo karty */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="" loading="lazy" /> : null}
        <span className={s.num}>#{c.number}</span>
        {!missing && c.owned > 1 ? <span className={s.qty}>×{c.owned}</span> : null}
      </div>
      <b title={c.name}>{c.name}</b>
      <div className={s.mcRow}>
        <span>{missing ? (c.offers ? `${c.offers} ${c.offers === 1 ? 'nabídka' : c.offers <= 4 ? 'nabídky' : 'nabídek'}` : 'zatím bez nabídky') : extra ?? c.setName}</span>
        {c.minPrice ? <strong>od <Kc n={c.minPrice} /></strong> : null}
      </div>
    </Link>
  );
}
