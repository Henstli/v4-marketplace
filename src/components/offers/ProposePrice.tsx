'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { proposePrice } from '@/app/zpravy/offers';

/**
 * „Nabídnout cenu“ u nabídky s cenou dohodou (DS OfferTable): pod tlačítkem panel s cenou,
 * počtem kusů a odesláním. Po odeslání otevře konverzaci s prodejcem.
 */
export function ProposePrice({ listingId, sellerId, max, className }: { listingId: string; sellerId: string; max: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
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
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>Nabídnout cenu</Button>
      {open ? (
        <form action={submit} className="tz-offer-panel">
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
        </form>
      ) : null}
    </div>
  );
}
