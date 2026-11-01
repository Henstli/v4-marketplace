'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Button, LoyaltyBadge, ProfileAvatar, ProfileCard } from '@/components/trezor';
import { PhotoEditor } from '@/components/profile/PhotoEditor';
import { mediaUrl, uploadImage } from './stranka/editorParts';
import { keepForm } from '@/lib/form';
import { PLANS } from '@/lib/plans';
import {
  COLLECTOR_STYLES, LOYALTY_LEVELS, SHOP_STYLES, TYPE_FRAMES, defaultCrop, frameAllowed, typeLineLabel,
  type CardForm, type PhotoCrop, type PresenceMode, type ProfileCardData,
} from '@/lib/profile-card';
import { updateAppearance, type AppearanceState } from './vzhled-actions';
import sell from '../prodat/sell.module.css';
import styles from './vzhled.module.css';

interface Saved { style: string; form: CardForm; frame: string; city: string; status: string; presence: PresenceMode; photoPath: string; crop: PhotoCrop | null }

const PRESENCE: { id: PresenceMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Automaticky', hint: 'Online, když jste na V4cards, jinak Offline.' },
  { id: 'dnd', label: 'Nerušit', hint: 'Červená tečka. Ostatní vidí, že teď neodpovídáte hned.' },
  { id: 'hidden', label: 'Neviditelný', hint: 'Vždy Offline, nikdo neuvidí, kdy jste tu.' },
];

// Kolo 2: kosmetika, kterou si tu později vybere každý sám.
const NEXT: { title: string; text: string }[] = [
  { title: 'Rámeček karty', text: 'Okraj celé karty profilu.' },
  { title: 'Ilustrace karty', text: 'Hotové ilustrace místo vlastní fotky.' },
  { title: 'Styl jména', text: 'Barva a písmo jména.' },
  { title: 'Povrch karty', text: 'Matný, lesklý, holo a další.' },
  { title: 'Podložka profilu', text: 'Pozadí celého profilu.' },
  { title: 'Další rámečky typové řádky', text: 'Pergamen, kámen, neon, karbon…' },
  { title: 'Odznaky úspěchů', text: 'Až 6 odznaků na kartě.' },
];

export function AppearanceForm({ card, saved }: { card: ProfileCardData; saved: Saved }) {
  const [state, action, pending] = useActionState<AppearanceState, FormData>(updateAppearance, {});
  const [v, setV] = useState<Saved>(saved);
  const set = <K extends keyof Saved>(k: K, val: Saved[K]) => setV((o) => ({ ...o, [k]: val }));
  const shop = card.kind === 'shop';
  const type = typeLineLabel(card.kind, v.style, v.form);
  const preview: ProfileCardData = {
    ...card,
    typeLead: type.lead,
    typeStyle: type.style,
    city: v.city.trim() || null,
    status: v.status.trim() || null,
    frame: frameAllowed(v.frame, card.plan) ? v.frame : 'sklo',
    presence: v.presence === 'dnd' ? 'dnd' : v.presence === 'hidden' ? 'offline' : 'online',
  };
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoSrc = v.photoPath ? mediaUrl(v.photoPath) : null;
  const photo = photoSrc && v.crop ? { src: photoSrc, crop: v.crop } : null;
  preview.photo = photo;

  const upload = async (file: File) => {
    setBusy(true);
    setPhotoError('');
    try {
      const bmp = await createImageBitmap(file);
      const a = bmp.height / bmp.width;
      bmp.close();
      const path = await uploadImage(card.id, 'avatar', file);
      setV((o) => ({ ...o, photoPath: path, crop: defaultCrop(a) }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Fotku se nepodařilo nahrát.');
    } finally {
      setBusy(false);
    }
  };

  const next = LOYALTY_LEVELS.find((l) => !card.loyalty || l.months > card.loyalty.months);

  return (
    <div className={styles.layout}>
      <div className={styles.preview}>
        <ProfileCard data={preview} headingLevel={2} />
        <p className="t-small muted" style={{ margin: 0, textAlign: 'center' }}>Náhled se mění hned, uloží se tlačítkem.</p>
      </div>

      <div className={styles.sections}>
        <form onSubmit={keepForm(action)} className={styles.section}>
          <h2 className="t-heading-m">Profilovka</h2>
          <p className="muted" style={{ margin: 0 }}>Nahrajte jednu fotku. Bílý obdélník je banner na kartě: posunete ho tažením a zvětšíte rohem nebo posuvníkem. Čárkovaný kruh je kulatá profilovka, dá se přesunout kamkoli v banneru a zvětšit.</p>
          <input type="hidden" name="photoPath" value={v.photoPath} />
          <input type="hidden" name="photoCrop" value={v.crop ? JSON.stringify(v.crop) : ''} />
          {photo ? (
            <div className={styles.photoRow}>
              <PhotoEditor src={photo.src} crop={photo.crop} onCrop={(c) => set('crop', c)} />
              <div className={styles.circles} aria-label="Kruh v malém">
                {[72, 40, 24, 16].map((s) => <ProfileAvatar key={s} name={card.name} photo={photo} size={s} />)}
              </div>
            </div>
          ) : null}
          <div className={styles.photoActions}>
            <label className="tz-btn tz-btn-md tz-btn-secondary" aria-disabled={busy || undefined}>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
              {busy ? 'Nahrávám…' : photo ? 'Nahrát jinou fotku' : 'Nahrát fotku'}
            </label>
            {photo ? <button type="button" className="tz-btn tz-btn-md tz-btn-ghost" onClick={() => set('crop', defaultCrop(photo.crop.a))}>Vrátit výřez</button> : null}
            {photo ? <button type="button" className="tz-btn tz-btn-md tz-btn-ghost" onClick={() => setV((o) => ({ ...o, photoPath: '', crop: null }))}>Odebrat fotku</button> : null}
            <span className="t-small muted">JPG, PNG nebo WebP do 20 MB.</span>
          </div>
          {photoError ? <p className={sell.error} role="alert">{photoError}</p> : null}

          <h2 className="t-heading-m" style={{ marginTop: 'var(--space-4)' }}>Typová řádka</h2>
          <div className={styles.grid}>
            {!shop ? (
              <label className={sell.field}>
                <span className="t-label muted">PŘED POMLČKOU</span>
                <select name="form" value={v.form} onChange={(e) => set('form', e.target.value === 'f' ? 'f' : 'm')} className={sell.input}>
                  <option value="m">Sběratel</option>
                  <option value="f">Sběratelka</option>
                </select>
              </label>
            ) : <input type="hidden" name="form" value="m" />}
            <label className={sell.field}>
              <span className="t-label muted">{shop ? 'DRUH OBCHODU' : 'STYL SBĚRATELE'}</span>
              <select name="style" value={v.style} onChange={(e) => set('style', e.target.value)} className={sell.input}>
                <option value="">Bez stylu</option>
                {shop
                  ? SHOP_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)
                  : COLLECTOR_STYLES.map((s) => <option key={s.id} value={s.id}>{s[v.form]}</option>)}
              </select>
            </label>
            <label className={sell.field}>
              <span className="t-label muted">MĚSTO (NEPOVINNÉ)</span>
              <input name="city" value={v.city} onChange={(e) => set('city', e.target.value)} maxLength={40} className={sell.input} placeholder="Brno" />
            </label>
          </div>

          <fieldset className={styles.frames}>
            <legend className="t-label muted">RÁMEČEK ŘÁDKY</legend>
            {TYPE_FRAMES.map((f) => {
              const ok = frameAllowed(f.id, card.plan);
              return (
                <label key={f.id} className={styles.frame} data-locked={ok ? undefined : ''}>
                  <input type="radio" name="frame" value={f.id} checked={v.frame === f.id} disabled={!ok} onChange={() => set('frame', f.id)} />
                  <span className="tz-pcard-swatch"><span className={`tz-typeline tz-typeline-${f.id}`}><span className="tz-typeline-text">{f.label}</span></span></span>
                  {!ok ? <span className="t-small muted">Plus a Pro</span> : null}
                </label>
              );
            })}
          </fieldset>

          <h2 className="t-heading-m" style={{ marginTop: 'var(--space-4)' }}>Status a stav</h2>
          <label className={sell.field}>
            <span className="t-label muted">STATUS POD JMÉNEM (NEPOVINNÉ)</span>
            <input name="status" value={v.status} onChange={(e) => set('status', e.target.value)} maxLength={60} className={sell.input} placeholder="Hledám Charizard z Base Setu" />
            <span className="t-small muted">{v.status.length} / 60</span>
          </label>
          <fieldset className={styles.presence}>
            <legend className="t-label muted">STAV</legend>
            {PRESENCE.map((p) => (
              <label key={p.id} className={styles.presenceOpt}>
                <input type="radio" name="presence" value={p.id} checked={v.presence === p.id} onChange={() => set('presence', p.id)} />
                <span><b>{p.label}</b><br /><span className="t-small muted">{p.hint}</span></span>
              </label>
            ))}
          </fieldset>

          <div className={sell.submit}>
            <Button type="submit" disabled={pending}>{pending ? 'Ukládám…' : 'Uložit vzhled'}</Button>
            {state.error ? <p className={sell.error} role="alert">{state.error}</p> : null}
            {state.ok ? <p className={sell.ok} role="status">Uloženo.</p> : null}
          </div>
          <p className="t-small muted" style={{ margin: 0 }}>Text O mně upravíte v <Link href="/ucet/stranka">úpravě stránky</Link>.</p>
        </form>

        <section className={styles.section} aria-labelledby="vernost">
          <h2 id="vernost" className="t-heading-m">Odznak věrnosti</h2>
          <p className="muted" style={{ margin: 0 }}>
            {card.plan === 'free'
              ? <>Odznak roste s tím, jak dlouho máte Plus nebo Pro. <Link href="/ucet/predplatne">Předplatné</Link></>
              : card.loyalty
                ? <>Máte <b>{card.loyalty.name}</b> s tarifem {PLANS[card.plan].name}.{next ? <> Další úroveň {next.name} za {next.label} předplatného.</> : ' To je nejvyšší úroveň.'}</>
                : <>První odznak, Bronz, dostanete po měsíci s tarifem {PLANS[card.plan].name}.</>}
          </p>
          <ol className={styles.levels}>
            {LOYALTY_LEVELS.map((l) => {
              const have = !!card.loyalty && card.loyalty.months >= l.months;
              return (
                <li key={l.id} data-have={have ? '' : undefined}>
                  <LoyaltyBadge level={l.id} name={l.name} label={l.label} size={44} />
                  <b>{l.name}</b>
                  <span className="t-small muted">{l.label}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="pripravujeme">
          <h2 id="pripravujeme" className="t-heading-m">Připravujeme</h2>
          <ul className={styles.next}>
            {NEXT.map((n) => (
              <li key={n.title}><b>{n.title}</b><span className="t-small muted">{n.text}</span><span className="tz-acct-soon">Brzy</span></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
