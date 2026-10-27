'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button, ButtonLink, CardThumb, Price } from '@/components/trezor';
import { getSavedAddress, getSellerOffers, placeOrder, type SellerChoice } from '@/app/kosik/actions';
import { addressProblem, CARRIERS, carrierKind, EMPTY_ADDRESS, methodName, paymentsFor, shippingPrice, type DeliveryAddress, type DeliveryPoint, type PaymentMethod, type PointProvider, type SellerOffer } from '@/lib/delivery';
import { thumbUrl } from '@/lib/images';
import { AddressBlock } from './AddressBlock';
import { CartPlans } from './CartPlans';
import { PointPicker } from './PointPicker';
import { useCart, type CartItem } from './CartProvider';
import styles from './cart.module.css';

const PROVIDER = Object.fromEntries(CARRIERS.filter((c) => c.point).map((c) => [c.key, c.point])) as Record<string, PointProvider>;
const LAST_POINTS = 'v4-vydejni-mista';
const PAY_LABEL: Record<PaymentMethod, string> = { transfer: 'Převodem předem', cod: 'Dobírka', cash: 'Hotově při předání' };
const PAY_HINT: Record<PaymentMethod, string> = { transfer: 'QR kód dostanete po potvrzení.', cod: 'Platíte při převzetí zásilky.', cash: 'Platíte prodejci na místě.' };

/** Kolik z ceny dopravy je balné nad ceník dopravce (DS DeliveryPayment › Strop ceny dopravy). */
function packingNote(price: number, list?: number | null): string | undefined {
  if (list == null) return undefined;
  if (price > list) return `ceník ${list} Kč + ${price - list} Kč balné`;
  return price === list ? 'podle ceníku dopravce' : undefined;
}

/** Volby dopravy, které prodejce nabízí (osobní předání na konci). */
function deliveries(offer: SellerOffer | undefined) {
  if (!offer) return [];
  const out: Array<{ key: string; name: string; note?: string }> = offer.methods.map((m) => ({ key: m.carrier as string, name: methodName(m), note: packingNote(m.price, m.listPrice) }));
  if (offer.pickup) out.push({ key: 'pickup', name: 'Osobní předání' });
  return out;
}

/** Doplní jedinou možnost a zahodí platbu, která k vybrané dopravě nepasuje. */
function settle(offer: SellerOffer | undefined, choice: Partial<SellerChoice>): Partial<SellerChoice> {
  const ds = deliveries(offer);
  const delivery = choice.delivery && ds.some((d) => d.key === choice.delivery) ? choice.delivery : ds.length === 1 ? ds[0].key : undefined;
  const ps = offer && delivery ? paymentsFor(offer, delivery) : [];
  const payment = choice.payment && ps.some((p) => p.key === choice.payment) ? choice.payment : ps.length === 1 ? ps[0].key : undefined;
  return { delivery, payment, point: choice.point };
}

export function CartView({ checkout }: { checkout: 'ready' | 'login' | 'off' }) {
  const { items, setQuantity, remove, clear, replace } = useCart();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [offers, setOffers] = useState<Record<string, SellerOffer>>({});
  const [picked, setPicked] = useState<Record<string, Partial<SellerChoice>>>({});
  // Ručně otevřené nebo sbalené volby; bez záznamu je rozbalený jen jediný prodejce v košíku.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Doručovací údaje kupujícího: jedny pro všechny prodejce v košíku.
  const [addr, setAddr] = useState<DeliveryAddress>(EMPTY_ADDRESS);
  const [saved, setSaved] = useState(false);
  const [save, setSave] = useState(false);
  const [picker, setPicker] = useState<{ sellerId: string; provider: PointProvider } | null>(null);
  // Naposledy vybraná místa podle mapy (jen v tomto prohlížeči, nejsou to osobní údaje).
  const [lastPoints, setLastPoints] = useState<Partial<Record<PointProvider, DeliveryPoint>>>({});
  const sellerKey = [...new Set(items.map((i) => i.sellerId))].sort().join(',');

  useEffect(() => {
    if (!sellerKey) return;
    let live = true;
    getSellerOffers(sellerKey.split(',')).then((t) => { if (live) setOffers(t); }).catch(() => {});
    return () => { live = false; };
  }, [sellerKey]);

  useEffect(() => {
    if (checkout !== 'ready') return;
    getSavedAddress().then((a) => { if (a) { setAddr(a); setSaved(true); setSave(true); } }).catch(() => {});
    try { setLastPoints(JSON.parse(localStorage.getItem(LAST_POINTS) ?? '{}')); } catch {}
  }, [checkout]);

  const pickPoint = (sellerId: string, provider: PointProvider, point: DeliveryPoint) => {
    choose(sellerId, { point });
    setLastPoints((prev) => {
      const next = { ...prev, [provider]: point };
      try { localStorage.setItem(LAST_POINTS, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const choose = (sellerId: string, change: Partial<SellerChoice>) =>
    setPicked((prev) => ({ ...prev, [sellerId]: { ...prev[sellerId], ...change } }));

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
    const offer = offers[sellerId];
    const choice = settle(offer, picked[sellerId] ?? {});
    const ship = offer && choice.delivery ? shippingPrice(offer, choice.delivery, sum) : 0;
    const fee = offer && choice.delivery && choice.payment ? paymentsFor(offer, choice.delivery).find((p) => p.key === choice.payment)?.fee ?? 0 : 0;
    const kind = carrierKind(choice.delivery);
    const provider = choice.delivery ? PROVIDER[choice.delivery] : undefined;
    const point = provider ? choice.point ?? lastPoints[provider] : undefined;
    const missing = kind === 'point' && !point?.name ? 'výdejní místo' : addressProblem(kind, addr, choice.delivery === 'letter');
    const complete = !!choice.delivery && !!choice.payment && !missing;
    return { group, sellerId, sum, offer, choice, ship, fee, kind, provider, point, missing, complete };
  });
  const shipping = groups.reduce((s, g) => s + g.ship, 0);
  const fees = groups.reduce((s, g) => s + g.fee, 0);
  const ready = groups.every((g) => g.complete);
  const single = groups.length === 1;

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const choices: Record<string, SellerChoice> = {};
      for (const g of groups) {
        if (!g.complete) return setError('Vyberte dopravu a platbu u každého prodejce.');
        choices[g.sellerId] = {
          delivery: g.choice.delivery!,
          payment: g.choice.payment!,
          point: g.kind === 'point' ? g.point : undefined,
          address: g.kind ? addr : undefined,
        };
      }
      const usesAddress = groups.some((g) => g.kind);
      const result = await placeOrder(items.map((i) => ({ listingId: i.listingId, quantity: i.quantity })), choices, usesAddress && save ? addr : null);
      if (result.error) return setError(result.error);
      clear();
      router.push('/objednavky?nova=1');
    });

  return (
    <div className={`container ${styles.layout}`}>
      <section className={styles.groups}>
        <h1 className="t-heading-l">Košík</h1>
        <p className="muted">
          {bySeller.size === 1 ? 'Jedna zásilka od jednoho prodejce.' : `${bySeller.size} zásilky od různých prodejců, každý posílá zvlášť.`}
        </p>
        <CartPlans items={items} onApply={replace} />
        {groups.map(({ group, sellerId, sum, offer, choice, ship, fee, kind, provider, point, missing }) => {
          const ds = deliveries(offer);
          const ps = offer && choice.delivery ? paymentsFor(offer, choice.delivery) : [];
          const count = group.reduce((n, i) => n + i.quantity, 0);
          const expanded = open[sellerId] ?? single;
          const chosen = ds.find((d) => d.key === choice.delivery);
          const summary = chosen
            ? [chosen.name, kind === 'point' ? point?.name : kind === 'home' && !missing ? `${addr.name.trim()}, ${addr.street.trim()}, ${addr.city.trim()}` : null, ship ? `${ship} Kč` : 'zdarma', choice.payment ? PAY_LABEL[choice.payment] : null].filter(Boolean).join(' · ')
            : null;
          const done = !!chosen && !!choice.payment && !missing;
          return (
            <div key={sellerId} className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className="t-heading-m">{group[0].sellerName}</h2>
                <span className="t-small muted">{count} {count === 1 ? 'karta' : count < 5 ? 'karty' : 'karet'} · <Price amount={sum} /></span>
              </div>
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
                  <span className={styles.itemPrice}><Price amount={item.price * item.quantity} /></span>
                  <Button variant="ghost" onClick={() => remove(item.listingId)} aria-label={`Odebrat ${item.cardName}`}>Odebrat</Button>
                </div>
              ))}
              {offer ? (
                <button type="button" className={styles.chooseHead} aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [sellerId]: !expanded }))}>
                  <span className={styles.chooseLabel}>DOPRAVA A PLATBA</span>
                  <span className={`${styles.chooseSum} ${done ? '' : styles.missing}`}>{done ? summary : summary ? `${summary} · ${choice.payment ? `doplňte ${missing}` : 'vyberte platbu'}` : 'Vyberte dopravu a platbu'}</span>
                  <span className={styles.chooseToggle}>
                    {expanded ? 'Sbalit' : done ? 'Změnit' : 'Vybrat'}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </span>
                </button>
              ) : null}
              {offer && expanded ? (
                <div className={styles.choose}>
                  <fieldset className={styles.chooseCol}>
                    <legend>DOPRAVA</legend>
                    {ds.length ? ds.map((d) => {
                      const price = shippingPrice(offer, d.key, sum);
                      return (
                        <label key={d.key} className={styles.opt}>
                          <input type="radio" name={`d_${sellerId}`} checked={choice.delivery === d.key} onChange={() => { choose(sellerId, { delivery: d.key, point: undefined }); setOpen((o) => ({ ...o, [sellerId]: true })); }} />
                          <span className={styles.optText}>
                            <strong>{d.name}</strong>
                            {d.key === 'pickup' ? <small>{offer.pickupExact ? `Adresa: ${offer.pickupPlace}` : `${offer.pickupPlace}${offer.pickupRadius ? ` · do ${offer.pickupRadius} km` : ''}`}</small> : d.note ? <small>{d.note}</small> : null}
                          </span>
                          <span className={styles.optPrice}>{price ? `${price} Kč` : 'zdarma'}</span>
                        </label>
                      );
                    }) : <p className={styles.none}>Prodejce zatím nemá nastavenou dopravu.</p>}
                    {kind === 'point' && provider ? (
                      point?.name ? (
                        <div className={styles.picked}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
                          <span className={styles.pickedText}>
                            <strong>{point.name}</strong>
                            {point.address ? <small>{point.address}</small> : null}
                            {point.id ? <small className="code">ID {point.id}</small> : null}
                          </span>
                          <button type="button" className={styles.pickedChange} onClick={() => setPicker({ sellerId, provider })}>Změnit</button>
                        </div>
                      ) : (
                        <button type="button" className={styles.pickButton} onClick={() => setPicker({ sellerId, provider })}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
                          Vybrat výdejní místo
                        </button>
                      )
                    ) : null}
                    {kind ? (
                      <AddressBlock
                        key={saved ? 'ulozena' : 'nova'}
                        kind={kind}
                        value={addr}
                        onChange={setAddr}
                        saved={saved}
                        save={save}
                        onSave={setSave}
                        phoneOptional={choice.delivery === 'letter'}
                        shared={groups.filter((g) => g.kind).length > 1}
                      />
                    ) : null}
                  </fieldset>
                  <fieldset className={styles.chooseCol}>
                    <legend>PLATBA</legend>
                    {!choice.delivery ? <p className={styles.none}>Nejdřív vyberte dopravu.</p> : ps.length ? ps.map((p) => (
                      <label key={p.key} className={styles.opt}>
                        <input type="radio" name={`p_${sellerId}`} checked={choice.payment === p.key} onChange={() => { choose(sellerId, { payment: p.key }); if (!kind && !single) setOpen((o) => ({ ...o, [sellerId]: false })); }} />
                        <span className={styles.optText}>
                          <strong>{PAY_LABEL[p.key]}</strong>
                          <small>{PAY_HINT[p.key]}</small>
                        </span>
                        {p.fee ? <span className={styles.optPrice}>+{p.fee} Kč</span> : null}
                      </label>
                    )) : <p className={styles.none}>K této dopravě prodejce nemá platbu.</p>}
                  </fieldset>
                </div>
              ) : null}
              <div className={styles.groupFoot}>
                <span className="t-small muted">
                  {choice.delivery ? <>Doprava <Price amount={ship} />{fee ? <> · dobírka <Price amount={fee} /></> : null}</> : 'Vyberte dopravu'}
                  {choice.delivery && choice.delivery !== 'pickup' && ship > 0 && offer?.freeFrom ? <> · zdarma od <Price amount={offer.freeFrom} /></> : null}
                </span>
                <strong className={styles.footLines}>Celkem <Price amount={sum + ship + fee} /></strong>
              </div>
            </div>
          );
        })}
      </section>

      {picker ? (
        <PointPicker
          provider={picker.provider}
          onPick={(p) => pickPoint(picker.sellerId, picker.provider, p)}
          onClose={() => setPicker(null)}
        />
      ) : null}

      <aside className={`panel ${styles.summary}`} aria-label="Souhrn objednávky">
        <h2 className="t-heading-m">Souhrn</h2>
        <dl className={styles.lines}>
          <div><dt>Karty</dt><dd><Price amount={subtotal} /></dd></div>
          <div><dt>Doprava ({bySeller.size}×)</dt><dd><Price amount={shipping} /></dd></div>
          {fees ? <div><dt>Příplatek za dobírku</dt><dd><Price amount={fees} /></dd></div> : null}
          <div className={styles.total}><dt>Celkem</dt><dd><Price amount={subtotal + shipping + fees} size="lg" /></dd></div>
        </dl>
        {checkout === 'ready' ? (
          <Button size="lg" onClick={submit} disabled={pending || !ready}>{pending ? 'Odesílám…' : 'Objednat s povinností platby'}</Button>
        ) : checkout === 'login' ? (
          <ButtonLink href="/prihlaseni?dalsi=/kosik" size="lg">Přihlásit se a objednat</ButtonLink>
        ) : (
          <Button size="lg" disabled title="Objednávky zapneme po připojení databáze">Objednat</Button>
        )}
        {checkout === 'ready' && !ready ? <p className="t-small muted">Vyberte dopravu a platbu u {bySeller.size === 1 ? 'prodejce' : 'každého prodejce'}.</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <p className="t-small muted">
          {bySeller.size === 1 ? 'Prodejce objednávku' : 'Každý prodejce svou objednávku'} do 48 hodin potvrdí. Do té doby
          jsou karty rezervované jen pro vás. Platíte přímo prodejci zvoleným způsobem, kupní smlouvu uzavíráte s ním,
          V4cards není její stranou a peníze nepřijímá.
        </p>
      </aside>
    </div>
  );
}
