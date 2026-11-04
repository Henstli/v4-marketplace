'use client';

import s from './kolekce.module.css';

/** Nastavení „Doplňovat samo“: rámeček s popisem vlevo a přepínačem vpravo (vzor nastavení z DS Trezor). */
export function AutoFill({ checked, onChange, kind, disabled }: { checked: boolean; onChange: (v: boolean) => void; kind: 'set' | 'custom'; disabled?: boolean }) {
  return (
    <label className={`${s.setRow}${checked ? ` ${s.setOn}` : ''}`}>
      <span className={s.setIco} aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /><path d="M12 8v8M8 12h8" />
        </svg>
      </span>
      <span className={s.setText}>
        <b>Doplňovat samo</b>
        <small>{kind === 'set'
          ? 'Kartu z této sady, kterou naskladníte, vložíme do alba sami. Při otevření alba ji uvidíte přiletět.'
          : 'Kartu z alba, která chybí a znovu ji naskladníte, vrátíme na její místo sami.'}
          {checked ? '' : ' Vypnuto: karty ze skladu čekají vedle alba, dokud je nevložíte.'}</small>
      </span>
      <input type="checkbox" role="switch" className={s.switch} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
