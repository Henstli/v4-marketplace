'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { addCards, cardAlbums, type AddOpts } from '@/app/kolekce/actions';
import { HaveForm } from '@/app/kolekce/HaveForm';
import { Button, PlusIcon } from '@/components/trezor';
import s from './HaveIt.module.css';
import dynamic from 'next/dynamic';
import { shortAlbumName } from '@/lib/album/designs';

// vzhledy alb (~18 kB) se stáhnou až při otevření nabídky, ne se stránkou karty
const AlbumBook = dynamic(() => import('./AlbumBook').then((m) => m.AlbumBook), { ssr: false });

type Albums = NonNullable<Awaited<ReturnType<typeof cardAlbums>>>;

/** „Mám ji“ na stránce karty (5E): vloží kartu do alba, kam patří, nebo jen do sbírky. */
export function HaveIt({ cardId }: { cardId: string }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Albums | null>(null);
  const [done, setDone] = useState<{ id: string | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Kolekce bere karty ze sbírky: kartu mimo sbírku nejdřív uložíme (stav, jazyk), jediný kus na prodeji stáhneme.
  const [need, setNeed] = useState<{ id: string | null; name: string; kind: 'missing' | 'sale' } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const toggle = async () => {
    if (open) return setOpen(false);
    setDone(null);
    const r = await cardAlbums(cardId);
    if (!r) return router.push(`/prihlaseni?dalsi=${encodeURIComponent(path)}`);
    setData(r);
    setOpen(true);
  };

  const add = async (albumId: string | null, name: string, o: AddOpts = {}) => {
    setBusy(true);
    const r = await addCards([cardId], albumId, o);
    setBusy(false);
    if ('error' in r) return;
    if (!r.added.length) { setNeed({ id: albumId, name, kind: r.onSale.length ? 'sale' : 'missing' }); return; }
    setNeed(null);
    setDone({ id: albumId, name });
    setData((d) => d && { owned: d.owned + 1, albums: d.albums.map((a) => (a.id === albumId ? { ...a, inAlbum: true } : a)) });
  };

  const fit = data?.albums.filter((a) => a.fits) ?? [];
  return (
    <div className={s.wrap} ref={box}>
      <Button variant="secondary" size="lg" onClick={toggle} aria-expanded={open}>
        {data?.owned ? `Mám ji (${data.owned}×)` : 'Mám ji'}
      </Button>
      {open && data ? (
        <div className={s.pop}>
          <h4>Vložit do alba</h4>
          {fit.map((a) => (
            <button key={a.id} type="button" className={s.row} disabled={busy || a.inAlbum} onClick={() => add(a.id, a.name)}>
              <AlbumBook design={a.design} name={a.name} scale={0.22} />
              <span>
                <b title={a.name}>{shortAlbumName(a.name)}</b>
                <small>
                  {a.kind === 'set'
                    ? `${a.inAlbum ? 'Už ji tam máš' : 'Patří sem'}${a.position ? ` · místo ${a.position}` : ''}`
                    : a.inAlbum ? 'Už je v albu' : 'Vlastní album, přidá se na konec'}
                </small>
              </span>
            </button>
          ))}
          {fit.length ? <div className={s.sep} /> : null}
          <button type="button" className={s.row} disabled={busy} onClick={() => add(null, '')}>
            <span className={s.plus}>✓</span>
            <span><b>Do kolekce bez alba</b><small>Uvidíš ji v Moje kolekce › Všechny karty</small></span>
          </button>
          <Link className={s.row} href="/kolekce/nove">
            <span className={s.plus}><PlusIcon size={18} stroke={2.5} /></span>
            <span><b>Založit nové album</b><small>Celá sada nebo vlastní výběr</small></span>
          </Link>
          {need?.kind === 'missing' ? <HaveForm name="Tuto kartu" pending={busy} onCancel={() => setNeed(null)} onSave={(cond, lang) => add(need.id, need.name, { cond, lang })} /> : null}
          {need?.kind === 'sale' ? (
            <div className={s.ok}>
              Jediný kus máte na prodeji. Album si ho vezme a z prodeje se stáhne.{' '}
              <button type="button" className={s.linkBtn} disabled={busy} onClick={() => add(need.id, need.name, { unsell: true })}>Stáhnout z prodeje a vložit</button>
            </div>
          ) : null}
          {done ? (
            <p className={s.ok}>
              ✓ {done.id ? <>Vloženo do alba {done.name}. <Link href={`/kolekce/${done.id}`}>Zobrazit album</Link></> : <>Přidáno do sbírky. <Link href="/kolekce?tab=karty">Moje kolekce</Link></>}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
