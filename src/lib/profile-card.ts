// Profil jako sběratelská karta (DS Trezor › ProfileCard): typová řádka, rámečky, status, stav a odznak věrnosti.
// Kódy stylů a rámečků zná jen web, databáze ukládá text. Nové styly a rámečky (kolo 2) se přidávají sem.
import type { Plan } from './plans';
import type { SellerKind } from './types';

export type CardForm = 'm' | 'f';
export type Presence = 'online' | 'offline' | 'dnd';
export type PresenceMode = 'auto' | 'dnd' | 'hidden';

/** Styl sběratele za pomlčkou v typové řádce (mužský a ženský tvar) */
export const COLLECTOR_STYLES: { id: string; m: string; f: string }[] = [
  { id: 'kompletista', m: 'Kompletista', f: 'Kompletistka' },
  { id: 'lovec', m: 'Lovec vzácností', f: 'Lovkyně vzácností' },
  { id: 'hrac', m: 'Hráč', f: 'Hráčka' },
  { id: 'investor', m: 'Investor', f: 'Investorka' },
  { id: 'otvirac', m: 'Otvírač boosterů', f: 'Otvíračka boosterů' },
  { id: 'gradovac', m: 'Gradovací nadšenec', f: 'Gradovací nadšenkyně' },
];

/** Druh obchodu za pomlčkou */
export const SHOP_STYLES: { id: string; label: string }[] = [
  { id: 'kamenny', label: 'Kamenný obchod' },
  { id: 'eshop', label: 'E-shop' },
  { id: 'kamenny-eshop', label: 'Kamenný obchod a e-shop' },
  { id: 'herna', label: 'Herna' },
  { id: 'stanek', label: 'Stánek na burzách' },
];

/** Rámečky typové řádky. Kolo 1: sklo pro všechny, stříbrná a zlatá fólie pro Plus a Pro. */
export const TYPE_FRAMES: { id: string; label: string; plans: Plan[] }[] = [
  { id: 'sklo', label: 'Sklo', plans: ['free', 'plus', 'pro'] },
  { id: 'stribro', label: 'Stříbrná fólie', plans: ['plus', 'pro'] },
  { id: 'zlato', label: 'Zlatá fólie', plans: ['plus', 'pro'] },
];

export function frameAllowed(frame: string, plan: Plan): boolean {
  return !!TYPE_FRAMES.find((f) => f.id === frame)?.plans.includes(plan);
}

/** Rámeček, který se opravdu ukáže (po snížení tarifu se vrátí sklo, uložená volba zůstane) */
export function effectiveFrame(frame: string | null | undefined, plan: Plan): string {
  return frame && frameAllowed(frame, plan) ? frame : 'sklo';
}

export type MatSurface = 'lava' | 'felt' | 'night' | 'leather';

/** Podložky celého profilu (DS Trezor › ProfileMat): Láva pro všechny, ostatní s tarifem. */
export const MAT_SURFACES: { id: MatSurface; label: string; plans: Plan[] }[] = [
  { id: 'lava', label: 'Láva', plans: ['free', 'plus', 'pro'] },
  { id: 'felt', label: 'Zelené sukno', plans: ['plus', 'pro'] },
  { id: 'night', label: 'Noční nebe', plans: ['plus', 'pro'] },
  { id: 'leather', label: 'Kůže', plans: ['pro'] },
];

export function matAllowed(mat: string, plan: Plan): boolean {
  return !!MAT_SURFACES.find((m) => m.id === mat)?.plans.includes(plan);
}

/** Podložka, která se opravdu ukáže (po snížení tarifu Láva, uložená volba zůstane) */
export function effectiveMat(mat: string | null | undefined, plan: Plan): MatSurface {
  return mat && matAllowed(mat, plan) ? (mat as MatSurface) : 'lava';
}

export function typeLineLabel(kind: SellerKind, style: string | null | undefined, form: CardForm): { lead: string; style: string | null } {
  if (kind === 'shop') return { lead: 'Obchod', style: SHOP_STYLES.find((s) => s.id === style)?.label ?? null };
  const s = COLLECTOR_STYLES.find((c) => c.id === style);
  return { lead: form === 'f' ? 'Sběratelka' : 'Sběratel', style: s ? s[form] : null };
}

/** Odznak věrnosti: 8 úrovní podle toho, jak dlouho má někdo nepřetržitě Plus nebo Pro */
export const LOYALTY_LEVELS = [
  { id: 'bronz', name: 'Bronz', months: 1, label: '1 měsíc' },
  { id: 'stribro', name: 'Stříbro', months: 3, label: '3 měsíce' },
  { id: 'zlato', name: 'Zlato', months: 6, label: '6 měsíců' },
  { id: 'platina', name: 'Platina', months: 12, label: '1 rok' },
  { id: 'smaragd', name: 'Smaragd', months: 24, label: '2 roky' },
  { id: 'diamant', name: 'Diamant', months: 36, label: '3 roky' },
  { id: 'rubin', name: 'Rubín', months: 60, label: '5 let' },
  { id: 'opal', name: 'Opál', months: 72, label: '6 a více let' },
] as const;
export type LoyaltyLevel = (typeof LOYALTY_LEVELS)[number];

/** Celé měsíce od začátku předplatného */
export function monthsSince(since: string, now = new Date()): number {
  const d = new Date(since);
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m -= 1;
  return Math.max(0, m);
}

/** Zaplacené měsíce předplatného včetně právě běžícího: hned po zaplacení 1, na začátku třetího měsíce 3. */
export function paidMonths(since: string, now = new Date()): number {
  return monthsSince(since, now) + 1;
}

/** Úroveň odznaku podle zaplacených měsíců: Bronz hned s prvním zaplacením, Stříbro se třetím, Opál se 72. */
export function loyaltyLevel(plan: Plan, since: string | null): LoyaltyLevel | null {
  if (plan === 'free' || !since) return null;
  const m = paidMonths(since);
  let lvl: LoyaltyLevel | null = null;
  for (const l of LOYALTY_LEVELS) if (m >= l.months) lvl = l;
  return lvl;
}

/**
 * Výřez profilovky z jedné fotky (deska AV). a = výška / šířka fotky.
 * Banner: x, w jako podíl šířky fotky, y jako podíl výšky; poměr stran banneru je pevný (ilustrace karty 304 × 168).
 * Kruh: cx, cy jako podíl šířky a výšky banneru, r jako podíl výšky banneru (0,15 až 0,5).
 */
export interface PhotoCrop { a: number; x: number; y: number; w: number; cx: number; cy: number; r: number }
export const BANNER_AR = 168 / 304;
export type Rect = [x: number, y: number, w: number, h: number];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Výška banneru jako podíl výšky fotky */
export function bannerH(c: Pick<PhotoCrop, 'a' | 'w'>): number {
  return (c.w * BANNER_AR) / c.a;
}

/** Nejširší banner, který se do fotky vejde */
export function maxBannerW(a: number): number {
  return Math.min(1, a / BANNER_AR);
}

export function defaultCrop(a: number): PhotoCrop {
  const w = maxBannerW(a) * 0.9;
  const h = bannerH({ a, w });
  return { a, x: (1 - w) / 2, y: (1 - h) / 2, w, cx: 0.5, cy: 0.5, r: 0.4 };
}

/** Uložený výřez z databáze nebo formuláře, opravený do platných mezí */
export function sanitizeCrop(v: unknown): PhotoCrop | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : NaN);
  const a = n('a');
  if (!(a > 0.05 && a < 20)) return null;
  const w = clamp(n('w'), 0.05, maxBannerW(a));
  if (Number.isNaN(w)) return null;
  const h = bannerH({ a, w });
  const r = clamp(Number.isNaN(n('r')) ? 0.4 : n('r'), 0.15, 0.5);
  const rx = r * BANNER_AR; // poloměr jako podíl šířky banneru
  return {
    a, w,
    x: clamp(Number.isNaN(n('x')) ? 0 : n('x'), 0, 1 - w),
    y: clamp(Number.isNaN(n('y')) ? 0 : n('y'), 0, 1 - h),
    r,
    cx: clamp(Number.isNaN(n('cx')) ? 0.5 : n('cx'), Math.min(0.5, rx), Math.max(0.5, 1 - rx)),
    cy: clamp(Number.isNaN(n('cy')) ? 0.5 : n('cy'), r, 1 - r),
  };
}

export function bannerRect(c: PhotoCrop): Rect {
  return [c.x, c.y, c.w, bannerH(c)];
}

export function circleRect(c: PhotoCrop): Rect {
  const h = bannerH(c);
  const d = 2 * c.r * h; // průměr jako podíl výšky fotky
  const dw = d * c.a; // a jako podíl šířky fotky
  const px = c.x + c.cx * c.w, py = c.y + c.cy * h;
  return [px - dw / 2, py - d / 2, dw, d];
}

/** Styl obrázku, který v rámečku ukáže jen daný výřez fotky (rámeček musí mít position: relative a overflow: hidden) */
export function cropStyle([x, y, w, h]: Rect): { width: string; height: string; left: string; top: string } {
  const p = (v: number) => `${Math.round(v * 1e4) / 1e4}%`;
  return { width: p(100 / w), height: p(100 / h), left: p((-x / w) * 100), top: p((-y / h) * 100) };
}

export interface ProfilePhoto { src: string; crop: PhotoCrop }

/** Vše, co potřebuje karta profilu (bez serverových závislostí, jde poslat i do prohlížeče) */
export interface ProfileCardData {
  id: string;
  name: string;
  kind: SellerKind;
  plan: Plan;
  memberNo: number | null;
  memberYear: number | null;
  status: string | null;
  presence: Presence;
  typeLead: string;
  typeStyle: string | null;
  city: string | null;
  frame: string;
  about: string | null;
  avatar: string | null;
  /** Profilovka z jedné fotky: banner na kartě a kruh v malém */
  photo: ProfilePhoto | null;
  loyalty: { id: string; name: string; label: string; months: number } | null;
  /** Majitel odznak věrnosti skryl (odznak se nepočítá jinak, jen se neukáže) */
  loyaltyHidden: boolean;
  /** Podložka celého profilu */
  mat: MatSurface;
  rating: number | null;
  reviews: number;
  listings: number;
}
