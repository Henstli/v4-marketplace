'use client';

import Link from 'next/link';
// Drobné interaktivní části stránky obchodu: holo lesk, odpočet, video a mapa po kliknutí,
// výška hlavičky webu pro lepkavé záložky a propojení náhledu s editorem.
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

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

type Drag = {
  el: HTMLElement;
  box: HTMLElement;
  x0: number;
  y0: number;
  started: boolean;
  offX: number;
  offY: number;
  tx: number;
  ty: number;
  order: HTMLElement[];
  side: { target: HTMLElement; pos: 'left' | 'right' } | null;
  last: PointerEvent;
};

/**
 * Náhled v editoru: klik na část stránky s data-edit pošle editoru, co upravit.
 * Blok jde chytit myší a přesunout: zvedne se, jede za kurzorem a ostatní mu plynule uhýbají
 * (jako ikony na ploše telefonu). Na kraji jiného bloku (Pro) ho postaví vedle.
 * Po změně editor náhled jen tiše obnoví (router.refresh), stránka se znovu nenačítá.
 */
export function PreviewBridge({ sideDrop }: { sideDrop: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refreshing = useRef(false);

  // Tiché obnovení na pokyn editoru.
  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'v4-shop-refresh') return;
      refreshing.current = true;
      startTransition(() => router.refresh());
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'v4-shop-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [router]);

  useEffect(() => {
    if (pending || !refreshing.current) return;
    refreshing.current = false;
    // Pořadí bloků v DOM po přetažení musí sedět s tím, co poslal server; jinak raději celé načíst.
    const box = document.querySelector<HTMLElement>('.tz-shop-blocks[data-order]');
    if (box) {
      const have = [...box.children].map((c) => (c as HTMLElement).dataset.blockId).filter(Boolean).join(',');
      if (have !== box.dataset.order) window.location.reload();
    }
    window.parent.postMessage({ type: 'v4-shop-refreshed' }, window.location.origin);
  }, [pending]);

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
    let drag: Drag | null = null;
    let justDragged = false;
    let raf = 0;

    const click = (e: MouseEvent) => {
      if (justDragged) {
        justDragged = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = e.target as Element | null;
      const gap = target?.closest<HTMLElement>('[data-gap]');
      if (gap) {
        e.preventDefault();
        e.stopPropagation();
        send({ type: 'v4-shop-divider', id: gap.dataset.gap, on: gap.dataset.on !== '1' });
        return;
      }
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

    // Ostatní bloky plynule dojedou na nové místo (FLIP).
    const flip = (d: Drag, mutate: () => void) => {
      const items = [...d.box.children].filter((c) => c !== d.el) as HTMLElement[];
      const first = new Map(items.map((c) => [c, c.getBoundingClientRect()]));
      mutate();
      for (const c of items) {
        const a = first.get(c)!;
        const b = c.getBoundingClientRect();
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (dx || dy) c.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    };

    // Zvednutý blok drží pod kurzorem, ať je v DOM kdekoli.
    const place = (d: Drag) => {
      const r = d.el.getBoundingClientRect();
      const baseLeft = r.left - d.tx;
      const baseTop = r.top - d.ty;
      d.tx = d.last.clientX - d.offX - baseLeft;
      d.ty = d.last.clientY - d.offY - baseTop;
      d.el.style.translate = `${d.tx}px ${d.ty}px`;
      return { baseLeft, baseTop };
    };

    const clearSide = (d: Drag) => {
      d.side?.target.removeAttribute('data-drop');
      d.side = null;
    };

    const track = (d: Drag) => {
      const { baseTop } = place(d);
      const { clientX: x, clientY: y } = d.last;
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-block-id]');
      if (!target || target === d.el || target.parentElement !== d.box) return;
      const r = target.getBoundingClientRect();
      const fx = (x - r.left) / r.width;
      if (sideDrop && (fx < 0.16 || fx > 0.84)) {
        const pos = fx < 0.5 ? 'left' : 'right';
        if (d.side?.target !== target || d.side.pos !== pos) {
          clearSide(d);
          d.side = { target, pos };
          target.setAttribute('data-drop', pos);
        }
        return;
      }
      clearSide(d);
      const kids = [...d.box.children];
      const from = kids.indexOf(d.el);
      const to = kids.indexOf(target);
      const sameRow = Math.abs(r.top - baseTop) < 24;
      const past = sameRow ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
      if (from < to && past) {
        flip(d, () => d.box.insertBefore(d.el, target.nextSibling));
        place(d);
      } else if (from > to && !past) {
        flip(d, () => d.box.insertBefore(d.el, target));
        place(d);
      }
    };

    // U horního a dolního okraje se náhled sám posouvá.
    const loop = () => {
      if (!drag?.started) return;
      const y = drag.last.clientY;
      const edge = 70;
      const v = y < edge ? -(edge - y) / 4 : y > window.innerHeight - edge ? (y - (window.innerHeight - edge)) / 4 : 0;
      if (v) {
        window.scrollBy(0, v);
        track(drag);
      }
      raf = requestAnimationFrame(loop);
    };

    const start = (d: Drag) => {
      d.started = true;
      d.box.setAttribute('data-dragging-active', '');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      const r = d.el.getBoundingClientRect();
      d.offX = d.x0 - r.left;
      d.offY = d.y0 - r.top;
      d.el.setAttribute('data-lifted', '');
      raf = requestAnimationFrame(loop);
    };

    const finish = (d: Drag, cancel: boolean) => {
      cancelAnimationFrame(raf);
      const { tx, ty } = d;
      d.el.removeAttribute('data-lifted');
      d.el.style.translate = '';
      d.box.removeAttribute('data-dragging-active');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const side = d.side;
      clearSide(d);
      if (cancel) {
        for (const c of d.order) d.box.appendChild(c);
        return;
      }
      d.el.animate([{ translate: `${tx}px ${ty}px` }, { translate: '0 0' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      const id = d.el.dataset.blockId;
      if (side) {
        for (const c of d.order) d.box.appendChild(c);
        send({ type: 'v4-shop-move', id, target: side.target.dataset.blockId, pos: side.pos });
        return;
      }
      const order = [...d.box.children].map((c) => (c as HTMLElement).dataset.blockId).filter(Boolean);
      if (order.join(',') !== d.box.dataset.order) send({ type: 'v4-shop-order', order });
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      const t = e.target as Element | null;
      if (t?.closest('.tz-embed, form, [data-gap], input, textarea, select')) return;
      const el = t?.closest<HTMLElement>('[data-block-id]');
      const box = el?.parentElement;
      if (!el || !box) return;
      drag = { el, box, x0: e.clientX, y0: e.clientY, started: false, offX: 0, offY: 0, tx: 0, ty: 0, order: [...box.children] as HTMLElement[], side: null, last: e };
    };
    const moveP = (e: PointerEvent) => {
      if (!drag) return;
      drag.last = e;
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
        start(drag);
      }
      e.preventDefault();
      track(drag);
    };
    const up = () => {
      if (!drag) return;
      if (drag.started) {
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 0);
        finish(drag, false);
      }
      drag = null;
    };
    const cancel = () => {
      if (drag?.started) finish(drag, true);
      drag = null;
    };
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    // Odkazy a obrázky se v náhledu nepřetahují po svém.
    const nativeDrag = (e: DragEvent) => e.preventDefault();

    window.addEventListener('scroll', save, { passive: true });
    document.addEventListener('click', click, true);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', moveP);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', keydown);
    document.addEventListener('dragstart', nativeDrag);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', save);
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', moveP);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('dragstart', nativeDrag);
    };
  }, [sideDrop]);
  return null;
}

/** Tlačítko Napsat zprávu (v hlavičce) nebo Nabídnout (u karty v Hledám, s předvyplněným textem). */
export function MessageSeller({ sellerId, label = 'Napsat zprávu', text, small }: {
  sellerId: string; label?: string; text?: string; small?: boolean;
}) {
  const href = `/zpravy/${sellerId}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  return (
    <Link href={href} className={`tz-btn tz-btn-md ${small ? 'tz-btn-primary tz-wanted-sell' : 'tz-btn-secondary'}`}>
      {small ? null : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>}
      {label}
    </Link>
  );
}

