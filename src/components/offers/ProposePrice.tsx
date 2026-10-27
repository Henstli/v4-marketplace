'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/trezor';
import { proposePrice } from '@/app/zpravy/offers';

/**
 * „Nabídnout cenu“ u nabídky s cenou dohodou (DS OfferTable): pod tlačítkem panel s cenou,
 * počtem kusů a odesláním. Po odeslání otevře konverzaci s prodejcem.
 */
export function ProposePrice({ listingId, sellerId, max, className }: { listingId: string; sellerId: string; max: number; className?: string }) {
  const [open, setOpen] = useState(false);
  // Panel je v <body> a přichycený k oknu (position: fixed), aby ho neořízla tabulka nabídek,
  // dlaždice ani posuvný pás v obchodě.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(300, window.innerWidth - 32);
    setPos({ top: r.bottom + 6, left: Math.max(16, Math.min(r.right - width, window.innerWidth - width - 16)) });
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    // Při posunu stránky (i když se otevře klávesnice na mobilu) panel jde s tlačítkem.
    const follow = () => place();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close);
      window.removeEventListener('resize', follow); window.removeEventListener('scroll', follow, true);
    };
  }, [open]);

  const submit = (form: FormData) => {
    setError(null);
    start(async () => {
      const r = await proposePrice(listingId, Number(form.get('price')), Number(form.get('quantity') ?? 1));
      if (r.error) {
        if (/přihlaste/i.test(r.error)) return router.push(`/prihlaseni?dalsi=${encodeURIComponent(pathname)}`);
        return setError(r.error);
      }
      router.push(`/zpravy/${sellerId}`);
    });
  };

  return (
    <div className={`tz-offer ${className ?? ''}`} ref={box}>
      <Button variant="secondary" onClick={() => { place(); setOpen((v) => !v); }} aria-expanded={open}>Nabídnout cenu</Button>
      {open ? createPortal(
        <form ref={panel} action={submit} className="tz-offer-panel" style={pos ? { top: pos.top, left: pos.left } : undefined}>
          <label>
            <span className="t-label muted">VAŠE CENA ZA KUS (KČ)</span>
            <input name="price" type="number" min={1} step={1} required inputMode="numeric" autoFocus className="tz-offer-input" />
          </label>
          {max > 1 ? (
            <label>
              <span className="t-label muted">POČET KUSŮ</span>
              <input name="quantity" type="number" min={1} max={max} step={1} defaultValue={1} className="tz-offer-input" />
            </label>
          ) : null}
          <Button type="submit" disabled={pending}>{pending ? 'Posílám…' : 'Poslat návrh'}</Button>
          {error ? <p className="tz-offer-error" role="alert">{error}</p> : null}
          <p className="t-small muted">Prodejce má 48 hodin na odpověď. Když cenu přijme, vznikne objednávka.</p>
        </form>,
        document.body,
      ) : null}
    </div>
  );
}
