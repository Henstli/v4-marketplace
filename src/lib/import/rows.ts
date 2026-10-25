// Řádky importu: z tabulky a mapování sloupců udělá nabídky k vystavení a zkontroluje je.
import type { GameId } from '../games';
import { CONDITIONS, LANGUAGE_NAMES, type Condition, type Language } from '../types';
import {
  cleanName, looksLikeSetCode, parseCondition, parseCurrency, parseFlag, parseGame, parseLanguage,
  parsePrice, parseQuantity, QUANTITY_MAX, type Currency, type FieldKey, type Mapping,
} from './columns';
import type { Table } from './read-file';

export interface ImportSettings {
  /** Hra pro celý soubor; prázdná = podle sloupce nebo automaticky */
  game: GameId | '';
  /** Měna cen v souboru (sloupec Měna má přednost) */
  currency: Currency;
  /** Kurz EUR → Kč */
  rate: number;
  /** Stav a jazyk pro prázdné buňky */
  condition: Condition;
  language: Language;
}

export interface CardLite {
  id: string;
  slug: string;
  name: string;
  number: string;
  game: GameId;
  setCode: string;
  setName: string;
  image?: string | null;
}

export interface ImportRow {
  /** Číslo řádku v souboru (hlavička je řádek 1) */
  line: number;
  name: string;
  setCode: string;
  setName: string;
  number: string;
  game: GameId | null;
  condition: Condition | null;
  language: Language | null;
  /** Cena za kus v Kč */
  price: number | null;
  quantity: number | null;
  graded: string;
  note: string;
  /** Původní hodnoty, které se nepodařilo přečíst (ukážou se u chyby) */
  rawCondition: string;
  rawLanguage: string;
}

export function buildRows(table: Table, mapping: Mapping, settings: ImportSettings, from = 0, to = table.rows.length): ImportRow[] {
  const get = (r: string[], k: FieldKey) => (mapping[k] != null ? (r[mapping[k]!] ?? '').trim() : '');
  return table.rows.slice(from, to).map((r, i) => {
    const playset = parseFlag(get(r, 'playset'));
    const currency = parseCurrency(get(r, 'currency')) ?? settings.currency;
    const rawPrice = parsePrice(get(r, 'price'));
    const qtyText = get(r, 'quantity');
    let quantity = parseQuantity(qtyText) ?? (qtyText ? null : 1);
    if (quantity != null && playset) quantity *= 4;
    let price: number | null = null;
    if (rawPrice != null) {
      const czk = (rawPrice * (currency === 'EUR' ? settings.rate : 1)) / (playset ? 4 : 1);
      price = Math.max(1, Math.round(czk));
    }
    const conditionText = get(r, 'condition');
    const languageText = get(r, 'language');
    let setName = get(r, 'setName');
    let setCode = get(r, 'setCode');
    // Jediný sloupec „sada“ s krátkou zkratkou bereme jako kód sady.
    if (!setCode && setName && looksLikeSetCode(setName)) setCode = setName;
    if (setCode && !setName && !looksLikeSetCode(setCode)) { setName = setCode; setCode = ''; }
    const flags = [
      parseFlag(get(r, 'foil')) ? 'Foil' : '',
      parseFlag(get(r, 'signed')) ? 'Podepsaná' : '',
      parseFlag(get(r, 'altered')) ? 'Altered' : '',
    ].filter(Boolean);
    const note = [...flags, get(r, 'note')].filter(Boolean).join(' · ').slice(0, 200);
    return {
      line: from + i + 2,
      name: cleanName(get(r, 'name')),
      setCode,
      setName,
      number: get(r, 'number'),
      game: settings.game || parseGame(get(r, 'game')),
      condition: conditionText ? parseCondition(conditionText) : settings.condition,
      language: languageText ? parseLanguage(languageText) : settings.language,
      price,
      quantity,
      graded: get(r, 'graded').slice(0, 20),
      note,
      rawCondition: conditionText,
      rawLanguage: languageText,
    };
  });
}

/** Co v řádku chybí nebo je špatně (kromě výběru karty). Prázdné pole = v pořádku. */
export function rowProblems(row: ImportRow): string[] {
  const out: string[] = [];
  if (!row.condition || !CONDITIONS.includes(row.condition)) out.push(row.rawCondition ? `Neznámý stav „${row.rawCondition}“` : 'Vyberte stav');
  if (!row.language || !(row.language in LANGUAGE_NAMES)) out.push(row.rawLanguage ? `Neznámý jazyk „${row.rawLanguage}“` : 'Vyberte jazyk');
  if (row.price == null || !Number.isInteger(row.price) || row.price <= 0) out.push('Chybí cena');
  if (row.quantity == null || !Number.isInteger(row.quantity) || row.quantity < 1) out.push('Chybí počet kusů');
  else if (row.quantity > QUANTITY_MAX) out.push(`Nejvýš ${QUANTITY_MAX} kusů`);
  return out;
}

/** Řádek CSV (středník, uvozovky podle potřeby) pro stažení. */
export function csvLine(cells: Array<string | number | null | undefined>): string {
  return cells
    .map((c) => {
      const s = c == null ? '' : String(c);
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(';');
}

/** Hlavička šablony V4cards; stejné sloupce má i export skladu, takže jde nahrát zpátky. */
export const TEMPLATE_HEADER = ['Hra', 'Název karty', 'Kód sady', 'Název sady', 'Číslo karty', 'Stav', 'Jazyk', 'Cena za kus', 'Počet kusů', 'Grading', 'Poznámka'];
