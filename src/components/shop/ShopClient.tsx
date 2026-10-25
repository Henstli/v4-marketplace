'use client';

// Drobné interaktivní části stránky obchodu: holo lesk, odpočet, video a mapa po kliknutí,
// výška hlavičky webu pro lepkavé záložky a propojení náhledu s editorem.
import { useEffect, useState } from 'react';

/** Holo lesk: karty s třídou tz-holo se natáčí za kurzorem (jen zařízení s myší). */
export function HoloEffect() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return;
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('.tz-holo');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
      el.style.setProperty('--rx', `${(0.5 - y) * 16}deg`);
      el.style.setProperty('--mx', `${Math.round(x * 100)}%`);
    };
    const leave = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('.tz-holo');
      if (!el || el.contains(e.relatedTarget as Node | null)) return;
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.style.removeProperty('--mx');
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', leave);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', leave);
    };
  }, []);
  return null;
}

/** Odpočet do data a času (místní čas prohlížeče). */
export function Countdown({ at }: { at: string }) {
  const target = new Date(at).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now == null ? null : Math.max(0, target - now);
  const parts = left == null
    ? [['–', 'dní'], ['–', 'hodin'], ['–', 'minut'], ['–', 'sekund']]
    : [
        [Math.floor(left / 86_400_000), 'dní'],
        [Math.floor(left / 3_600_000) % 24, 'hodin'],
        [Math.floor(left / 60_000) % 60, 'minut'],
        [Math.floor(left / 1000) % 60, 'sekund'],
      ];
  if (left === 0) return <p className="t-heading-m" style={{ margin: 0 }}>Už je to tady!</p>;
  return (
    <div className="tz-countdown" role="timer" aria-label="Zbývající čas">
      {parts.map(([v, l]) => (
        <span key={l} className="tz-countdown-part">{typeof v === 'number' ? String(v).padStart(2, '0') : v}<small>{l}</small></span>
      ))}
    </div>
  );
}

/** Video z YouTube: načte se až po kliknutí (soukromí a rychlost). */
export function VideoEmbed({ id, title }: { id: string; title: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="tz-embed">
      {on ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button type="button" className="tz-embed-play" onClick={() => setOn(true)}>
          <span aria-hidden="true">▶</span>
          <span>Přehrát video</span>
          <span className="t-small muted">Načte se z YouTube</span>
        </button>
      )}
    </div>
  );
}

/** Mapa prodejny: Google mapa po kliknutí, odkazy na navigaci vždy. */
export function MapEmbed({ address }: { address: string }) {
  const [on, setOn] = useState(false);
  const q = encodeURIComponent(address.replace(/\s+/g, ' '));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div className="tz-embed tz-embed-map">
        {on ? (
          <iframe src={`https://www.google.com/maps?q=${q}&output=embed`} title={`Mapa: ${address}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        ) : (
          <button type="button" className="tz-embed-play" onClick={() => setOn(true)}>
            <span aria-hidden="true">📍</span>
            <span>Zobrazit mapu</span>
            <span className="t-small muted">{address}</span>
          </button>
        )}
      </div>
      <p className="t-small" style={{ margin: 0 }}>
        Navigovat: <a href={`https://mapy.cz/zakladni?q=${q}`} target="_blank" rel="noopener noreferrer">Mapy.cz</a>
        {' · '}<a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noopener noreferrer">Google Mapy</a>
      </p>
    </div>
  );
}

/** Výška lepkavé hlavičky webu do --site-header-h, aby pod ní mohly držet záložky obchodu. */
export function SiteHeaderHeight() {
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const set = () => document.documentElement.style.setProperty('--site-header-h', `${header.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return null;
}

/**
 * Náhled v editoru: klik na část stránky s data-edit pošle editoru, co upravit,
 * a pozice posunu přežije znovunačtení náhledu po každé změně.
 */
export function PreviewBridge() {
  useEffect(() => {
    const key = 'v4-shop-preview-scroll';
    try {
      const y = Number(sessionStorage.getItem(key));
      if (y) window.scrollTo(0, y);
    } catch {}
    const save = () => {
      try { sessionStorage.setItem(key, String(window.scrollY)); } catch {}
    };
    const click = (e: MouseEvent) => {
      if (window.parent === window) return;
      const target = e.target as Element | null;
      // Záložky, filtry a stránkování náhledu fungují normálně.
      const a = target?.closest<HTMLAnchorElement>('a[href]');
      if (a && a.pathname === window.location.pathname) return;
      if (target?.closest('form')) return;
      const el = target?.closest<HTMLElement>('[data-edit]');
      if (el) window.parent.postMessage({ type: 'v4-shop-edit', target: el.dataset.edit }, window.location.origin);
      // Jinam se z náhledu neodchází a nic se nekupuje.
      if (el || a || target?.closest('button')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('scroll', save, { passive: true });
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('scroll', save);
      document.removeEventListener('click', click, true);
    };
  }, []);
  return null;
}
