'use client';

// Nastavení jednotlivých bloků stránky v editoru.
import { useState } from 'react';
import { Button, CardThumb, Chip } from '@/components/trezor';
import { GAMES } from '@/lib/games';
import { youtubeId, type ShopBlock } from '@/lib/shop-config';
import type { PickerCard } from './actions';
import { AddressInput, CardPicker, Field, ImageInput, ListingPicker, PickedListings, RowActions, mediaUrl, move, rid, uploadImage, type ListingOption } from './editorParts';
import sell from '../../prodat/sell.module.css';
import styles from './editor.module.css';

export interface BlockSettingsProps {
  b: ShopBlock;
  setData: (d: ShopBlock['data']) => void;
  uid: string;
  listings: ListingOption[];
  listingById: Map<string, ListingOption>;
  cards: Map<string, PickerCard>;
  rememberCard: (c: PickerCard) => void;
  storeAddress: string;
  setStoreAddress: (address: string) => void;
  goTo: (section: string) => void;
}

export function BlockSettings({ b, setData, uid, listings, listingById, cards, rememberCard, storeAddress, setStoreAddress, goTo }: BlockSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  switch (b.type) {
    case 'notice': {
      const n = b.data.notice ?? { title: '', text: '', until: '' };
      return (
        <div className={styles.stack}>
          <Field label="NADPIS OZNÁMENÍ"><input className={sell.input} value={n.title} maxLength={120} onChange={(e) => setData({ notice: { ...n, title: e.target.value } })} placeholder="Např. Turnaj v sobotu od 10:00" /></Field>
          <Field label="TEXT"><textarea className={`${sell.input} ${styles.textareaSmall}`} value={n.text} maxLength={400} onChange={(e) => setData({ notice: { ...n, text: e.target.value } })} /></Field>
          <Field label="PLATÍ DO" hint="Po tomto dni se oznámení samo skryje"><input type="date" className={sell.input} value={n.until} onChange={(e) => setData({ notice: { ...n, until: e.target.value } })} /></Field>
        </div>
      );
    }
    case 'spotlight': {
      const s = b.data.spotlight ?? { listingId: '', story: '' };
      return (
        <div className={styles.stack}>
          <PickedListings ids={s.listingId ? [s.listingId] : []} onChange={(ids) => setData({ spotlight: { ...s, listingId: ids[0] ?? '' } })} listingById={listingById} />
          <ListingPicker listings={listings} selected={s.listingId ? [s.listingId] : []} max={1} onPick={(id) => setData({ spotlight: { ...s, listingId: id } })} />
          <Field label="PŘÍBĚH KARTY" hint={`${s.story.length} / 500`}>
            <textarea className={`${sell.input} ${styles.textareaSmall}`} value={s.story} maxLength={500} onChange={(e) => setData({ spotlight: { ...s, story: e.target.value } })} />
          </Field>
        </div>
      );
    }
    case 'featured':
    case 'window': {
      const max = b.type === 'window' ? Number(b.variant) || 3 : 12;
      const ids = (b.type === 'window' ? b.data.window?.listingIds : b.data.featured?.listingIds) ?? [];
      const put = (next: string[]) => setData(b.type === 'window' ? { window: { listingIds: next } } : { featured: { listingIds: next } });
      return (
        <div className={styles.stack}>
          {b.type === 'window' ? <p className="t-small muted" style={{ margin: 0 }}>Karty se rozloží do vějíře, prostřední je nahoře. Nejlépe vypadá jako první blok hned pod hlavičkou.</p> : null}
          <PickedListings ids={ids.slice(0, max)} onChange={put} listingById={listingById} />
          <span className="t-small muted">{Math.min(ids.length, max)} z {max} nabídek{b.type === 'window' && ids.length < 3 ? ' · výloha se ukáže od 3 karet' : ''}</span>
          <ListingPicker listings={listings} selected={ids} max={max} onPick={(id) => put([...ids.slice(0, max), id])} />
        </div>
      );
    }
    case 'games': {
      const picked = b.data.games?.games ?? [];
      const toggle = (id: (typeof GAMES)[number]['id']) => setData({ games: { games: GAMES.map((g) => g.id).filter((g) => (g === id ? !picked.includes(g) : picked.includes(g))) } });
      return (
        <div className={sell.field}>
          <span className="t-label muted">HRY</span>
          <div className={styles.chips}>
            <Chip selected={!picked.length} onClick={() => setData({ games: { games: [] } })}>Všechny, které prodávám</Chip>
            {GAMES.map((g) => <Chip key={g.id} selected={picked.includes(g.id)} dot={g.dot} onClick={() => toggle(g.id)}>{g.name}</Chip>)}
          </div>
          <span className="t-small muted">Hra bez karet v nabídce se neukáže.</span>
        </div>
      );
    }
    case 'cheap': {
      const max = b.data.cheap?.maxPrice ?? 100;
      return (
        <Field label="NEJVYŠŠÍ CENA (KČ)">
          <input type="number" min={1} className={sell.input} value={max} onChange={(e) => setData({ cheap: { maxPrice: Math.max(1, Math.round(Number(e.target.value) || 0)) } })} />
        </Field>
      );
    }
    case 'events': {
      const items = b.data.events ?? [];
      const put = (next: typeof items) => setData({ events: next });
      return (
        <div className={styles.stack}>
          {items.map((e, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.inline}>
                <input type="date" className={sell.input} value={e.date} aria-label="Datum" onChange={(ev) => put(items.map((x, j) => (j === i ? { ...x, date: ev.target.value } : x)))} />
                <RowActions onRemove={() => put(items.filter((_, j) => j !== i))} />
              </div>
              <input className={sell.input} value={e.title} maxLength={100} placeholder="Název akce" aria-label="Název akce" onChange={(ev) => put(items.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))} />
              <input className={sell.input} value={e.info} maxLength={160} placeholder="Čas, startovné…" aria-label="Podrobnosti" onChange={(ev) => put(items.map((x, j) => (j === i ? { ...x, info: ev.target.value } : x)))} />
            </div>
          ))}
          {items.length < 12 ? <div><Button variant="secondary" onClick={() => put([...items, { date: '', title: '', info: '' }])}>Přidat akci</Button></div> : null}
        </div>
      );
    }
    case 'photos': {
      const photos = b.data.photos ?? [];
      return (
        <div className={styles.stack}>
          <div className={styles.thumbs}>
            {photos.map((ph) => (
              <span key={ph} className={styles.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(ph)!} alt="" />
                <button type="button" className={styles.iconButton} aria-label="Odebrat fotku" onClick={() => setData({ photos: photos.filter((x) => x !== ph) })}>×</button>
              </span>
            ))}
          </div>
          {photos.length < 8 ? (
            <label className={styles.upload}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                aria-label="Přidat fotku"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setBusy(true);
                  setError('');
                  try {
                    const path = await uploadImage(uid, 'foto', file);
                    setData({ photos: [...photos, path] });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Fotku se nepodařilo nahrát.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              {busy ? 'Nahrávám…' : 'Přidat fotku'}
            </label>
          ) : null}
          <span className="t-small muted">{photos.length} z 8 fotek</span>
          {error ? <span className={sell.error} role="alert">{error}</span> : null}
        </div>
      );
    }
    case 'faq': {
      const items = b.data.faq ?? [];
      const put = (next: typeof items) => setData({ faq: next });
      return (
        <div className={styles.stack}>
          {items.map((f, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.inline}>
                <input className={sell.input} value={f.q} maxLength={120} placeholder="Otázka, např. Jak posíláte karty?" aria-label="Otázka" onChange={(e) => put(items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
                <RowActions
                  onUp={i > 0 ? () => put(move(items, i, -1)) : undefined}
                  onDown={i < items.length - 1 ? () => put(move(items, i, 1)) : undefined}
                  onRemove={() => put(items.filter((_, j) => j !== i))}
                />
              </div>
              <textarea className={`${sell.input} ${styles.textareaSmall}`} value={f.a} maxLength={600} placeholder="Odpověď" aria-label="Odpověď" onChange={(e) => put(items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
            </div>
          ))}
          {items.length < 10 ? <div><Button variant="secondary" onClick={() => put([...items, { q: '', a: '' }])}>Přidat otázku</Button></div> : null}
        </div>
      );
    }
    case 'showcase': {
      const items = b.data.showcase ?? [];
      const put = (next: typeof items) => setData({ showcase: next });
      return (
        <div className={styles.stack}>
          {items.map((x, i) => {
            const card = cards.get(x.cardId);
            return (
              <div key={x.cardId} className={styles.card}>
                <div className={styles.inline}>
                  <CardThumb image={card?.image} size="sm" preview={card?.image} />
                  <span className={styles.pickText}><strong>{card?.name ?? 'Karta'}</strong>{card ? <span className="code muted">{card.setCode} {card.number}</span> : null}</span>
                  <RowActions onRemove={() => put(items.filter((_, j) => j !== i))} />
                </div>
                <div className={styles.inline}>
                  <input className={sell.input} value={x.grade} maxLength={20} placeholder="Grade, např. PSA 10" aria-label="Grade" onChange={(e) => put(items.map((y, j) => (j === i ? { ...y, grade: e.target.value } : y)))} />
                  <input className={sell.input} value={x.note} maxLength={80} placeholder="Poznámka" aria-label="Poznámka" onChange={(e) => put(items.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
                </div>
              </div>
            );
          })}
          {items.length < 12 ? <CardPicker onPick={(card) => { rememberCard(card); if (!items.some((y) => y.cardId === card.id)) put([...items, { cardId: card.id, grade: '', note: '' }]); }} /> : null}
        </div>
      );
    }
    case 'wanted': {
      const items = b.data.wanted ?? [];
      const put = (next: typeof items) => setData({ wanted: next });
      return (
        <div className={styles.stack}>
          <p className="t-small muted" style={{ margin: 0 }}>Ke každé kartě napište výkupní cenu a počet kusů, které sháníte. Kdo kartu má, uvidí tlačítko Nabídnout. Až budou na webu zprávy, pošle vám přes ně návrh prodeje k potvrzení.</p>
          {items.map((x, i) => {
            const card = cards.get(x.cardId);
            return (
              <div key={x.cardId} className={styles.picked}>
                <CardThumb image={card?.image} size="sm" preview={card?.image} />
                <span className={styles.pickText}><strong>{card?.name ?? 'Karta'}</strong>{card ? <span className="code muted">{card.setCode} {card.number}</span> : null}</span>
                <input type="number" min={1} className={`${sell.input} ${styles.narrow}`} value={x.maxPrice ?? ''} placeholder="Kč" aria-label="Výkupní cena v Kč" title="Výkupní cena v Kč" onChange={(e) => put(items.map((y, j) => (j === i ? { ...y, maxPrice: Math.round(Number(e.target.value)) || null } : y)))} />
                <input type="number" min={1} max={99} className={`${sell.input} ${styles.tiny}`} value={x.qty} aria-label="Počet kusů" title="Počet kusů" onChange={(e) => put(items.map((y, j) => (j === i ? { ...y, qty: Math.min(99, Math.max(1, Math.round(Number(e.target.value)) || 1)) } : y)))} />
                <RowActions onRemove={() => put(items.filter((_, j) => j !== i))} />
              </div>
            );
          })}
          {items.length < 20 ? <CardPicker onPick={(card) => { rememberCard(card); if (!items.some((y) => y.cardId === card.id)) put([...items, { cardId: card.id, maxPrice: null, qty: 1, key: rid() }]); }} /> : null}
        </div>
      );
    }
    case 'countdown': {
      const cd = b.data.countdown ?? { title: '', text: '', at: '' };
      return (
        <div className={styles.stack}>
          <Field label="NA CO SE ČEKÁ"><input className={sell.input} value={cd.title} maxLength={80} placeholder="Např. Vydání nové sady Pokémon" onChange={(e) => setData({ countdown: { ...cd, title: e.target.value } })} /></Field>
          <Field label="POPISEK" hint={`${cd.text.length} / 200 · nepovinné`}><textarea className={`${sell.input} ${styles.textareaSmall}`} value={cd.text} maxLength={200} placeholder="Např. Předobjednávky boosterů spouštíme v den vydání v 10:00." onChange={(e) => setData({ countdown: { ...cd, text: e.target.value } })} /></Field>
          <Field label="DATUM A ČAS" hint="Po uplynutí se ukáže „Už je to tady!“"><input type="datetime-local" className={sell.input} value={cd.at} onChange={(e) => setData({ countdown: { ...cd, at: e.target.value } })} /></Field>
        </div>
      );
    }
    case 'team': {
      const people = b.data.team ?? [];
      const put = (next: typeof people) => setData({ team: next });
      return (
        <div className={styles.stack}>
          {people.map((p, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.inline}>
                <ImageInput label="" path={p.photo} onPath={(photo) => put(people.map((x, j) => (j === i ? { ...x, photo } : x)))} uid={uid} prefix="tym" round small />
                <RowActions
                  onUp={i > 0 ? () => put(move(people, i, -1)) : undefined}
                  onDown={i < people.length - 1 ? () => put(move(people, i, 1)) : undefined}
                  onRemove={() => put(people.filter((_, j) => j !== i))}
                />
              </div>
              <div className={styles.inline}>
                <input className={sell.input} value={p.name} maxLength={40} placeholder="Jméno" aria-label="Jméno" onChange={(e) => put(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className={sell.input} value={p.role} maxLength={40} placeholder="Role, např. Majitel" aria-label="Role" onChange={(e) => put(people.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
              </div>
              <input className={sell.input} value={p.note} maxLength={80} placeholder="Oblíbená karta nebo hra (nepovinné)" aria-label="Poznámka" onChange={(e) => put(people.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
            </div>
          ))}
          {people.length < 6 ? <div><Button variant="secondary" onClick={() => put([...people, { name: '', role: '', photo: '', note: '' }])}>Přidat člověka</Button></div> : null}
        </div>
      );
    }
    case 'video': {
      const raw = b.data.video?.youtube ?? '';
      const id = youtubeId(raw);
      return (
        <Field label="ODKAZ NA VIDEO Z YOUTUBE" hint={raw && !id ? 'Tohle nevypadá jako odkaz na YouTube.' : 'Video se načte až po kliknutí, stránka zůstane rychlá.'}>
          <input className={sell.input} value={raw} maxLength={200} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => setData({ video: { youtube: e.target.value } })} />
        </Field>
      );
    }
    case 'map':
      return (
        <div className={styles.stack}>
          <Field label="ADRESA NA MAPĚ" hint="Ulice, číslo, město. Stejná adresa se ukáže i v části O nás.">
            <AddressInput value={storeAddress} onChange={setStoreAddress} />
          </Field>
          {!storeAddress.trim() ? <span className="t-small muted">Bez adresy se mapa na stránce neukáže.</span> : null}
          <span className="t-small muted">Otevírací dobu nastavíte v části <button type="button" className={styles.linkButton} onClick={() => goTo('about')}>O nás</button>.</span>
        </div>
      );
    case 'reviews':
      return <p className="t-small muted" style={{ margin: 0 }}>Plní se samo: skutečná hodnocení se 4 nebo 5 hvězdami a komentářem, bez jmen kupujících. Dokud žádná nemáte, blok se neukáže.</p>;
    case 'collections':
      return <p className="t-small muted" style={{ margin: 0 }}>Kolekce vytvoříte v části <button type="button" className={styles.linkButton} onClick={() => goTo('tabs')}>Záložky a kolekce</button>.</p>;
    default:
      return <p className="t-small muted" style={{ margin: 0 }}>Plní se samo z vaší nabídky.</p>;
  }
}
