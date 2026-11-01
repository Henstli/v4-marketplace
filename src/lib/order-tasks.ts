// Rozdělení objednávek na stránce Objednávky (DS Orders › Seznam): kdo je na tahu a jaký úkol čeká.
import { PAID_VIA, type FlowOrder } from './order-flow';

export type Bucket = 'ja' | 'druha' | 'hotove' | 'zrusene';
export type Role = 'buyer' | 'seller';

export interface Task {
  bucket: Bucket;
  /** Klíč podfiltru (`ukol` v adrese), prázdný = jen ve „Vše“. */
  task: string;
  /** Krátká věta pod stavem v seznamu. */
  next: string;
}

const ENDED = new Set(['cancelled', 'declined', 'expired']);
const DAY = 86400_000;

/** Podfiltry podle záložky a stavu, v tomto pořadí (Šimon 1. 11.). */
export const SUBS: Record<Role, Record<'ja' | 'druha', Array<[string, string]>>> = {
  seller: {
    ja: [['navrhy', 'Návrhy ceny'], ['potvrdit', 'Potvrdit'], ['platba', 'Zkontrolovat platbu'], ['odeslat', 'Odeslat'], ['predat', 'Předat'], ['nezaplaceno', 'Dlouho nezaplaceno']],
    druha: [['platba', 'Čeká na platbu'], ['cesta', 'Na cestě'], ['predani', 'Osobní předání']],
  },
  buyer: {
    ja: [['navrhy', 'Návrhy ceny'], ['zaplatit', 'Zaplatit'], ['doprava', 'Změna dopravy'], ['prevzit', 'Převzít']],
    druha: [['potvrzeni', 'Potvrzení'], ['kontrola', 'Kontrola platby'], ['odeslani', 'Odeslání']],
  },
};

/** Kolik dní je potvrzená objednávka bez platby (od potvrzení, u starších od objednání). */
export function unpaidDays(o: { decidedAt?: string | null; createdAt: string }, now = Date.now()): number {
  return Math.floor((now - Date.parse(o.decidedAt ?? o.createdAt)) / DAY);
}

export function orderTask(o: FlowOrder & { decidedAt?: string | null; createdAt: string }, role: Role, now = Date.now()): Task {
  if (ENDED.has(o.status)) return { bucket: 'zrusene', task: '', next: '' };
  if (o.status === 'delivered') return { bucket: 'hotove', task: '', next: '' };
  const pay = o.payment ?? 'transfer';
  const pickup = o.delivery === 'pickup';
  if (role === 'seller') {
    if (o.status === 'requested') {
      return o.shipChange != null
        ? { bucket: 'druha', task: '', next: 'Kupující potvrdí novou dopravu.' }
        : { bucket: 'ja', task: 'potvrdit', next: 'Potvrďte, nebo odmítněte.' };
    }
    if (o.status === 'confirmed') {
      if (o.shipChange != null) return { bucket: 'druha', task: '', next: 'Kupující potvrdí novou dopravu.' };
      if (pay === 'transfer') {
        if (!o.buyerPaidAt) {
          return unpaidDays(o, now) >= 3
            ? { bucket: 'ja', task: 'nezaplaceno', next: 'Připomeňte se, nebo objednávku zrušte.' }
            : { bucket: 'druha', task: 'platba', next: 'Kupující zaplatí předem.' };
        }
        if (o.notReceivedAt && !o.buyerInsistAt) return { bucket: 'druha', task: 'platba', next: 'Kupující ověří, jestli platba odešla.' };
        const where = o.paidVia ? PAID_VIA[o.paidVia].where : 'účet';
        return { bucket: 'ja', task: 'platba', next: `Přišlo ${(o.total ?? 0).toLocaleString('cs-CZ')} Kč na ${where === 'účet' ? 'účet' : where}?` };
      }
      if (pay === 'cod') return { bucket: 'ja', task: 'odeslat', next: 'Dobírka: odešlete a zadejte číslo zásilky.' };
      return { bucket: 'ja', task: 'predat', next: 'Předejte karty a klikněte na Předáno.' };
    }
    if (o.status === 'paid') {
      return pickup
        ? { bucket: 'druha', task: 'predani', next: 'Domluvte předání, kupující klikne na Převzato.' }
        : { bucket: 'ja', task: 'odeslat', next: 'Zabalte a zadejte číslo zásilky.' };
    }
    if (o.status === 'shipped') return { bucket: 'druha', task: 'cesta', next: 'Na cestě ke kupujícímu.' };
    return { bucket: 'druha', task: '', next: '' };
  }
  // Kupující
  if (o.status === 'requested') {
    return o.shipChange != null
      ? { bucket: 'ja', task: 'doprava', next: 'Prodejce navrhl vyšší dopravu.' }
      : { bucket: 'druha', task: 'potvrzeni', next: 'Prodejce objednávku potvrdí.' };
  }
  if (o.status === 'confirmed') {
    if (o.shipChange != null) return { bucket: 'ja', task: 'doprava', next: 'Prodejce navrhl vyšší dopravu.' };
    if (pay === 'transfer') {
      if (!o.buyerPaidAt) return { bucket: 'ja', task: 'zaplatit', next: 'Zaplaťte a klikněte na Zaplaceno.' };
      if (o.cancelRequestAt) return { bucket: 'ja', task: 'zaplatit', next: 'Prodejce žádá o zrušení.' };
      if (o.notReceivedAt && !o.buyerInsistAt) return { bucket: 'ja', task: 'zaplatit', next: 'Prodejce platbu nenašel.' };
      return { bucket: 'druha', task: 'kontrola', next: 'Prodejce kontroluje platbu.' };
    }
    if (pay === 'cod') return { bucket: 'druha', task: 'odeslani', next: 'Prodejce odešle na dobírku.' };
    return { bucket: 'druha', task: 'odeslani', next: 'Domluvte předání, platíte na místě.' };
  }
  if (o.status === 'paid') {
    return pickup
      ? { bucket: 'ja', task: 'prevzit', next: 'Po předání klikněte na Převzato.' }
      : { bucket: 'druha', task: 'odeslani', next: 'Prodejce kartu odešle.' };
  }
  if (o.status === 'shipped') return { bucket: 'ja', task: 'prevzit', next: 'Až dorazí, klikněte na Převzato.' };
  return { bucket: 'druha', task: '', next: '' };
}
