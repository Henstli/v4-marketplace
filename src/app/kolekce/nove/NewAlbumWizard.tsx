'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AlbumBook, Sleeve } from '@/components/album/AlbumBook';
import { cardsWord } from '@/components/album/engine';
import { Button, ButtonLink, Chip, SearchField, Steps } from '@/components/trezor';
import { GAMES, type GameId } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { createAlbum, findSets, getSet, searchForAlbum, setCards, type PickCard, type SetOption } from '../actions';
import { SleeveSprite } from '@/components/album/SleeveSprite';
import { LookFields, type Look } from '../AlbumLook';
import { CardPicker } from '../CardPicker';
import { AutoFill } from '../AutoFill';
import s from '../kolekce.module.css';

const LIVE = GAMES.filter((g) => g.live);

/**
 * Průvodce založením alba: vzhled (5A), sada nebo vlastní výběr (5B), karty ze sbírky (5C / 5D).
 * Album bere karty jen ze sbírky (skladu). preset = otevřeno ze Sbírky u sady (Založit kolekci).
 */
export function NewAlbumWizard({ preset }: { preset?: { setId: string; name?: string; unsell?: boolean; autoFill?: boolean } }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // Další krok průvodce vždy začíná nahoře (seznam sad bývá dlouhý).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);
  const [look, setLook] = useState<Look>({ name: preset?.name?.slice(0, 60) ?? '', design: 1, sleeve: 1 });
  const [unsell, setUnsell] = useState(preset?.unsell ?? false);
  const [autoFill, setAutoFill] = useState(preset?.autoFill ?? true);
  const [kind, setKind] = useState<'set' | 'custom'>('set');
  const [game, setGame] = useState<GameId>('pokemon');
  const [q, setQ] = useState('');
  const [sets, setSets] = useState<SetOption[] | null>(null);
  const [set, setSet] = useState<SetOption | null>(null);
  const [cards, setCardList] = useState<PickCard[] | null>(null);
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [found, setFound] = useState<PickCard[]>([]);
  const [tray, setTray] = useState<PickCard[]>([]);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const named = useRef(!!preset?.name);

  useEffect(() => {
    if (!preset?.setId) return;
    getSet(preset.setId).then((o) => { if (o) { setGame(o.game); setSet(o); setLook((l) => (l.name ? l : { ...l, name: o.name.slice(0, 60) })); } });
  }, [preset?.setId]);

  useEffect(() => {
    if (kind !== 'set' || step !== 1) return;
    let alive = true;
    setSets(null);
    const t = setTimeout(() => findSets(game, q).then((r) => { if (alive) setSets(r); }), q ? 280 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [kind, game, q, step]);

  useEffect(() => {
    if (!set) return;
    let alive = true;
    setCardList(null);
    setCards(set.id).then((r) => {
      if (!alive) return;
      setCardList(r);
      // do alba jdou karty, které jsou ve sbírce (album si z každé vezme 1 kus)
      setPicked(new Map(r.filter((c) => c.owned > 0).map((c) => [c.id, 1])));
    });
    return () => { alive = false; };
  }, [set]);

  useEffect(() => {
    if (kind !== 'custom' || step !== 2) return;
    if (q.trim().length < 2) { setFound([]); return; }
    let alive = true;
    const t = setTimeout(() => searchForAlbum(q).then((r) => { if (alive) setFound(r); }), 280);
    return () => { alive = false; clearTimeout(t); };
  }, [kind, q, step]);

  const chooseSet = (o: SetOption) => {
    setSet(o);
    if (!named.current || !look.name.trim()) { setLook((l) => ({ ...l, name: o.name.slice(0, 60) })); named.current = false; }
  };

  // Karty sady, které máte jen na prodeji (žádný kus mimo prodej): bez stažení z prodeje zůstanou v albu prázdné.
  const saleOnly = kind === 'set' ? (cards ?? []).filter((c) => c.owned > 0 && !c.keep && (c.sale ?? 0) > 0) : [];
  const total = kind === 'set' ? picked.size - (unsell ? 0 : saleOnly.length) : tray.length;

  const create = () =>
    start(async () => {
      setErr('');
      let ids: string[] = [];
      if (kind === 'set') ids = [...picked.keys()];
      else ids = tray.map((c) => c.id);
      const r = await createAlbum({ name: look.name, design: look.design, sleeve: look.sleeve, kind, setId: set?.id ?? null, cardIds: ids, unsell, autoFill });
      if ('error' in r) { setErr(r.error); return; }
      router.push(`/kolekce/${r.id}?zalozeno=1`);
    });

  const canNext = step === 0 ? true : step === 1 ? (kind === 'custom' || !!set) : !!look.name.trim();

  return (
    <main className={s.wrap}>
      <div className={s.crumb}><Link href="/kolekce">Moje kolekce</Link><span>›</span><span>Nové album</span></div>
      <div className={s.head} style={{ marginTop: 'var(--space-3)' }}>
        <div><h1>Nové album</h1><p>Vyber desky a obaly a sadu nebo vlastní karty. Do alba jdou karty ze tvé sbírky.</p></div>
        <Steps steps={['Vzhled', 'Obsah', 'Karty']} current={step} />
      </div>

      <div className={s.wiz}>
        <div className={s.wizMain}>
          {step === 0 ? (
            <LookFields value={look} onChange={(v) => { if (v.name !== look.name) named.current = true; setLook(v); }} />
          ) : null}

          {step === 1 ? (
            <>
              <div className={s.kinds}>
                <button type="button" className={s.kind} aria-pressed={kind === 'set'} onClick={() => setKind('set')}>
                  <b>Celá sada</b>
                  <span>Všechny karty sady podle čísel. Co ti chybí, zůstane jako prázdné místo s nabídkami.</span>
                </button>
                <button type="button" className={s.kind} aria-pressed={kind === 'custom'} onClick={() => setKind('custom')}>
                  <b>Vlastní album</b>
                  <span>Oblíbené karty napříč sadami a hrami, v pořadí, v jakém je přidáš.</span>
                </button>
              </div>
              {kind === 'set' ? (
                <>
                  <div className={s.chips}>
                    {LIVE.map((g) => <Chip key={g.id} selected={game === g.id} dot={g.dot} onClick={() => { setGame(g.id); setSet(null); }}>{g.name}</Chip>)}
                  </div>
                  <SearchField label="Hledat sadu" placeholder="Název, kód nebo rok sady" value={q} onChange={(e) => setQ(e.target.value)} />
                  <div className={s.sets}>
                    {sets === null ? <p className={s.hint}>Načítám sady…</p> : null}
                    {sets?.length === 0 ? <p className={s.hint}>Žádná sada neodpovídá.</p> : null}
                    {sets?.map((o) => (
                      <button key={o.id} type="button" className={s.set} aria-pressed={set?.id === o.id} onClick={() => chooseSet(o)}>
                        <span><b>{o.name}</b><small>{o.code.toUpperCase()}{o.year ? ` · ${o.year}` : ''} · {o.cards} {cardsWord(o.cards)}</small></span>
                        <em>{o.owned ? `máš ${o.owned}` : ''}</em>
                      </button>
                    ))}
                  </div>
                </>
              ) : <p className={s.hint}>Karty do vlastního alba vybereš v dalším kroku.</p>}
            </>
          ) : null}

          {step === 2 && kind === 'set' ? (
            <>
              <h2 style={{ margin: 0, font: '700 20px var(--font-display)' }}>Karty ze sbírky: {set?.name}</h2>
              <p className={s.hint}>
                {cards === null ? 'Načítám karty…' : `Do alba se vloží ${total} ${cardsWord(total)} ze sbírky, z každé 1 kus. ${(cards.length - total) || 'Žádné'} ${cards.length - total === 1 ? 'místo zůstane prázdné' : 'míst zůstane prázdných'}, karty, které chybí.`}
              </p>
              {saleOnly.length ? (
                <div className={s.have}>
                  <p className={s.hint} style={{ margin: 0 }}><b style={{ color: 'var(--ink)' }}>{saleOnly.length} {cardsWord(saleOnly.length)}</b> máte jen na prodeji.</p>
                  <div className={s.seg} role="radiogroup" aria-label="Karty na prodeji" style={{ height: 'auto' }}>
                    <button type="button" role="radio" aria-checked={!unsell} style={{ padding: '8px 10px' }} onClick={() => setUnsell(false)}>Nechat na prodeji (v albu zůstane prázdné místo)</button>
                    <button type="button" role="radio" aria-checked={unsell} style={{ padding: '8px 10px' }} onClick={() => setUnsell(true)}>Stáhnout z prodeje a dát do alba</button>
                  </div>
                </div>
              ) : null}
              <AutoFill kind="set" checked={autoFill} onChange={setAutoFill} />
              {cards === null ? null : (
                <CardPicker readOnly cards={cards.map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image, have: c.owned }))}
                  value={new Map([...picked].filter(([id]) => unsell || !saleOnly.some((x) => x.id === id)))} onChange={() => undefined} />
              )}
            </>
          ) : null}

          {step === 2 && kind === 'custom' ? (
            <>
              <h2 style={{ margin: 0, font: '700 20px var(--font-display)' }}>Vyber karty do alba</h2>
              <p className={s.hint}>Hledej ve své sbírce. Album si z každé karty vezme 1 kus. Kartu, kterou ve sbírce nemáš, přidáš v albu tlačítkem Mám ji. Pořadí v albu je pořadí v zásobníku dole.</p>
              <AutoFill kind="custom" checked={autoFill} onChange={setAutoFill} />
              <div style={{ marginTop: 'var(--space-3)' }}>
                <SearchField label="Hledat kartu" placeholder="Název karty, sada nebo číslo" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              </div>
              <CardPicker
                cards={found.filter((c) => c.owned > 0).map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image, have: c.owned }))}
                value={new Map(tray.map((c) => [c.id, 1]))}
                onChange={(m) => {
                  setTray((t) => {
                    const keep = t.filter((c) => m.has(c.id) || !found.some((f) => f.id === c.id));
                    const add = found.filter((f) => m.has(f.id) && !keep.some((c) => c.id === f.id));
                    return [...keep, ...add];
                  });
                }}
              />
              <div className={s.field} style={{ marginTop: 'var(--space-6)' }}>
                <span>V albu ({tray.length})</span>
                {tray.length ? (
                  <div className={s.tray}>
                    {tray.map((c, i) => (
                      <button key={c.id} type="button" className={s.pc} title={`Odebrat ${c.name}`} onClick={() => setTray(tray.filter((x) => x.id !== c.id))}>
                        <div className={s.mcImg}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {c.image ? <img src={thumbUrl(c.image) ?? c.image} alt="" /> : null}
                          <span className={s.num}>{i + 1}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : <small>Zatím prázdné. Karty můžeš přidat i později.</small>}
              </div>
            </>
          ) : null}

          {err ? <p className={s.err}>{err}</p> : null}
          <div className={s.wizFoot}>
            {step > 0 ? <Button variant="ghost" onClick={() => { setStep(preset && step === 2 ? 0 : step - 1); setQ(''); }}>← Zpět</Button> : <ButtonLink variant="secondary" href="/kolekce">Zrušit</ButtonLink>}
            {step < 2 ? (
              <Button disabled={!canNext} onClick={() => { setStep(preset && set && step === 0 ? 2 : step + 1); setQ(''); }}>Pokračovat</Button>
            ) : (
              <Button disabled={pending || !look.name.trim() || (kind === 'set' && !set)} onClick={create}>
                {pending ? 'Zakládám…' : total ? `Založit album a vložit ${total} ${cardsWord(total)}` : 'Založit prázdné album'}
              </Button>
            )}
          </div>
        </div>

        <aside className={s.prev}>
          {step !== 0 ? <SleeveSprite /> : null}
          <AlbumBook design={look.design} name={look.name || 'Moje album'} hover />
          <div className={s.prevSl}>
            <Sleeve sleeve={look.sleeve} image={tray[0]?.image ?? cards?.find((c) => picked.has(c.id))?.image ?? null} scale={0.55} />
            <Sleeve sleeve={look.sleeve} image={null} scale={0.55} back />
          </div>
          <h3>{look.name || 'Moje album'}</h3>
          <p>{kind === 'set' ? (set ? `${set.name} · ${set.cards} ${cardsWord(set.cards)}` : 'Vyber sadu') : 'Vlastní album'}{step === 2 ? ` · vložíš ${total}` : ''}</p>
        </aside>
      </div>
    </main>
  );
}
