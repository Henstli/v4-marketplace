'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, ButtonLink, CardThumb, FileDrop, Status, Steps } from '@/components/trezor';
import { formatNumber, plural } from '@/lib/format';
import { GAMES, getGame, type GameId } from '@/lib/games';
import { thumbUrl } from '@/lib/images';
import { FIELDS, guessMapping, isCardmarketExport, QUANTITY_MAX, type Mapping } from '@/lib/import/columns';
import { readTable, ReadError, type Table } from '@/lib/import/read-file';
import { buildRows, csvLine, rowProblems, type CardLite, type ImportRow, type ImportSettings } from '@/lib/import/rows';
import { CONDITION_NAMES, CONDITIONS, LANGUAGE_NAMES, type Condition, type Language } from '@/lib/types';
import { createImportedListings, matchImportRows, searchImportCards, type MatchInput } from './actions';
import styles from './import.module.css';

const STEPS = ['Soubor', 'Sloupce', 'Kontrola', 'Hotovo'];
const PAGE = 100;
const MATCH_CHUNK = 200;

interface Match {
  status: 'pending' | 'ok' | 'multi' | 'none';
  candidates: CardLite[];
  card: CardLite | null;
}

type Filter = 'all' | 'fix' | 'ready';

export function ImportWizard() {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [cardmarket, setCardmarket] = useState(false);
  const [readError, setReadError] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const [settings, setSettings] = useState<ImportSettings>({ game: '', currency: 'CZK', rate: 25, condition: 'NM', language: 'en' });
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [matches, setMatches] = useState<Record<number, Match>>({});
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; left: ImportRow[] } | null>(null);
  const [saving, startSaving] = useTransition();


  async function onFile(file: File) {
    setReadError('');
    setFileName(file.name);
    try {
      const t = await readTable(file);
      const cm = isCardmarketExport(t.header);
      setTable(t);
      setCardmarket(cm);
      setMapping(guessMapping(t.header));
      setSettings((s) => ({ ...s, currency: cm ? 'EUR' : s.currency }));
      setStep(1);
    } catch (e) {
      setTable(null);
      setReadError(e instanceof ReadError ? e.message : 'Soubor se nepodařilo přečíst. Nahrajte prosím CSV nebo Excel (.xlsx).');
    }
  }

  const canMatch = mapping.name != null || ((mapping.setCode != null || mapping.setName != null) && mapping.number != null);

  async function runMatching() {
    if (!table) return;
    setError('');
    const built = buildRows(table, mapping, settings);
    setRows(built);
    setSkipped(new Set());
    setFilter('all');
    setPage(0);
    setResult(null);
    const initial: Record<number, Match> = {};
    for (const r of built) initial[r.line] = { status: 'pending', candidates: [], card: null };
    setMatches(initial);
    setStep(2);
    setProgress({ done: 0, total: built.length });
    for (let i = 0; i < built.length; i += MATCH_CHUNK) {
      const chunk = built.slice(i, i + MATCH_CHUNK);
      const input: MatchInput[] = chunk.map((r) => ({
        idx: r.line, game: r.game, set_code: r.setCode, set_name: r.setName, number: r.number, name: r.name,
      }));
      const res = await matchImportRows(input);
      if (res.error || !res.results) {
        setError(res.error ?? 'Párování s katalogem se nepovedlo.');
        setProgress(null);
        return;
      }
      setMatches((m) => {
        const next = { ...m };
        for (const r of res.results!) {
          next[r.idx] = { status: r.status, candidates: r.candidates, card: r.status === 'ok' ? r.candidates[0] ?? null : null };
        }
        return next;
      });
      setProgress({ done: Math.min(built.length, i + MATCH_CHUNK), total: built.length });
    }
    setProgress(null);
  }

  const problemsOf = (r: ImportRow) => {
    const p = rowProblems(r);
    const m = matches[r.line];
    if (!m || m.status === 'pending') return ['Páruji…', ...p];
    if (!m.card) return [m.status === 'multi' ? 'Vyberte kartu' : 'Karta nenalezena', ...p];
    return p;
  };

  const stats = useMemo(() => {
    let ready = 0, fix = 0;
    for (const r of rows) {
      if (skipped.has(r.line)) continue;
      if (problemsOf(r).length) fix++; else ready++;
    }
    return { ready, fix, skipped: skipped.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, matches, skipped]);

  const visible = rows.filter((r) => {
    if (filter === 'all') return true;
    const ok = !skipped.has(r.line) && problemsOf(r).length === 0;
    return filter === 'ready' ? ok : !ok && !skipped.has(r.line);
  });
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const shown = visible.slice(page * PAGE, page * PAGE + PAGE);

  function updateRow(line: number, patch: Partial<ImportRow>) {
    setRows((rs) => rs.map((r) => (r.line === line ? { ...r, ...patch } : r)));
  }

  function pickCard(line: number, card: CardLite | null) {
    setMatches((m) => ({ ...m, [line]: { ...(m[line] ?? { status: 'none', candidates: [] }), card } }));
  }

  function toggleSkip(line: number) {
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(line)) next.delete(line); else next.add(line);
      return next;
    });
  }

  function save() {
    const ready = rows.filter((r) => !skipped.has(r.line) && problemsOf(r).length === 0);
    if (!ready.length) return;
    setError('');
    startSaving(async () => {
      const res = await createImportedListings(ready.map((r) => ({
        cardId: matches[r.line].card!.id,
        condition: r.condition!,
        language: r.language!,
        price: r.price!,
        quantity: r.quantity!,
        graded: r.graded,
        note: r.note,
      })));
      if (res.error && !res.created) {
        setError(res.error);
        return;
      }
      if (res.error) setError(res.error);
      // Ukládá se po částech v pořadí, takže vystavené jsou prvních `created` připravených řádků.
      const created = new Set(ready.slice(0, res.created ?? 0).map((r) => r.line));
      setResult({ created: created.size, left: rows.filter((r) => !created.has(r.line)) });
      setStep(3);
    });
  }

  function downloadLeft() {
    if (!table || !result) return;
    const lines = [csvLine(table.header), ...result.left.map((r) => csvLine(table.rows[r.line - 2]))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nevystavene-${fileName.replace(/\.[^.]+$/, '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function reset() {
    setStep(0); setTable(null); setFileName(''); setRows([]); setMatches({}); setResult(null); setError('');
  }

  return (
    <div className={styles.wizard}>
      <Steps steps={STEPS} current={step} label="Hromadné nahrávání" />

      {step === 0 ? (
        <section className={styles.stack}>
          <FileDrop
            accept=".csv,.txt,.tsv,.xlsx"
            fileName={fileName}
            hint="CSV nebo Excel (.xlsx), i export skladu z Cardmarketu"
            onFile={onFile}
          />
          {readError ? <p className={styles.error} role="alert">{readError}</p> : null}
          <div className={styles.help}>
            <div>
              <h3 className={styles.helpTitle}>Vlastní tabulka</h3>
              <p className="t-small muted">
                Stačí sloupce s názvem karty, sadou a číslem, stavem, jazykem, cenou a počtem kusů. Názvy sloupců
                rozpoznáme sami, jinak je přiřadíte v dalším kroku. <a href="/prodat/import/sablona">Stáhnout šablonu (CSV)</a>
              </p>
            </div>
            <div>
              <h3 className={styles.helpTitle}>Export z Cardmarketu</h3>
              <p className="t-small muted">
                Nahrajte export svého skladu z Cardmarketu (CSV) beze změn. Ceny v eurech přepočítáme na koruny podle kurzu,
                který si nastavíte, a playsety rozdělíme na kusy.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {step === 1 && table ? (
        <section className={styles.stack}>
          <div className={styles.fileLine}>
            <span className="code">{fileName}</span>
            <span className="t-small muted">
              {plural(table.rows.length, ['řádek', 'řádky', 'řádků'])}{cardmarket ? ' · export z Cardmarketu' : ''}
            </span>
            <Button variant="ghost" onClick={reset}>Jiný soubor</Button>
          </div>

          <div className={styles.settings}>
            <label className={styles.field}>
              <span className="t-label muted">HRA</span>
              <select className={styles.input} value={settings.game} onChange={(e) => setSettings({ ...settings, game: e.target.value as GameId | '' })}>
                <option value="">{mapping.game != null ? 'Podle sloupce Hra' : 'Rozpoznat automaticky'}</option>
                {GAMES.filter((g) => g.live).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className="t-label muted">CENY V SOUBORU</span>
              <select className={styles.input} value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value as 'CZK' | 'EUR' })}>
                <option value="CZK">Kč</option>
                <option value="EUR">EUR (přepočítat)</option>
              </select>
            </label>
            {settings.currency === 'EUR' || mapping.currency != null ? (
              <label className={styles.field}>
                <span className="t-label muted">KURZ (KČ ZA 1 EUR)</span>
                <input
                  className={styles.input}
                  type="number" min={1} max={100} step={0.01} inputMode="decimal"
                  value={settings.rate}
                  onChange={(e) => setSettings({ ...settings, rate: Number(e.target.value) || 0 })}
                />
              </label>
            ) : null}
            <label className={styles.field}>
              <span className="t-label muted">STAV, KDYŽ CHYBÍ</span>
              <select className={styles.input} value={settings.condition} onChange={(e) => setSettings({ ...settings, condition: e.target.value as Condition })}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{c} · {CONDITION_NAMES[c]}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className="t-label muted">JAZYK, KDYŽ CHYBÍ</span>
              <select className={styles.input} value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value as Language })}>
                {(Object.keys(LANGUAGE_NAMES) as Language[]).map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
              </select>
            </label>
          </div>

          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead>
                <tr><th>Údaj</th><th>Sloupec v souboru</th><th>Ukázka</th></tr>
              </thead>
              <tbody>
                {FIELDS.map((f) => {
                  const col = mapping[f.key];
                  const sample = col != null ? table.rows.slice(0, 3).map((r) => r[col]).filter(Boolean).join(' · ') : '';
                  return (
                    <tr key={f.key}>
                      <td>
                        <div className={styles.fieldName}>{f.label}</div>
                        {f.hint ? <div className="t-small muted">{f.hint}</div> : null}
                      </td>
                      <td>
                        <select
                          className="tz-cell-input"
                          aria-label={`Sloupec pro ${f.label}`}
                          value={col ?? ''}
                          onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                        >
                          <option value="">Nepoužít</option>
                          {table.header.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </td>
                      <td className={`tz-muted ${styles.sample}`}>{sample || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!canMatch ? <p className={styles.error} role="alert">Přiřaďte aspoň sloupec s názvem karty, nebo sadu a číslo karty.</p> : null}
          {mapping.price == null ? <p className="t-small muted">Sloupec s cenou není přiřazený, ceny pak vyplníte v dalším kroku ručně.</p> : null}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setStep(0)}>Zpět</Button>
            <Button size="lg" disabled={!canMatch || (settings.currency === 'EUR' && !(settings.rate > 0))} onClick={runMatching}>
              Spárovat s katalogem
            </Button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className={styles.stack}>
          <div className={styles.summary}>
            {(['all', 'fix', 'ready'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className="tz-chip"
                aria-pressed={filter === f ? 'true' : 'false'}
                onClick={() => { setFilter(f); setPage(0); }}
              >
                {f === 'all' ? `Vše ${formatNumber(rows.length)}` : f === 'fix' ? `K opravě ${formatNumber(stats.fix)}` : `Připraveno ${formatNumber(stats.ready)}`}
              </button>
            ))}
            {progress ? (
              <span className="t-small muted" role="status">Páruji s katalogem… {formatNumber(progress.done)} z {formatNumber(progress.total)}</span>
            ) : null}
          </div>

          <div className="tz-table-wrap">
            <table className="tz-table">
              <thead>
                <tr>
                  <th className="tz-check">Vystavit</th>
                  <th>Karta</th>
                  <th>Stav</th>
                  <th>Jazyk</th>
                  <th className="tz-num">Cena Kč</th>
                  <th className="tz-num">Ks</th>
                  <th>Kontrola</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const m = matches[r.line];
                  const skip = skipped.has(r.line);
                  const problems = problemsOf(r);
                  return (
                    <tr key={r.line}>
                      <td className="tz-check">
                        <input type="checkbox" checked={!skip} onChange={() => toggleSkip(r.line)} aria-label={`Vystavit řádek ${r.line}`} />
                      </td>
                      <td className={styles.cardCell}>
                        <CardCell row={r} match={m} game={settings.game || r.game || undefined} onPick={(c) => pickCard(r.line, c)} />
                      </td>
                      <td>
                        <select
                          className="tz-cell-input"
                          aria-label="Stav"
                          aria-invalid={!r.condition}
                          value={r.condition ?? ''}
                          onChange={(e) => updateRow(r.line, { condition: (e.target.value || null) as Condition | null })}
                        >
                          {!r.condition ? <option value="">{r.rawCondition || 'Vyberte'}</option> : null}
                          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td>
                        <select
                          className="tz-cell-input"
                          aria-label="Jazyk"
                          aria-invalid={!r.language}
                          value={r.language ?? ''}
                          onChange={(e) => updateRow(r.line, { language: (e.target.value || null) as Language | null })}
                        >
                          {!r.language ? <option value="">{r.rawLanguage || 'Vyberte'}</option> : null}
                          {(Object.keys(LANGUAGE_NAMES) as Language[]).map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
                        </select>
                      </td>
                      <td className="tz-num">
                        <input
                          className={`tz-cell-input tz-num ${styles.priceInput}`}
                          aria-label="Cena za kus v Kč"
                          aria-invalid={r.price == null}
                          inputMode="numeric"
                          value={r.price ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '');
                            updateRow(r.line, { price: v ? Number(v) : null });
                          }}
                        />
                      </td>
                      <td className="tz-num">
                        <input
                          className={`tz-cell-input tz-num ${styles.qtyInput}`}
                          aria-label="Počet kusů"
                          aria-invalid={r.quantity == null || r.quantity < 1 || r.quantity > QUANTITY_MAX}
                          inputMode="numeric"
                          value={r.quantity ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '');
                            updateRow(r.line, { quantity: v ? Number(v) : null });
                          }}
                        />
                      </td>
                      <td>
                        {skip ? <Status tone="muted">Vynecháno</Status>
                          : problems.length ? <Status tone={m?.status === 'pending' ? 'muted' : 'warn'}>{problems[0]}</Status>
                          : <Status tone="ok">Připraveno</Status>}
                        <div className="t-small muted">Řádek {r.line}</div>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length ? (
                  <tr><td colSpan={7} className="tz-muted">{filter === 'fix' ? 'Nic k opravě.' : 'Žádné řádky.'}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <div className={styles.pager}>
              <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Předchozí</Button>
              <span className="t-small muted">Strana {page + 1} z {pages}</span>
              <Button variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Další</Button>
            </div>
          ) : null}

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>Zpět ke sloupcům</Button>
            <div className={styles.saveBox}>
              {stats.fix ? <span className="t-small muted">{plural(stats.fix, ['řádek', 'řádky', 'řádků'])} k opravě se nevystaví.</span> : null}
              <Button size="lg" disabled={!!progress || saving || !stats.ready} onClick={save}>
                {saving ? 'Vystavuji…' : `Vystavit ${plural(stats.ready, ['nabídku', 'nabídky', 'nabídek'])}`}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {step === 3 && result ? (
        <section className={styles.stack}>
          <div className={styles.done}>
            <h2 className="t-heading-m">Vystaveno {plural(result.created, ['nabídka', 'nabídky', 'nabídek'])}</h2>
            <p className="muted">Nabídky jsou hned vidět v katalogu. Ceny a počty upravíte hromadně v sekci Moje nabídky.</p>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {result.left.length ? (
              <p className="t-small">
                {plural(result.left.length, ['řádek se nevystavil', 'řádky se nevystavily', 'řádků se nevystavilo'])}.{' '}
                <button type="button" className={styles.linkButton} onClick={downloadLeft}>Stáhnout je jako CSV</button>, opravit a nahrát znovu.
              </p>
            ) : null}
          </div>
          <div className={styles.actions}>
            <ButtonLink href="/prodat#moje-nabidky" variant="secondary">Moje nabídky</ButtonLink>
            <div className={styles.saveBox}>
              <Button onClick={reset}>Nahrát další soubor</Button>
            </div>
          </div>
        </section>
      ) : null}

    </div>
  );
}

function cardLine(c: CardLite) {
  return [c.setCode, c.number].filter(Boolean).join(' ');
}

function CardCell({ row, match, game, onPick }: { row: ImportRow; match?: Match; game?: GameId; onPick: (c: CardLite | null) => void }) {
  const [searching, setSearching] = useState(false);
  const fromFile = [row.name, row.setName || row.setCode, row.number].filter(Boolean).join(' · ') || 'Prázdný řádek';

  if (!match || match.status === 'pending') {
    return <span className="tz-muted">{fromFile}</span>;
  }

  if (match.card && !searching) {
    const c = match.card;
    return (
      <div className={styles.card}>
        <CardThumb size="sm" image={thumbUrl(c.image ?? undefined)} preview={c.image ?? undefined} color={`var(--game-${c.game}-art, var(--surface-sunken))`} />
        <div className={styles.cardText}>
          <Link href={`/karty/${c.slug}`} target="_blank" className={styles.cardName}>{c.name}</Link>
          <div className="t-small muted">
            <span className={styles.dot} style={{ background: getGame(c.game)?.dot }} aria-hidden="true" /> {c.setName} · <span className={styles.mono}>{cardLine(c)}</span>
          </div>
        </div>
        <button type="button" className={styles.linkButton} onClick={() => (match.candidates.length > 1 ? onPick(null) : setSearching(true))}>
          Změnit
        </button>
      </div>
    );
  }

  return (
    <div className={styles.fix}>
      <div className="t-small muted">Ze souboru: {fromFile}</div>
      {match.candidates.length > 1 && !searching ? (
        <select
          className="tz-cell-input"
          aria-label="Vyberte kartu"
          aria-invalid="true"
          value=""
          onChange={(e) => {
            if (e.target.value === 'hledat') setSearching(true);
            else onPick(match.candidates.find((c) => c.id === e.target.value) ?? null);
          }}
        >
          <option value="">Vyberte kartu ({plural(match.candidates.length, ['možnost', 'možnosti', 'možností'])})</option>
          {match.candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.setName} · {cardLine(c)}</option>)}
          <option value="hledat">Hledat jinou kartu…</option>
        </select>
      ) : (
        <CardSearch defaultQuery={[row.name, row.number].filter(Boolean).join(' ')} game={game} onPick={(c) => { onPick(c); setSearching(false); }} onCancel={match.card ? () => setSearching(false) : undefined} />
      )}
    </div>
  );
}

function CardSearch({ defaultQuery, game, onPick, onCancel }: { defaultQuery: string; game?: GameId; onPick: (c: CardLite) => void; onCancel?: () => void }) {
  const [q, setQ] = useState(defaultQuery);
  const [results, setResults] = useState<CardLite[] | null>(null);
  const [pending, start] = useTransition();
  const search = () => start(async () => setResults(await searchImportCards(q, game)));
  return (
    <div className={styles.search}>
      <div className={styles.searchRow}>
        <input
          className="tz-cell-input"
          aria-label="Hledat kartu v katalogu"
          placeholder="Název karty, sada nebo číslo"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
        />
        <Button variant="secondary" onClick={search} disabled={pending || q.trim().length < 2}>{pending ? 'Hledám…' : 'Najít'}</Button>
        {onCancel ? <Button variant="ghost" onClick={onCancel}>Zrušit</Button> : null}
      </div>
      {results ? (
        results.length ? (
          <ul className={styles.results}>
            {results.map((c) => (
              <li key={c.id}>
                <button type="button" className={styles.result} onClick={() => onPick(c)}>
                  <CardThumb size="sm" image={thumbUrl(c.image ?? undefined)} color={`var(--game-${c.game}-art, var(--surface-sunken))`} />
                  <span className={styles.cardText}>
                    <span className={styles.cardName}>{c.name}</span>
                    <span className="t-small muted">{c.setName} · <span className={styles.mono}>{cardLine(c)}</span></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="t-small muted">Nic jsme nenašli. Zkuste jiný název nebo číslo.</p>
      ) : null}
    </div>
  );
}
