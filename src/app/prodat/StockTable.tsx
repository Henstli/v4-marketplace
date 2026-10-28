'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { BulkBar, Button, CardThumb, Price, Status } from '@/components/trezor';
import { fold } from '@/lib/import/columns';
import { plural } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { LANGUAGE_NAMES, type Language } from '@/lib/types';
import { bulkUpdateListings, withdrawListings, type BulkResult } from './actions';
import styles from './sell.module.css';

export interface StockItem {
  id: string;
  /** null = cena dohodou */
  price: number | null;
  condition: string;
  language: string;
  quantity: number;
  /** Odložené kusy nabídky skryté podporou (null = neskrytá) */
  hidden?: number | null;
  /** Nabídku po nahlášení odstranila podpora (vrátit ji nejde) */
  removed?: boolean;
  card: { slug: string; name: string; setName: string; setCode: string; number: string; image: string | null; game: string | null } | null;
}

const PAGE = 100;

// Moje nabídky: tabulka s výběrem a hromadnými úpravami (cena o %, pevná cena, počet kusů, stažení).
export function StockTable({ items }: { items: StockItem[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pct, setPct] = useState('-10');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const f = fold(q);
    if (!f) return items;
    return items.filter((i) => fold([i.card?.name, i.card?.setName, i.card?.setCode, i.card?.number].filter(Boolean).join(' ')).includes(f));
  }, [items, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const ids = [...selected].filter((id) => items.some((i) => i.id === id));
  const allShown = shown.length > 0 && shown.every((i) => selected.has(i.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      const next = new Set(s);
      for (const i of shown) { if (allShown) next.delete(i.id); else next.add(i.id); }
      return next;
    });
  }

  function run(label: (n: number) => string, action: () => Promise<BulkResult>, clear = false) {
    setMessage(null);
    start(async () => {
      const res = await action();
      if (res.error) setMessage({ ok: false, text: res.error });
      else {
        setMessage({ ok: true, text: label(res.count ?? 0) });
        if (clear) setSelected(new Set());
      }
    });
  }

  const n = plural(ids.length, ['nabídku', 'nabídky', 'nabídek']);
  const changed = (c: number) => `Upraveno: ${plural(c, ['nabídka', 'nabídky', 'nabídek'])}.`;

  return (
    <div className={styles.stock}>
      {items.length > 10 ? (
        <input
          className={`${styles.input} ${styles.stockSearch}`}
          type="search"
          placeholder="Hledat ve skladu: název, sada nebo číslo"
          aria-label="Hledat ve skladu"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
        />
      ) : null}

      <div className="tz-table-wrap">
        <table className="tz-table">
          <thead>
            <tr>
              <th className="tz-check">
                <input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Vybrat všechny zobrazené nabídky" />
              </th>
              <th>Karta</th>
              <th>Stav</th>
              <th>Jazyk</th>
              <th className="tz-num">Cena</th>
              <th className="tz-num">Ks</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} aria-selected={selected.has(l.id) ? 'true' : 'false'}>
                <td className="tz-check">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Vybrat ${l.card?.name ?? 'nabídku'}`} />
                </td>
                <td>
                  <div className={styles.stockCard}>
                    <CardThumb
                      size="sm"
                      image={thumbUrl(l.card?.image ?? undefined)}
                      preview={l.card?.image ?? undefined}
                      color={l.card?.game ? `var(--game-${l.card.game}-art, var(--surface-sunken))` : undefined}
                    />
                    <div className={styles.resultText}>
                      {l.card ? <Link href={`/karty/${l.card.slug}`} className={styles.rowName}>{l.card.name}</Link> : 'Karta'}
                      {l.card ? (
                        <span className="t-small muted">{l.card.setName} · <span className={styles.mono}>{l.card.setCode} {l.card.number}</span></span>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td><span className="code">{l.condition}</span></td>
                <td className="tz-muted">{LANGUAGE_NAMES[l.language as Language] ?? l.language}</td>
                <td className="tz-num">{l.price != null ? <Price amount={l.price} /> : <span className="muted">Dohodou</span>}</td>
                <td className="tz-num">{l.removed ? <Status tone="warn">Odstraněno podporou</Status> : l.hidden != null ? <Status tone="warn">Skrytá podporou{l.hidden ? ` · ${l.hidden} ks` : ''}</Status> : l.quantity > 0 ? l.quantity : <Status tone="muted">Stažená</Status>}</td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={6} className="tz-muted">Nic neodpovídá hledání.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div className={styles.pager}>
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Předchozí</Button>
          <span className="t-small muted">Strana {page + 1} z {pages}</span>
          <Button variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Další</Button>
        </div>
      ) : null}

      {message ? <p className={message.ok ? styles.ok : styles.error} role="status">{message.text}</p> : null}

      {ids.length ? (
        <BulkBar count={ids.length} onClear={() => setSelected(new Set())}>
          <span className="tz-bulkbar-group">
            <input className={`tz-cell-input tz-num ${styles.bulkInput}`} inputMode="decimal" aria-label="Změna ceny v procentech" value={pct} onChange={(e) => setPct(e.target.value)} />
            <span>%</span>
            <Button
              variant="secondary"
              disabled={pending || !Number(pct.replace(',', '.'))}
              onClick={() => run(changed, () => bulkUpdateListings(ids, { pct: Number(pct.replace(',', '.')) }))}
            >
              Změnit cenu
            </Button>
          </span>
          <span className="tz-bulkbar-group">
            <input className={`tz-cell-input tz-num ${styles.bulkInput}`} inputMode="numeric" placeholder="Kč" aria-label="Nová cena za kus v Kč" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
            <Button variant="secondary" disabled={pending || !price} onClick={() => run(changed, () => bulkUpdateListings(ids, { price: Number(price) }))}>
              Nastavit cenu
            </Button>
          </span>
          <span className="tz-bulkbar-group">
            <input className={`tz-cell-input tz-num ${styles.bulkInput}`} inputMode="numeric" placeholder="ks" aria-label="Nový počet kusů" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
            <Button variant="secondary" disabled={pending || qty === ''} onClick={() => run(changed, () => bulkUpdateListings(ids, { quantity: Number(qty) }))}>
              Nastavit počet
            </Button>
          </span>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Opravdu stáhnout ${n} z prodeje?`)) return;
              run((c) => `Staženo z prodeje: ${plural(c, ['nabídka', 'nabídky', 'nabídek'])}.`, () => withdrawListings(ids), true);
            }}
          >
            Stáhnout z prodeje
          </Button>
        </BulkBar>
      ) : null}
    </div>
  );
}
