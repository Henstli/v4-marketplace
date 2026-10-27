'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button, ButtonLink, CardThumb, Price } from '@/components/trezor';
import { getSellerShipping, placeOrder, type SellerShipping } from '@/app/kosik/actions';
import { thumbUrl } from '@/lib/images';
import { useCart, type CartItem } from './CartProvider';
import styles from './cart.module.css';

// Výchozí doprava, než se načte ceník prodejce (stejná jako výchozí hodnota v profilu).
const DEFAULT_SHIPPING = 89;

function shippingFor(terms: SellerShipping | undefined, subtotal: number, pickup: boolean): number {
  if (!terms) return DEFAULT_SHIPPING;
  if (pickup && terms.pickupPlace) return 0;
  if (terms.freeFrom !== null && subtotal >= terms.freeFrom) return 0;
  return terms.shipping;
}

export function CartView({ checkout }: { checkout: 'ready' | 'login' | 'off' }) {
  const { items, setQuantity, remove, clear } = useCart();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [terms, setTerms] = useState<Record<string, SellerShipping>>({});
  const [pickup, setPickup] = useState<Set<string>>(new Set());
  const sellerKey = [...new Set(items.map((i) => i.sellerId))].sort().join(',');

  useEffect(() => {
    if (!sellerKey) return;
    let live = true;
    getSellerShipping(sellerKey.split(',')).then((t) => { if (live) setTerms(t); }).catch(() => {});
    return () => { live = false; };
  }, [sellerKey]);

  const togglePickup = (sellerId: string, on: boolean) =>
    setPickup((prev) => {
      const next = new Set(prev);
      if (on) next.add(sellerId); else next.delete(sellerId);
      return next;
    });

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const result = await placeOrder(
        items.map((i) => ({ listingId: i.listingId, quantity: i.quantity })),
        [...pickup].filter((id) => terms[id]?.pickupPlace),
      );
      if (result.error) return setError(result.error);
      clear();
      router.push('/objednavky?nova=1');
    });

  if (!items.length) {
    return (
      <div className="container section">
        <div className={`panel ${styles.empty}`}>
          <h1 className="t-heading-l">Košík je prázdný</h1>
          <p className="muted">Najděte kartu v katalogu a přidejte nabídku, která vám vyhovuje.</p>
          <div><ButtonLink href="/karty">Procházet karty</ButtonLink></div>
        </div>
      </div>
    );
  }

  const bySeller = new Map<string, CartItem[]>();
  for (const item of items) bySeller.set(item.sellerId, [...(bySeller.get(item.sellerId) ?? []), item]);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const groups = [...bySeller.values()].map((group) => {
    const sellerId = group[0].sellerId;
    const sum = group.reduce((s, i) => s + i.price * i.quantity, 0);
    const t = terms[sellerId];
    const picked = pickup.has(sellerId) && !!t?.pickupPlace;
    return { group, sellerId, sum, terms: t, picked, shipping: shippingFor(t, sum, picked) };
  });
  const shipping = groups.reduce((s, g) => s + g.shipping, 0);

  return (
    <div className={`container ${styles.layout}`}>
      <section className={styles.groups}>
        <h1 className="t-heading-l">Košík</h1>
        <p className="muted">
          {bySeller.size === 1 ? 'Jedna zásilka od jednoho prodejce.' : `${bySeller.size} zásilky od různých prodejců, každý posílá zvlášť.`}
        </p>
        {groups.map(({ group, sellerId, sum, terms: t, picked, shipping: ship }) => {
          return (
            <div key={sellerId} className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className="t-heading-m">{group[0].sellerName}</h2>
                <span className="t-small muted">
                  {picked ? 'Osobní předání zdarma' : ship === 0 ? 'Doprava zdarma' : <>Doprava <Price amount={ship} /></>}
                  {!picked && ship > 0 && t?.freeFrom ? <> · zdarma od <Price amount={t.freeFrom} /></> : null}
                </span>
              </div>
              {t?.pickupPlace ? (
                <label className="t-small" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <input type="checkbox" checked={picked} onChange={(e) => togglePickup(sellerId, e.target.checked)} />
                  Vyzvednu osobně ({t.pickupPlace})
                </label>
              ) : null}
              {group.map((item) => (
                <div key={item.listingId} className={styles.item}>
                  <div className={styles.itemCard}>
                    <CardThumb image={thumbUrl(item.image)} preview={item.image} color={item.game ? `var(--game-${item.game}-art)` : undefined} />
                    <div className={styles.itemInfo}>
                      <Link href={`/karty/${item.cardSlug}`} className={styles.itemName}>{item.cardName}</Link>
                      <div className="t-small muted">
                        <span className="code">{item.setLabel}</span> · <span className="code">{item.condition}</span> · {item.language}
                      </div>
                    </div>
                  </div>
                  <label className={styles.qty}>
                    <span className="sr-only">Počet kusů</span>
                    <select value={item.quantity} onChange={(e) => setQuantity(item.listingId, Number(e.target.value))}>
                      {Array.from({ length: item.maxQuantity }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n} ks</option>
                      ))}
                    </select>
                  </label>
                  <Price amount={item.price * item.quantity} />
                  <Button variant="ghost" onClick={() => remove(item.listingId)} aria-label={`Odebrat ${item.cardName}`}>Odebrat</Button>
                </div>
              ))}
              <div className={styles.groupFoot}>
                <span className="t-small muted">Mezisoučet</span>
                <Price amount={sum} />
              </div>
            </div>
          );
        })}
      </section>

      <aside className={`panel ${styles.summary}`} aria-label="Souhrn objednávky">
        <h2 className="t-heading-m">Souhrn</h2>
        <dl className={styles.lines}>
          <div><dt>Karty</dt><dd><Price amount={subtotal} /></dd></div>
          <div><dt>Doprava ({bySeller.size}×)</dt><dd><Price amount={shipping} /></dd></div>
          <div className={styles.total}><dt>Celkem</dt><dd><Price amount={subtotal + shipping} size="lg" /></dd></div>
        </dl>
        {checkout === 'ready' ? (
          <Button size="lg" onClick={submit} disabled={pending}>{pending ? 'Odesílám…' : 'Objednat s povinností platby'}</Button>
        ) : checkout === 'login' ? (
          <ButtonLink href="/prihlaseni?dalsi=/kosik" size="lg">Přihlásit se a objednat</ButtonLink>
        ) : (
          <Button size="lg" disabled title="Objednávky zapneme po připojení databáze">Objednat</Button>
        )}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <p className="t-small muted">
          {bySeller.size === 1 ? 'Prodejce objednávku' : 'Každý prodejce svou objednávku'} do 48 hodin potvrdí. Do té doby
          jsou karty rezervované jen pro vás. Platíte přímo prodejci podle domluvy, kupní smlouvu uzavíráte s ním,
          V4cards není její stranou a peníze nepřijímá.
        </p>
      </aside>
    </div>
  );
}
