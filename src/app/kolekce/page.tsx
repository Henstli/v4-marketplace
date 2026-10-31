import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlbumBook } from '@/components/album/AlbumBook';
import { ButtonLink, PlusIcon } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { getCollectionCards, getCollectionOverview, type AlbumCard, type AlbumSummary } from '@/lib/collection';
import { formatNumber } from '@/lib/format';
import { getGame } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { CollectionTabs } from './CollectionTabs';
import s from './kolekce.module.css';
import { shortAlbumName } from '@/lib/album/designs';

export const metadata: Metadata = { title: 'Moje kolekce' };

const Kc = ({ n }: { n: number }) => <>{formatNumber(Math.round(n))}&nbsp;Kč</>;

function AlbumTile({ a }: { a: AlbumSummary }) {
  const g = a.game ? getGame(a.game) : undefined;
  const pct = a.total ? Math.round((a.have / a.total) * 100) : 0;
  const full = a.kind === 'set' && a.total > 0 && a.have >= a.total;
  return (
    <Link href={`/kolekce/${a.id}`} className={s.album}>
      <div className={s.shelf}><AlbumBook design={a.design} name={a.name} lift /></div>
      <h3 title={a.name}>{shortAlbumName(a.name)}</h3>
      <div className={s.meta}>
        {g ? <span className={s.dot} style={{ background: g.dot }} /> : <span className={s.dot} style={{ background: 'var(--accent)' }} />}
        {a.kind === 'set' ? `${a.setName ?? 'Sada'}${a.setYear ? ` · ${a.setYear}` : ''}` : 'Vlastní album'}
      </div>
      {a.kind === 'set' ? (
        <>
          <div className={`${s.bar} ${full ? s.full : ''}`}><i style={{ width: `${pct}%` }} /></div>
          <div className={s.row}>
            <span><b>{a.have}</b> / {a.total}</span>
            {full ? <span className={`${s.tag} ${s.gold}`}>✓ Kompletní</span> : <span>{pct} %</span>}
          </div>
        </>
      ) : (
        <div className={s.row} style={{ marginTop: 12 }}>
          <span>{a.total} {a.total === 1 ? 'karta' : a.total >= 2 && a.total <= 4 ? 'karty' : 'karet'}</span>
          <span className={s.tag}>Vlastní</span>
        </div>
      )}
      <div className={s.value}>Hodnota <b><Kc n={a.value} /></b></div>
    </Link>
  );
}

function CardItem({ c, missing, extra }: { c: AlbumCard; missing?: boolean; extra?: string }) {
  const src = c.image ? thumbUrl(c.image) ?? c.image : null;
  return (
    <Link href={`/karty/${c.slug}`} className={s.mc}>
      <div className={`${s.mcImg} ${missing ? s.missing : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={c.name} loading="lazy" /> : null}
        <span className={s.num}>#{c.number}</span>
        {!missing && c.owned > 1 ? <span className={s.qty}>×{c.owned}</span> : null}
      </div>
      <b>{c.name}</b>
      <div className={s.mcRow}>
        <span>{missing ? (c.offers ? `${c.offers} ${c.offers === 1 ? 'nabídka' : c.offers <= 4 ? 'nabídky' : 'nabídek'}` : 'zatím bez nabídky') : extra ?? c.setName}</span>
        {c.minPrice ? <strong>od <Kc n={c.minPrice} /></strong> : null}
      </div>
    </Link>
  );
}

export default async function CollectionPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/kolekce');
  const { tab: rawTab } = await searchParams;
  const tab = rawTab === 'karty' || rawTab === 'chybi' ? rawTab : 'alba';
  const [o, all] = await Promise.all([getCollectionOverview(), getCollectionCards(400)]);
  const complete = o.albums.filter((a) => a.kind === 'set' && a.total > 0 && a.have >= a.total).length;
  const firstMissing = o.missing.filter((m) => m.offers > 0).slice(0, 12);
  const albumsWithMissing = [...new Set(firstMissing.map((m) => m.albumName))];

  return (
    <main className={s.wrap}>
      <div className={s.head}>
        <div>
          <h1>Moje kolekce</h1>
          <p>Tvoje alba, všechny karty a co ti do sad ještě chybí.</p>
        </div>
        <div className={s.actions}>
          <ButtonLink href="/kolekce/nove" variant="primary"><PlusIcon />Nové album</ButtonLink>
        </div>
      </div>

      <div className={s.stats}>
        <div className={s.stat}><span>Karet ve sbírce</span><b>{formatNumber(o.cardCount)}</b><em><i>+{o.addedThisWeek}</i> tento týden</em></div>
        <div className={s.stat}><span>Alba</span><b>{o.albums.length}</b><em>{complete} {complete === 1 ? 'kompletní sada' : complete >= 2 && complete <= 4 ? 'kompletní sady' : 'kompletních sad'}</em></div>
        <div className={s.stat}><span>Odhadovaná hodnota</span><b>{formatNumber(Math.round(o.value))} <small>Kč</small></b><em>podle nejnižších nabídek na V4cards</em></div>
        <div className={s.stat}><span>Chybí do kompletních sad</span><b>{formatNumber(o.missingTotal)}</b><em><i>{o.missingOffered}</i> z nich je teď v nabídce</em></div>
      </div>

      <CollectionTabs
        initial={tab}
        counts={{ alba: String(o.albums.length), karty: formatNumber(o.cardCount), chybi: formatNumber(o.missingTotal) }}
        panels={{
          alba: (
        <>
          <div className={s.grid}>
            {o.albums.map((a) => <AlbumTile key={a.id} a={a} />)}
            <Link href="/kolekce/nove" className={s.new}>
              <span className={s.plus}><PlusIcon size={28} stroke={2.5} /></span>
              <b>Nové album</b>
              <span>Celá sada s prázdnými místy, nebo vlastní výběr karet.</span>
            </Link>
          </div>
          {firstMissing.length ? (
            <>
              <div className={s.sec}>
                <h2>Chybí ti a jsou v nabídce<small>z alb {albumsWithMissing.join(', ')}</small></h2>
                <Link href="/kolekce?tab=chybi" data-tab="chybi">Všechny chybějící →</Link>
              </div>
              <div className={`${s.cards} ${s.oneRow}`}>{firstMissing.map((c) => <CardItem key={`${c.albumId}-${c.id}`} c={c} missing />)}</div>
            </>
          ) : null}
        </>
          ),
          karty: (
        all.length ? (
          <div className={s.cards} style={{ marginTop: 'var(--space-6)' }}>{all.map((c) => <CardItem key={c.id} c={c} />)}</div>
        ) : (
          <div className={s.empty}>
            <h2>Zatím tu nejsou žádné karty</h2>
            <p>Založ album a označ karty, které máš. Kartu přidáš i na její stránce tlačítkem „Mám ji“.</p>
            <ButtonLink href="/kolekce/nove">Založit album</ButtonLink>
          </div>
        )
          ),
          chybi: (
        o.missing.length ? (
          <>
            <p className={s.hint} style={{ marginTop: 'var(--space-4)' }}>Karty, které ti chybí v albech sad. Nahoře jsou ty, které teď někdo prodává.{o.missingTotal > o.missing.length ? ` Zobrazeno ${o.missing.length} z ${formatNumber(o.missingTotal)}.` : ''}</p>
            <div className={s.cards}>{o.missing.map((c) => <CardItem key={`${c.albumId}-${c.id}`} c={c} missing />)}</div>
          </>
        ) : (
          <div className={s.empty}>
            <h2>Nic ti nechybí</h2>
            <p>Chybějící karty se ukážou, když založíš album celé sady.</p>
            <ButtonLink href="/kolekce/nove">Založit album sady</ButtonLink>
          </div>
        )
          ),
        }}
      />
    </main>
  );
}
