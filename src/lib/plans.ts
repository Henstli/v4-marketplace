// Tarify předplatného: Zdarma a dva placené, Plus a Pro. Placení přijde s platbami (fáze D), zatím tarif přiděluje správce.
// Ceny a výhody placených tarifů se ještě dolaďují; mění se jen tady, databáze zná jen kódy.
export type Plan = 'free' | 'plus' | 'pro';

export interface PlanInfo {
  id: Plan;
  name: string;
  /** Kolik řádků jde najednou hromadně nahrát; null = bez limitu */
  importRows: number | null;
}

export const PLANS: Record<Plan, PlanInfo> = {
  free: { id: 'free', name: 'Zdarma', importRows: 100 },
  plus: { id: 'plus', name: 'Plus', importRows: 100 },
  // Hromadné nahrávání celého skladu je výhoda tarifu Pro.
  pro: { id: 'pro', name: 'Pro', importRows: null },
};

export const PAID_PLANS: Plan[] = ['plus', 'pro'];

export function toPlan(v: unknown): Plan {
  return v === 'plus' || v === 'pro' ? v : 'free';
}
