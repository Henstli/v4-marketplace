// Varianty košíku: stejné karty od jiných prodejců, nejlevněji nebo od co nejméně prodejců.
// Doprava se počítá za každého prodejce zvlášť (s dopravou zdarma od částky), proto se vyplatí slučovat.

export interface Candidate {
  listingId: string;
  sellerId: string;
  sellerName: string;
  price: number;
  condition: string;
  language: string;
  maxQuantity: number;
}

export interface Need {
  /** Nabídka, kterou má kupující teď v košíku */
  listingId: string;
  quantity: number;
  /** Nabídky téže karty ve stejném nebo lepším stavu a stejném jazyce, včetně té současné */
  candidates: Candidate[];
}

export interface ShippingTerms {
  shipping: number;
  freeFrom: number | null;
}

export interface Plan {
  /** Pro každou potřebu (ve stejném pořadí) vybraná nabídka */
  picks: Candidate[];
  cards: number;
  shipping: number;
  total: number;
  sellers: number;
}

export function planCost(needs: Need[], picks: Candidate[], terms: Record<string, ShippingTerms>, fallback = 89): Plan {
  const bySeller = new Map<string, number>();
  let cards = 0;
  picks.forEach((c, i) => {
    const sum = c.price * needs[i].quantity;
    cards += sum;
    bySeller.set(c.sellerId, (bySeller.get(c.sellerId) ?? 0) + sum);
  });
  let shipping = 0;
  for (const [seller, sum] of bySeller) {
    const t = terms[seller];
    if (!t) shipping += fallback;
    else if (t.freeFrom === null || sum < t.freeFrom) shipping += t.shipping;
  }
  return { picks, cards, shipping, total: cards + shipping, sellers: bySeller.size };
}

function usable(need: Need): Candidate[] {
  return need.candidates.filter((c) => c.maxQuantity >= need.quantity);
}

/** Zlepšuje plán přesuny jedné karty a vyřazením celého prodejce, dokud to snižuje cenu. */
function improve(needs: Need[], start: Candidate[], terms: Record<string, ShippingTerms>, allowed?: Set<string>): Candidate[] {
  let picks = [...start];
  let best = planCost(needs, picks, terms).total;
  for (let round = 0; round < 25; round++) {
    let changed = false;
    // 1) Jedna karta k jinému prodejci.
    needs.forEach((need, i) => {
      for (const c of usable(need)) {
        if (allowed && !allowed.has(c.sellerId)) continue;
        const next = picks.map((p, j) => (j === i ? c : p));
        const cost = planCost(needs, next, terms).total;
        if (cost < best) { picks = next; best = cost; changed = true; }
      }
    });
    // 2) Vyřadit prodejce: všechny jeho karty k nejlepší jiné nabídce (ušetří se jeho doprava).
    for (const seller of new Set(picks.map((p) => p.sellerId))) {
      let next: Candidate[] | null = [...picks];
      for (let i = 0; i < needs.length && next; i++) {
        if (next[i].sellerId !== seller) continue;
        const others = usable(needs[i]).filter((c) => c.sellerId !== seller && (!allowed || allowed.has(c.sellerId)));
        if (!others.length) { next = null; break; }
        let pick = others[0];
        let pickCost = Infinity;
        for (const c of others) {
          const cost = planCost(needs, next.map((p, j) => (j === i ? c : p)), terms).total;
          if (cost < pickCost) { pick = c; pickCost = cost; }
        }
        next[i] = pick;
      }
      if (next) {
        const cost = planCost(needs, next, terms).total;
        if (cost < best) { picks = next; best = cost; changed = true; }
      }
    }
    if (!changed) break;
  }
  return picks;
}

function cheapestOf(need: Need, seller?: string): Candidate | undefined {
  return [...usable(need)].filter((c) => !seller || c.sellerId === seller).sort((a, b) => a.price - b.price)[0];
}

/**
 * Nejnižší celková cena včetně dopravy. Heuristika s více starty: nejlevnější kus všude,
 * plán s nejméně prodejci a „hlavní prodejce“ (u každého z nejčastějších prodejců vše, co má).
 * Jednotlivé přesuny totiž samy neobjeví, že se vyplatí sloučit víc karet u jednoho prodejce.
 */
export function cheapestPlan(needs: Need[], terms: Record<string, ShippingTerms>): Plan {
  const base = needs.map((n) => cheapestOf(n)!);
  const coverage = new Map<string, number>();
  for (const n of needs) for (const seller of new Set(usable(n).map((c) => c.sellerId))) coverage.set(seller, (coverage.get(seller) ?? 0) + 1);
  const hubs = [...coverage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([seller]) => seller);
  const starts = [
    base,
    fewestSellersPlan(needs, terms).picks,
    ...hubs.map((hub) => needs.map((n, i) => cheapestOf(n, hub) ?? base[i])),
  ];
  let best: Plan | null = null;
  for (const start of starts) {
    const plan = planCost(needs, improve(needs, start, terms), terms);
    if (!best || plan.total < best.total || (plan.total === best.total && plan.sellers < best.sellers)) best = plan;
  }
  return best!;
}

/** Co nejméně prodejců; mezi nimi pak co nejlevněji. */
export function fewestSellersPlan(needs: Need[], terms: Record<string, ShippingTerms>): Plan {
  const open = new Set(needs.map((_, i) => i));
  const chosen = new Set<string>();
  while (open.size) {
    const cover = new Map<string, { count: number; cost: number }>();
    for (const i of open) {
      const cheapestBySeller = new Map<string, number>();
      for (const c of usable(needs[i])) {
        const sum = c.price * needs[i].quantity;
        if (sum < (cheapestBySeller.get(c.sellerId) ?? Infinity)) cheapestBySeller.set(c.sellerId, sum);
      }
      for (const [seller, sum] of cheapestBySeller) {
        const v = cover.get(seller) ?? { count: 0, cost: 0 };
        cover.set(seller, { count: v.count + 1, cost: v.cost + sum });
      }
    }
    let bestSeller: string | null = null;
    let bestScore = { count: -1, cost: Infinity };
    for (const [seller, v] of cover) {
      if (v.count > bestScore.count || (v.count === bestScore.count && v.cost < bestScore.cost)) { bestSeller = seller; bestScore = v; }
    }
    if (!bestSeller) break;
    chosen.add(bestSeller);
    for (const i of [...open]) if (usable(needs[i]).some((c) => c.sellerId === bestSeller)) open.delete(i);
  }
  const start = needs.map((n) => [...usable(n)].filter((c) => chosen.has(c.sellerId)).sort((a, b) => a.price - b.price)[0]);
  return planCost(needs, improve(needs, start, terms, chosen), terms);
}
