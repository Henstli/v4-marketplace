// Vzhled alb a obalů karet podle návrhů na plátně „V4cards: alba a obaly“ (Design album, Design obaly).
// designs.json a sleeves.json + public/album/sleeves.svg se generují z návrhů (.design/gen/export_album.py).
import designsJson from './designs.json';
import sleevesJson from './sleeves.json';

export interface AlbumDesign {
  id: number;
  name: string;
  desc: string;
  /** Vzorový název z návrhu */
  title: string;
  /** Pozadí desky (CSS background) */
  mat: string;
  /** Výzdoba desky: HTML se zástupci {{NAME}} a {{NAME_UP}} pro název alba */
  deco: string;
  /** Vnitřek desek */
  lining: string;
  /** Barva stránek */
  page: string;
  /** Okraj kapes */
  pocket: string;
  /** Čísla prázdných kapes */
  empty: string;
  glow: string | null;
  square: boolean;
}

export interface SleeveDesign {
  id: number;
  name: string;
  desc: string;
  film: 'gloss' | 'matte' | 'holo' | 'glit';
}

export const ALBUM_DESIGNS = designsJson as AlbumDesign[];
export const SLEEVES = sleevesJson as SleeveDesign[];
export const SLEEVE_SPRITE = '/album/sleeves.svg';

export function albumDesign(id: number): AlbumDesign {
  return ALBUM_DESIGNS[Math.min(ALBUM_DESIGNS.length, Math.max(1, id)) - 1];
}

export function sleeveDesign(id: number): SleeveDesign {
  return SLEEVES[Math.min(SLEEVES.length, Math.max(1, id)) - 1];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML výzdoby desky s názvem alba (desky jsou kreslené v 168 × 210). */
export function coverDeco(d: AlbumDesign, name: string): string {
  const n = name.trim() || ' ';
  return d.deco.split('{{NAME_UP}}').join(esc(n.toLocaleUpperCase('cs'))).split('{{NAME}}').join(esc(n));
}

/** Název alba v textu webu (nadpis, seznam, navigace): po 24 znacích tři tečky. Celý název je v title. */
export function shortAlbumName(name: string, max = 24): string {
  const ch = Array.from(name.trim());
  return ch.length > max ? ch.slice(0, max).join('').trimEnd() + '...' : ch.join('');
}

/** Písma, která používají názvy na deskách (načítají se jen na stránkách s alby). */
export const ALBUM_FONTS =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Fraunces:ital,wght@0,600;0,700;1,600&family=Poiret+One&family=Orbitron:wght@800&family=Barlow+Condensed:wght@700;800&family=Shippori+Mincho:wght@700;800&family=Bangers&family=Caveat:wght@700&family=Fredoka:wght@600&display=swap';

/** Přirozené řazení čísel karet v sadě (2 < 10 < 10a < TG03). */
export function compareCardNumbers(a: string, b: string): number {
  const pa = a.match(/^(\D*)(\d+)(.*)$/);
  const pb = b.match(/^(\D*)(\d+)(.*)$/);
  if (pa && pb) {
    if (pa[1] !== pb[1]) return pa[1] ? 1 : pb[1] ? -1 : pa[1].localeCompare(pb[1]);
    const d = Number(pa[2]) - Number(pb[2]);
    if (d) return d;
    return pa[3].localeCompare(pb[3]);
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b);
}

/** Hlavní číslo karty (před lomítkem) pro rozhodnutí, zda jde o tajnou vzácnost nad počtem v sadě. */
export function mainNumber(n: string): number | null {
  const m = n.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}
