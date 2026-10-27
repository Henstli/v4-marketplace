'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/trezor';
import type { DeliveryPoint, PointProvider } from '@/lib/delivery';
import styles from './cart.module.css';

// Mapy výdejních míst od dopravců (DS DeliveryPayment › Výdejní místo). Načtou se až po kliknutí
// na Vybrat výdejní místo, ne při otevření košíku: dopravce při tom dostane IP adresu kupujícího.
const BALIKOVNA_URL = 'https://b2c.cpost.cz/locations/?type=BALIKOVNY';
const BALIKOVNA_ORIGIN = 'https://b2c.cpost.cz';
const PPL_JS = 'https://www.ppl.cz/sources/map/main.js';
const PPL_CSS = 'https://www.ppl.cz/sources/map/main.css';
const PACKETA_JS = 'https://widget.packeta.com/v6/www/js/library.js';
const PACKETA_KEY = process.env.NEXT_PUBLIC_PACKETA_API_KEY;

const TITLE: Record<PointProvider, string> = {
  zasilkovna: 'Výdejní místo Zásilkovny',
  balikovna: 'Výdejní místo Balíkovny',
  ppl: 'Výdejní místo PPL',
};
const BRAND: Record<PointProvider, string> = { zasilkovna: 'Zásilkovna', balikovna: 'Česká pošta', ppl: 'PPL' };

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const join = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(', ');

function loadScript(src: string, fresh = false): Promise<void> {
  const old = document.querySelector<HTMLScriptElement>(`script[data-src="${src}"]`);
  if (old && !fresh) return old.dataset.ready ? Promise.resolve() : new Promise((ok) => old.addEventListener('load', () => ok()));
  old?.remove();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => { s.dataset.ready = '1'; ok(); };
    s.onerror = () => fail(new Error(src));
    document.head.appendChild(s);
  });
}

function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

/** PPL posílá v event.detail objekt místa; názvy polí PPL nezveřejňuje, bereme běžné varianty. */
function fromPpl(d: Obj): DeliveryPoint | null {
  const addr = (d.address && typeof d.address === 'object' ? d.address : d) as Obj;
  const name = str(d.name) || str(d.accessPointName);
  if (!name) return null;
  return {
    id: str(d.code) || str(d.accessPointCode) || str(d.id) || undefined,
    name,
    address: join(addr.street, join(str(addr.zipCode) || str(addr.zip), addr.city).replace(', ', ' ')) || undefined,
  };
}

/** Okno s mapou dopravce. Zásilkovna otevírá vlastní okno, ostatní mapy jsou v našem. */
export function PointPicker({ provider, onPick, onClose }: { provider: PointProvider; onPick: (p: DeliveryPoint) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  const [manual, setManual] = useState('');
  const packeta = provider === 'zasilkovna' && !!PACKETA_KEY;
  // Rodič posílá nové funkce při každém vykreslení, mapa se kvůli tomu znovu načítat nemá.
  const cb = useRef({ onPick, onClose });
  useLayoutEffect(() => { cb.current = { onPick, onClose }; });
  const pick = (p: DeliveryPoint) => { cb.current.onPick(p); cb.current.onClose(); };

  useEffect(() => {
    if (packeta) {
      // Zásilkovna: oficiální widget s klíčem V4cards (jen mapa, zásilky přes něj nevznikají).
      let live = true;
      loadScript(PACKETA_JS)
        .then(() => {
          const w = (window as unknown as { Packeta?: { Widget: { pick: (k: string, cb: (p: Obj | null) => void, o: Obj) => void } } }).Packeta;
          if (!live || !w) return;
          w.Widget.pick(PACKETA_KEY!, (p) => {
            if (p && str(p.name)) pick({ id: str(p.id) || undefined, name: str(p.name), address: join(p.street, `${str(p.zip)} ${str(p.city)}`) || undefined });
            else cb.current.onClose();
          }, { country: 'cz,sk', language: 'cs', appIdentity: 'v4cards' });
        })
          .catch(() => { if (live) setFailed(true); });
      return () => { live = false; };
    }
    dialog.current?.showModal();
    if (provider === 'balikovna') {
      const listen = (e: MessageEvent) => {
        if (e.origin !== BALIKOVNA_ORIGIN || e.data?.message !== 'pickerResult') return;
        const p = (e.data.point ?? {}) as Obj;
        if (!str(p.name)) return;
        pick({ id: str(p.id) || undefined, name: str(p.name), address: str(p.address) || join(p.zip, p.municipality_name) || undefined });
      };
      window.addEventListener('message', listen);
      return () => window.removeEventListener('message', listen);
    }
    if (provider === 'ppl') {
      const listen = (e: Event) => {
        const p = fromPpl(((e as CustomEvent).detail ?? {}) as Obj);
        if (p) pick(p);
      };
      document.addEventListener('ppl-parcelshop-map', listen);
      loadCss(PPL_CSS);
      // Skript PPL hledá mapu při načtení, proto se při každém otevření načte znovu.
      loadScript(PPL_JS, true).catch(() => setFailed(true));
      return () => document.removeEventListener('ppl-parcelshop-map', listen);
    }
    // Zásilkovna bez klíče: místo se napíše ručně.
  }, [provider, packeta]);

  // Widget Zásilkovny se nenačetl: náhradní okno s ručním zadáním.
  useEffect(() => { if (failed && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [failed]);

  if (packeta && !failed) return null;
  const typed = provider === 'zasilkovna';

  return (
    <dialog ref={dialog} className={styles.pickDialog} onClose={onClose} aria-labelledby="pick-title">
      <div className={styles.pickHead}>
        <strong id="pick-title">{TITLE[provider]}</strong>
        <button type="button" className={styles.pickClose} onClick={onClose}>Zavřít</button>
      </div>
      {typed || failed ? (
        <form
          className={styles.pickManual}
          onSubmit={(e) => { e.preventDefault(); if (manual.trim()) pick({ name: manual.trim().slice(0, 120) }); }}
        >
          <p className="t-small muted">
            {failed ? 'Mapu se nepodařilo načíst. ' : ''}Napište název nebo adresu výdejního místa, jak ho najdete na webu dopravce.
          </p>
          <label className={styles.point}>
            Výdejní místo
            <input value={manual} maxLength={120} onChange={(e) => setManual(e.target.value)} placeholder="např. Z-BOX Brno, Kounicova 12" autoFocus />
          </label>
          <div><Button type="submit" disabled={!manual.trim()}>Vybrat toto místo</Button></div>
        </form>
      ) : provider === 'balikovna' ? (
        <iframe src={BALIKOVNA_URL} title="Mapa Balíkoven" allow="geolocation" className={styles.pickFrame} />
      ) : (
        <div className={styles.pickPpl}><div id="ppl-parcelshop-map" data-lat="49.8" data-lng="15.5" /></div>
      )}
      <p className={`t-small muted ${styles.pickNote}`}>Mapu a seznam míst poskytuje {BRAND[provider]}.</p>
    </dialog>
  );
}
