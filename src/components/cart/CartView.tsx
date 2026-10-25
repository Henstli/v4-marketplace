'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, ButtonLink, Price } from '@/components/trezor';
import { placeOrder } from '@/app/kosik/actions';
import { useCart, type CartItem } from './CartProvider';
import styles from './cart.module.css';

// Odhad dopravy za jednu zásilku od prodejce (Zásilkovna), dokud nebude výběr dopravy.
const SHIPPING_PER_SELLER = 89;

export function CartView({ checkout }: { checkout: 'ready' | 'login' | 'off' }) {
  const { items, setQuantity, remove, clear } = useCart();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const result = await placeOrder(items.map((i) => ({ listingId: i.listingId, quantity: i.quantity })));
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
  const shipping = bySeller.size * SHIPPING_PER_SELLER;

  return (
    <div className={`container ${styles.layout}`}>
      <section className={styles.groups}>
        <h1 className="t-heading-l">Košík</h1>
        <p className="muted">
          {bySeller.size === 1 ? 'Jedna zásilka od jednoho prodejce.' : `${bySeller.size} zásilky od různých prodejců, každý posílá zvlášť.`}
        </p>
        {[...bySeller.values()].map((group) => {
          const sum = group.reduce((s, i) => s + i.price * i.quantity, 0);
          return (
            <div key={group[0].sellerId} className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className="t-heading-m">{group[0].sellerName}</h2>
                <span className="t-small muted">Doprava od <Price amount={SHIPPING_PER_SELLER} /></span>
              </div>
              {group.map((item) => (
                <div key={item.listingId} className={styles.item}>
                  <div className={styles.itemInfo}>
                    <Link href={`/karty/${item.cardSlug}`} className={styles.itemName}>{item.cardName}</Link>
                    <div className="t-small muted">
                      <span className="code">{item.setLabel}</span> · <span className="code">{item.condition}</span> · {item.language}
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
          <Button size="lg" onClick={submit} disabled={pending}>{pending ? 'Odesílám…' : 'Odeslat testovací objednávku'}</Button>
        ) : checkout === 'login' ? (
          <ButtonLink href="/prihlaseni?dalsi=/kosik" size="lg">Přihlásit se a objednat</ButtonLink>
        ) : (
          <Button size="lg" disabled title="Objednávky zapneme po připojení databáze">Pokračovat k platbě</Button>
        )}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <p className="t-small muted">
          Peníze držíme v úschově, prodejce je dostane až po doručení. V betě se zatím nic neplatí, objednávka je jen testovací.
        </p>
      </aside>
    </div>
  );
}
