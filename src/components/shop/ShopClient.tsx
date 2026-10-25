'use client';

// Drobné interaktivní části stránky obchodu: holo lesk, odpočet, video a mapa po kliknutí,
// výška hlavičky webu pro lepkavé záložky a propojení náhledu s editorem.
import { useEffect, useRef, useState, type ReactNode } from 'react';

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

/** Video z YouTube: náhled hned, samotné video se načte až po kliknutí (soukromí a rychlost). */
export function VideoEmbed({ id, title }: { id: string; title: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="tz-embed" data-thumb="" style={on ? undefined : { backgroundImage: `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` }}>
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
        </button>
      )}
    </div>
  );
}

/** Pás nabídek, který jede sám dokola; stojí při najetí myší, dotyku, posunu nebo fokusu. */
export function AutoStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!loop) {
      // Kopie obsahu jen tehdy, když se pás nevejde; jinak by se karty opakovaly vedle sebe.
      if (el.scrollWidth > el.clientWidth + 8) setLoop(true);
      return;
    }
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      if (!paused) {
        acc += dt * 0.035;
        if (acc >= 1) {
          const px = Math.floor(acc);
          acc -= px;
          el.scrollLeft += px;
        }
      }
      const half = el.scrollWidth / 2;
      if (el.scrollLeft >= half) el.scrollLeft -= half;
      raf = requestAnimationFrame(step);
    };
    const pause = () => { paused = true; clearTimeout(timer); };
    const resume = () => { clearTimeout(timer); timer = setTimeout(() => { paused = false; }, 2500); };
    const nudge = () => { pause(); resume(); };
    el.addEventListener('pointerenter', pause);
    el.addEventListener('pointerleave', resume);
    el.addEventListener('touchstart', pause, { passive: true });
    el.addEventListener('touchend', resume);
    el.addEventListener('wheel', nudge, { passive: true });
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', resume);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      el.removeEventListener('pointerenter', pause);
      el.removeEventListener('pointerleave', resume);
      el.removeEventListener('touchstart', pause);
      el.removeEventListener('touchend', resume);
      el.removeEventListener('wheel', nudge);
      el.removeEventListener('focusin', pause);
      el.removeEventListener('focusout', resume);
    };
  }, [loop]);
  return (
    <div ref={ref} className="tz-strip-auto">
      {children}
      {loop ? <div style={{ display: 'contents' }} aria-hidden="true" inert>{children}</div> : null}
    </div>
  );
}

/** Mapa prodejny: Google mapa se načte až při doscrollování, odkazy na navigaci vždy. */
export function MapEmbed({ address }: { address: string }) {
  const q = encodeURIComponent(address.replace(/\s+/g, ' ').trim());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div className="tz-embed tz-embed-map">
        <iframe src={`https://maps.google.com/maps?q=${q}&z=16&output=embed`} title={`Mapa: ${address}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
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
 * Náhled v editoru: klik na část stránky s data-edit pošle editoru, co upravit, bloky jde přetáhnout
 * nad, pod nebo vedle jiného bloku, a pozice posunu přežije znovunačtení náhledu po každé změně.
 */
export function PreviewBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const key = 'v4-shop-preview-scroll';
    try {
      const y = Number(sessionStorage.getItem(key));
      if (y) window.scrollTo(0, y);
    } catch {}
    const save = () => {
      try { sessionStorage.setItem(key, String(window.scrollY)); } catch {}
    };
    const send = (msg: Record<string, unknown>) => window.parent.postMessage(msg, window.location.origin);
    const click = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Záložky, filtry, stránkování, video a mapa fungují normálně.
      const a = target?.closest<HTMLAnchorElement>('a[href]');
      if (a && a.pathname === window.location.pathname) return;
      if (target?.closest('form, .tz-embed')) return;
      const el = target?.closest<HTMLElement>('[data-edit]');
      if (el) send({ type: 'v4-shop-edit', target: el.dataset.edit });
      // Jinam se z náhledu neodchází a nic se nekupuje.
      if (el || a || target?.closest('button')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Přetahování bloků
    const blocks = () => [...document.querySelectorAll<HTMLElement>('[data-block-id]')];
    for (const b of blocks()) b.draggable = true;
    let dragged: HTMLElement | null = null;
    let over: HTMLElement | null = null;
    const clear = () => {
      for (const b of blocks()) { b.removeAttribute('data-drop'); b.removeAttribute('data-dragging'); }
    };
    const where = (el: HTMLElement, e: DragEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (x < 0.22) return 'left';
      if (x > 0.78) return 'right';
      return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    };
    const dragstart = (e: DragEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-block-id]');
      if (!el || !e.dataTransfer) return;
      dragged = el;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.dataset.blockId ?? '');
      el.setAttribute('data-dragging', '');
    };
    const dragover = (e: DragEvent) => {
      if (!dragged) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-block-id]');
      if (over && over !== el) over.removeAttribute('data-drop');
      over = el && el !== dragged ? el : null;
      if (!over) return;
      e.preventDefault();
      over.setAttribute('data-drop', where(over, e));
    };
    const drop = (e: DragEvent) => {
      if (!dragged || !over) return;
      e.preventDefault();
      send({ type: 'v4-shop-move', id: dragged.dataset.blockId, target: over.dataset.blockId, pos: over.getAttribute('data-drop') });
      dragged = null;
      over = null;
      clear();
    };
    const dragend = () => { dragged = null; over = null; clear(); };

    window.addEventListener('scroll', save, { passive: true });
    document.addEventListener('click', click, true);
    document.addEventListener('dragstart', dragstart);
    document.addEventListener('dragover', dragover);
    document.addEventListener('drop', drop);
    document.addEventListener('dragend', dragend);
    return () => {
      window.removeEventListener('scroll', save);
      document.removeEventListener('click', click, true);
      document.removeEventListener('dragstart', dragstart);
      document.removeEventListener('dragover', dragover);
      document.removeEventListener('drop', drop);
      document.removeEventListener('dragend', dragend);
    };
  }, []);
  return null;
}
