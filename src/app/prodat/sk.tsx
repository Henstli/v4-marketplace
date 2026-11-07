/** Drobnosti pro Sklad a Sbírku podle prototypu (třídy .tz-sk z design-system/stock.css). */

export const nf = (n: number) => Math.round(n).toLocaleString('cs-CZ').replace(/\s/g, ' ');
export const kc = (n: number | null | undefined) => (n == null ? '—' : `${nf(n)} Kč`);
/** 1 kartu, 2 karty, 5 karet */
export const plA = (n: number) => `${nf(n)} ${n === 1 ? 'kartu' : n >= 2 && n <= 4 ? 'karty' : 'karet'}`;
/** 1 karta, 2 karty, 5 karet */
export const pl1 = (n: number) => `${nf(n)} ${n === 1 ? 'karta' : n >= 2 && n <= 4 ? 'karty' : 'karet'}`;
export const plw = (n: number, w: [string, string, string]) => `${nf(n)} ${n === 1 ? w[0] : n >= 2 && n <= 4 ? w[1] : w[2]}`;

/** Jazyk karty jako v prototypu: EN, DE, JP… */
export const langCode = (l: string) => (l === 'ja' ? 'JP' : l.toUpperCase());
/** Jazyky, které jde u karty nastavit (čeština se u karet nenabízí). */
export const CARD_LANGS = ['en', 'de', 'ja', 'fr', 'it', 'es', 'pt', 'ko', 'zh'];
export const LANG_FULL: Record<string, string> = {
  en: 'angličtina', de: 'němčina', ja: 'japonština', fr: 'francouzština', it: 'italština', es: 'španělština',
  pt: 'portugalština', ko: 'korejština', zh: 'čínština', ru: 'ruština', cs: 'čeština',
};
export const COND_FULL: Record<string, string> = {
  MT: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Lehce hraná', PL: 'Hraná',
};
export const COND_ORDER: Record<string, number> = { MT: 0, NM: 1, EX: 2, GD: 3, LP: 4, PL: 5 };

/** Zdroj řádku skladu: třída štítku .src a název. */
export const SRC: Record<string, [string, string]> = {
  manual: ['R', 'Ručně'], import: ['X', 'Tabulka'], photo: ['R', 'Z fotky'], app: ['A', 'Aplikace'],
};

export const Ico = {
  x: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  s: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  list: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="5" height="7" rx="1" /><rect x="3" y="13" width="5" height="7" rx="1" /><path d="M11 7.5h10M11 16.5h10" /></svg>,
  text: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  dots: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>,
  filter: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4" /></svg>,
  chev: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>,
  plus: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>,
  dl: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16" /></svg>,
  sale: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>,
  stock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 16V4M6 10l6 6 6-6M4 20h16" /></svg>,
  price: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12l9-9h8v8l-9 9z" /><circle cx="15.5" cy="8.5" r="1.5" /></svg>,
  sync: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" /><path d="M20 4v5h-5M4 20v-5h5" /></svg>,
  inv: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>,
};

/** Okno prototypu: ztmavení, hlavička s křížkem, tělo a patička. */
export function Modal({ title, wide, cls, onClose, children, foot }: {
  title: React.ReactNode; wide?: boolean; cls?: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode;
}) {
  return (
    <>
      <div className="dim" onClick={onClose} />
      <div className={`modal${wide ? ' wide' : ''}${cls ? ` ${cls}` : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="mh"><h3>{title}</h3><button type="button" className="cls" onClick={onClose} aria-label="Zavřít">{Ico.x}</button></div>
        <div className="mb">{children}</div>
        <div className="mf">{foot}</div>
      </div>
    </>
  );
}

/** Přepínač ve tvaru .seg */
export function Seg<T extends string>({ value, options, onChange, style, className }: {
  value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void; style?: React.CSSProperties; className?: string;
}) {
  return (
    <div className={`seg${className ? ` ${className}` : ''}`} style={style} role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
