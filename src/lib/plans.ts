// Tarify předplatného: Zdarma a dva placené, Plus a Pro. Placení přijde s platbami (fáze D), zatím tarif přiděluje správce.
// Ceny a výhody placených tarifů se ještě dolaďují; mění se jen tady, databáze zná jen kódy.
export type Plan = 'free' | 'plus' | 'pro';

export interface PlanInfo {
  id: Plan;
  name: string;
  /** Hromadné nahrávání nabídek ze souboru (bez limitu řádků) */
  bulkImport: boolean;
}

export const PLANS: Record<Plan, PlanInfo> = {
  free: { id: 'free', name: 'Zdarma', bulkImport: false },
  plus: { id: 'plus', name: 'Plus', bulkImport: false },
  // Šimon 25. 10.: hromadné nahrávání má jen Pro, a to neomezeně.
  pro: { id: 'pro', name: 'Pro', bulkImport: true },
};

export const PAID_PLANS: Plan[] = ['plus', 'pro'];

export function toPlan(v: unknown): Plan {
  return v === 'plus' || v === 'pro' ? v : 'free';
}
