'use client';

// Přátelé na hrací podložce (DS Trezor › ProfileMat, deska P5): balíček malých profilových karet.
// Klik na horní kartu nebo šipku ji pošle dospod. U sběratele Společní přátelé, u obchodu Zkušenosti přátel.
import Link from 'next/link';
import { useState } from 'react';
import { ProfileCard } from '@/components/trezor';
import { plural } from '@/lib/format';
import type { ProfileCardData } from '@/lib/profile-card';

export interface MatFriend {
  card: ProfileCardData;
  /** Dokončené obchody s majitelem profilu (u obchodu nákupy v něm) */
  trades: number;
  rating: number | null;
  comment: string | null;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export function MatFriends({ friends, shop, own, signedIn, requests = 0 }: {
  friends: MatFriend[]; shop: boolean; own: boolean; signedIn: boolean; requests?: number;
}) {
  const [order, setOrder] = useState(() => friends.map((_, k) => k));
  const n = friends.length;
  const go = (d: number) => setOrder((o) => (d > 0 ? [...o.slice(1), o[0]] : [o[n - 1], ...o.slice(0, n - 1)]));

  const note = own && requests ? (
    <Link href="/zpravy?pratele" className="tz-mat-freq">
      <span className="tz-acct-count">{requests}</span>
      {requests === 1 ? 'Nová žádost o přátelství' : requests < 5 ? 'Nové žádosti o přátelství' : 'Nových žádostí o přátelství'}
    </Link>
  ) : null;

  if (!n) {
    const text = !signedIn ? 'Přihlas se a uvidíš, koho z přátel tu znáš.'
      : own ? 'Zatím žádní přátelé. Přidáš je na jejich profilu tlačítkem Přidat přítele.'
      : shop ? 'Nikdo z tvých přátel tu zatím nenakoupil.'
      : 'Zatím žádní společní přátelé.';
    return (
      <>
        {note}
        <p className="tz-mat-empty">
          {text}
          {!signedIn ? <><br /><Link href="/prihlaseni" className="tz-btn tz-btn-sm tz-mat-ghost" style={{ marginTop: 10 }}>Přihlásit se</Link></> : null}
        </p>
      </>
    );
  }

  const top = friends[order[0]];
  const t = top.trades;
  const exp = shop
    ? (t ? plural(t, ['nákup v obchodě', 'nákupy v obchodě', 'nákupů v obchodě']) : 'Zatím tu nenakoupil')
    : (t ? plural(t, ['společný obchod', 'společné obchody', 'společných obchodů']) : 'Spolu zatím neobchodovali');
  return (
    <>
      {note}
      <div className="tz-mat-friends">
        <div className="tz-mat-deck">
          {friends.map((f, k) => {
            const pos = order.indexOf(k);
            const shown = Math.min(pos, 3);
            return (
              <div
                key={f.card.id}
                className="tz-mat-dcard"
                data-pos={pos}
                style={{ zIndex: 10 - shown, transform: `translate(${shown * 6}px, ${-shown * 5}px) rotate(${shown * 2}deg)`, opacity: pos > 3 ? 0 : 1 }}
                aria-hidden={pos ? true : undefined}
              >
                <ProfileCard data={f.card} headingLevel={3} />
              </div>
            );
          })}
          {n > 1 ? <button type="button" className="tz-mat-dnext" onClick={() => go(1)} aria-label="Další přítel" /> : null}
        </div>
        <div className="tz-mat-finfo" aria-live="polite">
          <h3><Link href={`/prodejci/${top.card.id}`}>{top.card.name}</Link></h3>
          <span className="tz-mat-sub">{top.card.typeLead}{top.card.city ? ` · ${top.card.city}` : ''}</span>
          <span className="tz-mat-fexp" data-none={t ? undefined : ''}>{exp}</span>
          {top.rating ? <span className="tz-mat-stars" aria-label={`${top.rating} z 5`}>{stars(top.rating)}</span> : null}
          {top.comment ? <q className="tz-mat-fquote">{top.comment}</q> : null}
          {n > 1 ? (
            <div className="tz-mat-pager">
              <button type="button" className="tz-mat-arrow" onClick={() => go(-1)} aria-label="Předchozí přítel">‹</button>
              <span>{order[0] + 1} / {n}</span>
              <button type="button" className="tz-mat-arrow" onClick={() => go(1)} aria-label="Další přítel">›</button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
