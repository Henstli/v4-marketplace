// Nastavení vlastní stránky obchodu a sběratele: typy, nabídka voleb a kontrola dat.
// Soubor běží na serveru i v editoru (prohlížeč), proto bez přístupu k databázi.
// Vzhled bloků je v design systému Trezor (ShopHeader, ShopSection); tady je jen co si obchod volí.
import type { Plan, PlanInfo } from './plans';
import { PLANS } from './plans';
import type { Condition, Language } from './types';
import { CONDITIONS, LANGUAGE_NAMES } from './types';
import { GAMES, type GameId } from './games';

/** Barvy obchodu = tokeny shop-* z design systému */
export const SHOP_COLORS = [
  { id: 'blue', name: 'Modrá' },
  { id: 'yellow', name: 'Žlutá' },
  { id: 'red', name: 'Červená' },
  { id: 'violet', name: 'Fialová' },
  { id: 'teal', name: 'Tyrkysová' },
  { id: 'copper', name: 'Měděná' },
  { id: 'lime', name: 'Citronová' },
  { id: 'pink', name: 'Růžová' },
] as const;
export type ShopColor = (typeof SHOP_COLORS)[number]['id'];

/** Barva z databáze jen ze známých tokenů (jde do CSS proměnné) */
export function safeColor(c: string): ShopColor {
  return SHOP_COLORS.find((x) => x.id === c)?.id ?? 'blue';
}

export const SHOP_LAYOUTS = [
  { id: 'banner', name: 'Banner' },
  { id: 'split', name: 'Rozdělená' },
  { id: 'center', name: 'Na střed' },
  { id: 'minimal', name: 'Minimální' },
] as const;
export type ShopLayoutId = (typeof SHOP_LAYOUTS)[number]['id'];

export const SHOP_FONTS = [
  { id: 'modern', name: 'Moderní', family: 'var(--font-display)' },
  { id: 'classic', name: 'Klasické', family: 'var(--font-classic)' },
  { id: 'sport', name: 'Sportovní', family: 'var(--font-sport)' },
] as const;
export type ShopFont = (typeof SHOP_FONTS)[number]['id'];

/** Vzory banneru = třídy tz-shop-banner-* z design systému, všechny z barev obchodu (hlavní i druhé) */
export const SHOP_BANNERS = [
  { id: 'pattern', name: 'Proužky', pro: false },
  { id: 'solid', name: 'Barva', pro: false },
  { id: 'gradient', name: 'Přechod', pro: false },
  { id: 'dots', name: 'Puntíky', pro: false },
  { id: 'aurora', name: 'Polární záře', pro: true },
  { id: 'mesh', name: 'Mlhovina', pro: true },
  { id: 'holo', name: 'Holo', pro: true },
  { id: 'waves', name: 'Vlny', pro: true },
  { id: 'rays', name: 'Paprsky', pro: true },
  { id: 'sparkle', name: 'Hvězdy', pro: true },
  { id: 'grid', name: 'Mřížka', pro: true },
  { id: 'checks', name: 'Šachovnice', pro: true },
  { id: 'carbon', name: 'Karbon', pro: true },
  { id: 'photo', name: 'Vlastní obrázek', pro: false },
] as const;
export type ShopBanner = (typeof SHOP_BANNERS)[number]['id'];

export interface ShopDesign {
  color: ShopColor;
  mode: 'dark' | 'light';
  layout: ShopLayoutId;
  font: ShopFont;
  corners: 'round' | 'sharp';
  banner: ShopBanner;
  /** Pořadí záložek za Přehledem: 'nabidka', 'onas', 'c:<id kolekce>' */
  tabs: string[];
  /** Skryté záložky (stejná id) */
  hiddenTabs: string[];
  /** Postranní panel s O nás, prodejnou a kontaktem na Přehledu */
  sidebar: 'right' | 'left' | 'none';
  /** Lišta záložek drží při posouvání nahoře */
  stickyTabs: boolean;
  /** Jemné pozadí celé stránky v barvě obchodu */
  background: ShopBackground;
  /** Ikona před nadpisy sekcí ('bar' = proužek, 'none' = bez ikony) */
  icon: ShopIcon;
  /** Tvar loga */
  logo: 'square' | 'round';
  /** Typ obchodu, ukáže se v hlavičce */
  shopType: ShopType;
  /** Oddělovač mezi bloky */
  divider: ShopDivider;
  /** Běžící pruh nad hlavičkou: jedna zpráva pořád dokola (prázdná = vypnutý) */
  ticker: string;
  /** Automatické štítky Novinka a Poslední kus */
  tagsAuto: boolean;
  /** Vlastní štítek a nabídky, na kterých je */
  customTag: string;
  customTagIds: string[];
  /** Holo lesk na kartách (Pro) */
  holo: boolean;
  /** Druhá barva obchodu (Pro), prázdná = jen hlavní */
  color2: ShopColor | '';
  /** Pomalu se posouvající vzor banneru (Pro) */
  liveBanner: boolean;
}

export const SHOP_BACKGROUNDS = [
  { id: 'none', name: 'Žádné' },
  { id: 'glow', name: 'Záře' },
  { id: 'aurora', name: 'Polární záře' },
  { id: 'spotlight', name: 'Reflektor' },
  { id: 'grain', name: 'Zrno' },
  { id: 'dots', name: 'Puntíky' },
  { id: 'grid', name: 'Mřížka' },
  { id: 'lines', name: 'Linky' },
  { id: 'topo', name: 'Vrstevnice' },
] as const;
export type ShopBackground = (typeof SHOP_BACKGROUNDS)[number]['id'];

export const SHOP_ICONS = [
  { id: 'none', name: 'Bez ikony' },
  { id: 'bar', name: 'Proužek' },
  { id: 'dot', name: 'Tečka' },
  { id: 'star', name: 'Hvězda' },
  { id: 'heart', name: 'Srdce' },
  { id: 'diamond', name: 'Diamant' },
  { id: 'spark', name: 'Jiskra' },
  { id: 'hex', name: 'Šestiúhelník' },
] as const;
export type ShopIcon = (typeof SHOP_ICONS)[number]['id'];

export const SHOP_DIVIDERS = [
  { id: 'none', name: 'Žádný' },
  { id: 'line', name: 'Linka' },
  { id: 'wave', name: 'Vlnka' },
  { id: 'zigzag', name: 'Zubatý' },
  { id: 'dots', name: 'Tečky' },
] as const;
export type ShopDivider = (typeof SHOP_DIVIDERS)[number]['id'];

/** Typ obchodu: ukáže kupujícím, s kým mají tu čest */
export const SHOP_TYPES = [
  { id: '', name: 'Neuvádět' },
  { id: 'store', name: 'Kamenný obchod' },
  { id: 'online', name: 'Online obchod' },
  { id: 'both', name: 'Kamenný i online obchod' },
  { id: 'collector', name: 'Sběratel' },
] as const;
export type ShopType = (typeof SHOP_TYPES)[number]['id'];

export const DEFAULT_DESIGN: ShopDesign = {
  color: 'blue', mode: 'dark', layout: 'banner', font: 'modern', corners: 'round', banner: 'pattern', tabs: [], hiddenTabs: [],
  sidebar: 'right', stickyTabs: false, background: 'none', icon: 'bar', logo: 'square', shopType: '', divider: 'none', ticker: '', tagsAuto: true,
  customTag: '', customTagIds: [], holo: false, color2: '', liveBanner: false,
};

export type BlockType =
  | 'notice' | 'spotlight' | 'featured' | 'games' | 'collections' | 'newest' | 'cheap'
  | 'events' | 'photos' | 'faq' | 'showcase' | 'wanted'
  | 'window' | 'countdown' | 'reviews' | 'team' | 'video' | 'map';

export interface BlockInfo {
  type: BlockType;
  name: string;
  desc: string;
  /** Jen tarif Pro */
  pro: boolean;
  /** Skupina v galerii bloků */
  group: 'offer' | 'shop' | 'fun';
  emoji: string;
  variants: { id: string; name: string }[];
}

const GRID = [{ id: 'grid', name: 'Mřížka (2 řádky)' }, { id: 'strip', name: 'Pás, který jede sám' }];

export const BLOCKS: BlockInfo[] = [
  { type: 'notice', name: 'Oznámení', desc: 'Turnaj, dovolená nebo sleva, s datem platnosti', pro: false, group: 'shop', emoji: '📣', variants: [{ id: 'card', name: 'Karta' }, { id: 'bar', name: 'Pruh' }] },
  { type: 'spotlight', name: 'Karta týdne', desc: 'Jedna vaše nabídka velká, s příběhem', pro: true, group: 'offer', emoji: '⭐', variants: [{ id: 'left', name: 'Obrázek vlevo' }, { id: 'right', name: 'Obrázek vpravo' }] },
  { type: 'featured', name: 'Doporučujeme', desc: 'Až 12 nabídek, které vyberete', pro: false, group: 'offer', emoji: '👍', variants: GRID },
  { type: 'games', name: 'Kolekce podle hry', desc: 'Dlaždice s počtem karet pro každou hru', pro: false, group: 'offer', emoji: '🎮', variants: [{ id: 'tiles', name: 'Dlaždice' }] },
  { type: 'collections', name: 'Vlastní kolekce', desc: 'Vaše uložené výběry skladu, i jako záložky', pro: true, group: 'offer', emoji: '🗂', variants: [{ id: 'tiles', name: 'Dlaždice' }, { id: 'cards', name: 'Barevné karty' }, { id: 'chips', name: 'Štítky v řadě' }] },
  { type: 'newest', name: 'Novinky ve skladu', desc: 'Plní se samo z posledních nabídek', pro: false, group: 'offer', emoji: '🆕', variants: GRID },
  { type: 'cheap', name: 'Nejlevnější', desc: 'Karty do zvolené ceny, plní se samo', pro: false, group: 'offer', emoji: '💸', variants: GRID },
  { type: 'events', name: 'Turnaje a akce', desc: 'Kalendář akcí v prodejně', pro: true, group: 'shop', emoji: '🏆', variants: [{ id: 'list', name: 'Seznam' }] },
  { type: 'photos', name: 'Fotky z prodejny', desc: 'Až 8 fotek', pro: true, group: 'shop', emoji: '📷', variants: [{ id: 'gallery', name: 'Galerie' }] },
  { type: 'faq', name: 'Otázky a odpovědi', desc: 'Doprava, platba, reklamace a další časté dotazy', pro: false, group: 'shop', emoji: '❓', variants: [{ id: 'list', name: 'Seznam' }] },
  { type: 'showcase', name: 'Vitrína', desc: 'Karty ze sbírky, které nejsou na prodej', pro: false, group: 'offer', emoji: '🖼', variants: [{ id: 'grid', name: 'Mřížka' }] },
  { type: 'window', name: 'Výloha', desc: '3 nebo 5 karet ve vějíři, nejlépe hned pod hlavičkou', pro: true, group: 'offer', emoji: '🃏', variants: [{ id: '3', name: '3 karty' }, { id: '5', name: '5 karet' }] },
  { type: 'countdown', name: 'Odpočet', desc: 'Do vydání sady, turnaje nebo konce slevy', pro: false, group: 'fun', emoji: '⏱', variants: [{ id: 'card', name: 'Karta' }] },
  { type: 'reviews', name: 'Recenze zákazníků', desc: 'Skutečná kladná hodnocení s komentářem', pro: false, group: 'shop', emoji: '💬', variants: [{ id: '3', name: '3 recenze' }, { id: '6', name: '6 recenzí' }] },
  { type: 'team', name: 'Kdo jsme', desc: 'Lidé za obchodem s fotkou', pro: true, group: 'shop', emoji: '👋', variants: [{ id: 'grid', name: 'Mřížka' }] },
  { type: 'video', name: 'Video', desc: 'Video z YouTube, načte se až po kliknutí', pro: true, group: 'fun', emoji: '▶️', variants: [{ id: 'wide', name: 'Široké' }] },
  { type: 'map', name: 'Mapa prodejny', desc: 'Adresa prodejny na mapě a navigace', pro: false, group: 'shop', emoji: '📍', variants: [{ id: 'map', name: 'Mapa' }] },
  { type: 'wanted', name: 'Hledám', desc: 'Karty, které sháníte, s cenou', pro: false, group: 'offer', emoji: '🔎', variants: [{ id: 'list', name: 'Seznam' }] },
];

export function blockInfo(type: string): BlockInfo | undefined {
  return BLOCKS.find((b) => b.type === type);
}

export interface NoticeData { title: string; text: string; until: string }
export interface SpotlightData { listingId: string; story: string }
export interface FeaturedData { listingIds: string[] }
export interface CheapData { maxPrice: number }
/** Které hry ukázat; prázdné = všechny, které má prodejce v nabídce */
export interface GamesData { games: GameId[] }
export interface EventItem { date: string; title: string; info: string }
export interface FaqItem { q: string; a: string }
export interface ShowcaseItem { cardId: string; grade: string; note: string }
export interface WantedItem { cardId: string; maxPrice: number | null }
export interface WindowData { listingIds: string[] }
export interface CountdownData { title: string; text: string; at: string }
export interface TeamPerson { name: string; role: string; photo: string; note: string }
export interface VideoData { youtube: string }

export type BlockWidth = 'full' | 'half' | 'third';

export interface ShopBlock {
  id: string;
  type: BlockType;
  enabled: boolean;
  variant: string;
  /** Vlastní nadpis; prázdný = název bloku */
  title: string;
  /** Šířka v mřížce Přehledu (Pro): celá, polovina, třetina */
  width: BlockWidth;
  data: {
    notice?: NoticeData;
    spotlight?: SpotlightData;
    featured?: FeaturedData;
    cheap?: CheapData;
    games?: GamesData;
    events?: EventItem[];
    photos?: string[];
    faq?: FaqItem[];
    showcase?: ShowcaseItem[];
    wanted?: WantedItem[];
    window?: WindowData;
    countdown?: CountdownData;
    team?: TeamPerson[];
    video?: VideoData;
  };
}

export interface ShopCollection {
  id: string;
  name: string;
  q: string;
  game: GameId | '';
  /** Kód sady, např. OBF */
  set: string;
  condition: Condition | '';
  language: Language | '';
  priceMin: number | null;
  priceMax: number | null;
  sort: CollectionSort;
  /** Ručně vybrané nabídky; když nějaké jsou, filtry se nepoužijí */
  listingIds: string[];
}

export const COLLECTION_SORTS = [
  { id: 'new', name: 'Nejnovější' },
  { id: 'cheap', name: 'Nejlevnější' },
  { id: 'expensive', name: 'Nejdražší' },
] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number]['id'];

export function emptyCollection(id: string): ShopCollection {
  return { id, name: '', q: '', game: '', set: '', condition: '', language: '', priceMin: null, priceMax: null, sort: 'new', listingIds: [] };
}

export interface ShopContact { web: string; instagram: string; facebook: string; discord: string; email: string; phone: string }
export interface ShopStore { address: string; pickup: boolean; hours: { day: string; time: string }[] }

export interface ShopPageConfig {
  slug: string;
  published: boolean;
  tagline: string;
  about: string;
  offerNote: string;
  logoPath: string;
  bannerPath: string;
  design: ShopDesign;
  blocks: ShopBlock[];
  collections: ShopCollection[];
  contact: ShopContact;
  store: ShopStore;
}

export function newBlock(type: BlockType): ShopBlock {
  const info = blockInfo(type)!;
  return { id: Math.random().toString(36).slice(2, 10), type, enabled: true, variant: info.variants[0].id, title: '', width: 'full', data: {} };
}

export function defaultConfig(kind: 'shop' | 'private'): ShopPageConfig {
  const types: BlockType[] = kind === 'shop' ? ['notice', 'featured', 'games', 'newest'] : ['showcase', 'featured', 'wanted'];
  return {
    slug: '',
    published: false,
    tagline: '',
    about: '',
    offerNote: '',
    logoPath: '',
    bannerPath: '',
    design: { ...DEFAULT_DESIGN, color: kind === 'shop' ? 'blue' : 'violet' },
    blocks: types.map((t) => ({ ...newBlock(t), id: t, enabled: t !== 'notice' })),
    collections: [],
    contact: { web: '', instagram: '', facebook: '', discord: '', email: '', phone: '' },
    store: { address: '', pickup: false, hours: [] },
  };
}

// ---------- Kontrola dat (z formuláře i z databáze) ----------

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: NoInfer<T>): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}
function ids<T extends string>(list: readonly { id: T }[]): T[] {
  return list.map((x) => x.id);
}
function arr(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : [];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown): string {
  return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : '';
}
function date(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function price(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
}
/** Cesta k obrázku v bucketu shop-media, jen ve složce majitele */
function mediaPath(v: unknown, owner: string): string {
  const s = str(v, 200);
  return s && new RegExp(`^${owner}/[a-z0-9-]+\\.(jpe?g|png|webp)$`).test(s) ? s : '';
}

const TAB_RE = /^(nabidka|onas|c:[a-z0-9]{1,12})$/i;

/** Id videa z odkazu YouTube (watch, youtu.be, shorts) nebo samotné id */
export function youtubeId(v: unknown): string {
  const s = str(v, 200);
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/) ?? s.match(/^([\w-]{11})$/);
  return m ? m[1] : '';
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

function sanitizeBlock(raw: unknown, owner: string): ShopBlock | null {
  const b = obj(raw);
  const info = blockInfo(String(b.type));
  if (!info) return null;
  const d = obj(b.data);
  const data: ShopBlock['data'] = {};
  switch (info.type) {
    case 'notice': {
      const n = obj(d.notice);
      data.notice = { title: str(n.title, 120), text: str(n.text, 400), until: date(n.until) };
      break;
    }
    case 'spotlight': {
      const s = obj(d.spotlight);
      data.spotlight = { listingId: uuid(s.listingId), story: str(s.story, 500) };
      break;
    }
    case 'featured':
      data.featured = { listingIds: [...new Set(arr(obj(d.featured).listingIds, 12).map(uuid).filter(Boolean))] };
      break;
    case 'games': {
      const picked = arr(obj(d.games).games, GAMES.length).filter((g): g is GameId => GAMES.some((x) => x.id === g));
      data.games = { games: GAMES.map((g) => g.id).filter((id) => picked.includes(id)) };
      break;
    }
    case 'cheap':
      data.cheap = { maxPrice: price(obj(d.cheap).maxPrice) ?? 100 };
      break;
    case 'events':
      data.events = arr(d.events, 12).map((e) => obj(e)).map((e) => ({ date: date(e.date), title: str(e.title, 100), info: str(e.info, 160) })).filter((e) => e.title);
      break;
    case 'photos':
      data.photos = arr(d.photos, 8).map((p) => mediaPath(p, owner)).filter(Boolean);
      break;
    case 'faq':
      data.faq = arr(d.faq, 10).map((e) => obj(e)).map((e) => ({ q: str(e.q, 120), a: str(e.a, 600) })).filter((e) => e.q);
      break;
    case 'showcase':
      data.showcase = arr(d.showcase, 12).map((e) => obj(e)).map((e) => ({ cardId: uuid(e.cardId), grade: str(e.grade, 20), note: str(e.note, 80) })).filter((e) => e.cardId);
      break;
    case 'window':
      data.window = { listingIds: [...new Set(arr(obj(d.window).listingIds, 5).map(uuid).filter(Boolean))] };
      break;
    case 'countdown': {
      const c = obj(d.countdown);
      const at = typeof c.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c.at) ? c.at : '';
      data.countdown = { title: str(c.title, 80), text: str(c.text, 300), at };
      break;
    }
    case 'team':
      data.team = arr(d.team, 6).map((e) => obj(e)).map((e) => ({ name: str(e.name, 40), role: str(e.role, 40), photo: mediaPath(e.photo, owner), note: str(e.note, 80) })).filter((e) => e.name);
      break;
    case 'video':
      data.video = { youtube: youtubeId(obj(d.video).youtube) };
      break;
    case 'wanted':
      data.wanted = arr(d.wanted, 20).map((e) => obj(e)).map((e) => ({ cardId: uuid(e.cardId), maxPrice: price(e.maxPrice) })).filter((e) => e.cardId);
      break;
  }
  return {
    id: str(b.id, 12).replace(/[^a-z0-9]/gi, '') || Math.random().toString(36).slice(2, 10),
    type: info.type,
    enabled: b.enabled !== false,
    variant: oneOf(b.variant, ids(info.variants), info.variants[0].id),
    title: str(b.title, 60),
    width: oneOf(b.width, ['full', 'half', 'third'] as const, 'full'),
    data,
  };
}

/** Vyčistí nastavení stránky: neznámé hodnoty nahradí výchozími, ořízne délky a počty. */
export function sanitizeConfig(raw: unknown, owner: string, kind: 'shop' | 'private' = 'shop'): ShopPageConfig {
  const r = obj(raw);
  const base = defaultConfig(kind);
  const d = obj(r.design);
  const c = obj(r.contact);
  const s = obj(r.store);
  const slug = str(r.slug, 40).toLowerCase();
  const seen = new Set<string>();
  const blocks = arr(r.blocks, 40)
    .map((b) => sanitizeBlock(b, owner))
    .filter((b): b is ShopBlock => !!b && !seen.has(b.id) && !!seen.add(b.id));
  return {
    slug: SLUG_RE.test(slug) ? slug : '',
    published: r.published === true,
    tagline: str(r.tagline, 160),
    about: str(r.about, 1500),
    offerNote: str(r.offerNote, 100),
    logoPath: mediaPath(r.logoPath, owner),
    bannerPath: mediaPath(r.bannerPath, owner),
    design: {
      color: oneOf(d.color, ids(SHOP_COLORS), base.design.color),
      mode: oneOf(d.mode, ['dark', 'light'] as const, 'dark'),
      layout: oneOf(d.layout, ids(SHOP_LAYOUTS), 'banner'),
      font: oneOf(d.font, ids(SHOP_FONTS), 'modern'),
      corners: oneOf(d.corners, ['round', 'sharp'] as const, 'round'),
      banner: oneOf(d.banner, ids(SHOP_BANNERS), 'pattern'),
      tabs: [...new Set(arr(d.tabs, 24).map((t) => str(t, 20)).filter((t) => TAB_RE.test(t)))],
      hiddenTabs: [...new Set(arr(d.hiddenTabs, 24).map((t) => str(t, 20)).filter((t) => TAB_RE.test(t)))],
      sidebar: oneOf(d.sidebar, ['right', 'left', 'none'] as const, 'right'),
      stickyTabs: d.stickyTabs === true,
      background: oneOf(d.background, ids(SHOP_BACKGROUNDS), 'none'),
      icon: oneOf(d.icon, ids(SHOP_ICONS), 'bar'),
      logo: oneOf(d.logo, ['square', 'round'] as const, 'square'),
      shopType: oneOf(d.shopType, ids(SHOP_TYPES), ''),
      divider: oneOf(d.divider, ids(SHOP_DIVIDERS), 'none'),
      // Dřív šlo víc zpráv, zůstává první.
      ticker: str(Array.isArray(d.ticker) ? d.ticker[0] : d.ticker, 80),
      tagsAuto: d.tagsAuto !== false,
      customTag: str(d.customTag, 20),
      customTagIds: [...new Set(arr(d.customTagIds, 24).map(uuid).filter(Boolean))],
      holo: d.holo === true,
      color2: oneOf(d.color2, ['', ...ids(SHOP_COLORS)] as const, ''),
      liveBanner: d.liveBanner === true,
    },
    blocks: Array.isArray(r.blocks) ? blocks : base.blocks,
    collections: arr(r.collections, 20).map((x) => obj(x)).map((x) => ({
      id: str(x.id, 12).replace(/[^a-z0-9]/gi, '') || Math.random().toString(36).slice(2, 10),
      name: str(x.name, 40),
      q: str(x.q, 60),
      game: oneOf(x.game, ['', ...GAMES.map((g) => g.id)] as const, ''),
      set: str(x.set, 12).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      priceMin: price(x.priceMin),
      priceMax: price(x.priceMax),
      sort: oneOf(x.sort, ids(COLLECTION_SORTS), 'new'),
      listingIds: [...new Set(arr(x.listingIds, 60).map(uuid).filter(Boolean))],
      condition: oneOf(x.condition, ['', ...CONDITIONS] as const, ''),
      language: oneOf(x.language, ['', ...(Object.keys(LANGUAGE_NAMES) as Language[])] as const, ''),
    })).filter((x) => x.name),
    contact: {
      web: str(c.web, 120), instagram: str(c.instagram, 60), facebook: str(c.facebook, 120),
      discord: str(c.discord, 120), email: str(c.email, 120), phone: str(c.phone, 30),
    },
    store: {
      address: str(s.address, 200),
      pickup: s.pickup === true,
      hours: arr(s.hours, 7).map((h) => obj(h)).map((h) => ({ day: str(h.day, 20), time: str(h.time, 40) })).filter((h) => h.day),
    },
  };
}

/** Co z nastavení se smí ukázat při daném tarifu. Uložené nastavení se nemění, jen zobrazení. */
export function effectiveConfig(config: ShopPageConfig, plan: Plan): ShopPageConfig {
  const info: PlanInfo = PLANS[plan];
  const proBanner = SHOP_BANNERS.find((b) => b.id === config.design.banner)?.pro;
  const design: ShopDesign = info.fullDesign
    ? config.design
    : {
        ...config.design, layout: 'banner', font: 'modern', corners: 'round', banner: proBanner ? 'pattern' : config.design.banner,
        holo: false, color2: '', liveBanner: false,
      };
  const blocks = config.blocks
    .filter((b) => b.enabled && (info.proBlocks || !blockInfo(b.type)?.pro))
    .slice(0, info.maxBlocks)
    .map((b) => (info.fullDesign ? b : { ...b, width: 'full' as const }));
  return {
    ...config,
    design,
    blocks,
    offerNote: info.offerHighlight ? config.offerNote : '',
    collections: info.proBlocks ? config.collections : [],
  };
}

/** Odznak „Ověřený prodejce“: placený tarif, ověření správcem a dobré hodnocení. */
export function hasVerifiedBadge(plan: Plan, verified: boolean, rating: number | null, reviews: number): boolean {
  if (plan === 'free' || !verified) return false;
  // Od 5 hodnocení musí držet aspoň 95 % kladných.
  return reviews < 5 || (rating ?? 0) >= 95;
}

/** Veřejná adresa stránky prodejce */
export function shopHref(kind: 'shop' | 'private', slug: string): string {
  return `/${kind === 'shop' ? 'obchod' : 'sberatel'}/${slug}`;
}

export interface ShopTab {
  /** 'nabidka', 'onas' nebo 'c:<id kolekce>' */
  id: string;
  label: string;
}

/** Možné záložky za Přehledem v uloženém pořadí (nové na konec). Přehled je vždy první a v seznamu není. */
export function allTabs(config: ShopPageConfig): ShopTab[] {
  const known: ShopTab[] = [
    { id: 'nabidka', label: 'Celá nabídka' },
    ...config.collections.map((c) => ({ id: `c:${c.id}`, label: c.name })),
    { id: 'onas', label: 'O nás' },
  ];
  const at = new Map(config.design.tabs.map((id, i) => [id, i]));
  return known
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (at.get(a.t.id) ?? 100 + a.i) - (at.get(b.t.id) ?? 100 + b.i))
    .map((x) => x.t);
}

/** Záložky, které se opravdu ukážou: bez skrytých a bez O nás, když není co ukázat. */
export function visibleTabs(config: ShopPageConfig): ShopTab[] {
  const hasAbout = !!(config.about || config.store.address || config.store.hours.length || Object.values(config.contact).some(Boolean));
  return allTabs(config).filter((t) => !config.design.hiddenTabs.includes(t.id) && (t.id !== 'onas' || hasAbout));
}
