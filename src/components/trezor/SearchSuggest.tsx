import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { Price } from './Price';
import { cx } from './cx';
import { initials, SellerBadge } from './Shop';

export interface SearchSuggestItem {
  href: string;
  /** card = karta s obrázkem a cenou (výchozí), set = sada, seller = prodejce nebo obchod (ikona místo obrázku) */
  kind?: 'card' | 'set' | 'seller';
  name: string;
  /** Druhý řádek místo „sada · číslo“, např. "Pokémon · OBF · 2023" nebo "Obchod · CZ" */
  meta?: string;
  /** Krátký text vpravo u sady nebo prodejce, např. "12 nabídek" */
  tag?: string;
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
  /** Profilovka prodejce místo ikony: obrázek, nebo iniciály na barvě obchodu (např. "var(--shop-pink)") */
  avatar?: { image: string | null; color: string };
  /** Odznaky za jménem prodejce */
  badges?: ('verified' | 'pro')[];
}

export interface SearchSuggestGroup {
  title: string;
  items: SearchSuggestItem[];
}

export interface SearchSuggestProps {
  /** id seznamu, na které odkazuje aria-controls pole; řádky mají id `${id}-${index}` */
  id: string;
  /** Text v poli: zvýrazní se v názvech a použije v posledním řádku */
  query: string;
  /** Skupiny s nadpisy (Karty, Sady, Prodejci); prázdné se nezobrazí, jediná skupina karet je bez nadpisu */
  groups: SearchSuggestGroup[];
  /** Řádek vybraný klávesnicí: index přes všechny skupiny za sebou, poslední řádek „Všechny výsledky“ má index počtu návrhů */
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

// Ikony skupin: sada (stoh karet) a prodejce (obchod).
const ICONS = {
  set: (
    <>
      <rect x={7} y={3} width={12} height={16} rx={2} />
      <path d="M5 6v13a2 2 0 0 0 2 2h9" />
    </>
  ),
  seller: (
    <>
      <path d="M4 9l1.5-5h13L20 9" />
      <path d="M4 9h16v2a3 3 0 0 1-5.33 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.67-1.1A3 3 0 0 1 4 11z" />
      <path d="M5 13v7h14v-7" />
    </>
  ),
};

// Řádky jsou jen pro myš a dotyk; klávesnice zůstává v poli a vybírá přes aria-activedescendant.
const keepFocus = (e: MouseEvent) => e.preventDefault();

export function SearchSuggest({ id, query, groups, activeIndex = -1, allHref, onSelect, emptyText, label = 'Návrhy', className }: SearchSuggestProps) {
  const shown = groups.filter((g) => g.items.length);
  const titled = shown.length > 1 || shown.some((g) => g.items[0].kind && g.items[0].kind !== 'card');
  let n = 0;
  const rows: ReactNode[] = [];
  shown.forEach((g) => {
    if (titled) {
      rows.push(
        <li key={`g-${g.title}`} role="presentation" className="tz-suggest-group" aria-hidden="true">
          {g.title.toUpperCase()}
        </li>,
      );
    }
    for (const it of g.items) {
      const i = n++;
      const card = !it.kind || it.kind === 'card';
      rows.push(
        <li key={`${it.kind ?? 'card'}-${it.href}`} role="presentation">
          <Link
            id={`${id}-${i}`}
            role="option"
            href={it.href}
            tabIndex={-1}
            className={cx('tz-suggest-item', card ? null : 'tz-suggest-item-compact')}
            aria-selected={i === activeIndex}
            onMouseDown={keepFocus}
            onClick={onSelect ? (e) => onSelect(it.href, e) : undefined}
          >
            {card ? (
              <span className="tz-suggest-art" style={it.image ? undefined : { background: it.color || 'var(--surface-sunken)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.image ? <img src={it.image} alt="" loading="lazy" decoding="async" /> : null}
              </span>
            ) : it.avatar ? (
              <span className="tz-suggest-avatar" style={{ background: it.avatar.color }} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.avatar.image ? <img src={it.avatar.image} alt="" loading="lazy" decoding="async" /> : initials(it.name)}
              </span>
            ) : (
              <span className="tz-suggest-icon" aria-hidden="true">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[it.kind as 'set' | 'seller']}
                </svg>
              </span>
            )}
            <span className="tz-suggest-text">
              {it.badges?.length ? (
                <span className="tz-suggest-namerow">
                  <span className="tz-suggest-name">{highlight(it.name, query)}</span>
                  {it.badges.map((b) => <SellerBadge key={b} type={b} />)}
                </span>
              ) : (
                <span className="tz-suggest-name" style={{ display: 'block' }}>{highlight(it.name, query)}</span>
              )}
              <span className="tz-suggest-meta">
                {it.dot ? <span className="tz-chip-dot" style={{ background: it.dot }} aria-hidden="true" /> : null}
                {it.meta ?? [it.set, it.number].filter(Boolean).join(' · ')}
              </span>
            </span>
            {card ? (
              <span className="tz-suggest-price">
                {it.price != null ? <Price amount={it.price} prefix="od" /> : <span className="tz-suggest-none">Bez nabídky</span>}
              </span>
            ) : it.tag ? (
              <span className="tz-suggest-tag">{it.tag}</span>
            ) : null}
          </Link>
        </li>,
      );
    }
  });

  return (
    <ul id={id} role="listbox" aria-label={label} className={cx('tz-suggest', className)}>
      {rows}
      {n === 0 ? (
        <li role="presentation" className="tz-suggest-empty">
          {emptyText ?? 'Nic neodpovídá. Zkuste jiný název karty, sady nebo prodejce.'}
        </li>
      ) : null}
      {allHref ? (
        <li role="presentation">
          <Link
            id={`${id}-${n}`}
            role="option"
            href={allHref}
            tabIndex={-1}
            className="tz-suggest-item tz-suggest-all"
            aria-selected={activeIndex === n}
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
