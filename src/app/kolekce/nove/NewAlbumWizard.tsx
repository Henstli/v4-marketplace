'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AlbumBook, Sleeve } from '@/components/album/AlbumBook';
import { cardsWord } from '@/components/album/engine';
import { Button, Chip, SearchField, Steps } from '@/components/trezor';
import { GAMES, type GameId } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { createAlbum, findSets, searchForAlbum, setCards, type PickCard, type SetOption } from '../actions';
import { SleeveSprite } from '@/components/album/SleeveSprite';
import { LookFields, type Look } from '../AlbumLook';
import { CardPicker } from '../CardPicker';
import s from '../kolekce.module.css';

const LIVE = GAMES.filter((g) => g.live);

/** Průvodce založením alba: vzhled (5A), sada nebo vlastní výběr (5B), karty, které už máš (5C / 5D). */
export function NewAlbumWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [look, setLook] = useState<Look>({ name: '', design: 1, sleeve: 1 });
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
  const named = useRef(false);

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
      // karty, které už ve sbírce jsou, jsou předem označené
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
    if (!named.current || !look.name.trim()) { setLook((l) => ({ ...l, name: o.name.slice(0, 24) })); named.current = false; }
  };

  const total = kind === 'set' ? [...picked.values()].reduce((a, b) => a + b, 0) : tray.length;

  const create = () =>
    start(async () => {
      setErr('');
      let ids: string[] = [];
      if (kind === 'set') picked.forEach((n, id) => { for (let i = 0; i < n; i++) ids.push(id); });
      else ids = tray.map((c) => c.id);
      const r = await createAlbum({ name: look.name, design: look.design, sleeve: look.sleeve, kind, setId: set?.id ?? null, cardIds: ids });
      if ('error' in r) { setErr(r.error); return; }
      router.push(`/kolekce/${r.id}?zalozeno=1`);
    });

  const canNext = step === 0 ? true : step === 1 ? (kind === 'custom' || !!set) : !!look.name.trim();

  return (
    <main className={s.wrap}>
      <div className={s.crumb}><Link href="/kolekce">Moje kolekce</Link><span>›</span><span>Nové album</span></div>
      <div className={s.head} style={{ marginTop: 'var(--space-3)' }}>
        <div><h1>Nové album</h1><p>Vyber desky a obaly, sadu nebo vlastní karty a označ, co už máš.</p></div>
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
              <h2 style={{ margin: 0, font: '700 20px var(--font-display)' }}>Které karty ze sady {set?.name} už máš?</h2>
              <p className={s.hint}>Klikni na kartu, tažením označíš víc najednou, dvojklik přidá další kus. Neoznačené karty budou v albu jako prázdná místa.</p>
              <div className={s.toolbar} style={{ marginTop: 'var(--space-3)' }}>
                <Button variant="secondary" size="md" onClick={() => setPicked(new Map((cards ?? []).map((c) => [c.id, picked.get(c.id) ?? 1])))}>Označit vše</Button>
                <Button variant="ghost" size="md" onClick={() => setPicked(new Map())}>Zrušit výběr</Button>
              </div>
              {cards === null ? <p className={s.hint}>Načítám karty…</p> : (
                <CardPicker cards={cards.map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image, have: c.owned }))} value={picked} onChange={setPicked} />
              )}
            </>
          ) : null}

          {step === 2 && kind === 'custom' ? (
            <>
              <h2 style={{ margin: 0, font: '700 20px var(--font-display)' }}>Vyber karty do alba</h2>
              <p className={s.hint}>Hledej v celém katalogu. Karty ve sbírce jsou nahoře. Pořadí v albu je pořadí v zásobníku dole.</p>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <SearchField label="Hledat kartu" placeholder="Název karty, sada nebo číslo" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              </div>
              <CardPicker
                cards={found.map((c) => ({ id: c.id, name: c.name, number: c.number, image: c.image, have: c.owned }))}
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
            {step > 0 ? <Button variant="ghost" onClick={() => { setStep(step - 1); setQ(''); }}>← Zpět</Button> : <Link href="/kolekce" className={s.hint} style={{ margin: 0 }}>Zrušit</Link>}
            {step < 2 ? (
              <Button disabled={!canNext} onClick={() => { setStep(step + 1); setQ(''); }}>Pokračovat</Button>
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
