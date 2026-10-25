// Ukázková data pro vývoj, dokud není připojená databáze. Ceny a prodejci jsou smyšlení.
import type { Card, Listing, Seller } from './types';

// Deterministická "náhodná" řada cen, ať se stránka mezi načteními nemění.
function history(seed: number, base: number, drift: number): number[] {
  let x = seed;
  const out: number[] = [];
  for (let i = 0; i < 30; i++) {
    x = (x * 9301 + 49297) % 233280;
    const noise = (x / 233280 - 0.5) * 0.06;
    out.push(Math.round(base * (1 + (drift * i) / 30 + noise)));
  }
  return out;
}

export const SELLERS: Seller[] = [
  { id: 's1', name: 'Puk a karta', kind: 'shop', country: 'CZ', rating: 99.6, sales: 4210 },
  { id: 's2', name: 'Brněnský trezor', kind: 'shop', country: 'CZ', rating: 99.1, sales: 2875 },
  { id: 's3', name: 'TatraTCG', kind: 'shop', country: 'SK', rating: 98.8, sales: 1630 },
  { id: 's4', name: 'jan_sbira', kind: 'private', country: 'CZ', rating: 100, sales: 142 },
  { id: 's5', name: 'hokejovy_archiv', kind: 'private', country: 'CZ', rating: 98.4, sales: 389 },
  { id: 's6', name: 'zuzka.cards', kind: 'private', country: 'SK', rating: 99.3, sales: 211 },
];

const c = (
  id: string,
  game: Card['game'],
  name: string,
  setName: string,
  setCode: string,
  number: string,
  rarity: string,
  base: number,
  drift: number,
): Card => ({
  id,
  slug: `${name}-${setCode}-${number}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, ''),
  game,
  name,
  setName,
  setCode,
  number,
  rarity,
  priceHistory: history(Number(id.slice(1)) * 7919, base, drift),
});

// Sportovní karty nemají veřejný katalog, přidávají se přes schválené návrhy prodejců.
export const CARDS: Card[] = [
  c('c7', 'pokemon', 'Charizard ex', 'Obsidian Flames', 'OBF', '223/197', 'Special Illustration Rare', 1290, 0.042),
  c('c8', 'pokemon', 'Umbreon VMAX', 'Evolving Skies', 'EVS', '215/203', 'Secret Rare', 14900, 0.07),
  c('c9', 'pokemon', 'Mew ex', 'Scarlet & Violet 151', 'MEW', '205/165', 'Hyper Rare', 690, -0.03),
  c('c10', 'pokemon', 'Pikachu ex', 'Surging Sparks', 'SSP', '238/191', 'Special Illustration Rare', 5200, 0.11),
  c('c11', 'magic', 'Sheoldred, the Apocalypse', 'Dominaria United', 'DMU', '107', 'Mythic', 1890, -0.05),
  c('c12', 'magic', 'The One Ring', 'The Lord of the Rings: Tales of Middle-earth', 'LTR', '246', 'Mythic', 1150, -0.08),
  c('c13', 'magic', 'Ragavan, Nimble Pilferer', 'Modern Horizons 2', 'MH2', '138', 'Mythic', 1490, 0.02),
  c('c14', 'magic', 'Orcish Bowmasters', 'The Lord of the Rings: Tales of Middle-earth', 'LTR', '103', 'Rare', 1020, 0.06),
];

let n = 0;
const l = (cardId: string, sellerId: string, price: number, condition: Listing['condition'], language: Listing['language'], quantity = 1, graded?: string): Listing => ({
  id: `l${++n}`,
  cardId,
  sellerId,
  price,
  condition,
  language,
  quantity,
  graded,
});

export const LISTINGS: Listing[] = [
  l('c7', 's2', 1290, 'NM', 'en', 5),
  l('c7', 's3', 1340, 'NM', 'cs', 2),
  l('c7', 's4', 1190, 'EX', 'en'),
  l('c7', 's6', 1250, 'NM', 'en'),
  l('c8', 's2', 14490, 'NM', 'en'),
  l('c8', 's3', 15200, 'MT', 'ja'),
  l('c9', 's1', 650, 'NM', 'en', 6),
  l('c9', 's4', 620, 'EX', 'cs'),
  l('c10', 's2', 4990, 'NM', 'en', 2),
  l('c10', 's6', 5350, 'NM', 'cs'),
  l('c11', 's2', 1790, 'NM', 'en', 3),
  l('c11', 's3', 1690, 'EX', 'de'),
  l('c12', 's2', 1090, 'NM', 'en', 4),
  l('c13', 's3', 1450, 'NM', 'en'),
  l('c13', 's4', 1390, 'GD', 'en'),
  l('c14', 's2', 990, 'NM', 'en', 8),
];
