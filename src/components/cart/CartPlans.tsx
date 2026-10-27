'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Price } from '@/components/trezor';
import { getCartAlternatives, type CartAlternatives } from '@/app/kosik/actions';
import { cheapestPlan, fewestSellersPlan, planCost, type Need, type Plan } from '@/lib/cart-optimize';
import { plural } from '@/lib/format';
import type { CartItem } from './CartProvider';
import styles from './cart.module.css';

// Nad tímto počtem položek varianty nepočítáme, výpočet by v prohlížeči trval dlouho.
const MAX_ITEMS = 40;

/** Varianty košíku: stejné karty od jiných prodejců, nejlevněji nebo od co nejméně prodejců. */
export function CartPlans({ items, onApply }: { items: CartItem[]; onApply: (items: CartItem[]) => void }) {
  const [alt, setAlt] = useState<CartAlternatives>();
  const key = items.map((i) => `${i.listingId}:${i.quantity}`).sort().join(',');

  useEffect(() => {
    if (!key || items.length > MAX_ITEMS) return;
    let live = true;
    getCartAlternatives(items.map((i) => i.listingId)).then((a) => { if (live) setAlt(a); }).catch(() => {});
    return () => { live = false; };
    // Načítá se znovu jen při změně složení košíku (key), ne při každém novém poli items.
  }, [key]);

  const plans = useMemo(() => {
    if (!alt) return [];
    const needs: Need[] = items.map((i) => ({ listingId: i.listingId, quantity: i.quantity, candidates: alt.candidates[i.listingId] ?? [] }));
    // Bez aktuální nabídky v datech (prodaná, vlastní) varianty nepočítáme.
    if (needs.some((n) => !n.candidates.some((c) => c.listingId === n.listingId))) return [];
    const current = planCost(needs, needs.map((n) => n.candidates.find((c) => c.listingId === n.listingId)!), alt.terms);
    const options: Array<{ label: string; plan: Plan }> = [
      { label: 'Nejlevněji', plan: cheapestPlan(needs, alt.terms) },
      { label: 'Nejméně prodejců', plan: fewestSellersPlan(needs, alt.terms) },
    ];
    const seen = new Set<string>();
    return options
      .filter(({ plan }) => {
        const id = plan.picks.map((p) => p.listingId).join(',');
        if (seen.has(id) || !differs(plan, current)) return false;
        seen.add(id);
        return true;
      })
      .map((o) => ({ ...o, current, items: toItems(items, o.plan) }))
      .filter((o) => o.items !== null);
  }, [alt, items]);

  if (!plans.length) return null;
  const current = plans[0].current;

  return (
    <section className={styles.plans} aria-label="Varianty košíku">
      <div>
        <h2 className="t-heading-m">Stejné karty jinak</h2>
        <p className="t-small muted">Ve stejném nebo lepším stavu a stejném jazyce, doprava podle ceníku prodejců.</p>
      </div>
      <div className={styles.planRow}>
        <div>
          <span className={styles.planLabel}>Váš košík</span>
          <span className="t-small muted">{sellersText(current)}</span>
        </div>
        <Price amount={current.total} />
        <span className={`t-small muted ${styles.planAction}`}>Vybráno</span>
      </div>
      {plans.map(({ label, plan, items: next }) => (
        <div key={label} className={styles.planRow}>
          <div>
            <span className={styles.planLabel}>{label}</span>
            <span className="t-small muted">
              {sellersText(plan)}
              {plan.total < current.total ? <> · ušetříte <Price amount={current.total - plan.total} /></> : null}
              {plan.total > current.total ? <> · o <Price amount={plan.total - current.total} /> dráž</> : null}
            </span>
          </div>
          <Price amount={plan.total} />
          <Button variant="secondary" className={styles.planAction} onClick={() => onApply(next!)}>Použít</Button>
        </div>
      ))}
    </section>
  );
}

function sellersText(plan: Plan): string {
  return `${plural(plan.sellers, ['prodejce', 'prodejci', 'prodejců'])} · doprava ${plan.shipping.toLocaleString('cs-CZ')} Kč`;
}

function differs(a: Plan, b: Plan): boolean {
  return a.total !== b.total || a.sellers !== b.sellers;
}

/** Položky košíku pro variantu; null, když by dvě položky chtěly víc kusů jedné nabídky, než má. */
function toItems(items: CartItem[], plan: Plan): CartItem[] | null {
  const byListing = new Map<string, CartItem>();
  for (let i = 0; i < items.length; i++) {
    const c = plan.picks[i];
    const prev = byListing.get(c.listingId);
    const quantity = (prev?.quantity ?? 0) + items[i].quantity;
    if (quantity > c.maxQuantity) return null;
    byListing.set(c.listingId, {
      ...items[i],
      listingId: c.listingId,
      sellerId: c.sellerId,
      sellerName: c.sellerName,
      price: c.price,
      condition: c.condition,
      language: c.language,
      maxQuantity: c.maxQuantity,
      quantity,
    });
  }
  return [...byListing.values()];
}
