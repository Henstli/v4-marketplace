import type { Metadata } from 'next';
import Link from 'next/link';
import { ChipLink } from '@/components/trezor';
import { SearchBox } from '@/components/search/SearchBox';
import { CardSummaryTile } from '@/components/CardSummaryTile';
import { findSetsAndSellers, getSet, PAGE_SIZE, searchCards, type CatalogQuery, type SortKey } from '@/lib/catalog';
import { formatNumber, plural } from '@/lib/format';
import { GAMES, getGame, type GameId } from '@/lib/games';
import { CONDITIONS, LANGUAGE_NAMES, type Condition, type Language, type SellerKind } from '@/lib/types';
import styles from './catalog.module.css';

export const metadata: Metadata = { title: 'Karty' };

type Params = Record<string, string | string[] | undefined>;

// Parametry v URL jsou česky, ať se dají sdílet a čtou se v adrese.
const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'relevance', label: 'Doporučené' },
  { id: 'price-asc', label: 'Nejlevnější' },
  { id: 'price-desc', label: 'Nejdražší' },
  { id: 'trend', label: 'Největší růst' },
];
const SORT_PARAM: Record<SortKey, string> = { relevance: '', 'price-asc': 'cena', 'price-desc': 'cena-sestupne', trend: 'trend' };
const SELLER_KINDS: Array<{ id: SellerKind; label: string; param: string }> = [
  { id: 'shop', label: 'Obchody', param: 'obchod' },
  { id: 'private', label: 'Sběratelé', param: 'sberatel' },
];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v || undefined;
}

function parse(params: Params): CatalogQuery {
  const game = one(params.hra);
  const condition = one(params.stav);
  const language = one(params.jazyk);
  const seller = one(params.prodejce);
  const sort = one(params.razeni);
  const page = Number(one(params.strana));
  return {
    q: one(params.q),
    game: game && getGame(game) ? (game as GameId) : undefined,
    condition: CONDITIONS.includes(condition as Condition) ? (condition as Condition) : undefined,
    language: language && language in LANGUAGE_NAMES ? (language as Language) : undefined,
    sellerKind: SELLER_KINDS.find((k) => k.param === seller)?.id,
    sort: (Object.keys(SORT_PARAM) as SortKey[]).find((k) => SORT_PARAM[k] && SORT_PARAM[k] === sort) ?? 'relevance',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

function href(params: Params, key: string, value: string | undefined): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const val = one(v);
    // Změna filtru vrací na první stránku.
    // Sada patří k jedné hře, změna hry ji zruší.
    if (val && k !== key && k !== 'strana' && !(key === 'hra' && k === 'sada')) next.set(k, val);
  }
  if (value) next.set(key, value);
  const s = next.toString();
  return s ? `/karty?${s}` : '/karty';
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = parse(params);
  const setCode = one(params.sada);
  const set = setCode ? await getSet(query.game, setCode) : null;
  const [{ cards, total }, related] = await Promise.all([
    searchCards({ ...query, setId: set?.id }),
    // K hledanému textu nabídneme i sady a prodejce („Obsidian Flames“, jméno obchodu).
    query.q && !set && (query.page ?? 1) === 1 ? findSetsAndSellers(query.q, query.game) : null,
  ]);
  const page = query.page ?? 1;
  const pages = Math.ceil(total / PAGE_SIZE);
  const pageHref = (n: number) => {
    const base = href(params, 'razeni', one(params.razeni));
    if (n <= 1) return base;
    return `${base}${base.includes('?') ? '&' : '?'}strana=${n}`;
  };
  const game = query.game ? getGame(query.game) : undefined;
  const sellerParam = SELLER_KINDS.find((k) => k.id === query.sellerKind)?.param;

  return (
    <div className={`container ${styles.layout}`}>
      <aside className={styles.filters} aria-label="Filtry">
        <SearchBox
          key={query.q ?? ''}
          className={styles.filterSearch}
          defaultValue={query.q}
          placeholder="Hledat v katalogu"
          label="Hledat v katalogu"
          game={query.game}
          groups
          keep={Object.fromEntries(
            Object.entries(params).flatMap(([k, v]) => (k !== 'q' && k !== 'strana' && one(v) ? [[k, one(v)!]] : [])),
          )}
        />

        <FilterGroup title="HRA">
          <ChipLink href={href(params, 'hra', undefined)} selected={!query.game}>Vše</ChipLink>
          {GAMES.filter((g) => g.live).map((g) => (
            <ChipLink key={g.id} href={href(params, 'hra', g.id)} selected={query.game === g.id} dot={g.dot}>
              {g.name}
            </ChipLink>
          ))}
        </FilterGroup>

        {set ? (
          <FilterGroup title="SADA">
            <ChipLink href={href(params, 'sada', undefined)}>Všechny sady</ChipLink>
            <ChipLink href={href(params, 'sada', set.code)} selected dot={getGame(set.game)?.dot}>{set.name}</ChipLink>
          </FilterGroup>
        ) : null}

        <FilterGroup title="STAV">
          <ChipLink href={href(params, 'stav', undefined)} selected={!query.condition}>Vše</ChipLink>
          {CONDITIONS.map((c) => (
            <ChipLink key={c} href={href(params, 'stav', c)} selected={query.condition === c}>{c}</ChipLink>
          ))}
        </FilterGroup>

        <FilterGroup title="JAZYK">
          <ChipLink href={href(params, 'jazyk', undefined)} selected={!query.language}>Vše</ChipLink>
          {(Object.keys(LANGUAGE_NAMES) as Language[]).map((l) => (
            <ChipLink key={l} href={href(params, 'jazyk', l)} selected={query.language === l}>{LANGUAGE_NAMES[l]}</ChipLink>
          ))}
        </FilterGroup>

        <FilterGroup title="PRODEJCE">
          <ChipLink href={href(params, 'prodejce', undefined)} selected={!query.sellerKind}>Všichni</ChipLink>
          {SELLER_KINDS.map((k) => (
            <ChipLink key={k.id} href={href(params, 'prodejce', k.param)} selected={sellerParam === k.param}>{k.label}</ChipLink>
          ))}
        </FilterGroup>
      </aside>

      <section className={styles.results}>
        <div className="section-head">
          <div>
            <h1 className="t-heading-l">
              {query.q ? `Výsledky pro „${query.q}“` : set ? set.name : game ? game.name : 'Všechny karty'}
            </h1>
            <p className="t-small muted">
              {set ? `${[getGame(set.game)?.name, set.code, set.year].filter(Boolean).join(' · ')} · ` : ''}
              {resultCount(total)}{pages > 1 ? ` · strana ${page} z ${formatNumber(pages)}` : ''}
            </p>
          </div>
          <nav className={styles.sort} aria-label="Řazení">
            {SORTS.map((s) => (
              <ChipLink key={s.id} href={href(params, 'razeni', SORT_PARAM[s.id] || undefined)} selected={query.sort === s.id}>
                {s.label}
              </ChipLink>
            ))}
          </nav>
        </div>

        {related && (related.sets.length || related.sellers.length) ? (
          <div className={styles.related}>
            {related.sets.length ? (
              <div className={styles.relatedRow}>
                <span className="t-label muted">SADY</span>
                {related.sets.map((s) => (
                  <ChipLink key={s.id} href={`/karty?${new URLSearchParams({ hra: s.game, sada: s.code })}`} dot={getGame(s.game)?.dot}>
                    {s.name} · {plural(s.cards, ['karta', 'karty', 'karet'])}
                  </ChipLink>
                ))}
              </div>
            ) : null}
            {related.sellers.length ? (
              <div className={styles.relatedRow}>
                <span className="t-label muted">PRODEJCI</span>
                {related.sellers.map((s) => (
                  <ChipLink key={s.id} href={`/prodejci/${s.id}`}>
                    {s.name} · {plural(s.offers, ['nabídka', 'nabídky', 'nabídek'])}
                  </ChipLink>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {cards.length ? (
          <>
            <div className="card-grid">
              {cards.map((card) => <CardSummaryTile key={card.id} card={card} />)}
            </div>
            {pages > 1 ? (
              <nav className={styles.pager} aria-label="Stránky">
                {page > 1 ? <ChipLink href={pageHref(page - 1)}>← Předchozí</ChipLink> : null}
                <span className="t-small muted">Strana {page} z {formatNumber(pages)}</span>
                {page < pages ? <ChipLink href={pageHref(page + 1)}>Další →</ChipLink> : null}
              </nav>
            ) : null}
          </>
        ) : (
          <div className="panel">
            <h2 className="t-heading-m">Nic jsme nenašli</h2>
            <p className="muted">Zkuste jiný název karty, sady nebo prodejce, případně zrušte některý z filtrů.</p>
            {query.game === 'sport' ? (
              <p className="muted">
                Sportovní karty do katalogu přidávají prodejci. Máte kartu, která tu chybí? <Link href="/prodat/nova-karta">Navrhněte ji</Link>.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function resultCount(n: number): string {
  if (n === 1) return '1 karta';
  if (n >= 2 && n <= 4) return `${n} karty`;
  return `${formatNumber(n)} karet`;
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <h2 className="t-label muted">{title}</h2>
      <div className={styles.chips}>{children}</div>
    </div>
  );
}
