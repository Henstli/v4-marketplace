'use client';

import { useState } from 'react';
import { AlbumBook, Sleeve } from '@/components/album/AlbumBook';
import { SleeveSprite } from '@/components/album/SleeveSprite';
import { Button } from '@/components/trezor';
import { ALBUM_DESIGNS, SLEEVES, albumDesign, sleeveDesign } from '@/lib/album/designs';
import s from './kolekce.module.css';

export interface Look { name: string; design: number; sleeve: number }

/** Název, desky (20 vzhledů) a obaly (20 vzorů) alba: krok 5A průvodce a zásuvka Vzhled alba. */
export function LookFields({ value, onChange }: { value: Look; onChange: (v: Look) => void }) {
  return (
    <>
      <SleeveSprite />
      <label className={s.field}>
        <span>Název alba</span>
        <input className={s.input} value={value.name} maxLength={60} placeholder="Třeba Kanto 1999" onChange={(e) => onChange({ ...value, name: e.target.value })} />
        <small>Název se vytiskne na desky. Nejvýš 60 znaků, dlouhý název se na deskách zkrátí.</small>
      </label>
      <div className={s.field}>
        <span>Desky alba <small>· {albumDesign(value.design).name}</small></span>
        <div className={s.designs}>
          {ALBUM_DESIGNS.map((d) => (
            <button key={d.id} type="button" className={s.dOpt} aria-pressed={value.design === d.id} onClick={() => onChange({ ...value, design: d.id })} title={d.desc}>
              <AlbumBook design={d.id} name={value.name || d.title} scale={0.42} hover={value.design === d.id} />
              {d.name}
            </button>
          ))}
        </div>
      </div>
      <div className={s.field}>
        <span>Obaly karet <small>· {sleeveDesign(value.sleeve).name}</small></span>
        <div className={s.designs}>
          {SLEEVES.map((sl) => (
            <button key={sl.id} type="button" className={s.dOpt} aria-pressed={value.sleeve === sl.id} onClick={() => onChange({ ...value, sleeve: sl.id })} title={sl.desc}>
              <Sleeve sleeve={sl.id} image={null} scale={0.42} back />
              {sl.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function AlbumLook({ value, onSave, onDelete }: { value: Look; onSave: (v: Look) => Promise<string | null>; onDelete?: () => void }) {
  const [v, setV] = useState(value);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className={s.prev} style={{ position: 'static', marginBottom: 'var(--space-6)' }}>
        <AlbumBook design={v.design} name={v.name || ' '} hover />
      </div>
      <LookFields value={v} onChange={setV} />
      {err ? <p className={s.err}>{err}</p> : null}
      <div className={s.wizFoot}>
        {onDelete ? <Button variant="danger" onClick={onDelete}>Smazat album</Button> : <span />}
        <Button
          disabled={busy || !v.name.trim()}
          onClick={async () => { setBusy(true); setErr(''); const e = await onSave(v); setBusy(false); if (e) setErr(e); }}
        >
          {busy ? 'Ukládám…' : 'Uložit vzhled'}
        </Button>
      </div>
    </>
  );
}
