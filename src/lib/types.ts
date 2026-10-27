import type { GameId } from './games';

export type Condition = 'MT' | 'NM' | 'EX' | 'GD' | 'LP' | 'PL';
export const CONDITIONS: Condition[] = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL'];
export const CONDITION_NAMES: Record<Condition, string> = {
  MT: 'Mint',
  NM: 'Near Mint',
  EX: 'Excellent',
  GD: 'Good',
  LP: 'Light Played',
  PL: 'Played',
};

export type Language = 'cs' | 'en' | 'de' | 'ja' | 'fr' | 'it' | 'es' | 'pt' | 'ko' | 'zh' | 'ru';
export const LANGUAGE_NAMES: Record<Language, string> = {
  cs: 'Čeština', en: 'Angličtina', de: 'Němčina', ja: 'Japonština',
  // Další jazyky kvůli importu skladu z Cardmarketu.
  fr: 'Francouzština', it: 'Italština', es: 'Španělština', pt: 'Portugalština', ko: 'Korejština', zh: 'Čínština', ru: 'Ruština',
};
/** Jazyky, které má filtr katalogu vždy; ostatní se ukážou, jen když jsou vybrané. */
export const FILTER_LANGUAGES: Language[] = ['cs', 'en', 'de', 'ja'];

export interface Card {
  id: string;
  slug: string;
  game: GameId;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  rarity: string;
  image?: string;
  /** Historie průměrné prodejní ceny za posledních 30 dní, Kč */
  priceHistory: number[];
}

export type SellerKind = 'private' | 'shop';

export interface Seller {
  id: string;
  name: string;
  kind: SellerKind;
  country: 'CZ' | 'SK';
  /** Podíl kladných hodnocení v %, null u prodejce bez hodnocení */
  rating: number | null;
  sales: number;
}

export interface Listing {
  id: string;
  cardId: string;
  sellerId: string;
  /** null = cena dohodou (negotiable) */
  price: number | null;
  /** Cena dohodou: kupující posílá návrh ceny, do košíku nejde. */
  negotiable?: boolean;
  condition: Condition;
  language: Language;
  quantity: number;
  graded?: string;
  note?: string;
}

export interface CardSummary extends Card {
  minPrice: number | null;
  offers: number;
  trend: number;
}
