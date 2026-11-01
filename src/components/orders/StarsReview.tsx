'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/trezor';
import { addReview } from '@/app/objednavky/actions';

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending}>{pending ? 'Ukládám…' : 'Ohodnotit'}</Button>;
}

/** Hodnocení prodejce v rámečku Co teď (DS Orders): hvězdy a komentář. */
export function StarsReview({ orderId, sellerId, cancelled }: { orderId: string; sellerId: string; cancelled?: boolean }) {
  const [rating, setRating] = useState(cancelled ? 1 : 0);
  return (
    <form action={addReview} className="tz-ord-review">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="sellerId" value={sellerId} />
      <input type="hidden" name="rating" value={rating || ''} />
      <span className="tz-ord-stars" role="radiogroup" aria-label="Hodnocení">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} z 5`} data-on={n <= rating ? '' : undefined} onClick={() => setRating(n)}>★</button>
        ))}
      </span>
      <input name="comment" maxLength={500} placeholder={cancelled ? 'Co se stalo?' : 'Jak proběhl nákup? (nepovinné)'} aria-label="Komentář k hodnocení" />
      <Submit disabled={!rating} />
    </form>
  );
}
