'use client';

// Editor vlastní stránky: vlevo nastavení v osmi částech, vpravo živý náhled celé stránky.
// Změny se průběžně ukládají jako koncept, kupující je uvidí až po „Zveřejnit změny“.
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, ButtonLink, Chip, SellerBadge, ShopDivider, shopStyle } from '@/components/trezor';
import { plural } from '@/lib/format';
import { GAMES } from '@/lib/games';
import { PLANS, type Plan } from '@/lib/plans';
import {
  allTabs, visibleTabs, BLOCKS, blockInfo, effectiveConfig, newBlock, shopHref, slugify,
  SHOP_BACKGROUNDS, SHOP_BANNERS, SHOP_COLORS, SHOP_DIVIDERS, SHOP_FONTS, SHOP_ICONS, SHOP_LAYOUTS, SHOP_TYPES, SLUG_RE, emptyCollection, COLLECTION_SORTS,
  type BlockInfo, type BlockType, type BlockWidth, type ShopBlock, type ShopCollection, type ShopDesign, type ShopPageConfig,
} from '@/lib/shop-config';
import { CONDITIONS, LANGUAGE_NAMES, type Language } from '@/lib/types';
import { discardDraft, saveDraft, saveShopPage, type PickerCard, type SaveState } from './actions';
import { BlockSettings } from './BlockSettings';
import {
  Field, Group, ImageInput, ListingPicker, PickedListings, ProTag, RowActions, Tiles, Toggle, move, rid, type ListingOption,
} from './editorParts';
import sell from '../../prodat/sell.module.css';
import styles from './editor.module.css';

export type { ListingOption } from './editorParts';

interface Props {
  uid: string;
  name: string;
  kind: 'shop' | 'private';
  plan: Plan;
  badge: boolean;
  /** Zveřejněná (uložená) verze */
  initial: ShopPageConfig;
  /** Rozpracovaný koncept, pokud nějaký je */
  draft: ShopPageConfig | null;
  listings: ListingOption[];
  cards: PickerCard[];
}

type SectionId = 'start' | 'brand' | 'header' | 'layout' | 'blocks' | 'tabs' | 'about' | 'publish';

const SECTIONS: { id: SectionId; icon: string; name: string; desc: string }[] = [
  { id: 'start', icon: '✓', name: 'Začínáme', desc: 'Co ještě vyplnit a hotové šablony' },
  { id: 'brand', icon: '◆', name: 'Značka a barvy', desc: 'Logo, barvy, režim, písmo' },
  { id: 'header', icon: '▭', name: 'Hlavička a banner', desc: 'Šablona, vzor, sezóna, běžící pruh' },
  { id: 'layout', icon: '▦', name: 'Rozvržení a styl', desc: 'Panel, pozadí, ikony, štítky, holo' },
  { id: 'blocks', icon: '≡', name: 'Bloky', desc: 'Obsah Přehledu, pořadí a šířka' },
  { id: 'tabs', icon: '⇆', name: 'Záložky a kolekce', desc: 'Lišta pod hlavičkou' },
  { id: 'about', icon: 'i', name: 'O nás a kontakt', desc: 'Texty, kontakty, prodejna' },
  { id: 'publish', icon: '🔗', name: 'Adresa a zveřejnění', desc: 'Vlastní adresa stránky' },
];

const GROUPS = [
  { id: 'all', name: 'Vše' },
  { id: 'offer', name: 'Nabídka' },
  { id: 'shop', name: 'Obchod' },
  { id: 'fun', name: 'Ozdoby' },
] as const;

const WIDTHS: { id: BlockWidth; name: string }[] = [
  { id: 'full', name: 'Celá šířka' },
  { id: 'half', name: 'Polovina' },
  { id: 'third', name: 'Třetina' },
];

const PREVIEW = '/ucet/stranka/nahled';

/** Kolik nastavení se liší od zveřejněné verze (pro „N nezveřejněných změn“). */
function countChanges(a: ShopPageConfig, b: ShopPageConfig): number {
  let n = 0;
  for (const k of Object.keys(a) as (keyof ShopPageConfig)[]) {
    if (k === 'design' || k === 'blocks') continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) n++;
  }
  for (const k of Object.keys(a.design) as (keyof ShopDesign)[]) {
    if (JSON.stringify(a.design[k]) !== JSON.stringify(b.design[k])) n++;
  }
  const before = new Map(b.blocks.map((x, i) => [x.id, { x, i }]));
  a.blocks.forEach((x, i) => {
    const old = before.get(x.id);
    if (!old || old.i !== i || JSON.stringify(old.x) !== JSON.stringify(x)) n++;
  });
  n += b.blocks.filter((x) => !a.blocks.some((y) => y.id === x.id)).length;
  return n;
}

export function ShopEditor({ uid, name, kind, plan, badge, initial, draft, listings, cards: initialCards }: Props) {
  const info = PLANS[plan];
  const pro = info.fullDesign;
  const locked = !pro;
  const [published, setPublished] = useState<ShopPageConfig>(initial);
  const [c, setCState] = useState<ShopPageConfig>(draft ?? initial);
  const cRef = useRef(c);
  const history = useRef<ShopPageConfig[]>([]);
  const lastPush = useRef(0);
  const [undoCount, setUndoCount] = useState(0);
  const [cards, setCards] = useState(() => new Map(initialCards.map((x) => [x.id, x])));
  const [section, setSection] = useState<SectionId | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>(draft ? 'saved' : 'idle');
  const [draftError, setDraftError] = useState('');
  const [msg, setMsg] = useState<SaveState>({});
  const [publishing, startPublish] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);
  const railBody = useRef<HTMLDivElement>(null);
  const listingById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const shown = effectiveConfig(c, plan);
  const changes = countChanges(c, published);

  /** Každá změna jde přes update: kvůli tlačítku Zpět (rychlé psaní se slučuje do jednoho kroku). */
  const update = useCallback((fn: (x: ShopPageConfig) => ShopPageConfig) => {
    const prev = cRef.current;
    const next = fn(prev);
    const now = Date.now();
    if (now - lastPush.current > 800) {
      history.current = [...history.current.slice(-49), prev];
      setUndoCount(history.current.length);
    }
    lastPush.current = now;
    cRef.current = next;
    setCState(next);
    setMsg({});
  }, []);
  const set = <K extends keyof ShopPageConfig>(key: K, value: ShopPageConfig[K]) => update((x) => ({ ...x, [key]: value }));
  const setDesign = (patch: Partial<ShopDesign>) => update((x) => ({ ...x, design: { ...x.design, ...patch } }));
  const updateBlock = (id: string, fn: (b: ShopBlock) => ShopBlock) => update((x) => ({ ...x, blocks: x.blocks.map((b) => (b.id === id ? fn(b) : b)) }));
  const setBlocks = (blocks: ShopBlock[]) => update((x) => ({ ...x, blocks }));
  const rememberCard = (card: PickerCard) => setCards((m) => new Map(m).set(card.id, card));

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    setUndoCount(history.current.length);
    lastPush.current = 0;
    cRef.current = prev;
    setCState(prev);
  };

  const reloadPreview = () => {
    const f = frame.current;
    if (!f) return;
    try {
      f.contentWindow?.location.reload();
    } catch {
      f.src = PREVIEW;
    }
  };

  // Koncept se uloží chvíli po poslední změně a náhled se znovu načte.
  const savedJson = useRef(JSON.stringify(draft ?? initial));
  const seq = useRef(0);
  useEffect(() => {
    if (!info.shopPage) return;
    const json = JSON.stringify(c);
    if (json === savedJson.current) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setDraftState('saving');
      const same = json === JSON.stringify(published);
      let r: SaveState;
      try {
        r = same ? await discardDraft() : await saveDraft(json);
      } catch {
        r = { error: 'Koncept se nepodařilo uložit. Zkontrolujte připojení.' };
      }
      if (n !== seq.current) return;
      if (r.error) {
        setDraftState('error');
        setDraftError(r.error);
      } else {
        savedJson.current = json;
        setDraftState(same ? 'idle' : 'saved');
        reloadPreview();
      }
    }, 700);
    return () => clearTimeout(t);
    // published se mění jen se zveřejněním, kdy se c nemění
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  const goTo = useCallback((s: string) => {
    setSection(s as SectionId);
    setAdding(false);
    setPane('edit');
    railBody.current?.scrollTo({ top: 0 });
  }, []);

  /** Blok přetažený v náhledu: nad, pod, nebo vedle jiného bloku (vedle = oba na polovinu, jen Pro). */
  const moveBlock = useCallback((id: string, target: string, pos: string) => {
    update((x) => {
      const moving = x.blocks.find((b) => b.id === id);
      if (!moving || id === target || !x.blocks.some((b) => b.id === target)) return x;
      const side = (pos === 'left' || pos === 'right') && pro;
      const rest = x.blocks.filter((b) => b.id !== id);
      const at = rest.findIndex((b) => b.id === target);
      const after = pos === 'after' || pos === 'right';
      const tw = rest[at].width === 'full' ? 'half' : rest[at].width;
      const moved = side ? { ...moving, width: tw } : moving;
      const next = rest.map((b, i) => (side && i === at ? { ...b, width: tw } : b));
      next.splice(after ? at + 1 : at, 0, moved);
      return { ...x, blocks: next };
    });
  }, [update, pro]);

  // Klik na část náhledu otevře její nastavení, přetažení bloku ho přesune.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'v4-shop-move') {
        moveBlock(String(e.data.id ?? ''), String(e.data.target ?? ''), String(e.data.pos ?? ''));
        return;
      }
      if (e.data?.type !== 'v4-shop-edit') return;
      const target = String(e.data.target ?? '');
      if (target.startsWith('block:')) {
        setSection('blocks');
        setAdding(false);
        setOpenBlock(target.slice(6));
        setPane('edit');
      } else if (target === 'header') goTo('header');
      else if (target === 'about') goTo('about');
      else if (target === 'tabs') goTo('tabs');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [goTo, moveBlock]);

  useEffect(() => {
    // Posouvá jen levý panel, ne celou stránku.
    const el = section === 'blocks' && openBlock ? document.getElementById(`blk-${openBlock}`) : null;
    if (el && railBody.current) railBody.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  }, [section, openBlock]);

  // Ctrl+Z mimo textová pole = Zpět.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const publish = () => startPublish(async () => {
    const r = await saveShopPage(JSON.stringify(c));
    setMsg(r);
    if (r.ok) {
      setPublished(c);
      savedJson.current = JSON.stringify(c);
      setDraftState('idle');
    } else if (r.error?.includes('adres')) {
      goTo('publish');
    }
  });

  const discard = () => {
    if (!window.confirm('Zahodit všechny nezveřejněné změny a vrátit se ke zveřejněné verzi?')) return;
    update(() => published);
  };

  const publicHref = info.shopPage && published.slug && SLUG_RE.test(published.slug) ? shopHref(kind, published.slug) : `/prodejci/${uid}`;

  // Zdarma: jen základní profil.
  if (!info.shopPage) {
    const save = () => startPublish(async () => setMsg(await saveShopPage(JSON.stringify(c))));
    return (
      <div className={`container section ${styles.simple}`}>
        <div>
          <p className="t-small"><Link href="/ucet">← Účet</Link></p>
          <h1 className="t-heading-l">Moje stránka</h1>
        </div>
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h2 className="t-heading-m">Základní profil</h2>
          <p className="muted">V tarifu Zdarma máte základní profil s obrázkem, popisem a celou nabídkou. Vlastní stránku s bannerem, barvami, bloky a vlastní adresou dostanete v tarifu Plus nebo Pro.</p>
          <ImageInput label="PROFILOVÝ OBRÁZEK" path={c.logoPath} onPath={(p) => set('logoPath', p)} uid={uid} prefix="logo" round />
          <Field label={kind === 'shop' ? 'O NÁS' : 'O MNĚ'} hint={`${c.about.length} / 1500`}>
            <textarea className={`${sell.input} ${styles.textarea}`} value={c.about} maxLength={1500} onChange={(e) => set('about', e.target.value)} />
          </Field>
        </section>
        <div className={styles.saveBar}>
          <Button onClick={save} disabled={publishing}>{publishing ? 'Ukládám…' : 'Uložit profil'}</Button>
          <Link href={`/prodejci/${uid}`}>Zobrazit profil</Link>
          {msg.error ? <p className={sell.error} role="alert">{msg.error}</p> : null}
          {msg.ok ? <p className={sell.ok} role="status">Uloženo.</p> : null}
        </div>
      </div>
    );
  }

  // ---------- Části nastavení ----------

  const checklist: { done: boolean; label: string; to: SectionId }[] = [
    { done: !!c.logoPath, label: 'Nahrajte logo', to: 'brand' },
    { done: !!c.tagline, label: 'Napište podtitul pod jméno', to: 'header' },
    { done: c.blocks.some((b) => b.enabled), label: 'Přidejte bloky na Přehled', to: 'blocks' },
    { done: !!(c.about || Object.values(c.contact).some(Boolean)), label: 'Vyplňte O nás a kontakt', to: 'about' },
    { done: !!c.slug && SLUG_RE.test(c.slug), label: 'Vyberte adresu stránky', to: 'publish' },
    { done: published.published, label: 'Zveřejněte stránku', to: 'publish' },
  ];

  const startSection = (
    <div className={styles.stack}>
      <div className={styles.progress}>
        <span className="t-label muted">HOTOVO {checklist.filter((x) => x.done).length} Z {checklist.length}</span>
        <span className={styles.progressBar}><span style={{ width: `${(checklist.filter((x) => x.done).length / checklist.length) * 100}%` }} /></span>
      </div>
      <div className={styles.rows}>
        {checklist.map((x) => (
          <button key={x.label} type="button" className={styles.step} data-done={x.done} onClick={() => goTo(x.to)}>
            <span className={styles.stepDot} aria-hidden="true">{x.done ? '✓' : ''}</span>
            <span>{x.label}</span>
            <span className="muted" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      <Group label="TYP OBCHODU" hint="Ukáže se kupujícím v hlavičce stránky.">
        <div className={styles.chips}>
          {SHOP_TYPES.map((t) => <Chip key={t.id || 'none'} selected={c.design.shopType === t.id} onClick={() => setDesign({ shopType: t.id })}>{t.name}</Chip>)}
        </div>
      </Group>
      <p className="t-small muted" style={{ margin: 0 }}>
        Tip: klikněte v náhledu vpravo na kteroukoli část stránky a otevře se její nastavení.
      </p>
    </div>
  );

  const swatches = (value: string, onPick: (id: string) => void, none?: boolean) => (
    <div className={styles.swatches}>
      {none ? <button type="button" className={`${styles.swatch} ${styles.swatchNone}`} aria-pressed={!value} aria-label="Žádná" title="Žádná" onClick={() => onPick('')} /> : null}
      {SHOP_COLORS.map((x) => (
        <button key={x.id} type="button" className={styles.swatch} style={{ background: `var(--shop-${x.id})` }} aria-pressed={value === x.id} aria-label={x.name} title={x.name} onClick={() => onPick(x.id)} />
      ))}
    </div>
  );

  const brandSection = (
    <div className={styles.stack}>
      <ImageInput label="LOGO" path={c.logoPath} onPath={(p) => set('logoPath', p)} uid={uid} prefix="logo" round={c.design.logo === 'round'} />
      <Group label="TVAR LOGA">
        <div className={styles.chips}>
          <Chip selected={c.design.logo === 'square'} onClick={() => setDesign({ logo: 'square' })}>Čtvercové</Chip>
          <Chip selected={c.design.logo === 'round'} onClick={() => setDesign({ logo: 'round' })}>Kulaté</Chip>
        </div>
      </Group>
      <Group label="HLAVNÍ BARVA" hint="Barví banner, tlačítka, záložky a nadpisy.">
        {swatches(c.design.color, (id) => setDesign({ color: id as ShopDesign['color'] }))}
      </Group>
      <Group label="DRUHÁ BARVA" pro locked={locked} hint="Doplňková barva do vzorů banneru, štítků a oddělovačů.">
        {swatches(c.design.color2, (id) => setDesign({ color2: id as ShopDesign['color2'] }), true)}
      </Group>
      <Group label="REŽIM">
        <div className={styles.chips}>
          <Chip selected={c.design.mode === 'dark'} onClick={() => setDesign({ mode: 'dark' })}>Tmavý</Chip>
          <Chip selected={c.design.mode === 'light'} onClick={() => setDesign({ mode: 'light' })}>Světlý</Chip>
        </div>
      </Group>
      <Group label="PÍSMO NADPISŮ" pro locked={locked}>
        <div className={styles.chips}>
          {SHOP_FONTS.map((x) => <Chip key={x.id} selected={c.design.font === x.id} onClick={() => setDesign({ font: x.id })}><span style={{ fontFamily: x.family }}>{x.name}</span></Chip>)}
        </div>
      </Group>
      <Group label="ROHY" pro locked={locked}>
        <div className={styles.chips}>
          <Chip selected={c.design.corners === 'round'} onClick={() => setDesign({ corners: 'round' })}>Zaoblené</Chip>
          <Chip selected={c.design.corners === 'sharp'} onClick={() => setDesign({ corners: 'sharp' })}>Ostré</Chip>
        </div>
      </Group>
    </div>
  );

  const shopVars = { ...shopStyle(c.design.color), ...(c.design.color2 ? { '--shop-2': `var(--shop-${c.design.color2})` } : {}) } as React.CSSProperties;

  const headerSection = (
    <div className={styles.stack}>
      <Field label="PODTITUL" hint={`${c.tagline.length} / 160 · pod jménem v hlavičce`}>
        <input className={sell.input} value={c.tagline} maxLength={160} onChange={(e) => set('tagline', e.target.value)} placeholder="Např. Pokémon a Magic od roku 2015" />
      </Field>
      <Group label="ŠABLONA HLAVIČKY" pro locked={locked}>
        <Tiles options={SHOP_LAYOUTS} value={c.design.layout} onChange={(layout) => setDesign({ layout })} cols={2} render={(id) => <span className={styles.layoutArt} data-layout={id}><i /><b /><s /></span>} />
      </Group>
      <Group label="BANNER" hint="Vzory se barví podle barev obchodu.">
        <div className="tz-shop" style={shopVars}>
          <Tiles
            options={SHOP_BANNERS.filter((x) => x.id !== 'photo')}
            value={c.design.banner}
            onChange={(banner) => setDesign({ banner })}
            locked={locked}
            render={(id) => <span className={`tz-shop-banner tz-shop-banner-${id} ${styles.bannerSample}`} />}
          />
        </div>
      </Group>
      <ImageInput
        label="VLASTNÍ OBRÁZEK BANNERU"
        path={c.bannerPath}
        onPath={(path) => update((x) => ({ ...x, bannerPath: path, design: { ...x.design, banner: path ? 'photo' : x.design.banner === 'photo' ? 'pattern' : x.design.banner } }))}
        uid={uid}
        prefix="banner"
        wide
      />
      {c.bannerPath && c.design.banner !== 'photo' ? <Button variant="secondary" onClick={() => setDesign({ banner: 'photo' })}>Použít vlastní obrázek</Button> : null}
      <Toggle checked={c.design.liveBanner} onChange={(liveBanner) => setDesign({ liveBanner })} hint={<>Vzor banneru se pomalu posouvá. Jen u vzorů, ne u obrázku.{locked ? <ProTag /> : null}</>}>Živý banner</Toggle>
      <Field label="BĚŽÍCÍ PRUH" hint="Jedna krátká zpráva nad hlavičkou, opakuje se pořád dokola. Prázdná = pruh se neukáže.">
        <input className={sell.input} value={c.design.ticker} maxLength={80} placeholder="Např. Nová sada Surging Sparks skladem" onChange={(e) => setDesign({ ticker: e.target.value })} />
      </Field>
    </div>
  );

  const layoutSection = (
    <div className={styles.stack}>
      <Group label="POSTRANNÍ PANEL NA PŘEHLEDU" hint="Panel s O nás, prodejnou a kontaktem. Na mobilu je vždy pod obsahem.">
        <Tiles
          options={[{ id: 'right', name: 'Vpravo' }, { id: 'left', name: 'Vlevo' }, { id: 'none', name: 'Bez panelu' }] as const}
          value={c.design.sidebar}
          onChange={(sidebar) => setDesign({ sidebar })}
          cols={3}
          render={(id) => <span className={styles.sideArt} data-side={id}><i /><b /></span>}
        />
      </Group>
      <Toggle checked={c.design.stickyTabs} onChange={(stickyTabs) => setDesign({ stickyTabs })} hint="Při posouvání zůstanou záložky nahoře.">Záložky drží nahoře</Toggle>
      <Group label="POZADÍ STRÁNKY">
        <div className="tz-shop" style={shopVars}>
          <Tiles options={SHOP_BACKGROUNDS} value={c.design.background} onChange={(background) => setDesign({ background })} cols={3} render={(id) => <span className={`tz-shop-bg ${styles.bgSample}`} data-bg={id === 'none' ? undefined : id} />} />
        </div>
      </Group>
      <Group label="IKONA U NADPISŮ">
        <div className={styles.chips}>
          {SHOP_ICONS.map((x) => <Chip key={x.id} selected={c.design.icon === x.id} onClick={() => setDesign({ icon: x.id })}>{x.name}</Chip>)}
        </div>
      </Group>
      <Group label="ODDĚLOVAČE MEZI BLOKY">
        <div className="tz-shop" style={shopVars}>
          <Tiles options={SHOP_DIVIDERS} value={c.design.divider} onChange={(divider) => setDesign({ divider })} cols={3} render={(id) => <span className={styles.dividerSample}>{id === 'none' ? <span className="t-small muted">—</span> : <ShopDivider style={id} />}</span>} />
        </div>
      </Group>
      <Toggle checked={c.design.tagsAuto} onChange={(tagsAuto) => setDesign({ tagsAuto })} hint="Novinka = přidáno za posledních 7 dní, Poslední kus = poslední kus skladem.">Štítky Novinka a Poslední kus</Toggle>
      <Field label="VLASTNÍ ŠTÍTEK" hint="Např. Top, Sleva, Doporučujeme. Dáte ho na vybrané nabídky níže.">
        <input className={sell.input} value={c.design.customTag} maxLength={20} placeholder="Název štítku" onChange={(e) => setDesign({ customTag: e.target.value })} />
      </Field>
      {c.design.customTag ? (
        <>
          <PickedListings ids={c.design.customTagIds} onChange={(customTagIds) => setDesign({ customTagIds })} listingById={listingById} />
          <ListingPicker listings={listings} selected={c.design.customTagIds} max={24} onPick={(id) => setDesign({ customTagIds: [...c.design.customTagIds, id] })} />
        </>
      ) : null}
      <Toggle checked={c.design.holo} onChange={(holo) => setDesign({ holo })} hint={<>Karty se natáčí za myší a lesknou se jako holo.{locked ? <ProTag /> : null}</>}>Holo lesk na kartách</Toggle>
    </div>
  );

  const activeBlocks = c.blocks.filter((b) => b.enabled && (info.proBlocks || !blockInfo(b.type)?.pro)).length;
  const blocksSection = adding ? (
    <BlockGallery
      locked={!info.proBlocks}
      onPick={(type) => {
        const b = newBlock(type);
        setBlocks(type === 'window' ? [b, ...c.blocks] : [...c.blocks, b]);
        setOpenBlock(b.id);
        setAdding(false);
      }}
      onClose={() => setAdding(false)}
    />
  ) : (
    <div className={styles.stack}>
      <p className="t-small muted" style={{ margin: 0 }}>
        Na Přehledu {Math.min(activeBlocks, info.maxBlocks)} z {pro ? 'neomezeně' : info.maxBlocks} bloků · Celá nabídka je vždy na konci. Pořadí změníte přetažením nebo šipkami.
      </p>
      <BlockList
        blocks={c.blocks}
        shown={shown.blocks}
        info={info}
        openBlock={openBlock}
        setOpenBlock={setOpenBlock}
        setBlocks={setBlocks}
        updateBlock={updateBlock}
        renderSettings={(b) => (
          <BlockSettings
            b={b}
            setData={(d) => updateBlock(b.id, (x) => ({ ...x, data: { ...x.data, ...d } }))}
            uid={uid}
            listings={listings}
            listingById={listingById}
            cards={cards}
            rememberCard={rememberCard}
            storeAddress={c.store.address}
            setStoreAddress={(address) => set('store', { ...c.store, address })}
            goTo={goTo}
          />
        )}
      />
      <Button onClick={() => setAdding(true)} disabled={c.blocks.length >= 40}>+ Přidat blok</Button>
    </div>
  );

  const tabsSection = <TabsEditor c={c} locked={!info.proBlocks} setDesign={setDesign} setCollections={(cols) => set('collections', cols)} listings={listings} listingById={listingById} />;

  const aboutSection = (
    <div className={styles.stack}>
      <Field label={kind === 'shop' ? 'O NÁS' : 'O MNĚ'} hint={`${c.about.length} / 1500`}>
        <textarea className={`${sell.input} ${styles.textarea}`} value={c.about} maxLength={1500} onChange={(e) => set('about', e.target.value)} />
      </Field>
      <Field label="VZKAZ U NABÍDEK" pro locked={locked} hint={`${c.offerNote.length} / 100 · pod vaším jménem u nabídek na detailu karty`}>
        <input className={sell.input} value={c.offerNote} maxLength={100} onChange={(e) => set('offerNote', e.target.value)} placeholder="Např. Odesíláme do 24 hodin" />
      </Field>
      <h3 className={styles.subhead}>Kontakt</h3>
      {([['web', 'WEB'], ['instagram', 'INSTAGRAM'], ['facebook', 'FACEBOOK'], ['discord', 'DISCORD'], ['email', 'E-MAIL'], ['phone', 'TELEFON']] as const).map(([k, label]) => (
        <Field key={k} label={label}>
          <input className={sell.input} value={c.contact[k]} maxLength={k === 'phone' ? 30 : 120} onChange={(e) => set('contact', { ...c.contact, [k]: e.target.value })} />
        </Field>
      ))}
      {kind === 'shop' ? (
        <>
          <h3 className={styles.subhead}>Kamenná prodejna</h3>
          <Field label="ADRESA" hint="Ukáže se v panelu a v bloku Mapa prodejny.">
            <textarea className={`${sell.input} ${styles.textareaSmall}`} value={c.store.address} maxLength={200} onChange={(e) => set('store', { ...c.store, address: e.target.value })} />
          </Field>
          <Toggle checked={c.store.pickup} onChange={(pickup) => set('store', { ...c.store, pickup })}>Osobní odběr objednávek v prodejně</Toggle>
          <Group label="OTEVÍRACÍ DOBA">
            <div className={styles.rows}>
              {c.store.hours.map((h, i) => (
                <div key={i} className={styles.inline}>
                  <input className={`${sell.input} ${styles.narrow}`} value={h.day} maxLength={20} placeholder="Po–Pá" aria-label="Dny" onChange={(e) => set('store', { ...c.store, hours: c.store.hours.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)) })} />
                  <input className={sell.input} value={h.time} maxLength={40} placeholder="10:00–18:00" aria-label="Čas" onChange={(e) => set('store', { ...c.store, hours: c.store.hours.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })} />
                  <RowActions onRemove={() => set('store', { ...c.store, hours: c.store.hours.filter((_, j) => j !== i) })} />
                </div>
              ))}
            </div>
            {c.store.hours.length < 7 ? <div><Button variant="secondary" onClick={() => set('store', { ...c.store, hours: [...c.store.hours, { day: '', time: '' }] })}>Přidat řádek</Button></div> : null}
          </Group>
        </>
      ) : null}
    </div>
  );

  const publishSection = (
    <div className={styles.stack}>
      <Field label="ADRESA STRÁNKY" hint={c.slug && !SLUG_RE.test(c.slug) ? '3 až 40 znaků: malá písmena bez diakritiky, číslice a pomlčky.' : `v4cards.com${shopHref(kind, c.slug || '…')}`}>
        <div className={styles.inline}>
          <span className="code muted">{shopHref(kind, '')}</span>
          <input className={sell.input} value={c.slug} maxLength={40} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder={slugify(name)} />
        </div>
      </Field>
      {!c.slug ? <div><Button variant="secondary" onClick={() => set('slug', slugify(name))}>Použít název „{slugify(name)}“</Button></div> : null}
      <Toggle checked={c.published} onChange={(v) => set('published', v)} hint="Dokud není zveřejněná, vidíte ji jen vy a kupující dostanou základní profil. Změna se projeví po Zveřejnit změny.">
        Stránka je zveřejněná
      </Toggle>
      <p className="t-small" style={{ margin: 0 }}><Link href={publicHref} target="_blank">Otevřít zveřejněnou stránku ↗</Link></p>
      <p className="t-small muted" style={{ margin: 0 }}>
        Tarif {info.name}. {pro ? 'Máte všechny šablony, písma a bloky.' : <>Volby se štítkem <SellerBadge type="pro" /> uložit můžete, ukážou se po přechodu na Pro.</>}
      </p>
    </div>
  );

  const content: Record<SectionId, ReactNode> = {
    start: startSection, brand: brandSection, header: headerSection, layout: layoutSection,
    blocks: blocksSection, tabs: tabsSection, about: aboutSection, publish: publishSection,
  };

  const summary: Record<SectionId, string> = {
    start: `${checklist.filter((x) => x.done).length} z ${checklist.length} hotovo`,
    brand: `${SHOP_COLORS.find((x) => x.id === c.design.color)?.name} · ${c.design.mode === 'light' ? 'světlý' : 'tmavý'}`,
    header: SHOP_BANNERS.find((x) => x.id === c.design.banner)?.name ?? '',
    layout: c.design.sidebar === 'none' ? 'Bez panelu' : `Panel ${c.design.sidebar === 'left' ? 'vlevo' : 'vpravo'}`,
    blocks: plural(c.blocks.filter((b) => b.enabled).length, ['blok', 'bloky', 'bloků']),
    tabs: plural(visibleTabs(shown).length + 1, ['záložka', 'záložky', 'záložek']),
    about: c.about ? 'Vyplněno' : 'Zatím prázdné',
    publish: published.published ? 'Zveřejněno' : 'Nezveřejněno',
  };

  const current = SECTIONS.find((s) => s.id === section);
  const status = draftState === 'saving' ? 'Ukládám koncept…'
    : draftState === 'error' ? draftError
    : changes ? `Koncept uložen · ${plural(changes, ['nezveřejněná změna', 'nezveřejněné změny', 'nezveřejněných změn'])}`
    : published.published ? 'Vše je zveřejněné' : 'Stránka zatím není zveřejněná';

  return (
    <div className={styles.app} data-pane={pane}>
      <div className={styles.top}>
        <Link href="/ucet" className={styles.back}>← Účet</Link>
        <h1 className={styles.title}>Moje stránka</h1>
        <span className={styles.status} data-state={draftState === 'error' ? 'error' : changes ? 'dirty' : 'clean'} role="status">
          <span aria-hidden="true">●</span> {status}
        </span>
        <span className={styles.topSpacer} />
        <div className={`${styles.seg} ${styles.deviceSwitch}`} role="group" aria-label="Velikost náhledu">
          <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>Počítač</button>
          <button type="button" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>Mobil</button>
        </div>
        <div className={`${styles.seg} ${styles.paneSwitch}`} role="group" aria-label="Zobrazit">
          <button type="button" aria-pressed={pane === 'edit'} onClick={() => setPane('edit')}>Nastavení</button>
          <button type="button" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>Náhled</button>
        </div>
        <Button variant="ghost" onClick={undo} disabled={!undoCount} title="Vrátit poslední změnu (Ctrl+Z)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
          Zpět
        </Button>
        <ButtonLink href={publicHref} target="_blank" variant="secondary" title="Otevře stránku tak, jak ji vidí kupující">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
          Zobrazit stránku
        </ButtonLink>
        <Button variant="ghost" onClick={discard} disabled={!changes}>Zahodit změny</Button>
        <Button onClick={publish} disabled={publishing || !changes}>
          {publishing ? 'Zveřejňuji…' : 'Zveřejnit změny'}
        </Button>
      </div>
      {msg.error ? <p className={`${sell.error} ${styles.topMsg}`} role="alert">{msg.error}</p> : null}
      {msg.ok ? (
        <p className={`${sell.ok} ${styles.topMsg}`} role="status">
          Zveřejněno. {msg.href ? <Link href={msg.href} target="_blank">Otevřít stránku ↗</Link> : null}
        </p>
      ) : null}

      <div className={styles.body}>
        <aside className={styles.rail} aria-label="Nastavení stránky">
          {current ? (
            <div className={styles.railHead}>
              <button type="button" className={styles.backButton} onClick={() => { setSection(null); setAdding(false); }}>← Všechny části</button>
              <h2 className="t-heading-m" style={{ margin: 0 }}>{current.name}</h2>
            </div>
          ) : null}
          <div className={styles.railBody} ref={railBody}>
            {current ? content[current.id] : (
              <nav className={styles.nav}>
                {SECTIONS.map((s) => (
                  <button key={s.id} type="button" className={styles.navItem} onClick={() => goTo(s.id)}>
                    <span className={styles.navIcon} aria-hidden="true">{s.icon}</span>
                    <span className={styles.navText}>
                      <strong>{s.name}</strong>
                      <span className="t-small muted">{s.desc}</span>
                    </span>
                    <span className={styles.navSummary}>{summary[s.id]}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        </aside>
        <div className={styles.stage}>
          <div className={styles.frameWrap} data-device={device}>
            <iframe ref={frame} src={PREVIEW} title="Náhled stránky" className={styles.frame} />
          </div>
          <p className="t-small muted" style={{ margin: 0, textAlign: 'center' }}>Náhled konceptu tak, jak ho uvidí kupující. Klikněte na část stránky a upravte ji.</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Bloky ----------

function BlockList({ blocks, shown, info, openBlock, setOpenBlock, setBlocks, updateBlock, renderSettings }: {
  blocks: ShopBlock[];
  shown: ShopBlock[];
  info: (typeof PLANS)[Plan];
  openBlock: string | null;
  setOpenBlock: (id: string | null) => void;
  setBlocks: (b: ShopBlock[]) => void;
  updateBlock: (id: string, fn: (b: ShopBlock) => ShopBlock) => void;
  renderSettings: (b: ShopBlock) => ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  if (!blocks.length) return <p className="muted">Zatím žádné bloky. Přidejte první, nebo použijte šablonu v části Začínáme.</p>;
  return (
    <div className={styles.blockList}>
      {blocks.map((b, i) => {
        const bi = blockInfo(b.type)!;
        const lockedBlock = bi.pro && !info.proBlocks;
        const overLimit = b.enabled && !lockedBlock && !shown.some((x) => x.id === b.id);
        const open = openBlock === b.id;
        return (
          <div
            key={b.id}
            id={`blk-${b.id}`}
            className={styles.blockItem}
            data-open={open}
            data-off={!b.enabled || lockedBlock}
            data-over={over === i && drag !== null && drag !== i}
            onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i); } }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null && drag !== i) {
                const next = [...blocks];
                const [x] = next.splice(drag, 1);
                next.splice(i, 0, x);
                setBlocks(next);
              }
              setDrag(null);
              setOver(null);
            }}
          >
            <div className={styles.blockRow}>
              <span
                className={styles.grip}
                draggable
                onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                title="Přetáhněte pro změnu pořadí"
                aria-hidden="true"
              >⋮⋮</span>
              <button type="button" className={styles.blockMain} onClick={() => setOpenBlock(open ? null : b.id)} aria-expanded={open}>
                <span aria-hidden="true">{bi.emoji}</span>
                <span className={styles.blockName}>
                  <strong>{b.title || bi.name}</strong>
                  <span className="t-small muted">
                    {lockedBlock ? 'Ukáže se s tarifem Pro' : overLimit ? 'Nad limit bloků, neukáže se' : !b.enabled ? 'Skrytý' : b.title ? bi.name : bi.desc}
                  </span>
                </span>
                {b.width !== 'full' && info.fullDesign ? <span className={styles.widthTag}>{b.width === 'half' ? '½' : '⅓'}</span> : null}
                {bi.pro ? <SellerBadge type="pro" /> : null}
              </button>
              <label className={styles.miniSwitch} title={b.enabled ? 'Skrýt blok' : 'Ukázat blok'}>
                <input type="checkbox" role="switch" checked={b.enabled} aria-label={b.enabled ? 'Blok je vidět' : 'Blok je skrytý'} onChange={(e) => updateBlock(b.id, (x) => ({ ...x, enabled: e.target.checked }))} />
              </label>
              <RowActions
                onUp={i > 0 ? () => setBlocks(move(blocks, i, -1)) : undefined}
                onDown={i < blocks.length - 1 ? () => setBlocks(move(blocks, i, 1)) : undefined}
              />
            </div>
            {open ? (
              <div className={styles.blockBody}>
                <Field label="NADPIS BLOKU">
                  <input className={sell.input} value={b.title} maxLength={60} placeholder={bi.name} onChange={(e) => updateBlock(b.id, (x) => ({ ...x, title: e.target.value }))} />
                </Field>
                {bi.variants.length > 1 ? (
                  <Group label="VZHLED">
                    <div className={styles.chips}>
                      {bi.variants.map((v) => <Chip key={v.id} selected={b.variant === v.id} onClick={() => updateBlock(b.id, (x) => ({ ...x, variant: v.id }))}>{v.name}</Chip>)}
                    </div>
                  </Group>
                ) : null}
                <Group label="ŠÍŘKA" pro locked={!info.fullDesign} hint="Dva bloky Polovina nebo tři Třetina vedle sebe se postaví do řady. Na mobilu jsou vždy pod sebou.">
                  <div className={styles.chips}>
                    {WIDTHS.map((w) => <Chip key={w.id} selected={b.width === w.id} onClick={() => updateBlock(b.id, (x) => ({ ...x, width: w.id }))}>{w.name}</Chip>)}
                  </div>
                </Group>
                {renderSettings(b)}
                <div className={styles.blockFoot}>
                  <button type="button" className={styles.dangerLink} onClick={() => { setBlocks(blocks.filter((x) => x.id !== b.id)); setOpenBlock(null); }}>Odebrat blok</button>
                  <Button variant="secondary" onClick={() => setOpenBlock(null)}>Hotovo</Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function BlockGallery({ locked, onPick, onClose }: { locked: boolean; onPick: (t: BlockType) => void; onClose: () => void }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('all');
  const list: BlockInfo[] = BLOCKS.filter((b) => group === 'all' || b.group === group);
  return (
    <div className={styles.stack}>
      <div className={styles.inline}>
        <strong style={{ flex: 1 }}>Přidat blok</strong>
        <button type="button" className={styles.linkButton} onClick={onClose}>Zrušit</button>
      </div>
      <div className={styles.chips}>
        {GROUPS.map((g) => <Chip key={g.id} selected={group === g.id} onClick={() => setGroup(g.id)}>{g.name}</Chip>)}
      </div>
      <div className={styles.gallery}>
        {list.map((b) => (
          <button key={b.type} type="button" className={styles.galleryItem} onClick={() => onPick(b.type)}>
            <span className={styles.galleryEmoji} aria-hidden="true">{b.emoji}</span>
            <strong>{b.name}{b.pro && locked ? <ProTag /> : null}</strong>
            <span className="t-small muted">{b.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Záložky a kolekce ----------

/** Záložky pod hlavičkou: Přehled je vždy první, ostatní jde přeřadit a skrýt. Kolekce = uložené výběry skladu. */
function TabsEditor({ c, locked, setDesign, setCollections, listings, listingById }: {
  c: ShopPageConfig;
  listings: ListingOption[];
  listingById: Map<string, ListingOption>;
  locked: boolean;
  setDesign: (patch: Partial<ShopDesign>) => void;
  setCollections: (cols: ShopCollection[]) => void;
}) {
  const tabs = allTabs(c);
  const order = tabs.map((t) => t.id);
  const visible = visibleTabs(c).map((t) => t.id);
  return (
    <div className={styles.stack}>
      <p className="t-small muted" style={{ margin: 0 }}>Lišta pod hlavičkou. Každá záložka otevře vlastní pohled: Celá nabídka celý sklad, O nás texty a kontakt, kolekce svůj výběr.</p>
      <div className={styles.rows}>
        <div className={styles.picked}>
          <span className={styles.pickText}><strong>Přehled</strong><span className="t-small muted">Vždy první, bloky stránky</span></span>
        </div>
        {tabs.map((t, i) => {
          const hidden = c.design.hiddenTabs.includes(t.id);
          const empty = !hidden && !visible.includes(t.id);
          return (
            <div key={t.id} className={styles.picked}>
              <label className={styles.check}>
                <input type="checkbox" checked={!hidden} onChange={(e) => setDesign({ hiddenTabs: e.target.checked ? c.design.hiddenTabs.filter((x) => x !== t.id) : [...c.design.hiddenTabs, t.id] })} />
                <span className={styles.pickText}>
                  <strong>{t.label || 'Kolekce bez názvu'}</strong>
                  {empty ? <span className="t-small muted">Neukáže se, vyplňte O nás, kontakt nebo prodejnu</span> : null}
                  {t.id.startsWith('c:') ? <span className="t-small muted">Vlastní kolekce</span> : null}
                </span>
              </label>
              <RowActions
                onUp={i > 0 ? () => setDesign({ tabs: move(order, i, -1) }) : undefined}
                onDown={i < tabs.length - 1 ? () => setDesign({ tabs: move(order, i, 1) }) : undefined}
              />
            </div>
          );
        })}
      </div>
      <h3 className={styles.subhead}>Vlastní kolekce {locked ? <ProTag /> : null}</h3>
      <p className="t-small muted" style={{ margin: 0 }}>Uložené výběry skladu, třeba „Do 100 Kč“ nebo „Japonské karty“. Ukážou se jako záložky a v bloku Vlastní kolekce.</p>
      <div className={styles.rows}>
        {c.collections.map((col, i) => (
          <div key={col.id} className={styles.card}>
            <div className={styles.inline}>
              <input className={sell.input} value={col.name} maxLength={40} placeholder="Název, např. Do 100 Kč" aria-label="Název kolekce" onChange={(e) => setCollections(c.collections.map((x) => (x.id === col.id ? { ...col, name: e.target.value } : x)))} />
              <RowActions
                onUp={i > 0 ? () => setCollections(move(c.collections, i, -1)) : undefined}
                onDown={i < c.collections.length - 1 ? () => setCollections(move(c.collections, i, 1)) : undefined}
                onRemove={() => setCollections(c.collections.filter((x) => x.id !== col.id))}
              />
            </div>
            <CollectionFilters col={col} listings={listings} listingById={listingById} onChange={(next) => setCollections(c.collections.map((x) => (x.id === col.id ? next : x)))} />
          </div>
        ))}
      </div>
      {c.collections.length < 20 ? (
        <div><Button variant="secondary" onClick={() => setCollections([...c.collections, emptyCollection(rid())])}>Přidat kolekci</Button></div>
      ) : null}
    </div>
  );
}

function CollectionFilters({ col, onChange, listings, listingById }: {
  col: ShopCollection;
  onChange: (c: ShopCollection) => void;
  listings: ListingOption[];
  listingById: Map<string, ListingOption>;
}) {
  const [manual, setManual] = useState(col.listingIds.length > 0);
  // Sady jen z vlastních nabídek (a jen vybrané hry), seřazené podle názvu.
  const sets = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of listings) if (l.setCode && (!col.game || l.game === col.game)) m.set(l.setCode, l.setName || l.setCode);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'cs'));
  }, [listings, col.game]);
  const price = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))) || 0);
  const matching = useMemo(() => {
    if (manual) return null;
    const t = col.q.trim().toLowerCase();
    return listings.filter((l) => (!t || l.name.toLowerCase().includes(t))
      && (!col.game || l.game === col.game) && (!col.set || l.setCode === col.set)
      && (col.priceMin == null || l.price >= col.priceMin) && (col.priceMax == null || l.price <= col.priceMax)).length;
  }, [manual, listings, col]);
  return (
    <>
      <div className={styles.chips} role="group" aria-label="Jak vybrat karty">
        <Chip selected={!manual} onClick={() => { setManual(false); onChange({ ...col, listingIds: [] }); }}>Podle filtrů</Chip>
        <Chip selected={manual} onClick={() => setManual(true)}>Vybrat ručně</Chip>
      </div>
      {manual ? (
        <>
          <PickedListings ids={col.listingIds} onChange={(ids) => onChange({ ...col, listingIds: ids })} listingById={listingById} />
          <span className="t-small muted">{col.listingIds.length} z 60 nabídek{!col.listingIds.length ? ' · bez vybraných karet se kolekce řídí filtry' : ''}</span>
          <ListingPicker listings={listings} selected={col.listingIds} max={60} onPick={(id) => onChange({ ...col, listingIds: [...col.listingIds, id] })} />
        </>
      ) : (
        <>
          <input className={sell.input} value={col.q} maxLength={60} placeholder="Název karty obsahuje (nepovinné)" aria-label="Hledaný text" onChange={(e) => onChange({ ...col, q: e.target.value })} />
          <div className={styles.inline}>
            <select className={sell.input} value={col.game} aria-label="Hra" onChange={(e) => onChange({ ...col, game: e.target.value as ShopCollection['game'], set: '' })}>
              <option value="">Všechny hry</option>
              {GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select className={sell.input} value={col.set} aria-label="Sada" onChange={(e) => onChange({ ...col, set: e.target.value })}>
              <option value="">Všechny sady</option>
              {col.set && !sets.some(([code]) => code === col.set) ? <option value={col.set}>{col.set}</option> : null}
              {sets.map(([code, name]) => <option key={code} value={code}>{name} ({code.toUpperCase()})</option>)}
            </select>
          </div>
          <div className={styles.inline}>
            <input type="number" min={0} className={sell.input} value={col.priceMin ?? ''} placeholder="Cena od Kč" aria-label="Cena od" onChange={(e) => onChange({ ...col, priceMin: price(e.target.value) })} />
            <input type="number" min={0} className={sell.input} value={col.priceMax ?? ''} placeholder="Cena do Kč" aria-label="Cena do" onChange={(e) => onChange({ ...col, priceMax: price(e.target.value) })} />
          </div>
          <div className={styles.inline}>
            <select className={sell.input} value={col.condition} aria-label="Stav" onChange={(e) => onChange({ ...col, condition: e.target.value as ShopCollection['condition'] })}>
              <option value="">Jakýkoli stav</option>
              {CONDITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select className={sell.input} value={col.language} aria-label="Jazyk" onChange={(e) => onChange({ ...col, language: e.target.value as ShopCollection['language'] })}>
              <option value="">Jakýkoli jazyk</option>
              {(Object.keys(LANGUAGE_NAMES) as Language[]).map((x) => <option key={x} value={x}>{LANGUAGE_NAMES[x]}</option>)}
            </select>
          </div>
          {matching != null ? <span className="t-small muted">Teď odpovídá {plural(matching, ['nabídka', 'nabídky', 'nabídek'])}.</span> : null}
        </>
      )}
      <div className={styles.inline}>
        <span className="t-label muted">ŘAZENÍ</span>
        <div className={styles.chips}>
          {COLLECTION_SORTS.map((o) => <Chip key={o.id} selected={col.sort === o.id} onClick={() => onChange({ ...col, sort: o.id })}>{o.name}</Chip>)}
        </div>
      </div>
    </>
  );
}
