import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { Price } from './Price';
import { cx } from './cx';

export interface SearchSuggestItem {
  href: string;
  name: string;
  /** Název sady */
  set?: string;
  /** Číslo karty v sadě */
  number?: string;
  /** Barva tečky kategorie, např. "var(--game-pokemon)" */
  dot?: string;
  /** Obrázek karty; bez něj zástupná plocha v barvě `color` */
  image?: string;
  color?: string;
  /** Nejnižší cena v Kč; null = nikdo neprodává */
  price?: number | null;
}

export interface SearchSuggestProps {
  /** id seznamu, na které odkazuje aria-controls pole; řádky mají id `${id}-${index}` */
  id: string;
  /** Text v poli: zvýrazní se v názvech a použije v posledním řádku */
  query: string;
  items: SearchSuggestItem[];
  /** Řádek vybraný klávesnicí (poslední řádek „Všechny výsledky“ má index items.length) */
  activeIndex?: number;
  /** Odkaz na celý katalog s dotazem; bez něj se poslední řádek nezobrazí */
  allHref?: string;
  onSelect?: (href: string, event: MouseEvent) => void;
  emptyText?: string;
  label?: string;
  className?: string;
}

// Bez diakritiky a velkých písmen, znak po znaku (délka zůstává, ať jde zvýraznit původní text).
function fold(s: string): string {
  return Array.from(s, (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().charAt(0) || ch).join('');
}

// Zvýrazní začátek slova, který odpovídá prvnímu slovu dotazu.
function highlight(name: string, query: string): ReactNode {
  const word = fold(query).split(/[^a-z0-9]+/).filter(Boolean)[0];
  if (!word) return name;
  const chars = Array.from(name);
  const m = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(fold(name));
  if (!m) return name;
  const at = m.index + m[1].length;
  return (
    <>
      {chars.slice(0, at).join('')}
      <mark>{chars.slice(at, at + word.length).join('')}</mark>
      {chars.slice(at + word.length).join('')}
    </>
  );
}

// Řádky jsou jen pro myš a dotyk; klávesnice zůstává v poli a vybírá přes aria-activedescendant.
const keepFocus = (e: MouseEvent) => e.preventDefault();

export function SearchSuggest({ id, query, items, activeIndex = -1, allHref, onSelect, emptyText, label = 'Návrhy karet', className }: SearchSuggestProps) {
  return (
    <ul id={id} role="listbox" aria-label={label} className={cx('tz-suggest', className)}>
      {items.map((it, i) => (
        <li key={it.href} role="presentation">
          <Link
            id={`${id}-${i}`}
            role="option"
            href={it.href}
            tabIndex={-1}
            className="tz-suggest-item"
            aria-selected={i === activeIndex}
            onMouseDown={keepFocus}
            onClick={onSelect ? (e) => onSelect(it.href, e) : undefined}
          >
            <span className="tz-suggest-art" style={it.image ? undefined : { background: it.color || 'var(--surface-sunken)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.image ? <img src={it.image} alt="" loading="lazy" decoding="async" /> : null}
            </span>
            <span className="tz-suggest-text">
              <span className="tz-suggest-name" style={{ display: 'block' }}>{highlight(it.name, query)}</span>
              <span className="tz-suggest-meta">
                {it.dot ? <span className="tz-chip-dot" style={{ background: it.dot }} aria-hidden="true" /> : null}
                {[it.set, it.number].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="tz-suggest-price">
              {it.price != null ? <Price amount={it.price} prefix="od" /> : <span className="tz-suggest-none">Bez nabídky</span>}
            </span>
          </Link>
        </li>
      ))}
      {items.length === 0 ? (
        <li role="presentation" className="tz-suggest-empty">
          {emptyText ?? 'Žádná karta neodpovídá. Zkuste jiný název nebo číslo karty.'}
        </li>
      ) : null}
      {allHref ? (
        <li role="presentation">
          <Link
            id={`${id}-${items.length}`}
            role="option"
            href={allHref}
            tabIndex={-1}
            className="tz-suggest-item tz-suggest-all"
            aria-selected={activeIndex === items.length}
            onMouseDown={keepFocus}
            onClick={onSelect ? (e) => onSelect(allHref, e) : undefined}
          >
            <span>Všechny výsledky pro „{query}“</span>
            <span className="tz-kbd" aria-hidden="true">Enter</span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
