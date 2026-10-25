'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, Chip, SellerBadge, ShopHeader, shopStyle } from '@/components/trezor';
import { createClient } from '@/lib/supabase/browser';
import { SUPABASE_URL } from '@/lib/supabase/config';
import { formatNumber } from '@/lib/format';
import { GAMES } from '@/lib/games';
import { PLANS, type Plan } from '@/lib/plans';
import {
  BLOCKS, blockInfo, effectiveConfig, newBlock, shopHref, slugify, SHOP_BANNERS, SHOP_COLORS, SHOP_FONTS, SHOP_LAYOUTS, SLUG_RE,
  type BlockType, type ShopBlock, type ShopCollection, type ShopPageConfig,
} from '@/lib/shop-config';
import { CONDITIONS, LANGUAGE_NAMES, type Language } from '@/lib/types';
import { findCatalogCards, saveShopPage, type PickerCard, type SaveState } from './actions';
import sell from '../../prodat/sell.module.css';
import styles from './editor.module.css';

export interface ListingOption {
  id: string;
  name: string;
  sub: string;
  price: number;
  image?: string;
}

interface Props {
  uid: string;
  name: string;
  kind: 'shop' | 'private';
  plan: Plan;
  badge: boolean;
  initial: ShopPageConfig;
  listings: ListingOption[];
  cards: PickerCard[];
}

const FONT_URLS: Record<string, string> = {
  classic: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap',
  sport: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&display=swap',
};

const MAX_IMAGE = 3 * 1024 * 1024;

function mediaUrl(path: string): string | null {
  return path ? `${SUPABASE_URL}/storage/v1/object/public/shop-media/${path}` : null;
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Nahraje obrázek do vlastní složky v bucketu shop-media a vrátí jeho cestu. */
async function uploadImage(uid: string, prefix: string, file: File): Promise<string> {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!ext) throw new Error('Nahrajte obrázek JPG, PNG nebo WebP.');
  if (file.size > MAX_IMAGE) throw new Error('Obrázek může mít nejvýš 3 MB.');
  const path = `${uid}/${prefix}-${Date.now().toString(36)}${rid()}.${ext}`;
  const { error } = await createClient().storage.from('shop-media').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
  if (error) throw new Error('Obrázek se nepodařilo nahrát. Máte-li zapnuté dvoufázové ověření, přihlaste se znovu s kódem.');
  return path;
}

function ProTag() {
  return <span className={styles.lockTag}><SellerBadge type="pro" /></span>;
}

function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`${sell.field} ${wide ? sell.wide : ''}`}>
      <span className="t-label muted">{label}</span>
      {children}
      {hint ? <span className="t-small muted">{hint}</span> : null}
    </label>
  );
}

function ImageInput({ label, path, onPath, uid, prefix, round, disabled }: {
  label: string; path: string; onPath: (p: string) => void; uid: string; prefix: string; round?: boolean; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = mediaUrl(path);
  return (
    <div className={sell.field}>
      <span className="t-label muted">{label}</span>
      <div className={styles.imageRow}>
        <span className={`${styles.imagePreview} ${round ? styles.round : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt="" /> : <span className="t-small muted">Bez obrázku</span>}
        </span>
        <div className={styles.imageActions}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={sell.file}
            disabled={disabled || busy}
            aria-label={label}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setBusy(true);
              setError('');
              try {
                onPath(await uploadImage(uid, prefix, file));
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Obrázek se nepodařilo nahrát.');
              } finally {
                setBusy(false);
              }
            }}
          />
          {path ? <button type="button" className={styles.linkButton} onClick={() => onPath('')} disabled={disabled}>Odebrat</button> : null}
          <span className="t-small muted">{busy ? 'Nahrávám…' : 'JPG, PNG nebo WebP do 3 MB'}</span>
          {error ? <span className={sell.error} role="alert">{error}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Výběr z vlastních nabídek (Doporučujeme, Karta týdne) */
function ListingPicker({ listings, selected, onPick, max }: { listings: ListingOption[]; selected: string[]; onPick: (id: string) => void; max: number }) {
  const [q, setQ] = useState('');
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listings.filter((l) => !selected.includes(l.id) && (!t || l.name.toLowerCase().includes(t) || l.sub.toLowerCase().includes(t))).slice(0, 8);
  }, [q, listings, selected]);
  if (selected.length >= max) return null;
  if (!listings.length) return <p className="t-small muted">Zatím nemáte žádné nabídky. Přidejte je v sekci <Link href="/prodat">Prodat</Link>.</p>;
  return (
    <div className={styles.picker}>
      <input className={sell.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat ve vlastních nabídkách" aria-label="Hledat ve vlastních nabídkách" />
      <div className={styles.pickList}>
        {found.map((l) => (
          <button key={l.id} type="button" className={styles.pickRow} onClick={() => onPick(l.id)}>
            <span className={styles.pickText}><strong>{l.name}</strong><span className="code muted">{l.sub}</span></span>
            <span className="t-price">{formatNumber(l.price)} Kč</span>
            <span className={styles.add} aria-hidden="true">+</span>
          </button>
        ))}
        {!found.length ? <p className="t-small muted">Nic nenalezeno.</p> : null}
      </div>
    </div>
  );
}

/** Výběr karty z katalogu (Vitrína, Hledám) */
function CardPicker({ onPick }: { onPick: (c: PickerCard) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PickerCard[] | null>(null);
  const [pending, start] = useTransition();
  const search = () => start(async () => setFound(await findCatalogCards(q)));
  return (
    <div className={styles.picker}>
      <div className={styles.inline}>
        <input
          className={sell.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          placeholder="Název karty z katalogu"
          aria-label="Hledat kartu v katalogu"
        />
        <Button variant="secondary" onClick={search} disabled={pending || q.trim().length < 2}>{pending ? 'Hledám…' : 'Hledat'}</Button>
      </div>
      {found ? (
        <div className={styles.pickList}>
          {found.map((c) => (
            <button key={c.id} type="button" className={styles.pickRow} onClick={() => onPick(c)}>
              <span className={styles.pickText}><strong>{c.name}</strong><span className="code muted">{c.setCode} {c.number}</span></span>
              <span className={styles.add} aria-hidden="true">+</span>
            </button>
          ))}
          {!found.length ? <p className="t-small muted">Nic nenalezeno.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function RowActions({ onUp, onDown, onRemove }: { onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  return (
    <span className={styles.rowActions}>
      {onUp ? <button type="button" className={styles.iconButton} onClick={onUp} aria-label="Posunout nahoru">↑</button> : null}
      {onDown ? <button type="button" className={styles.iconButton} onClick={onDown} aria-label="Posunout dolů">↓</button> : null}
      <button type="button" className={styles.iconButton} onClick={onRemove} aria-label="Odebrat">×</button>
    </span>
  );
}

function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function ShopEditor({ uid, name, kind, plan, badge, initial, listings, cards: initialCards }: Props) {
  const info = PLANS[plan];
  const [c, setC] = useState<ShopPageConfig>(initial);
  const [cards, setCards] = useState(() => new Map(initialCards.map((x) => [x.id, x])));
  const [state, setState] = useState<SaveState>({});
  const [saving, startSave] = useTransition();
  const [addType, setAddType] = useState<BlockType | ''>('');
  const listingById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const shown = effectiveConfig(c, plan);
  const pro = info.fullDesign;

  const set = <K extends keyof ShopPageConfig>(key: K, value: ShopPageConfig[K]) => { setC((x) => ({ ...x, [key]: value })); setState({}); };
  const setDesign = (patch: Partial<ShopPageConfig['design']>) => set('design', { ...c.design, ...patch });
  const updateBlock = (id: string, fn: (b: ShopBlock) => ShopBlock) => set('blocks', c.blocks.map((b) => (b.id === id ? fn(b) : b)));
  const setData = (b: ShopBlock, data: ShopBlock['data']) => updateBlock(b.id, (x) => ({ ...x, data: { ...x.data, ...data } }));
  const rememberCard = (card: PickerCard) => setCards((m) => new Map(m).set(card.id, card));

  const save = () => startSave(async () => setState(await saveShopPage(JSON.stringify(c))));
  const publicHref = info.shopPage && c.slug && SLUG_RE.test(c.slug) ? shopHref(kind, c.slug) : `/prodejci/${uid}`;
  const activeBlocks = c.blocks.filter((b) => b.enabled && (info.proBlocks || !blockInfo(b.type)?.pro)).length;

  const saveBar = (
    <div className={styles.saveBar}>
      <Button onClick={save} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit stránku'}</Button>
      <Link href={publicHref}>{info.shopPage && !c.published ? 'Náhled stránky' : 'Zobrazit stránku'}</Link>
      {state.error ? <p className={sell.error} role="alert">{state.error}</p> : null}
      {state.ok ? <p className={sell.ok} role="status">Uloženo.</p> : null}
    </div>
  );

  // Zdarma: jen základní profil.
  if (!info.shopPage) {
    return (
      <>
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h2 className="t-heading-m">Základní profil</h2>
          <p className="muted">V tarifu Zdarma máte základní profil s obrázkem, popisem a celou nabídkou. Vlastní stránku s bannerem, barvou, bloky a vlastní adresou dostanete v tarifu Plus nebo Pro.</p>
          <ImageInput label="PROFILOVÝ OBRÁZEK" path={c.logoPath} onPath={(p) => set('logoPath', p)} uid={uid} prefix="logo" round />
          <Field label={kind === 'shop' ? 'O NÁS' : 'O MNĚ'} hint={`${c.about.length} / 1500`}>
            <textarea className={`${sell.input} ${styles.textarea}`} value={c.about} maxLength={1500} onChange={(e) => set('about', e.target.value)} />
          </Field>
        </section>
        {saveBar}
      </>
    );
  }

  const fontUrl = FONT_URLS[shown.design.font];

  return (
    <div className={styles.editor}>
      {fontUrl ? <link rel="stylesheet" href={fontUrl} precedence="default" /> : null}
      <p className="muted">
        Tarif {info.name}. {pro
          ? 'Máte všechny šablony, písma a bloky.'
          : <>Šablony hlavičky, písma, rohy, vzkaz u nabídek a bloky se štítkem <SellerBadge type="pro" /> jsou v tarifu Pro. Uložit je můžete už teď, ukážou se po přechodu na Pro.</>}
      </p>

      <section
        className={`tz-shop ${styles.preview}`}
        data-font={shown.design.font}
        data-corners={shown.design.corners}
        data-theme={shown.design.mode === 'light' ? 'light' : undefined}
        style={shopStyle(shown.design.color)}
        aria-label="Náhled hlavičky"
      >
        <span className="t-label muted">NÁHLED</span>
        <ShopHeader
          layout={shown.design.layout}
          name={name}
          logo={mediaUrl(c.logoPath)}
          bannerImage={shown.design.banner === 'photo' ? mediaUrl(c.bannerPath) : null}
          bannerStyle={shown.design.banner === 'solid' ? 'solid' : 'pattern'}
          meta={kind === 'shop' ? 'Obchod · Česko' : 'Sběratel · Česko'}
          tagline={c.tagline || undefined}
          badges={<>{badge ? <SellerBadge type="verified" /> : null}{plan === 'pro' ? <SellerBadge type="pro" /> : null}</>}
          tabs={[{ label: 'Přehled', href: '#', current: true }, { label: 'Celá nabídka', href: '#' }, ...shown.collections.map((x) => ({ label: x.name, href: '#' }))]}
        />
      </section>

      <section className="panel">
        <h2 className="t-heading-m">Adresa a zveřejnění</h2>
        <div className={sell.form}>
          <Field label="ADRESA STRÁNKY" hint={c.slug && !SLUG_RE.test(c.slug) ? '3 až 40 znaků: malá písmena bez diakritiky, číslice a pomlčky.' : `v4cards.com${shopHref(kind, c.slug || '…')}`} wide>
            <div className={styles.inline}>
              <span className="code muted">{shopHref(kind, '')}</span>
              <input className={sell.input} value={c.slug} maxLength={40} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder={slugify(name)} />
              {!c.slug ? <Button variant="secondary" onClick={() => set('slug', slugify(name))}>Použít název</Button> : null}
            </div>
          </Field>
          <label className={`${styles.check} ${sell.wide}`}>
            <input type="checkbox" checked={c.published} onChange={(e) => set('published', e.target.checked)} />
            <span>Stránka je zveřejněná. Dokud není, vidíte ji jen vy a kupující dostanou základní profil.</span>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2 className="t-heading-m">Vzhled</h2>
        <div className={styles.stack}>
          <ImageInput label="LOGO" path={c.logoPath} onPath={(p) => set('logoPath', p)} uid={uid} prefix="logo" />
          <div className={sell.field}>
            <span className="t-label muted">BARVA</span>
            <div className={styles.swatches}>
              {SHOP_COLORS.map((x) => (
                <button key={x.id} type="button" className={styles.swatch} style={{ background: `var(--shop-${x.id})` }} aria-pressed={c.design.color === x.id} aria-label={x.name} title={x.name} onClick={() => setDesign({ color: x.id })} />
              ))}
            </div>
          </div>
          <div className={sell.field}>
            <span className="t-label muted">REŽIM</span>
            <div className={styles.chips}>
              <Chip selected={c.design.mode === 'dark'} onClick={() => setDesign({ mode: 'dark' })}>Tmavý</Chip>
              <Chip selected={c.design.mode === 'light'} onClick={() => setDesign({ mode: 'light' })}>Světlý</Chip>
            </div>
          </div>
          <div className={sell.field}>
            <span className="t-label muted">BANNER</span>
            <div className={styles.chips}>
              {SHOP_BANNERS.map((x) => <Chip key={x.id} selected={c.design.banner === x.id} onClick={() => setDesign({ banner: x.id })}>{x.name}</Chip>)}
            </div>
          </div>
          {c.design.banner === 'photo' ? <ImageInput label="OBRÁZEK BANNERU" path={c.bannerPath} onPath={(p) => set('bannerPath', p)} uid={uid} prefix="banner" /> : null}
          <div className={sell.field}>
            <span className="t-label muted">ŠABLONA HLAVIČKY {!pro ? <ProTag /> : null}</span>
            <div className={styles.chips}>
              {SHOP_LAYOUTS.map((x) => <Chip key={x.id} selected={c.design.layout === x.id} onClick={() => setDesign({ layout: x.id })}>{x.name}</Chip>)}
            </div>
          </div>
          <div className={sell.field}>
            <span className="t-label muted">PÍSMO NADPISŮ {!pro ? <ProTag /> : null}</span>
            <div className={styles.chips}>
              {SHOP_FONTS.map((x) => <Chip key={x.id} selected={c.design.font === x.id} onClick={() => setDesign({ font: x.id })}>{x.name}</Chip>)}
            </div>
          </div>
          <div className={sell.field}>
            <span className="t-label muted">ROHY {!pro ? <ProTag /> : null}</span>
            <div className={styles.chips}>
              <Chip selected={c.design.corners === 'round'} onClick={() => setDesign({ corners: 'round' })}>Zaoblené</Chip>
              <Chip selected={c.design.corners === 'sharp'} onClick={() => setDesign({ corners: 'sharp' })}>Ostré</Chip>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="t-heading-m">Texty</h2>
        <div className={sell.form}>
          <Field label="PODTITUL" hint={`${c.tagline.length} / 160 · pod jménem v hlavičce`} wide>
            <input className={sell.input} value={c.tagline} maxLength={160} onChange={(e) => set('tagline', e.target.value)} />
          </Field>
          <Field label={kind === 'shop' ? 'O NÁS' : 'O MNĚ'} hint={`${c.about.length} / 1500`} wide>
            <textarea className={`${sell.input} ${styles.textarea}`} value={c.about} maxLength={1500} onChange={(e) => set('about', e.target.value)} />
          </Field>
          <Field label="VZKAZ U NABÍDEK" hint={<>{c.offerNote.length} / 100 · pod vaším jménem u nabídek na detailu karty {!pro ? <ProTag /> : null}</>} wide>
            <input className={sell.input} value={c.offerNote} maxLength={100} onChange={(e) => set('offerNote', e.target.value)} placeholder="Např. Odesíláme do 24 hodin" />
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className={sell.sectionHead}>
          <h2 className="t-heading-m">Bloky stránky</h2>
          <span className="t-small muted">Na stránce {Math.min(activeBlocks, info.maxBlocks)} z {pro ? 'neomezeně' : info.maxBlocks} · Celá nabídka je vždy na konci</span>
        </div>
        <div className={styles.blocks}>
          {c.blocks.map((b, i) => {
            const bi = blockInfo(b.type)!;
            const locked = bi.pro && !info.proBlocks;
            const hidden = b.enabled && !locked && !shown.blocks.some((x) => x.id === b.id);
            return (
              <div key={b.id} className={`${styles.block} ${!b.enabled || locked ? styles.blockOff : ''}`}>
                <div className={styles.blockHead}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={b.enabled} onChange={(e) => updateBlock(b.id, (x) => ({ ...x, enabled: e.target.checked }))} />
                    <strong>{bi.name}</strong>
                  </label>
                  {bi.pro ? <SellerBadge type="pro" /> : null}
                  {locked ? <span className="t-small muted">ukáže se s tarifem Pro</span> : null}
                  {hidden ? <span className="t-small muted">nad limit bloků, neukáže se</span> : null}
                  <RowActions
                    onUp={i > 0 ? () => set('blocks', move(c.blocks, i, -1)) : undefined}
                    onDown={i < c.blocks.length - 1 ? () => set('blocks', move(c.blocks, i, 1)) : undefined}
                    onRemove={() => set('blocks', c.blocks.filter((x) => x.id !== b.id))}
                  />
                </div>
                {b.enabled ? (
                  <div className={styles.blockBody}>
                    <div className={styles.inline}>
                      <input className={sell.input} value={b.title} maxLength={60} placeholder={bi.name} aria-label="Nadpis bloku" onChange={(e) => updateBlock(b.id, (x) => ({ ...x, title: e.target.value }))} />
                      {bi.variants.length > 1 ? (
                        <select className={sell.input} value={b.variant} aria-label="Vzhled bloku" onChange={(e) => updateBlock(b.id, (x) => ({ ...x, variant: e.target.value }))}>
                          {bi.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      ) : null}
                    </div>
                    <BlockSettings b={b} setData={(d) => setData(b, d)} uid={uid} listings={listings} listingById={listingById} cards={cards} rememberCard={rememberCard} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className={styles.inline} style={{ marginTop: 'var(--space-4)' }}>
          <select className={sell.input} value={addType} onChange={(e) => setAddType(e.target.value as BlockType)} aria-label="Přidat blok">
            <option value="">Přidat blok…</option>
            {BLOCKS.map((x) => <option key={x.type} value={x.type}>{x.name}{x.pro ? ' (Pro)' : ''} · {x.desc}</option>)}
          </select>
          <Button variant="secondary" disabled={!addType || c.blocks.length >= 40} onClick={() => { if (addType) { set('blocks', [...c.blocks, newBlock(addType)]); setAddType(''); } }}>Přidat</Button>
        </div>
      </section>

      <section className="panel">
        <div className={sell.sectionHead}>
          <h2 className="t-heading-m">Vlastní kolekce {!pro ? <ProTag /> : null}</h2>
          <span className="t-small muted">Uložené výběry skladu, ukážou se jako záložky v hlavičce</span>
        </div>
        <div className={styles.rows}>
          {c.collections.map((col, i) => (
            <CollectionRow
              key={col.id}
              col={col}
              onChange={(next) => set('collections', c.collections.map((x) => (x.id === col.id ? next : x)))}
              actions={<RowActions
                onUp={i > 0 ? () => set('collections', move(c.collections, i, -1)) : undefined}
                onDown={i < c.collections.length - 1 ? () => set('collections', move(c.collections, i, 1)) : undefined}
                onRemove={() => set('collections', c.collections.filter((x) => x.id !== col.id))}
              />}
            />
          ))}
        </div>
        {c.collections.length < 20 ? (
          <Button variant="secondary" onClick={() => set('collections', [...c.collections, { id: rid(), name: '', q: '', game: '', condition: '', language: '' }])}>Přidat kolekci</Button>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="t-heading-m">Kontakt</h2>
        <div className={sell.form}>
          {([['web', 'WEB'], ['instagram', 'INSTAGRAM'], ['facebook', 'FACEBOOK'], ['discord', 'DISCORD'], ['email', 'E-MAIL'], ['phone', 'TELEFON']] as const).map(([k, label]) => (
            <Field key={k} label={label}>
              <input className={sell.input} value={c.contact[k]} maxLength={k === 'phone' ? 30 : 120} onChange={(e) => set('contact', { ...c.contact, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </section>

      {kind === 'shop' ? (
        <section className="panel">
          <h2 className="t-heading-m">Kamenná prodejna</h2>
          <div className={sell.form}>
            <Field label="ADRESA" wide>
              <textarea className={`${sell.input} ${styles.textareaSmall}`} value={c.store.address} maxLength={200} onChange={(e) => set('store', { ...c.store, address: e.target.value })} />
            </Field>
            <label className={`${styles.check} ${sell.wide}`}>
              <input type="checkbox" checked={c.store.pickup} onChange={(e) => set('store', { ...c.store, pickup: e.target.checked })} />
              <span>Osobní odběr objednávek v prodejně</span>
            </label>
            <div className={`${sell.field} ${sell.wide}`}>
              <span className="t-label muted">OTEVÍRACÍ DOBA</span>
              {c.store.hours.map((h, i) => (
                <div key={i} className={styles.inline}>
                  <input className={sell.input} value={h.day} maxLength={20} placeholder="Po–Pá" aria-label="Dny" onChange={(e) => set('store', { ...c.store, hours: c.store.hours.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)) })} />
                  <input className={sell.input} value={h.time} maxLength={40} placeholder="10:00–18:00" aria-label="Čas" onChange={(e) => set('store', { ...c.store, hours: c.store.hours.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })} />
                  <RowActions onRemove={() => set('store', { ...c.store, hours: c.store.hours.filter((_, j) => j !== i) })} />
                </div>
              ))}
              {c.store.hours.length < 7 ? <div><Button variant="secondary" onClick={() => set('store', { ...c.store, hours: [...c.store.hours, { day: '', time: '' }] })}>Přidat řádek</Button></div> : null}
            </div>
          </div>
        </section>
      ) : null}

      {saveBar}
    </div>
  );
}

function CollectionRow({ col, onChange, actions }: { col: ShopCollection; onChange: (c: ShopCollection) => void; actions: ReactNode }) {
  return (
    <div className={styles.collection}>
      <input className={sell.input} value={col.name} maxLength={40} placeholder="Název, např. Do 100 Kč" aria-label="Název kolekce" onChange={(e) => onChange({ ...col, name: e.target.value })} />
      <input className={sell.input} value={col.q} maxLength={60} placeholder="Hledaný text (nepovinné)" aria-label="Hledaný text" onChange={(e) => onChange({ ...col, q: e.target.value })} />
      <select className={sell.input} value={col.game} aria-label="Hra" onChange={(e) => onChange({ ...col, game: e.target.value as ShopCollection['game'] })}>
        <option value="">Všechny hry</option>
        {GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <select className={sell.input} value={col.condition} aria-label="Stav" onChange={(e) => onChange({ ...col, condition: e.target.value as ShopCollection['condition'] })}>
        <option value="">Jakýkoli stav</option>
        {CONDITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <select className={sell.input} value={col.language} aria-label="Jazyk" onChange={(e) => onChange({ ...col, language: e.target.value as ShopCollection['language'] })}>
        <option value="">Jakýkoli jazyk</option>
        {(Object.keys(LANGUAGE_NAMES) as Language[]).map((x) => <option key={x} value={x}>{LANGUAGE_NAMES[x]}</option>)}
      </select>
      {actions}
    </div>
  );
}

function BlockSettings({ b, setData, uid, listings, listingById, cards, rememberCard }: {
  b: ShopBlock;
  setData: (d: ShopBlock['data']) => void;
  uid: string;
  listings: ListingOption[];
  listingById: Map<string, ListingOption>;
  cards: Map<string, PickerCard>;
  rememberCard: (c: PickerCard) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  switch (b.type) {
    case 'notice': {
      const n = b.data.notice ?? { title: '', text: '', until: '' };
      return (
        <div className={sell.form}>
          <Field label="NADPIS OZNÁMENÍ" wide><input className={sell.input} value={n.title} maxLength={120} onChange={(e) => setData({ notice: { ...n, title: e.target.value } })} /></Field>
          <Field label="TEXT" wide><textarea className={`${sell.input} ${styles.textareaSmall}`} value={n.text} maxLength={400} onChange={(e) => setData({ notice: { ...n, text: e.target.value } })} /></Field>
          <Field label="PLATÍ DO" hint="Po tomto dni se oznámení samo skryje"><input type="date" className={sell.input} value={n.until} onChange={(e) => setData({ notice: { ...n, until: e.target.value } })} /></Field>
        </div>
      );
    }
    case 'spotlight': {
      const s = b.data.spotlight ?? { listingId: '', story: '' };
      const l = listingById.get(s.listingId);
      return (
        <div className={styles.stack}>
          {l ? (
            <div className={styles.picked}>
              <span className={styles.pickText}><strong>{l.name}</strong><span className="code muted">{l.sub} · {formatNumber(l.price)} Kč</span></span>
              <RowActions onRemove={() => setData({ spotlight: { ...s, listingId: '' } })} />
            </div>
          ) : <ListingPicker listings={listings} selected={[]} max={1} onPick={(id) => setData({ spotlight: { ...s, listingId: id } })} />}
          <Field label="PŘÍBĚH KARTY" hint={`${s.story.length} / 500`}>
            <textarea className={`${sell.input} ${styles.textareaSmall}`} value={s.story} maxLength={500} onChange={(e) => setData({ spotlight: { ...s, story: e.target.value } })} />
          </Field>
        </div>
      );
    }
    case 'featured': {
      const ids = b.data.featured?.listingIds ?? [];
      return (
        <div className={styles.stack}>
          <div className={styles.rows}>
            {ids.map((id, i) => {
              const l = listingById.get(id);
              return (
                <div key={id} className={styles.picked}>
                  <span className={styles.pickText}><strong>{l?.name ?? 'Nabídka už není v prodeji'}</strong>{l ? <span className="code muted">{l.sub} · {formatNumber(l.price)} Kč</span> : null}</span>
                  <RowActions
                    onUp={i > 0 ? () => setData({ featured: { listingIds: move(ids, i, -1) } }) : undefined}
                    onDown={i < ids.length - 1 ? () => setData({ featured: { listingIds: move(ids, i, 1) } }) : undefined}
                    onRemove={() => setData({ featured: { listingIds: ids.filter((x) => x !== id) } })}
                  />
                </div>
              );
            })}
          </div>
          <span className="t-small muted">{ids.length} z 12 nabídek</span>
          <ListingPicker listings={listings} selected={ids} max={12} onPick={(id) => setData({ featured: { listingIds: [...ids, id] } })} />
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
            <div key={i} className={styles.inline}>
              <input type="date" className={sell.input} value={e.date} aria-label="Datum" onChange={(ev) => put(items.map((x, j) => (j === i ? { ...x, date: ev.target.value } : x)))} />
              <input className={sell.input} value={e.title} maxLength={100} placeholder="Název akce" aria-label="Název akce" onChange={(ev) => put(items.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))} />
              <input className={sell.input} value={e.info} maxLength={160} placeholder="Čas, startovné…" aria-label="Podrobnosti" onChange={(ev) => put(items.map((x, j) => (j === i ? { ...x, info: ev.target.value } : x)))} />
              <RowActions onRemove={() => put(items.filter((_, j) => j !== i))} />
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
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className={sell.file}
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
          ) : null}
          <span className="t-small muted">{busy ? 'Nahrávám…' : `${photos.length} z 8 fotek`}</span>
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
            <div key={i} className={styles.faqRow}>
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
              <div key={x.cardId} className={styles.inline}>
                <span className={styles.pickText}><strong>{card?.name ?? 'Karta'}</strong>{card ? <span className="code muted">{card.setCode} {card.number}</span> : null}</span>
                <input className={sell.input} value={x.grade} maxLength={20} placeholder="Grade, např. PSA 10" aria-label="Grade" onChange={(e) => put(items.map((y, j) => (j === i ? { ...y, grade: e.target.value } : y)))} />
                <input className={sell.input} value={x.note} maxLength={80} placeholder="Poznámka" aria-label="Poznámka" onChange={(e) => put(items.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
                <RowActions onRemove={() => put(items.filter((_, j) => j !== i))} />
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
          {items.map((x, i) => {
            const card = cards.get(x.cardId);
            return (
              <div key={x.cardId} className={styles.inline}>
                <span className={styles.pickText}><strong>{card?.name ?? 'Karta'}</strong>{card ? <span className="code muted">{card.setCode} {card.number}</span> : null}</span>
                <input type="number" min={1} className={sell.input} value={x.maxPrice ?? ''} placeholder="Do Kč (nepovinné)" aria-label="Nejvyšší cena" onChange={(e) => put(items.map((y, j) => (j === i ? { ...y, maxPrice: Math.round(Number(e.target.value)) || null } : y)))} />
                <RowActions onRemove={() => put(items.filter((_, j) => j !== i))} />
              </div>
            );
          })}
          {items.length < 20 ? <CardPicker onPick={(card) => { rememberCard(card); if (!items.some((y) => y.cardId === card.id)) put([...items, { cardId: card.id, maxPrice: null }]); }} /> : null}
        </div>
      );
    }
    default:
      return <p className="t-small muted">{b.type === 'collections' ? 'Kolekce nastavíte níže v části Vlastní kolekce.' : 'Plní se samo z vaší nabídky.'}</p>;
  }
}
