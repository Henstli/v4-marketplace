'use client';

// Vzhled profilu, varianta Discord (DS Trezor › AppearanceEditor): záložky Profil, Kosmetika a Odznaky,
// vpravo náhled Karta / V malém / Celý profil, okno výběru s vlastním náhledem a lišta neuložených změn.
import Link from 'next/link';
import { useActionState, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LoyaltyBadge, ProfileAvatar, ProfileCard } from '@/components/trezor';
import { PhotoEditor } from '@/components/profile/PhotoEditor';
import { ProfileMat } from '@/components/profile/ProfileMat';
import { mediaUrl, uploadImage } from './stranka/editorParts';
import { keepForm } from '@/lib/form';
import { PLANS, type Plan } from '@/lib/plans';
import type { ProfileShowcase } from '@/lib/profile';
import {
  COLLECTOR_STYLES, LOYALTY_LEVELS, MAT_SURFACES, SHOP_STYLES, TYPE_FRAMES, defaultCrop, frameAllowed, matAllowed, typeLineLabel,
  type CardForm, type MatSurface, type PhotoCrop, type PresenceMode, type ProfileCardData,
} from '@/lib/profile-card';
import { updateAppearance, type AppearanceState } from './vzhled-actions';
import sell from '../prodat/sell.module.css';
import styles from './vzhled.module.css';

interface Saved {
  style: string; form: CardForm; frame: string; city: string; status: string; presence: PresenceMode;
  photoPath: string; crop: PhotoCrop | null; mat: MatSurface; loyalty: 'show' | 'hide';
}
type View = 'karta' | 'maly' | 'profil';
type Tab = 'profil' | 'kosmetika' | 'odznaky';
type Picker = 'frame' | 'mat' | 'loyalty';

const PRESENCE: { id: PresenceMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Automaticky', hint: 'Online, když jste na V4cards, jinak Offline.' },
  { id: 'dnd', label: 'Nerušit', hint: 'Červená tečka. Ostatní vidí, že teď neodpovídáte hned.' },
  { id: 'hidden', label: 'Neviditelný', hint: 'Vždy Offline, nikdo neuvidí, kdy jste tu.' },
];
const VIEWS: [View, string][] = [['karta', 'Karta'], ['maly', 'V malém'], ['profil', 'Celý profil']];
const TABS: [Tab, string][] = [['profil', 'Profil'], ['kosmetika', 'Kosmetika'], ['odznaky', 'Odznaky']];

const tierOf = (plans: Plan[]) => (plans.includes('free') ? null : plans.includes('plus') ? 'plus' : 'pro');
const Tier = ({ t }: { t: 'plus' | 'pro' | null }) => (t ? <span className={`tz-tierlabel tz-tierlabel-${t}`}>{t.toUpperCase()}</span> : null);
const same = (a: Saved, b: Saved) => JSON.stringify(a) === JSON.stringify(b);

function Row({ title, value, side, action, soon }: { title: string; value?: ReactNode; side?: ReactNode; action?: ReactNode; soon?: boolean }) {
  return (
    <div className="tz-look-row" data-soon={soon ? '' : undefined}>
      <div className="tz-look-row-text"><b>{title}{soon ? <span className="tz-acct-soon" style={{ marginLeft: 0 }}>Brzy</span> : null}</b>{value ? <span>{value}</span> : null}</div>
      <div className="tz-look-row-side">{side}{action}</div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="tz-look-group"><span className="t-label">{label}</span>{children}</div>;
}

/** Celý profil zmenšený do sloupce náhledu (podložka má plnou šířku 1180 px). */
function FitMat({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ k: 0.4, h: 300 });
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const fit = () => { const k = Math.min(1, o.clientWidth / 1180); setBox({ k, h: i.offsetHeight * k }); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o); ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="tz-look-fit" style={{ height: box.h }}>
      <div ref={inner} style={{ transform: `scale(${box.k})` }} inert>{children}</div>
    </div>
  );
}

function Seg({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="tz-look-seg" role="group" aria-label="Náhled">
      {VIEWS.map(([k, t]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{t}</button>)}
    </div>
  );
}

export function AppearanceForm({ card, saved, show }: { card: ProfileCardData; saved: Saved; show: ProfileShowcase }) {
  const [state, action, pending] = useActionState<AppearanceState, FormData>(updateAppearance, {});
  const [base, setBase] = useState<Saved>(saved);
  const [v, setV] = useState<Saved>(saved);
  const sent = useRef<Saved | null>(null);
  const set = <K extends keyof Saved>(k: K, val: Saved[K]) => setV((o) => ({ ...o, [k]: val }));
  const [tab, setTab] = useState<Tab>('profil');
  const [view, setView] = useState<View>('karta');
  const [open, setOpen] = useState<null | 'status' | 'presence' | 'type'>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [pick, setPick] = useState<null | { k: Picker; sel: string; view: View }>(null);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const shop = card.kind === 'shop';

  useEffect(() => {
    if (state.ok && sent.current) { setBase(sent.current); sent.current = null; }
  }, [state]);

  const photoSrc = v.photoPath ? mediaUrl(v.photoPath) : null;
  const photo = photoSrc && v.crop ? { src: photoSrc, crop: v.crop } : null;
  const build = (s: Saved): ProfileCardData => {
    const type = typeLineLabel(card.kind, s.style, s.form);
    return {
      ...card,
      typeLead: type.lead,
      typeStyle: type.style,
      city: s.city.trim() || null,
      status: s.status.trim() || null,
      frame: frameAllowed(s.frame, card.plan) || pick?.k === 'frame' ? s.frame : 'sklo',
      presence: s.presence === 'dnd' ? 'dnd' : s.presence === 'hidden' ? 'offline' : 'online',
      photo,
      mat: s.mat,
      loyaltyHidden: s.loyalty === 'hide',
    };
  };
  const preview = build(v);
  const dirty = !same(v, base);

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

  const renderPreview = (pv: View, data: ProfileCardData) => {
    if (pv === 'karta') return <ProfileCard data={data} headingLevel={2} />;
    if (pv === 'profil') return <FitMat><ProfileMat card={data} show={show} own actions={<span className="tz-btn tz-btn-md tz-btn-primary">Upravit vzhled profilu</span>} /></FitMat>;
    return (
      <div className="tz-look-small">
        <div className="tz-look-sblock"><span className="t-label">PROFILOVKA</span>
          <div className="tz-look-circles">{[72, 40, 24, 16].map((s) => <ProfileAvatar key={s} name={card.name} photo={photo} size={s} />)}</div>
        </div>
        <div className="tz-look-sblock"><span className="t-label">HLAVIČKA WEBU</span>
          <div className="tz-look-hdr"><span className="tz-look-logo">V4</span><span className="tz-look-search">Karta, sada, hráč…</span><ProfileAvatar name={card.name} photo={photo} size={28} /></div>
        </div>
        <div className="tz-look-sblock"><span className="t-label">ZPRÁVY</span>
          <div className="tz-look-srow"><ProfileAvatar name={card.name} photo={photo} size={36} /><div><b>{card.name}</b> <span className="t-small muted">14:02</span><p>Zapdos mám, pošlu fotky.</p></div></div>
        </div>
        <div className="tz-look-sblock"><span className="t-label">NABÍDKA U KARTY</span>
          <div className="tz-look-srow"><ProfileAvatar name={card.name} photo={photo} size={24} /><b>{card.name}</b>{card.plan !== 'free' ? <Tier t={card.plan} /> : null}<span className="tz-look-price">1 290 Kč</span></div>
        </div>
        <div className="tz-look-sblock"><span className="t-label">RECENZE</span>
          <div className="tz-look-srow"><ProfileAvatar name={card.name} photo={photo} size={32} /><div><b>{card.name}</b> <span className="tz-look-stars">★★★★★</span><p>Rychlé odeslání, karta přesně podle popisu.</p></div></div>
        </div>
      </div>
    );
  };

  const type = typeLineLabel(card.kind, v.style, v.form);
  const frameLabel = TYPE_FRAMES.find((f) => f.id === v.frame)?.label ?? 'Sklo';
  const matLabel = MAT_SURFACES.find((m) => m.id === v.mat)?.label ?? 'Láva';
  const nextLevel = LOYALTY_LEVELS.find((l) => !card.loyalty || l.months > card.loyalty.months);
  const change = (k: Picker, pv: View) => setPick({ k, sel: v[k], view: pv });
  const toggle = (k: 'status' | 'presence' | 'type') => setOpen((o) => (o === k ? null : k));
  const albumsWord = (n: number) => (n === 1 ? 'album' : n >= 2 && n <= 4 ? 'alba' : 'alb');

  // Okno výběru: dlaždice vlevo, vlastní náhled vpravo
  const picker = (() => {
    if (!pick) return null;
    const items: { id: string; label: string; tier: 'plus' | 'pro' | null; ok: boolean; vis: ReactNode }[] =
      pick.k === 'frame' ? TYPE_FRAMES.map((f) => ({
        id: f.id, label: f.label, tier: tierOf(f.plans), ok: frameAllowed(f.id, card.plan),
        vis: <span className={`tz-typeline tz-typeline-${f.id}`}><span className="tz-typeline-text">{type.lead}</span></span>,
      }))
      : pick.k === 'mat' ? MAT_SURFACES.map((m) => ({
        id: m.id, label: m.label, tier: tierOf(m.plans), ok: matAllowed(m.id, card.plan),
        vis: <span className="tz-look-swatch tz-mat" data-mat={m.id} />,
      }))
      : [
        { id: 'show', label: card.loyalty ? `Zobrazit (${card.loyalty.name})` : 'Zobrazit', tier: null, ok: true, vis: card.loyalty ? <LoyaltyBadge level={card.loyalty.id} name={card.loyalty.name} label={card.loyalty.label} size={44} /> : <span className="muted">—</span> },
        { id: 'hide', label: 'Skrýt', tier: null, ok: true, vis: <span className="muted">—</span> },
      ];
    const cur = items.find((i) => i.id === pick.sel);
    const title = pick.k === 'frame' ? 'Rámeček typové řádky' : pick.k === 'mat' ? 'Podložka profilu' : 'Odznak věrnosti';
    const trial = build({ ...v, [pick.k]: pick.sel } as Saved);
    return (
      <div className="tz-look-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) setPick(null); }}>
        <div className="tz-look-box">
          <div className="tz-look-mh"><h2>{title}</h2><button type="button" className="tz-look-x" aria-label="Zavřít" onClick={() => setPick(null)}>×</button></div>
          <div className="tz-look-mb">
            <div className="tz-look-grid">
              {items.map((i) => (
                <button key={i.id} type="button" className="tz-look-tile" aria-pressed={pick.sel === i.id} onClick={() => setPick({ ...pick, sel: i.id })}>
                  <span className="tz-look-vis">{i.vis}</span>
                  <b>{i.label} <Tier t={i.tier} /></b>
                  {!i.ok ? <span className="t-small muted">Můžeš si vyzkoušet</span> : null}
                  {pick.sel === i.id ? <i className="tz-look-check" aria-hidden="true">✓</i> : null}
                </button>
              ))}
            </div>
            <div className="tz-look-mside">
              <Seg value={pick.view} onChange={(pv) => setPick({ ...pick, view: pv })} />
              {renderPreview(pick.view, trial)}
            </div>
          </div>
          <div className="tz-look-mf">
            {cur && !cur.ok ? <span className="tz-look-note">{cur.label} je pro tarif {cur.tier === 'pro' ? 'Pro' : 'Plus a Pro'}. <Link href="/ucet/predplatne">Předplatné</Link></span> : null}
            <button type="button" className="tz-btn tz-btn-md tz-btn-secondary" onClick={() => setPick(null)}>Zrušit</button>
            <button type="button" className="tz-btn tz-btn-md tz-btn-primary" disabled={!cur?.ok} onClick={() => { set(pick.k, pick.sel as never); setPick(null); }}>Použít</button>
          </div>
        </div>
      </div>
    );
  })();

  return (
    <form
      onSubmit={(e) => { sent.current = v; keepForm(action)(e); }}
      className="tz-look"
      data-view={view}
    >
      <input type="hidden" name="photoPath" value={v.photoPath} />
      <input type="hidden" name="photoCrop" value={v.crop ? JSON.stringify(v.crop) : ''} />
      <input type="hidden" name="style" value={v.style} />
      <input type="hidden" name="form" value={shop ? 'm' : v.form} />
      <input type="hidden" name="city" value={v.city} />
      <input type="hidden" name="status" value={v.status} />
      <input type="hidden" name="presence" value={v.presence} />
      <input type="hidden" name="frame" value={v.frame} />
      <input type="hidden" name="mat" value={v.mat} />
      <input type="hidden" name="loyalty" value={v.loyalty} />

      <div className="tz-look-list">
        <div className="tz-look-tabs" role="tablist">
          {TABS.map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>)}
        </div>

        {tab === 'profil' ? (
          <>
            <Group label="FOTKA">
              <Row
                title="Fotka"
                value={photo ? 'Profilovka a banner karty z jedné fotky' : 'Bez fotky, na kartě jsou iniciály'}
                side={<ProfileAvatar name={card.name} photo={photo} size={34} />}
                action={<button type="button" className="tz-btn tz-btn-md tz-btn-secondary" onClick={() => setPhotoOpen(true)}>Změnit</button>}
              />
              <Row title="Ilustrace místo fotky" value="Hotové ilustrace na kartu" soon />
            </Group>
            <Group label="TEXT">
              <Row title="Status" value={v.status.trim() ? `„${v.status.trim()}“` : 'Bez statusu'} action={<button type="button" className="tz-btn tz-btn-md tz-btn-secondary" aria-expanded={open === 'status'} onClick={() => toggle('status')}>{open === 'status' ? 'Hotovo' : 'Upravit'}</button>} />
              {open === 'status' ? (
                <div className="tz-look-body">
                  <label className={sell.field}>
                    <span className="t-label muted">STATUS POD JMÉNEM (NEPOVINNÉ)</span>
                    <input value={v.status} onChange={(e) => set('status', e.target.value)} maxLength={60} className={sell.input} placeholder="Hledám Charizard z Base Setu" autoFocus />
                    <span className="t-small muted">{v.status.length} / 60</span>
                  </label>
                </div>
              ) : null}
              <Row
                title="Stav"
                value={PRESENCE.find((p) => p.id === v.presence)?.label}
                side={<i className={`tz-presence tz-presence-${preview.presence}`} />}
                action={<button type="button" className="tz-btn tz-btn-md tz-btn-secondary" aria-expanded={open === 'presence'} onClick={() => toggle('presence')}>{open === 'presence' ? 'Hotovo' : 'Změnit'}</button>}
              />
              {open === 'presence' ? (
                <fieldset className={`tz-look-body ${styles.presence}`}>
                  <legend className="sr-only">Stav</legend>
                  {PRESENCE.map((p) => (
                    <label key={p.id} className={styles.presenceOpt}>
                      <input type="radio" name="presence-pick" checked={v.presence === p.id} onChange={() => set('presence', p.id)} />
                      <span><b>{p.label}</b><br /><span className="t-small muted">{p.hint}</span></span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <Row
                title="Typová řádka"
                value={[type.style ? `${type.lead} — ${type.style}` : type.lead, v.city.trim()].filter(Boolean).join(', ')}
                action={<button type="button" className="tz-btn tz-btn-md tz-btn-secondary" aria-expanded={open === 'type'} onClick={() => toggle('type')}>{open === 'type' ? 'Hotovo' : 'Upravit'}</button>}
              />
              {open === 'type' ? (
                <div className={`tz-look-body ${styles.grid}`}>
                  {!shop ? (
                    <label className={sell.field}>
                      <span className="t-label muted">PŘED POMLČKOU</span>
                      <select value={v.form} onChange={(e) => set('form', e.target.value === 'f' ? 'f' : 'm')} className={sell.input}>
                        <option value="m">Sběratel</option>
                        <option value="f">Sběratelka</option>
                      </select>
                    </label>
                  ) : null}
                  <label className={sell.field}>
                    <span className="t-label muted">{shop ? 'DRUH OBCHODU' : 'STYL SBĚRATELE'}</span>
                    <select value={v.style} onChange={(e) => set('style', e.target.value)} className={sell.input}>
                      <option value="">Bez stylu</option>
                      {shop
                        ? SHOP_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)
                        : COLLECTOR_STYLES.map((s) => <option key={s.id} value={s.id}>{s[v.form]}</option>)}
                    </select>
                  </label>
                  <label className={sell.field}>
                    <span className="t-label muted">MĚSTO (NEPOVINNÉ)</span>
                    <input value={v.city} onChange={(e) => set('city', e.target.value)} maxLength={40} className={sell.input} placeholder="Brno" />
                  </label>
                </div>
              ) : null}
              <Row title="O mně" value={card.about ?? 'Zatím bez popisu'} action={<Link href="/ucet/stranka" className="tz-btn tz-btn-md tz-btn-secondary">Upravit</Link>} />
            </Group>
          </>
        ) : null}

        {tab === 'kosmetika' ? (
          <>
            <Group label="KARTA">
              <Row
                title="Rámeček typové řádky"
                value={frameLabel}
                side={<span className="tz-look-tl"><span className={`tz-typeline tz-typeline-${preview.frame}`}><span className="tz-typeline-text">.</span></span></span>}
                action={<button type="button" className="tz-btn tz-btn-md tz-btn-secondary" onClick={() => change('frame', 'karta')}>Změnit</button>}
              />
              <Row title="Rámeček karty" value="Okraj celé karty profilu" soon />
              <Row title="Povrch karty" value="Matný, lesklý, holo a další" soon />
              <Row title="Efekt profilu" value="Jiskry, přejezd lesku, sníh" soon />
            </Group>
            <Group label="JMÉNO A PROFILOVKA">
              <Row title="Styl jména" value="Barva a písmo jména" soon />
              <Row title="Rámeček profilovky" value="Okraj kolem kulaté profilovky" soon />
            </Group>
            <Group label="CELÝ PROFIL">
              <Row
                title="Podložka profilu"
                value={matLabel}
                side={<span className="tz-look-swatch tz-mat" data-mat={v.mat} />}
                action={<button type="button" className="tz-btn tz-btn-md tz-btn-secondary" onClick={() => change('mat', 'profil')}>Změnit</button>}
              />
              <Row
                title="Alba na profilu"
                value={show.albums.length ? `${show.albums.length} ${albumsWord(show.albums.length)}: ${show.albums.slice(0, 3).map((a) => a.name).join(', ')}${show.albums.length > 3 ? '…' : ''}` : 'Žádné album na profilu'}
                action={<Link href="/kolekce" className="tz-btn tz-btn-md tz-btn-secondary">Upravit</Link>}
              />
              <p className="t-small muted" style={{ margin: '8px 0 0' }}>Album z profilu skryješ v jeho detailu tlačítkem Skrýt z profilu.</p>
            </Group>
          </>
        ) : null}

        {tab === 'odznaky' ? (
          <>
            <Group label="VĚRNOST">
              <Row
                title="Odznak věrnosti"
                value={card.loyalty ? `${card.loyalty.name} · ${v.loyalty === 'show' ? 'zobrazený' : 'skrytý'}` : 'Zatím žádný'}
                side={card.loyalty && v.loyalty === 'show' ? <LoyaltyBadge level={card.loyalty.id} name={card.loyalty.name} label={card.loyalty.label} size={34} /> : null}
                action={<button type="button" className="tz-btn tz-btn-md tz-btn-secondary" disabled={!card.loyalty} onClick={() => change('loyalty', 'karta')}>Změnit</button>}
              />
              <p className="t-small muted" style={{ margin: '10px 0' }}>
                {card.plan === 'free'
                  ? <>Odznak roste s tím, jak dlouho máte Plus nebo Pro. <Link href="/ucet/predplatne">Předplatné</Link></>
                  : card.loyalty
                    ? <>Máte <b>{card.loyalty.name}</b> s tarifem {PLANS[card.plan].name}.{nextLevel ? <> Další úroveň {nextLevel.name} za {nextLevel.label} předplatného.</> : ' To je nejvyšší úroveň.'}</>
                    : <>První odznak, Bronz, dostanete po měsíci s tarifem {PLANS[card.plan].name}.</>}
              </p>
              <ol className={styles.levels}>
                {LOYALTY_LEVELS.map((l) => (
                  <li key={l.id} data-have={card.loyalty && card.loyalty.months >= l.months ? '' : undefined}>
                    <LoyaltyBadge level={l.id} name={l.name} label={l.label} size={40} />
                    <b>{l.name}</b>
                    <span className="t-small muted">{l.label}</span>
                  </li>
                ))}
              </ol>
            </Group>
            <Group label="ÚSPĚCHY">
              <Row title="Odznaky úspěchů" value="Až 6 odznaků na kartě" soon />
            </Group>
          </>
        ) : null}

        {dirty || state.error ? (
          <div className="tz-look-savebar" role="status">
            <span>{state.error ? <b style={{ color: 'var(--danger)' }}>{state.error}</b> : <><b>Máš neuložené změny</b> · náhled už je ukazuje</>}</span>
            <button type="button" className="tz-btn tz-btn-md tz-btn-ghost" disabled={pending} onClick={() => setV(base)}>Vrátit</button>
            <button type="submit" className="tz-btn tz-btn-md tz-btn-primary" disabled={pending || !dirty}>{pending ? 'Ukládám…' : 'Uložit změny'}</button>
          </div>
        ) : state.ok ? <p className={sell.ok} role="status" style={{ marginTop: 'var(--space-4)' }}>Uloženo.</p> : null}
      </div>

      <aside className="tz-look-side" aria-label="Náhled">
        <Seg value={view} onChange={setView} />
        {renderPreview(view, preview)}
      </aside>

      {photoOpen ? (
        <div className="tz-look-modal" role="dialog" aria-modal="true" aria-label="Fotka" onClick={(e) => { if (e.target === e.currentTarget) setPhotoOpen(false); }}>
          <div className="tz-look-box" style={{ width: 'min(860px, 100%)' }}>
            <div className="tz-look-mh"><h2>Fotka</h2><button type="button" className="tz-look-x" aria-label="Zavřít" onClick={() => setPhotoOpen(false)}>×</button></div>
            <div className="tz-look-mb">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <p className="muted" style={{ margin: 0 }}>Bílý obdélník je banner na kartě: posunete ho tažením a zvětšíte rohem nebo posuvníkem. Kruh je kulatá profilovka, přesunete ho tažením a velikost změníte za okraj.</p>
                {photo ? <PhotoEditor src={photo.src} crop={photo.crop} onCrop={(c) => set('crop', c)} /> : null}
                <div className={styles.photoActions}>
                  <label className="tz-btn tz-btn-md tz-btn-secondary" aria-disabled={busy || undefined}>
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
                    {busy ? 'Nahrávám…' : photo ? 'Nahrát jinou fotku' : 'Nahrát fotku'}
                  </label>
                  {photo ? <button type="button" className="tz-btn tz-btn-md tz-btn-ghost" onClick={() => set('crop', defaultCrop(photo.crop.a))}>Vrátit výřez</button> : null}
                  {photo ? <button type="button" className="tz-btn tz-btn-md tz-btn-ghost" onClick={() => setV((o) => ({ ...o, photoPath: '', crop: null }))}>Odebrat fotku</button> : null}
                </div>
                <span className="t-small muted">JPG, PNG nebo WebP do 20 MB.</span>
                {photoError ? <p className={sell.error} role="alert">{photoError}</p> : null}
              </div>
              <div className="tz-look-mside">
                <ProfileCard data={preview} headingLevel={2} />
                <div className="tz-look-sblock" style={{ width: '100%', maxWidth: 340 }}>
                  <span className="t-label">PROFILOVKA V MALÉM</span>
                  <div className="tz-look-circles">{[72, 40, 24, 16].map((s) => <ProfileAvatar key={s} name={card.name} photo={photo} size={s} />)}</div>
                </div>
              </div>
            </div>
            <div className="tz-look-mf"><button type="button" className="tz-btn tz-btn-md tz-btn-primary" onClick={() => setPhotoOpen(false)}>Hotovo</button></div>
          </div>
        </div>
      ) : null}
      {picker}
    </form>
  );
}
