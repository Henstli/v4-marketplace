'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/trezor';
import { answerOffer, proposePrice } from '@/app/zpravy/offers';
import { ModeArea, ModeBack, ModeButton, NowModes, useNowMode } from './NowMode';

const kc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;

function Counter({ listingId, quantity, buyer, start }: { listingId: string; quantity: number; buyer: string | null; start: number }) {
  const router = useRouter();
  const { setMode } = useNowMode();
  const [amount, setAmount] = useState(String(start));
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const send = () => run(async () => {
    setError(null);
    const res = await proposePrice(listingId, Number(amount), quantity, buyer);
    if (res.error) { setError(res.error); return; }
    setMode('');
    router.refresh();
  });
  return (
    <form className="tz-ord-swap" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <ModeBack />
      <label className="tz-ord-money">
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} aria-label="Vaše cena v korunách" autoFocus />
        <span>Kč</span>
      </label>
      <Button type="submit" disabled={pending || !Number(amount)}>{pending ? 'Posílám…' : 'Poslat protinávrh'}</Button>
      {error ? <p className="tz-ord-err" role="alert">{error}</p> : null}
    </form>
  );
}

/**
 * Tlačítka v detailu návrhu ceny (DS Orders): Odmítnout, Protinávrh, Přijmout v jedné řadě;
 * Protinávrh řadu vymění za ✕, částku a Poslat protinávrh.
 */
export function OfferActions({ offerId, listingId, quantity, price, role, buyerId, myTurn }: {
  offerId: string; listingId: string; quantity: number; price: number; role: 'buyer' | 'seller'; buyerId: string; myTurn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const answer = (action: 'accept' | 'decline' | 'cancel') => run(async () => {
    setError(null);
    const res = await answerOffer(offerId, action);
    if (res.error) { setError(res.error); return; }
    if (action === 'accept' && res.orderNumber) router.push(`/objednavky/${res.orderNumber}`);
    else router.refresh();
  });
  // Prodejce odmítá, kupující svůj návrh stahuje (answer_price_offer v databázi).
  const no = role === 'seller' ? 'decline' : 'cancel';
  return (
    <NowModes>
      <div className="tz-ord-now-acts">
        <ModeArea when="">
          {myTurn ? (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => answer(no)}>Odmítnout</Button>
              <ModeButton to="counter" variant="secondary">Protinávrh</ModeButton>
              <Button disabled={pending} onClick={() => answer('accept')}>{pending ? 'Ukládám…' : `Přijmout ${kc(price)}`}</Button>
            </>
          ) : (
            <>
              <ModeButton to="counter" variant="ghost">Změnit cenu</ModeButton>
              <Button variant="secondary" disabled={pending} onClick={() => answer(no)}>{role === 'buyer' ? 'Stáhnout návrh' : 'Zrušit návrh'}</Button>
            </>
          )}
        </ModeArea>
        <ModeArea when="counter">
          <Counter listingId={listingId} quantity={quantity} buyer={role === 'seller' ? buyerId : null} start={price} />
        </ModeArea>
        {error ? <p className="tz-ord-err" role="alert">{error}</p> : null}
      </div>
    </NowModes>
  );
}
