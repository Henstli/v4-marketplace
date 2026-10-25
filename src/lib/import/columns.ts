// Hromadné nahrávání nabídek: sloupce souboru, jejich automatické rozpoznání a převod hodnot.
// Zvládá šablonu V4cards, export skladu z Cardmarketu i běžné tabulky obchodů.
import { GAMES, type GameId } from '../games';
import { CONDITIONS, LANGUAGE_NAMES, type Condition, type Language } from '../types';

export type FieldKey =
  | 'game' | 'name' | 'setCode' | 'setName' | 'number' | 'condition' | 'language'
  | 'price' | 'quantity' | 'graded' | 'note' | 'foil' | 'playset' | 'signed' | 'altered' | 'currency';

export interface FieldDef {
  key: FieldKey;
  label: string;
  hint?: string;
  /** Názvy sloupců bez diakritiky, mezer a interpunkce */
  aliases: string[];
}

export const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Název karty', hint: 'U sportovních karet jméno hráče', aliases: ['nazev', 'nazevkarty', 'karta', 'name', 'cardname', 'englishname', 'productname', 'hrac', 'player', 'jmeno'] },
  { key: 'setCode', label: 'Kód sady', hint: 'Např. OBF, MH3, OP-05', aliases: ['kodsady', 'setcode', 'exp', 'expcode', 'expansioncode', 'editioncode', 'kod'] },
  { key: 'setName', label: 'Název sady', aliases: ['sada', 'nazevsady', 'set', 'setname', 'expname', 'expansion', 'expansionname', 'edice', 'edition'] },
  { key: 'number', label: 'Číslo karty', hint: 'Např. 125/197 nebo 125', aliases: ['cislo', 'cislokarty', 'number', 'cardnumber', 'collectornumber', 'cn', 'no', 'nr', 'num'] },
  { key: 'game', label: 'Hra', aliases: ['hra', 'game', 'tcg', 'kategorie', 'category'] },
  { key: 'condition', label: 'Stav', hint: 'MT, NM, EX, GD, LP, PL', aliases: ['stav', 'condition', 'cond'] },
  { key: 'language', label: 'Jazyk', aliases: ['jazyk', 'language', 'lang'] },
  { key: 'price', label: 'Cena za kus', aliases: ['cena', 'cenazakus', 'cenakc', 'cenaczk', 'price', 'priceczk', 'priceeur', 'prodejnicena', 'myprice'] },
  { key: 'quantity', label: 'Počet kusů', aliases: ['pocet', 'pocetkusu', 'ks', 'kusu', 'kusy', 'mnozstvi', 'quantity', 'amount', 'qty', 'count'] },
  { key: 'graded', label: 'Grading', hint: 'Např. PSA 9', aliases: ['grading', 'graded', 'gradovani', 'grade'] },
  { key: 'note', label: 'Poznámka', aliases: ['poznamka', 'comment', 'comments', 'note', 'notes', 'popis'] },
  { key: 'foil', label: 'Foil', hint: 'Zapíše se do poznámky', aliases: ['foil', 'isfoil', 'printing'] },
  { key: 'playset', label: 'Playset (4 kusy)', hint: 'Cena a počet se přepočítají na kusy', aliases: ['playset', 'isplayset'] },
  { key: 'signed', label: 'Podepsaná', aliases: ['signed', 'issigned', 'podepsana', 'podpis'] },
  { key: 'altered', label: 'Altered', aliases: ['altered', 'isaltered'] },
  { key: 'currency', label: 'Měna', aliases: ['mena', 'currency', 'currencycode'] },
];

export type Mapping = Partial<Record<FieldKey, number>>;

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const headerKey = (h: string) => fold(h).replace(/[^a-z0-9]/g, '');

/** Přiřadí sloupce souboru polím podle názvů v hlavičce. */
export function guessMapping(header: string[]): Mapping {
  const keys = header.map(headerKey);
  const mapping: Mapping = {};
  const used = new Set<number>();
  for (const f of FIELDS) {
    const i = keys.findIndex((k, idx) => !used.has(idx) && f.aliases.includes(k));
    if (i >= 0) {
      mapping[f.key] = i;
      used.add(i);
    }
  }
  return mapping;
}

/** Export skladu z Cardmarketu: podle typických sloupců (idProduct, Exp., Amount, Foil?). */
export function isCardmarketExport(header: string[]): boolean {
  const keys = new Set(header.map(headerKey));
  return keys.has('idproduct') || keys.has('idarticle') || keys.has('cardmarketid') || (keys.has('exp') && keys.has('amount'));
}

const GAME_ALIASES: Record<string, GameId> = {
  pokemon: 'pokemon', ptcg: 'pokemon', pkmn: 'pokemon',
  magic: 'magic', mtg: 'magic', magicthegathering: 'magic',
  lorcana: 'lorcana', disneylorcana: 'lorcana',
  onepiece: 'onepiece', optcg: 'onepiece', onepiececardgame: 'onepiece',
  riftbound: 'riftbound', riftboundleagueoflegends: 'riftbound',
  cyberpunk: 'cyberpunk',
  sport: 'sport', hokej: 'sport', hockey: 'sport', nhl: 'sport', sportovnikarty: 'sport',
};

export function parseGame(v: string): GameId | null {
  const k = headerKey(v);
  if (!k) return null;
  if (GAME_ALIASES[k]) return GAME_ALIASES[k];
  return GAMES.find((g) => headerKey(g.name) === k || g.id === k)?.id ?? null;
}

const CONDITION_ALIASES: Record<string, Condition> = {
  mt: 'MT', m: 'MT', mint: 'MT', gemmint: 'MT',
  nm: 'NM', nearmint: 'NM', nmm: 'NM',
  ex: 'EX', excellent: 'EX', sp: 'EX', slightlyplayed: 'EX',
  gd: 'GD', good: 'GD', mp: 'GD', moderatelyplayed: 'GD',
  lp: 'LP', lightplayed: 'LP', lightlyplayed: 'LP',
  pl: 'PL', played: 'PL', hp: 'PL', heavilyplayed: 'PL', po: 'PL', poor: 'PL', dmg: 'PL', damaged: 'PL',
};

export function parseCondition(v: string): Condition | null {
  const k = headerKey(v);
  if (!k) return null;
  const up = k.toUpperCase();
  if (CONDITIONS.includes(up as Condition)) return up as Condition;
  return CONDITION_ALIASES[k] ?? null;
}

// Cardmarket čísluje jazyky: 1 angličtina, 2 francouzština, 3 němčina, 4 španělština, 5 italština,
// 6 zjednodušená čínština, 7 japonština, 8 portugalština, 9 ruština, 10 korejština, 11 tradiční čínština.
const CARDMARKET_LANGUAGES: Record<string, Language> = {
  '1': 'en', '2': 'fr', '3': 'de', '4': 'es', '5': 'it', '6': 'zh', '7': 'ja', '8': 'pt', '9': 'ru', '10': 'ko', '11': 'zh',
};

const LANGUAGE_ALIASES: Record<string, Language> = {
  en: 'en', eng: 'en', english: 'en', anglictina: 'en', anglicky: 'en', anglicka: 'en',
  cs: 'cs', cz: 'cs', cze: 'cs', czech: 'cs', cestina: 'cs', cesky: 'cs', ceska: 'cs',
  de: 'de', ger: 'de', german: 'de', deutsch: 'de', nemcina: 'de', nemecky: 'de', nemecka: 'de',
  ja: 'ja', jp: 'ja', jpn: 'ja', japanese: 'ja', japonstina: 'ja', japonsky: 'ja', japonska: 'ja',
  fr: 'fr', fre: 'fr', french: 'fr', francais: 'fr', francouzstina: 'fr', francouzsky: 'fr',
  it: 'it', ita: 'it', italian: 'it', italiano: 'it', italstina: 'it', italsky: 'it',
  es: 'es', spa: 'es', spanish: 'es', espanol: 'es', spanelstina: 'es', spanelsky: 'es',
  pt: 'pt', por: 'pt', portuguese: 'pt', portugalstina: 'pt', portugalsky: 'pt',
  ko: 'ko', kr: 'ko', kor: 'ko', korean: 'ko', korejstina: 'ko', korejsky: 'ko',
  zh: 'zh', cn: 'zh', chi: 'zh', chinese: 'zh', simplifiedchinese: 'zh', traditionalchinese: 'zh', cinstina: 'zh', cinsky: 'zh',
  ru: 'ru', rus: 'ru', russian: 'ru', rustina: 'ru', rusky: 'ru',
};

export function parseLanguage(v: string): Language | null {
  const raw = v.trim();
  if (!raw) return null;
  if (CARDMARKET_LANGUAGES[raw]) return CARDMARKET_LANGUAGES[raw];
  const k = headerKey(raw);
  const lang = LANGUAGE_ALIASES[k] ?? (k in LANGUAGE_NAMES ? (k as Language) : null);
  return lang;
}

/** Cena z textu: „1 290 Kč“, „12,50“, „0.25“, „€ 1.234,50“. Vrací číslo v měně souboru. */
export function parsePrice(v: string): number | null {
  let s = v.replace(/[^0-9,.-]/g, '');
  if (!s) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Oddělovač, který je víc vpravo, je desetinný.
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '') : s.replace(/,/g, '');
  } else if (dot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseQuantity(v: string): number | null {
  const s = v.replace(/[^0-9]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

export function parseFlag(v: string): boolean {
  const k = headerKey(v);
  return ['1', 'x', 'y', 'yes', 'true', 'ano', 'a', 'foil', 'signed', 'altered', 'playset'].includes(k);
}

export type Currency = 'CZK' | 'EUR';

export function parseCurrency(v: string): Currency | null {
  const k = headerKey(v);
  if (['eur', 'euro', 'e'].includes(k) || v.includes('€')) return 'EUR';
  if (['czk', 'kc', 'korun'].includes(k)) return 'CZK';
  return null;
}

/** Kód sady se pozná podle tvaru: krátký, bez mezer (OBF, MH3, OP-05, sv3pt5). */
export function looksLikeSetCode(v: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.\-]{0,9}$/.test(v.trim()) && !/^\d{4,}$/.test(v.trim());
}

/** Cardmarket přidává k názvu verzi „(V.2)“, ta v katalogu není. */
export function cleanName(v: string): string {
  return v.replace(/\s*\(V\.\s*\d+\)\s*$/i, '').replace(/\s+/g, ' ').trim();
}

export const QUANTITY_MAX = 999;
