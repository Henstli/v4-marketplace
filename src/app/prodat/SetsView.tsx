'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { thumbUrl } from '@/lib/images';
import { CONDITIONS, CONDITION_NAMES } from '@/lib/types';
import { setView, watchSet, type SetView } from './sk-actions';
import { Ico, kc, Modal, nf, Seg } from './sk';
import { AlbumViewer, type AlbumHandle } from '@/components/album/AlbumViewer';
import type { EngineCard } from '@/components/album/engine';

export interface SetCard {
  id: string; name: string; code: string; game: string; owned: number; total: number; images: string[];
  lowSum: number; watched: number; missing: number; album: boolean;
}

type Filter = 'open' | 'watch' | 'album' | 'done';
type Tab = 'cards' | 'watch' | 'album';

const AlbIco = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></svg>;
const EyeIco = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const BellIco = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21h4" /></svg>;
const CheckIco = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;
const FillIco = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /><path d="M12 8v8M8 12h8" /></svg>;
const karet = (n: number) => (n === 1 ? 'karta' : n >= 2 && n <= 4 ? 'karty' : 'karet');
const isWatched = (s: SetCard) => s.missing > 0 && s.watched >= s.missing;

/** Chybí do sad: sada = jedna karta bez tlačítek, klik otevře okno sady (Karty sady, Hlídání, Album). */
export function SetsView({ sets, preview }: { sets: SetCard[]; /** jen pro náhled bez přihlášení */ preview?: SetView }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('open');
  const [sort, setSort] = useState<'near' | 'name' | 'missing'>('near');
  const [open, setOpen] = useState<SetCard | null>(null);
  const n = {
    open: sets.filter((s) => s.owned < s.total).length,
    watch: sets.filter(isWatched).length,
    album: sets.filter((s) => s.album).length,
    done: sets.filter((s) => s.owned >= s.total).length,
  };
  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('cs');
    return sets
      .filter((s) => (f === 'open' ? s.owned < s.total : f === 'watch' ? isWatched(s) : f === 'album' ? s.album : s.owned >= s.total))
      .filter((s) => !needle || s.name.toLocaleLowerCase('cs').includes(needle) || s.code.toLowerCase().includes(needle))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'cs') : sort === 'missing' ? (a.total - a.owned) - (b.total - b.owned) : b.owned / b.total - a.owned / a.total));
  }, [sets, f, q, sort]);

  if (!sets.length) return <div className="tbl"><div className="none">Zatím tu nic není. Jakmile budete mít ve sbírce kartu, ukážeme, kolik vám chybí do celé sady.</div></div>;
  return (
    <>
      <div className="bar" style={{ marginBottom: 14 }}>
        <label className="search" style={{ margin: 0, width: 260 }}>{Ico.s}<input placeholder="Hledat sadu" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {([['open', 'Rozpracované'], ['watch', 'Hlídané'], ['album', 'S albem'], ['done', 'Dokončené']] as const).map(([k, t]) => (
          <button key={k} type="button" className={`chip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{t} <span className="mono" style={{ opacity: 0.7 }}>{n[k]}</span></button>
        ))}
        <span style={{ marginLeft: 'auto' }} />
        <Seg value={sort} onChange={setSort} className="fit" options={[['near', 'Nejblíž dokončení'], ['missing', 'Nejméně chybí'], ['name', 'Podle názvu']]} />
      </div>
      {list.length ? (
        <div className="ssg">
          {list.map((s) => {
            const left = s.total - s.owned;
            return (
              <button key={s.id} type="button" className="ssc" onClick={() => setOpen(s)}>
                <span className="ssf">{(s.images.length ? s.images : [null]).slice(0, 3).map((im, i) => (im ? <img key={i} src={thumbUrl(im)} alt="" /> : <i key={i} />))}</span>
                <span className="ssb">
                  <span className="ssh"><b>{s.name}</b><span className="sst">
                    {isWatched(s) ? <span className="on">{EyeIco}Hlídáte</span> : null}
                    {s.album ? <span className="on">{AlbIco}Album</span> : null}
                  </span></span>
                  <small className="ssk">{s.code.toUpperCase()}{s.game ? ` · ${s.game}` : ''}</small>
                  <span className="prog"><i style={{ width: `${(s.owned / s.total) * 100}%` }} /></span>
                  <span className="ssl">
                    {left ? <span>Chybí <b>{nf(left)}</b>{s.lowSum ? <> · od <b>{kc(s.lowSum)}</b></> : null}</span> : <span><b>Kompletní</b></span>}
                    <span className="mono">{nf(s.owned)} / {nf(s.total)}</span>
                  </span>
                </span>
                <span className="ssv">{Ico.chev}</span>
              </button>
            );
          })}
        </div>
      ) : <div className="tbl"><div className="none">Nic tomu neodpovídá.</div></div>}
      {open ? <SetModal s={open} preview={preview} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** Okno sady: Karty sady (mřížka se sbírkou a cenami), Hlídání chybějících karet, Album (náhled skutečného alba, založit nebo otevřít). Akce jsou jen v záložkách nahoře. */
function SetModal({ s, preview, onClose }: { s: SetCard; preview?: SetView; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<SetView | null>(null);
  const [tab, setTab] = useState<Tab>('cards');
  const [f, setF] = useState<'miss' | 'have' | 'all'>('all');
  const [cheap, setCheap] = useState(false);
  // Hlídání
  const [won, setWon] = useState(isWatched(s));
  const [cond, setCond] = useState('EX');
  const [lim, setLim] = useState<'none' | 'max'>('none');
  const [max, setMax] = useState('');
  const [stop, setStop] = useState(true);
  // Album
  const [name, setName] = useState(s.name.slice(0, 60));
  const [auto, setAuto] = useState(true);
  const [unsell, setUnsell] = useState(false);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();

  // stránka pod oknem se neposouvá (ani když kolečko dojede na konec seznamu v okně)
  useEffect(() => {
    const el = document.documentElement, sw = window.innerWidth - el.clientWidth;
    const prev = [el.style.overflow, el.style.paddingRight];
    el.style.overflow = 'hidden'; if (sw > 0) el.style.paddingRight = `${sw}px`;
    return () => { el.style.overflow = prev[0]; el.style.paddingRight = prev[1]; };
  }, []);

  useEffect(() => {
    (preview ? Promise.resolve(preview) : setView(s.id)).then((r) => {
      setV(r ?? { cards: [], watch: null, album: null });
      if (r?.watch) { setCond(r.watch.cond); setLim(r.watch.max ? 'max' : 'none'); setMax(r.watch.max ? String(r.watch.max) : ''); setStop(r.watch.stop); }
    }).catch(() => setV({ cards: [], watch: null, album: null }));
  }, [s.id, preview]);

  const cards = v?.cards ?? [];
  const miss = cards.filter((c) => !c.have);
  const have = cards.filter((c) => c.have);
  const saleOnly = have.filter((c) => !c.keep && c.sale);
  const low = miss.reduce((a, c) => a + (c.low ?? 0), 0);
  const offered = miss.filter((c) => c.low != null).length;
  // album sady: kus, který si necháváte (a s „Dát do alba“ i kus jen na prodeji)
  const albumCards: EngineCard[] = useMemo(() => cards.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, number: c.number, image: c.image, setName: s.name,
    owned: c.keep > 0 || (unsell && c.have > 0) ? 1 : 0,
  })), [cards, unsell, s.name]);
  // přepnutí „Nechat na prodeji / Dát do alba“ jen vymění karty, album zůstane na stejné stránce
  const albRef = useRef<AlbumHandle>(null);
  useEffect(() => { albRef.current?.setCards(albumCards); }, [albumCards]);
  // mřížka v Hlídání: posuvník leží v pravém odsazení. Klasický posuvník si místo bere sám, překryvný (Firefox, macOS)
  // ne, proto se odsazení dopočítá z jeho skutečné šířky a karty jsou vždy stejně daleko od okraje boxu.
  const sbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const g = sbRef.current;
    if (!g || typeof ResizeObserver === 'undefined') return;
    const fit = () => g.style.setProperty('--sbw', `${Math.min(16, g.offsetWidth - g.clientWidth)}px`);
    const ro = new ResizeObserver(fit); ro.observe(g); fit();
    return () => ro.disconnect();
  }, [tab, v]);
  const shown = (f === 'miss' ? miss : f === 'have' ? have : cards).filter((c) => !cheap || (!c.have && c.low != null && c.low <= 200));

  const saveWatch = (on: boolean) => start(async () => {
    setErr('');
    const m = lim === 'max' ? Number(max) : null;
    if (on && lim === 'max' && !(m && m > 0)) { setErr('Zadejte nejvyšší cenu v korunách.'); return; }
    const r = await watchSet(s.id, on ? cond : null, on ? m : null, stop);
    if (r.error) { setErr(r.error); return; }
    router.refresh();
    onClose();
  });
  const toAlbum = () => {
    const p = new URLSearchParams({ sada: s.id, nazev: name.trim() || s.name, prodej: unsell ? '1' : '0', samo: auto ? '1' : '0' });
    router.push(`/kolekce/nove?${p}`);
  };

  const foot = tab === 'watch' ? <>
    <span className="ssum">Každou kartu upravíte zvlášť v <Link href="/ucet/hlidane" style={{ color: 'var(--ink)', fontWeight: 600 }}>Hlídání a příkazech</Link></span>
    <button type="button" className="btn" onClick={onClose}>Zavřít</button>
    <button type="button" className="btn p" disabled={pending || !miss.length || (!won && !isWatched(s))} onClick={() => saveWatch(won)}>Uložit hlídání</button>
  </> : tab === 'album' ? (v?.album ? <>
    <button type="button" className="btn" onClick={onClose}>Zavřít</button>
    <Link className="btn p" href={`/kolekce/${v.album.id}`}>{AlbIco}Otevřít album</Link>
  </> : <>
    <span className="ssum">Vzhled desek a obalů vyberete v dalším kroku</span>
    <button type="button" className="btn" onClick={onClose}>Zavřít</button>
    <button type="button" className="btn p" disabled={!v || !name.trim()} onClick={toAlbum}>{AlbIco}Vybrat vzhled alba</button>
  </>) : <>
    {miss.length ? <span className="ssum">Chybí <b>{nf(miss.length)}</b> {karet(miss.length)}{low ? <>, doplníte od <b>{kc(low)}</b></> : null}</span> : <span className="ssum"><b>Sada je kompletní</b></span>}
    <button type="button" className="btn" onClick={onClose}>Zavřít</button>
  </>;

  return (
    <Modal wide title={<>{s.name}<small className="mono" style={{ marginLeft: 10, font: '500 13px var(--fm)', color: 'var(--ink-muted)' }}>{s.code.toUpperCase()}{s.game ? ` · ${s.game}` : ''}</small></>} onClose={onClose} foot={foot}>
      <div className="smh"><div className="prog" style={{ flex: 1 }}><i style={{ width: `${(s.owned / s.total) * 100}%` }} /></div><span className="mono">{nf(s.owned)} / {nf(s.total)}</span></div>
      <div className="mtabs" role="tablist">
        {([['cards', 'Karty sady'], ['watch', 'Hlídání'], ['album', 'Album']] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      {v == null ? <div className="none">Načítám…</div> : null}

      {v && tab === 'cards' ? <>
        <div className="bar" style={{ margin: 0 }}>
          {([['all', 'Celá sada', cards.length], ['miss', 'Chybí', miss.length], ['have', 'Mám', have.length]] as const).map(([k, t, c]) => (
            <button key={k} type="button" className={`chip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{t} <span className="mono" style={{ opacity: 0.7 }}>{c}</span></button>
          ))}
          {f !== 'have' ? <button type="button" className={`chip${cheap ? ' on' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => setCheap(!cheap)}>Do 200 Kč</button> : null}
        </div>
        {shown.length ? (
          <div className="ssgrid">
            {shown.slice(0, 400).map((c) => (
              <Link key={c.id} href={`/karty/${c.slug}`} target="_blank" className={`sst2${c.have ? '' : ' ms'}`} title={c.name}>
                <span className="im">{c.image ? <img src={c.image} alt="" loading="lazy" /> : <i />}
                  {c.have > 1 ? <span className="bd">{c.have}×</span> : null}
                  {!c.have && c.watched ? <span className="wt" title="Hlídáte">{EyeIco}</span> : null}
                  {!c.have && c.offers ? <span className="ov">{c.offers} {c.offers === 1 ? 'nabídka' : c.offers < 5 ? 'nabídky' : 'nabídek'}</span> : null}
                </span>
                <small>{c.number} {c.name}</small>
                {c.have ? <small className="hv">{c.keep ? '\u00a0' : 'jen na prodeji'}</small>
                  : <b className={c.low == null ? 'na' : ''}>{c.low != null ? kc(c.low) : 'nikdo neprodává'}</b>}
              </Link>
            ))}
          </div>
        ) : <div className="none">{f === 'miss' && !cheap ? 'Máte celou sadu.' : 'Nic tomu neodpovídá.'}</div>}
      </> : null}

      {v && tab === 'watch' ? (miss.length ? (
        <div className="ssw">
          <div className="sswc">
            <div className="sswt"><b>{nf(miss.length)}</b><span>{miss.length === 1 ? 'chybějící kartu budeme hlídat' : `chybějících ${karet(miss.length)} budeme hlídat`}</span>
              <span className="sswl"><span><i className="on" />{nf(offered)} teď v nabídce</span><span><i />{nf(miss.length - offered)} nikdo neprodává</span></span></div>
            <div className="sswg" ref={sbRef}>
              {miss.map((c) => (
                <Link key={c.id} href={`/karty/${c.slug}`} target="_blank" className={`sswi${c.low != null ? ' of' : ''}`} title={c.name}>
                  {c.image ? <img src={c.image} alt="" loading="lazy" /> : <i />}
                  {won ? <span className="e">{EyeIco}</span> : null}
                  <span className={`p${c.low != null ? '' : ' na'}`}>{c.low != null ? kc(c.low) : 'nikdo'}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="ssws">
            <label className={`setr${won ? ' on' : ''}`}>
              <span className="ico">{BellIco}</span>
              <span className="tx"><b>Hlídat chybějící karty</b><small>Až se některá objeví v nabídce, pošleme e-mail, nejvýš jednou denně.</small></span>
              <button type="button" role="switch" aria-checked={won} className={`tg big${won ? ' on' : ''}`} aria-label="Hlídat chybějící karty" onClick={() => setWon(!won)} />
            </label>
            <div className="ssfr"><div className="ssfh"><b>Nejhorší stav</b><small>{CONDITION_NAMES[cond as keyof typeof CONDITION_NAMES]} a lepší</small></div>
              <div className="sscd">{CONDITIONS.map((c, i) => (
                <button key={c} type="button" className={c === cond ? 'cut' : i < CONDITIONS.indexOf(cond as (typeof CONDITIONS)[number]) ? 'in' : ''} onClick={() => setCond(c)}>{c}</button>
              ))}</div></div>
            <div className="ssfr"><div className="ssfh"><b>Nejvyšší cena za kus</b><small>dražší neukážeme</small></div>
              <div className="sspr"><Seg value={lim} onChange={setLim} options={[['none', 'Bez limitu'], ['max', 'Do ceny']]} />
                {lim === 'max' ? <div className="inp"><input value={max} inputMode="numeric" placeholder="500" onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} /><em>Kč</em></div> : null}</div></div>
            <label className={`setr${stop ? ' on' : ''}`}>
              <span className="ico">{CheckIco}</span>
              <span className="tx"><b>Přestat po získání</b><small>Kartu, kterou koupíte nebo naskladníte, přestaneme hlídat.</small></span>
              <button type="button" role="switch" aria-checked={stop} className={`tg big${stop ? ' on' : ''}`} aria-label="Přestat hlídat získané karty" onClick={() => setStop(!stop)} />
            </label>
          </div>
        </div>
      ) : <div className="none">Sada je kompletní, není co hlídat.</div>) : null}

      {v && tab === 'album' ? (
        <div className="ssw">
          <div className="ssab">
            <AlbumViewer ref={albRef} key={s.id} name={v.album?.name ?? (name.trim() || s.name)} design={1} sleeve={1} cards={albumCards} open counterTotal />
          </div>
          {v.album ? (
            <div className="ssws">
              <div className="ssfr"><div className="ssfh"><b>{v.album.name}</b></div><small className="ssn">Karty sady ze sbírky jsou v albu, z každé 1 kus. Ten kus nejde prodat, dokud ho z alba nevyjmete.</small></div>
            </div>
          ) : (
            <div className="ssws">
              <div className="f" style={{ margin: 0 }}><label>Název alba</label><div className="inp"><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ font: '500 14px var(--fs)' }} /></div></div>
              <div className="sscn">
                <div className="k1"><b>{nf(have.length - (unsell ? 0 : saleOnly.length))}</b><small>vložíme</small></div>
                {saleOnly.length ? <div className="k2"><b>{nf(unsell ? 0 : saleOnly.length)}</b><small>na prodeji</small></div> : null}
                <div><b>{nf(miss.length)}</b><small>prázdných</small></div>
              </div>
              {saleOnly.length ? (
                <div className="ssfr"><div className="ssfh"><b>Karty, které máte jen na prodeji</b></div>
                  <div className="ssop">
                    <button type="button" className={unsell ? '' : 'on'} onClick={() => setUnsell(false)}><span className="rd" /><span>Nechat na prodeji<small>V albu bude místo</small></span></button>
                    <button type="button" className={unsell ? 'on' : ''} onClick={() => setUnsell(true)}><span className="rd" /><span>Dát do alba<small>Stáhneme 1 kus</small></span></button>
                  </div></div>
              ) : null}
              <label className={`setr${auto ? ' on' : ''}`}>
                <span className="ico">{FillIco}</span>
                <span className="tx"><b>Doplňovat samo</b><small>Novou kartu sady ze skladu vložíme do alba sami.</small></span>
                <button type="button" role="switch" aria-checked={auto} className={`tg big${auto ? ' on' : ''}`} aria-label="Doplňovat samo" onClick={() => setAuto(!auto)} />
              </label>
            </div>
          )}
        </div>
      ) : null}
      {err ? <small style={{ color: 'var(--down)' }}>{err}</small> : null}
    </Modal>
  );
}
