'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './delivery.module.css';

// Našeptávač míst z OpenStreetMap (Photon), jen Česko a Slovensko.
const PHOTON = 'https://photon.komoot.io';
const BBOX = '12.0,47.7,22.6,51.1';

export interface Place { label: string; detail: string; lat: number; lng: number }

interface Feature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; street?: string; housenumber?: string; city?: string; district?: string; county?: string; state?: string; country?: string };
}

function toPlace(f: Feature): Place {
  const p = f.properties;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : undefined;
  const town = p.city ?? p.district ?? p.county;
  const head = p.name ?? street ?? town ?? '';
  const parts = [head, head !== street ? street : undefined, head !== town ? town : undefined].filter(Boolean) as string[];
  return {
    label: [...new Set(parts)].join(', ').slice(0, 60),
    detail: [p.state, p.country].filter(Boolean).join(', '),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  };
}

/** Název místa podle bodu na mapě (pro vyplnění pole po kliknutí do mapy). */
export async function placeAt(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&lang=default`);
    const data = (await res.json()) as { features?: Feature[] };
    return data.features?.[0] ? toPlace(data.features[0]).label : null;
  } catch {
    return null;
  }
}

/** Pole „Místo (vidí kupující)“ s našeptávačem (DS DeliveryPayment). Výběr posune mapu. */
export function PlaceInput({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (p: Place) => void }) {
  const [items, setItems] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);

  useEffect(() => {
    const q = value.trim();
    if (!typed.current || q.length < 3) { setItems([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=default&bbox=${BBOX}`, { signal: ctrl.signal });
        const data = (await res.json()) as { features?: Feature[] };
        const seen = new Set<string>();
        setItems((data.features ?? []).map(toPlace).filter((p) => p.label && !seen.has(p.label) && seen.add(p.label)).slice(0, 5));
        setActive(-1);
      } catch {
        // Bez našeptávače jde místo pořád napsat ručně.
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [value]);

  const pick = (p: Place) => {
    typed.current = false;
    onChange(p.label);
    onPick(p);
    setItems([]);
    setOpen(false);
  };
  const shown = open && items.length > 0;

  return (
    <div className={styles.place}>
      <input
        name="pickupPlace" maxLength={60} required value={value} className={styles.input}
        placeholder="např. Brno, Mendlovo náměstí" autoComplete="off"
        role="combobox" aria-expanded={shown} aria-controls="pickup-place-list" aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `pickup-place-${active}` : undefined}
        onChange={(e) => { typed.current = true; onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {shown ? (
        <ul id="pickup-place-list" role="listbox" className={styles.placeList}>
          {items.map((p, i) => (
            <li key={`${p.label}-${i}`} id={`pickup-place-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              <strong>{p.label}</strong>
              {p.detail ? <small>{p.detail}</small> : null}
            </li>
          ))}
          <li className={styles.placeCredit} aria-hidden>Data © OpenStreetMap</li>
        </ul>
      ) : null}
    </div>
  );
}
