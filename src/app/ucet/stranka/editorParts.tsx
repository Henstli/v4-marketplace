'use client';

// Společné ovládací prvky editoru stránky: pole, nahrávání obrázků, výběr nabídek a karet.
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, CardThumb, SellerBadge } from '@/components/trezor';
import { createClient } from '@/lib/supabase/browser';
import { SUPABASE_URL } from '@/lib/supabase/config';
import { formatNumber } from '@/lib/format';
import { findCatalogCards, type PickerCard } from './actions';
import sell from '../../prodat/sell.module.css';
import styles from './editor.module.css';

export interface ListingOption {
  id: string;
  name: string;
  sub: string;
  price: number;
  image?: string;
  game?: string;
  setCode?: string;
  setName?: string;
}

const MAX_IMAGE = 3 * 1024 * 1024;

export function mediaUrl(path: string): string | null {
  return path ? `${SUPABASE_URL}/storage/v1/object/public/shop-media/${path}` : null;
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Nahraje obrázek do vlastní složky v bucketu shop-media a vrátí jeho cestu. */
export async function uploadImage(uid: string, prefix: string, file: File): Promise<string> {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!ext) throw new Error('Nahrajte obrázek JPG, PNG nebo WebP.');
  if (file.size > MAX_IMAGE) throw new Error('Obrázek může mít nejvýš 3 MB.');
  const path = `${uid}/${prefix}-${Date.now().toString(36)}${rid()}.${ext}`;
  const { error } = await createClient().storage.from('shop-media').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
  if (error) throw new Error('Obrázek se nepodařilo nahrát. Máte-li zapnuté dvoufázové ověření, přihlaste se znovu s kódem.');
  return path;
}

export function ProTag() {
  return <span className={styles.lockTag}><SellerBadge type="pro" /></span>;
}

/** Nadpis volby s nápovědou a štítkem Pro, když ji tarif zatím neukáže. */
export function Label({ children, pro, locked }: { children: ReactNode; pro?: boolean; locked?: boolean }) {
  return (
    <span className={styles.label}>
      <span className="t-label muted">{children}</span>
      {pro && locked ? <ProTag /> : null}
    </span>
  );
}

export function Field({ label, hint, children, pro, locked }: { label: string; hint?: ReactNode; children: ReactNode; pro?: boolean; locked?: boolean }) {
  return (
    <label className={sell.field}>
      <Label pro={pro} locked={locked}>{label}</Label>
      {children}
      {hint ? <span className="t-small muted">{hint}</span> : null}
    </label>
  );
}

/** Skupina voleb s nadpisem (bez <label>, uvnitř jsou tlačítka). */
export function Group({ label, hint, children, pro, locked }: { label: string; hint?: ReactNode; children: ReactNode; pro?: boolean; locked?: boolean }) {
  return (
    <div className={sell.field} role="group" aria-label={label}>
      <Label pro={pro} locked={locked}>{label}</Label>
      {children}
      {hint ? <span className="t-small muted">{hint}</span> : null}
    </div>
  );
}

/** Přepínač zapnuto/vypnuto s popisem. */
export function Toggle({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.toggleText}>
        <span>{children}</span>
        {hint ? <span className="t-small muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ImageInput({ label, path, onPath, uid, prefix, round, wide, small }: {
  label: string; path: string; onPath: (p: string) => void; uid: string; prefix: string; round?: boolean; wide?: boolean; small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = mediaUrl(path);
  return (
    <div className={sell.field}>
      {label ? <span className="t-label muted">{label}</span> : null}
      <div className={styles.imageRow}>
        <span className={`${styles.imagePreview} ${round ? styles.round : ''} ${wide ? styles.imageWide : ''} ${small ? styles.imageSmall : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt="" /> : <span className="t-small muted">Bez obrázku</span>}
        </span>
        <div className={styles.imageActions}>
          <label className={styles.upload}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              aria-label={label || 'Nahrát obrázek'}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                setError('');
                try {
                  onPath(await uploadImage(uid, prefix, file));
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Obrázek se nepodařilo nahrát.');
                } finally {
                  setBusy(false);
                }
              }}
            />
            {busy ? 'Nahrávám…' : path ? 'Změnit' : 'Nahrát obrázek'}
          </label>
          {path ? <button type="button" className={styles.linkButton} onClick={() => onPath('')}>Odebrat</button> : null}
          {!small ? <span className="t-small muted">{wide ? 'JPG, PNG nebo WebP do 3 MB, ideálně 1600 × 400 px' : 'JPG, PNG nebo WebP do 3 MB'}</span> : null}
          {error ? <span className={sell.error} role="alert">{error}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Výběr z vlastních nabídek */
export function ListingPicker({ listings, selected, onPick, max }: { listings: ListingOption[]; selected: string[]; onPick: (id: string) => void; max: number }) {
  const [q, setQ] = useState('');
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listings.filter((l) => !selected.includes(l.id) && (!t || l.name.toLowerCase().includes(t) || l.sub.toLowerCase().includes(t))).slice(0, 6);
  }, [q, listings, selected]);
  if (selected.length >= max) return null;
  if (!listings.length) return <p className="t-small muted">Zatím nemáte žádné nabídky. Přidejte je v sekci <Link href="/prodat">Prodat</Link>.</p>;
  return (
    <div className={styles.picker}>
      <input className={sell.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat ve vlastních nabídkách" aria-label="Hledat ve vlastních nabídkách" />
      <div className={styles.pickList}>
        {found.map((l) => (
          <button key={l.id} type="button" className={styles.pickRow} onClick={() => onPick(l.id)}>
            <CardThumb image={l.image} size="sm" preview={l.image} />
            <span className={styles.pickText}><strong>{l.name}</strong><span className="code muted">{l.sub}</span></span>
            <span className="t-price">{formatNumber(l.price)} Kč</span>
            <span className={styles.add} aria-hidden="true">+</span>
          </button>
        ))}
        {!found.length ? <p className="t-small muted" style={{ padding: 'var(--space-2) var(--space-3)', margin: 0 }}>Nic nenalezeno.</p> : null}
      </div>
    </div>
  );
}

/** Vybrané nabídky s přeřazením a odebráním */
export function PickedListings({ ids, onChange, listingById }: { ids: string[]; onChange: (ids: string[]) => void; listingById: Map<string, ListingOption> }) {
  if (!ids.length) return null;
  return (
    <div className={styles.rows}>
      {ids.map((id, i) => {
        const l = listingById.get(id);
        return (
          <div key={id} className={styles.picked}>
            <CardThumb image={l?.image} size="sm" preview={l?.image} />
            <span className={styles.pickText}><strong>{l?.name ?? 'Nabídka už není v prodeji'}</strong>{l ? <span className="code muted">{l.sub} · {formatNumber(l.price)} Kč</span> : null}</span>
            <RowActions
              onUp={i > 0 ? () => onChange(move(ids, i, -1)) : undefined}
              onDown={i < ids.length - 1 ? () => onChange(move(ids, i, 1)) : undefined}
              onRemove={() => onChange(ids.filter((x) => x !== id))}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Výběr karty z katalogu (Vitrína, Hledám) */
export function CardPicker({ onPick }: { onPick: (c: PickerCard) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PickerCard[] | null>(null);
  const [pending, start] = useTransition();
  const search = () => start(async () => setFound(await findCatalogCards(q)));
  return (
    <div className={styles.picker}>
      <div className={styles.inline}>
        <input
          className={sell.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          placeholder="Název karty z katalogu"
          aria-label="Hledat kartu v katalogu"
        />
        <Button variant="secondary" onClick={search} disabled={pending || q.trim().length < 2}>{pending ? 'Hledám…' : 'Hledat'}</Button>
      </div>
      {found ? (
        <div className={styles.pickList}>
          {found.map((c) => (
            <button key={c.id} type="button" className={styles.pickRow} onClick={() => onPick(c)}>
              <CardThumb image={c.image} size="sm" preview={c.image} />
              <span className={styles.pickText}><strong>{c.name}</strong><span className="code muted">{c.setCode} {c.number}</span></span>
              <span className={styles.add} aria-hidden="true">+</span>
            </button>
          ))}
          {!found.length ? <p className="t-small muted" style={{ padding: 'var(--space-2) var(--space-3)', margin: 0 }}>Nic nenalezeno.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function RowActions({ onUp, onDown, onRemove, horizontal }: { onUp?: () => void; onDown?: () => void; onRemove?: () => void; horizontal?: boolean }) {
  return (
    <span className={styles.rowActions}>
      {onUp ? <button type="button" className={styles.iconButton} onClick={onUp} aria-label={horizontal ? 'Posunout doleva' : 'Posunout nahoru'}>{horizontal ? '←' : '↑'}</button> : null}
      {onDown ? <button type="button" className={styles.iconButton} onClick={onDown} aria-label={horizontal ? 'Posunout doprava' : 'Posunout dolů'}>{horizontal ? '→' : '↓'}</button> : null}
      {onRemove ? <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Odebrat">×</button> : null}
    </span>
  );
}

/** Dlaždice s volbami (obrázek + název), jedna vybraná. */
export function Tiles<T extends string>({ options, value, onChange, locked, render, cols }: {
  options: readonly { id: T; name: string; pro?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  locked?: boolean;
  render?: (id: T) => ReactNode;
  cols?: number;
}) {
  return (
    <div className={styles.tiles} style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
      {options.map((o) => (
        <button key={o.id} type="button" className={styles.tile} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {render ? <span className={styles.tileArt} aria-hidden="true">{render(o.id)}</span> : null}
          <span className={styles.tileName}>{o.name}{o.pro && locked ? <ProTag /> : null}</span>
        </button>
      ))}
    </div>
  );
}
