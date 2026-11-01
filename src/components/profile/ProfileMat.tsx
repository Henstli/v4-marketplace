// Celý profil na hrací podložce (DS Trezor › ProfileMat, deska P5, rozvržení B Karta vlevo):
// vlevo karta a rychlé statistiky, uprostřed Alba a Chybí do sady, vpravo Poslední obchody a Hodnocení.
// Společní přátelé přijdou s přáteli, do té doby je na jejich místě Hodnocení.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlbumBook } from '@/components/album/AlbumBook';
import { MessageSeller } from '@/components/shop/ShopClient';
import { ProfileCard } from '@/components/trezor';
import { formatNumber } from '@/lib/format';
import type { ProfileShowcase } from '@/lib/profile';
import type { ProfileCardData } from '@/lib/profile-card';
import { MatAlbums } from './MatAlbums';

export type MatSurface = 'lava' | 'felt' | 'night' | 'leather';

function Zone({ label, area, className = '', children }: { label: string; area: string; className?: string; children: ReactNode }) {
  return (
    <section className={`tz-mat-zone ${className}`} style={{ gridArea: area }} aria-label={label}>
      <h2 className="tz-mat-label">{label}</h2>
      {children}
    </section>
  );
}

/** Doba odpovědi pro statistiku pod kartou: „5 min“, „2 h“, „1 d“ */
export function replyLabel(min: number | null): string {
  if (min == null) return '–';
  if (min < 60) return `${Math.max(1, Math.ceil(min))} min`;
  if (min < 48 * 60) return `${Math.ceil(min / 60)} h`;
  return `${Math.ceil(min / 1440)} d`;
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
  if (days <= 0) return 'dnes';
  if (days === 1) return 'včera';
  if (days < 5) return `před ${days} dny`;
  if (days < 14) return 'minulý týden';
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export function ProfileMat({ card, show, own, actions, surface = 'lava' }: {
  card: ProfileCardData; show: ProfileShowcase; own: boolean; actions: ReactNode; surface?: MatSurface;
}) {
  const female = card.typeLead === 'Sběratelka';
  const shop = card.kind === 'shop';
  const verb = (sold: boolean) => (sold ? (shop ? 'Prodáno' : female ? 'Prodala' : 'Prodal') : (shop ? 'Koupeno' : female ? 'Koupila' : 'Koupil'));
  const m = show.missing;
  return (
    <section className="tz-mat" data-mat={surface} aria-label={`Profil ${card.name}`}>
      <div className="tz-mat-grid">
        <Zone label={shop ? 'Karta obchodu' : 'Moje karta'} area="card" className="tz-mat-card">
          <ProfileCard data={card} headingLevel={1} />
          <div className="tz-mat-stats">
            <div className="tz-mat-stat"><b>{card.rating != null ? `${formatNumber(card.rating, 0)} %` : '–'}</b><span>Hodnocení</span></div>
            <div className="tz-mat-stat"><b>{formatNumber(show.sales)}</b><span>Obchodů</span></div>
            <div className="tz-mat-stat"><b>{replyLabel(show.replyMinutes)}</b><span>Odpoví</span></div>
          </div>
        </Zone>

        <Zone label="Alba" area="a">
          {show.albums.length ? <MatAlbums albums={show.albums} own={own} /> : (
            <p className="tz-mat-empty">{own ? <>Zatím žádné album. <Link href="/kolekce/nove">Založit album</Link></> : 'Zatím žádné album.'}</p>
          )}
        </Zone>

        <Zone label="Poslední obchody" area="b">
          {show.trades.length ? (
            <div className="tz-mat-trades">
              {show.trades.map((t) => (
                <div key={t.id} className="tz-mat-trade">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {t.image ? <img src={t.image} alt="" loading="lazy" /> : <span className="tz-mat-noimg" />}
                  <div>
                    <b>{verb(t.sold)} {t.card ?? 'karty'}{t.items > 1 ? ` a ${t.items - 1} další` : ''}</b>
                    <span className="tz-mat-sub">{t.other ?? 'Smazaný účet'} · {ago(t.at)}</span>
                  </div>
                  {t.rating ? <span className="tz-mat-stars" aria-label={`${t.rating} z 5`}>{stars(t.rating)}</span> : null}
                </div>
              ))}
            </div>
          ) : <p className="tz-mat-empty">Zatím žádný dokončený obchod.</p>}
        </Zone>

        <Zone label="Chybí do sady" area="c">
          {m ? (
            <div className="tz-mat-missing">
              <div className="tz-mat-mbook">
                <AlbumBook design={m.album.design} name={m.album.name} scale={0.5} />
                <span>{m.count} chybí</span>
              </div>
              {m.cards.map((c) => (
                <Link key={c.slug} href={`/karty/${c.slug}`} className="tz-mat-slot" title={`${c.name} ${c.number}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.image ? <img src={c.image} alt="" loading="lazy" /> : null}
                  <span>{c.name}<br />{c.number}</span>
                </Link>
              ))}
              {!own ? (
                <div className="tz-mat-more">
                  {m.count > m.cards.length ? <span>+ {formatNumber(m.count - m.cards.length)} dalších</span> : null}
                  <MessageSeller sellerId={card.id} label="Mám některou" small={false} text={`Ahoj, mám kartu do tvého alba ${m.album.name}: `} />
                </div>
              ) : m.count > m.cards.length ? <div className="tz-mat-more"><span>+ {formatNumber(m.count - m.cards.length)} dalších</span></div> : null}
            </div>
          ) : <p className="tz-mat-empty">{show.albums.length ? 'Všechna alba sad jsou kompletní.' : 'Žádné album sady.'}</p>}
        </Zone>

        <Zone label="Hodnocení" area="d">
          {card.reviews ? (
            <div className="tz-mat-rating">
              <div className="tz-mat-score">
                <b>{card.rating != null ? `${formatNumber(card.rating, 0)} %` : '–'}</b>
                <span className="tz-mat-sub">{card.reviews} {card.reviews === 1 ? 'recenze' : card.reviews < 5 ? 'recenze' : 'recenzí'}</span>
              </div>
              <div className="tz-mat-quotes">
                {show.reviews.length ? show.reviews.map((r, k) => (
                  <figure key={k} className="tz-mat-quote"><b>{r.author ?? 'Kupující'} <span className="tz-mat-stars">{stars(r.rating)}</span></b>{r.comment}</figure>
                )) : <p className="tz-mat-empty">Recenze zatím bez textu.</p>}
              </div>
            </div>
          ) : <p className="tz-mat-empty">Zatím bez hodnocení.</p>}
        </Zone>

        <div className="tz-mat-actions">{actions}</div>
      </div>
    </section>
  );
}
