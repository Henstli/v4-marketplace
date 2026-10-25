import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

/** Štítek u jména prodejce: „Ověřený prodejce“ nebo PRO (tarif Pro). */
export function SellerBadge({ type, className }: { type: 'verified' | 'pro'; className?: string }) {
  if (type === 'pro') return <span className={cx('tz-badge', 'tz-badge-pro', className)} title="Tarif Pro">PRO</span>;
  return (
    <span className={cx('tz-badge', 'tz-badge-verified', className)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      Ověřený prodejce
    </span>
  );
}

export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0] ?? '?').charAt(0) + (w[1] ? w[1].charAt(0) : (w[0] ?? '').charAt(1))).toUpperCase();
}

export interface ShopLogoProps {
  name: string;
  /** Nahrané logo; bez něj iniciály na barvě obchodu */
  image?: string | null;
  size?: number;
  round?: boolean;
  className?: string;
}

/** Logo obchodu nebo avatar sběratele. Barvu a písmo bere z obalu .tz-shop. */
export function ShopLogo({ name, image, size = 96, round, className }: ShopLogoProps) {
  return (
    <span
      className={cx('tz-shop-logo', round && 'tz-shop-logo-round', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? <img src={image} alt="" /> : initials(name)}
    </span>
  );
}

export type ShopLayout = 'banner' | 'split' | 'center' | 'minimal';

export interface ShopHeaderProps {
  layout?: ShopLayout;
  name: string;
  logo?: string | null;
  bannerImage?: string | null;
  /** Vzor banneru z design systému (tz-shop-banner-*) */
  bannerStyle?: string;
  meta?: ReactNode;
  tagline?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  tabs?: { label: string; href: string; current?: boolean }[];
  className?: string;
}

/** Hlavička stránky obchodu ve čtyřech šablonách; patří do obalu .tz-shop. */
export function ShopHeader({ layout = 'banner', name, logo, bannerImage, bannerStyle = 'pattern', meta, tagline, badges, actions, tabs, className }: ShopHeaderProps) {
  const banner = layout === 'minimal' ? null : (
    <div
      className={cx('tz-shop-banner', !bannerImage && `tz-shop-banner-${bannerStyle}`)}
      style={bannerImage ? { backgroundImage: `url(${JSON.stringify(bannerImage)})` } : undefined}
      aria-hidden="true"
    />
  );
  const id = (
    <div className="tz-shop-id">
      <ShopLogo name={name} image={logo} size={layout === 'minimal' ? 64 : layout === 'split' ? 72 : 112} round={layout === 'center'} />
      <div className="tz-shop-text">
        <div className="tz-shop-titlerow">
          <h1 className="tz-shop-name">{name}</h1>
          {badges}
        </div>
        {meta ? <p className="tz-shop-meta">{meta}</p> : null}
        {tagline ? <p className="tz-shop-tagline">{tagline}</p> : null}
      </div>
      {actions ? <div className="tz-shop-actions">{actions}</div> : null}
    </div>
  );
  return (
    <section className={cx('tz-shop-head', `tz-shop-head-${layout}`, className)} aria-label="Hlavička obchodu">
      {layout === 'split' ? <div className="tz-shop-split-row">{id}{banner}</div> : <>{banner}{id}</>}
      {tabs?.length ? (
        <nav className="tz-shop-tabs" aria-label="Části stránky">
          {tabs.map((t) => <a key={t.href + t.label} href={t.href} aria-current={t.current ? 'page' : undefined}>{t.label}</a>)}
        </nav>
      ) : null}
    </section>
  );
}

/** Blok stránky obchodu s nadpisem v písmu obchodu. */
export function ShopSection({ title, note, id, children, className }: { title: string; note?: ReactNode; id?: string; children?: ReactNode; className?: string }) {
  return (
    <section className={cx('tz-shop-section', className)} id={id} aria-label={title}>
      <div className="tz-shop-section-head">
        <h2 className="tz-shop-heading">{title}</h2>
        {note ? <span className="tz-shop-section-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Styl obalu .tz-shop pro barvu obchodu (token shop-*). */
export function shopStyle(color: string): CSSProperties {
  return { ['--shop' as string]: `var(--shop-${color})` } as CSSProperties;
}
