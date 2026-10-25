// Tarify předplatného: Zdarma a dva placené, Plus a Pro. Placení přijde s platbami (fáze D), zatím tarif přiděluje správce.
// Ceny a výhody placených tarifů se ještě dolaďují; mění se jen tady, databáze zná jen kódy.
export type Plan = 'free' | 'plus' | 'pro';

export interface PlanInfo {
  id: Plan;
  name: string;
  /** Hromadné nahrávání nabídek ze souboru (bez limitu řádků) */
  bulkImport: boolean;
  /** Vlastní stránka s adresou /obchod/<nazev> (jinak jen základní profil) */
  shopPage: boolean;
  /** Nejvíc bloků na stránce (bez Celé nabídky, ta je vždy) */
  maxBlocks: number;
  /** Šablony hlavičky, písma a rohy navíc k výchozím (banner, moderní, zaoblené) */
  fullDesign: boolean;
  /** Bloky jen pro Pro: karta týdne, vlastní kolekce, akce, fotky */
  proBlocks: boolean;
  /** U nabídek: větší logo, štítek PRO a vzkaz pod jménem; přednost při stejné ceně a stavu */
  offerHighlight: boolean;
  /** Logo a odznak Ověřený prodejce u nabídek */
  offerLogo: boolean;
}

export const PLANS: Record<Plan, PlanInfo> = {
  free: { id: 'free', name: 'Zdarma', bulkImport: false, shopPage: false, maxBlocks: 0, fullDesign: false, proBlocks: false, offerHighlight: false, offerLogo: false },
  plus: { id: 'plus', name: 'Plus', bulkImport: false, shopPage: true, maxBlocks: 6, fullDesign: false, proBlocks: false, offerHighlight: false, offerLogo: true },
  // Šimon 25. 10.: hromadné nahrávání má jen Pro, a to neomezeně. Pro je víc vidět v nabídkách.
  pro: { id: 'pro', name: 'Pro', bulkImport: true, shopPage: true, maxBlocks: 40, fullDesign: true, proBlocks: true, offerHighlight: true, offerLogo: true },
};

export const PAID_PLANS: Plan[] = ['plus', 'pro'];

export function toPlan(v: unknown): Plan {
  return v === 'plus' || v === 'pro' ? v : 'free';
}
