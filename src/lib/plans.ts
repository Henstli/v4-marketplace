// Tarify předplatného: jeden zdarma a dva placené. Placení přijde s platbami (fáze D), zatím tarif přiděluje správce.
// Názvy, ceny a výhody placených tarifů ještě nejsou rozhodnuté; mění se jen tady, databáze zná jen kódy.
export type Plan = 'free' | 'tier1' | 'tier2';

export interface PlanInfo {
  id: Plan;
  name: string;
  /** Kolik řádků jde najednou hromadně nahrát; null = bez limitu */
  importRows: number | null;
}

export const PLANS: Record<Plan, PlanInfo> = {
  free: { id: 'free', name: 'Zdarma', importRows: 100 },
  tier1: { id: 'tier1', name: 'Placený tarif 1', importRows: null },
  tier2: { id: 'tier2', name: 'Placený tarif 2', importRows: null },
};

export const PAID_PLANS: Plan[] = ['tier1', 'tier2'];

export function toPlan(v: unknown): Plan {
  return v === 'tier1' || v === 'tier2' ? v : 'free';
}
