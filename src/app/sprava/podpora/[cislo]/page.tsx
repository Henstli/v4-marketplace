import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReportPanel } from '@/components/reports/ReportPanel';
import { ReplyBox, type ReplyTarget } from '@/components/support/ReplyBox';
import { Ticker } from '@/components/support/Ticker';
import { Button, Status } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDateTime, formatPrice } from '@/lib/format';
import { ORDER_STATUS } from '@/lib/order-status';
import { loadReportFiles, REPORT_SELECT, reportCode, type ReportRow } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import {
  caseCode, dueGroup, dueText, hm, hmLong, isoToPragueLocal, KIND, minutesOf, PRIORITY, STATUS,
  type CaseEvent, type CasePriority, type CaseRow, type CaseStatus, type TimeRow,
} from '@/lib/support';
import { addTime, decideContent, fixTime, startTimer, stopTimer, updateCase } from '../actions';
import { CONTENT_REASON, contentCode, KIND_NOUN, type ContentKind, type ContentReason, type ContentSnapshot } from '@/lib/content-reports';
import styles from '../podpora.module.css';

type Props = { params: Promise<{ cislo: string }>; searchParams: Promise<{ ok?: string; chyba?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cislo } = await params;
  return { title: `${caseCode(Number(cislo) || 0)} · podpora` };
}

interface ContentRow {
  id: string; number: number; target_kind: ContentKind; listing_id: string | null; message_id: number | null; review_id: string | null;
  author_id: string | null; url: string | null; reason: ContentReason; body: string; reporter_id: string | null;
  reporter_name: string | null; reporter_email: string | null; snapshot: ContentSnapshot; decision: 'kept' | 'removed' | null;
  facts: string | null; decided_at: string | null; created_at: string;
}

interface AdminOrder { id: string; number: number; status: string; buyer_id: string | null; seller_id: string | null; total_czk: number; shipping_czk: number }

/** Případ podpory: časová osa, odpověď, stav a čas (DS Support, Případ). */
export default async function CasePage({ params, searchParams }: Props) {
  const [{ cislo }, { ok, chyba }] = await Promise.all([params, searchParams]);
  const number = Number(cislo);
  if (!Number.isInteger(number) || number < 1) notFound();
  const user = (await getCurrentUser())!;
  const supabase = await createClient();
  const { data: c } = await supabase.from('support_cases').select('*').eq('number', number).maybeSingle<CaseRow>();
  if (!c) notFound();

  const [{ data: events }, { data: times }, { data: staff }, { data: report }, { data: orders }] = await Promise.all([
    supabase.from('case_events').select('*').eq('case_id', c.id).order('created_at').returns<CaseEvent[]>(),
    supabase.from('case_time').select('*').eq('case_id', c.id).order('started_at').returns<TimeRow[]>(),
    supabase.rpc('admin_staff'),
    c.report_id ? supabase.from('reports').select(REPORT_SELECT).eq('id', c.report_id).maybeSingle<ReportRow>() : Promise.resolve({ data: null }),
    c.order_id ? supabase.rpc('admin_orders', { p_ids: [c.order_id] }) : Promise.resolve({ data: [] }),
  ]);
  const { data: content } = c.kind === 'content'
    ? await supabase.from('content_reports').select('*').eq('case_id', c.id).order('created_at').returns<ContentRow[]>()
    : { data: null };
  const order = ((orders ?? []) as AdminOrder[])[0] ?? null;
  // Správce cizí objednávky přes RLS nevidí, údaje doplníme z admin_orders.
  if (report && order) report.orders = { number: order.number, buyer_id: order.buyer_id, seller_id: order.seller_id, total_czk: order.total_czk, shipping_czk: order.shipping_czk };
  const files = report ? await loadReportFiles(supabase, report.id) : [];

  const ids = [...new Set([c.user_id, c.other_id, ...(events ?? []).map((e) => e.author_id), ...(times ?? []).map((t) => t.staff_id)].filter((x): x is string => !!x))];
  const [{ data: people }, { data: other }] = await Promise.all([
    ids.length ? supabase.from('profiles').select('id, display_name, kind').in('id', ids) : Promise.resolve({ data: [] }),
    c.other_id ? supabase.rpc('admin_user_info', { p_user: c.other_id }) : Promise.resolve({ data: null }),
  ]);
  const name = (id: string | null) => (id ? (people ?? []).find((p) => p.id === id)?.display_name ?? 'smazaný účet' : '');
  const staffList = (staff ?? []) as Array<{ id: string; name: string }>;
  const role = (id: string | null) => (!order || !id ? '' : id === order.buyer_id ? 'kupující' : id === order.seller_id ? 'prodejce' : '');

  const targets: ReplyTarget[] = [];
  if (c.user_id) targets.push({ id: 'user', label: `${name(c.user_id)}${role(c.user_id) ? ` (${role(c.user_id)})` : ''}` });
  if (c.other_id) targets.push({ id: 'other', label: `${name(c.other_id)}${role(c.other_id) ? ` (${role(c.other_id)})` : ''}` });
  if (c.user_id && c.other_id) targets.push({ id: 'both', label: 'Oběma stranám' });
  if (c.contact_email) targets.push({ id: 'contact', label: c.contact_email });

  const running = (times ?? []).find((t) => !t.ended_at && t.staff_id === user.id);
  const total = (times ?? []).reduce((s, t) => s + minutesOf(t), 0);
  const group = dueGroup(c);
  const path = `/sprava/podpora/${c.number}`;
  const info = other as null | { cancelled_after_paid: number; disputes: number; listings: number; restriction: { kind: string } | null };

  return (
    <div className={styles.page}>
      <div className={styles.caseHead}>
        <Link href="/sprava/podpora" className={styles.link}>← Fronta</Link>
        <div className={styles.caseTitle}>
          <span className={styles.caseCode}>{caseCode(c.number)}</span>
          <h1>{c.subject}</h1>
        </div>
        <div className={styles.row}>
          <Status tone={c.status === 'open' ? 'info' : c.status === 'waiting' ? 'warn' : 'muted'}>{STATUS[c.status]}</Status>
          {c.status !== 'resolved' && c.due_at ? (
            <Status tone={group === 'late' ? 'warn' : 'muted'}>{group === 'late' ? 'Po termínu · ' : 'Termín '}{dueText(c.due_at)}</Status>
          ) : null}
          <span className={`${styles.prio} ${styles[`prio-${c.priority}`]}`}>{PRIORITY[c.priority]}</span>
          <span className={styles.small}>{KIND[c.kind]} · založeno {formatDateTime(c.created_at)}</span>
        </div>
      </div>
      {ok ? <p className={styles.flash}>{ok}</p> : null}
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          <ol className={styles.timeline}>
            {(events ?? []).map((e) => (
              <li key={e.id}>
                {e.kind === 'event' ? (
                  <span className={styles.ev}>{formatDateTime(e.created_at)} · {e.body}{e.author_id ? ` · ${name(e.author_id)}` : ''}</span>
                ) : (
                  <div className={`${styles.msg} ${e.kind === 'note' ? styles.msgNote : e.kind === 'email' ? styles.msgMail : ''}`}>
                    <span className={styles.msgMeta}>
                      {e.kind === 'note' ? `INTERNÍ POZNÁMKA · ${name(e.author_id)} · uživatel ji nevidí`
                        : e.kind === 'email' ? `E-MAIL · ${name(e.author_id)} → ${e.recipients ?? ''}`
                          : `${name(e.author_id) || c.contact_email || 'Uživatel'}${role(e.author_id) ? ` · ${role(e.author_id)}` : ''}`}
                      {' · '}{formatDateTime(e.created_at)}
                    </span>
                    <div className={styles.msgBody}>{e.body}</div>
                  </div>
                )}
              </li>
            ))}
            {!events?.length ? <li className={styles.small}>Zatím žádné události.</li> : null}
          </ol>

          {content?.length ? <ContentPanel caseId={c.id} rows={content} name={name} /> : null}

          <ReplyBox caseId={c.id} number={c.number} targets={targets} />

          {report ? (
            <ReportPanel r={report} me={user.id} files={files} admin
              otherName={`${name(report.reporter_id)} (${report.reporter_role === 'buyer' ? 'kupující' : 'prodejce'}) → ${name(report.against_id)}`} />
          ) : null}
        </div>

        <aside className={styles.side}>
          <form action={updateCase} className={styles.box}>
            <input type="hidden" name="case_id" value={c.id} />
            <label className={styles.field}>Stav
              <select className={styles.input} name="status" defaultValue={c.status}>
                {(Object.keys(STATUS) as CaseStatus[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
              </select>
            </label>
            <div className={styles.two}>
              <label className={styles.field}>Priorita
                <select className={styles.input} name="priority" defaultValue={c.priority}>
                  {(Object.keys(PRIORITY) as CasePriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
                </select>
              </label>
              <label className={styles.field}>Řeší
                <select className={styles.input} name="assignee" defaultValue={c.assignee_id ?? ''}>
                  <option value="">Nepřiřazeno</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <label className={styles.field}>Termín
              <input className={styles.input} type="datetime-local" name="due" defaultValue={c.due_at ? isoToPragueLocal(c.due_at) : ''} />
            </label>
            <Button type="submit" variant="secondary">Uložit</Button>
          </form>

          <section className={styles.box} aria-label="Čas na případu">
            <h2 className={styles.boxTitle}>ČAS NA PŘÍPADU</h2>
            <div className={styles.clock}>{running ? <Ticker since={running.started_at} /> : hm(total)}</div>
            {running ? (
              <form action={stopTimer} className={styles.row}>
                <input type="hidden" name="back" value={path} />
                <input className={styles.input} name="note" maxLength={200} placeholder="Co jste dělali (nepovinné)" />
                <Button type="submit" variant="ghost">Zastavit</Button>
              </form>
            ) : (
              <form action={startTimer}>
                <input type="hidden" name="case_id" value={c.id} />
                <input type="hidden" name="back" value={path} />
                <Button type="submit">Začít</Button>
              </form>
            )}
            {times?.length ? (
              <ul className={styles.times}>
                {times.map((t) => (
                  <li key={t.id}>
                    <span>{name(t.staff_id)} · {formatDateTime(t.started_at)} · {t.ended_at ? hmLong(minutesOf(t)) : 'běží'}{t.note ? ` · ${t.note}` : ''}</span>
                    {t.auto_stopped && t.staff_id === user.id ? (
                      <form action={fixTime} className={styles.fix}>
                        <Status tone="warn">Zastaveno samo, zkontrolujte</Status>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="number" value={c.number} />
                        <input className={styles.input} type="number" name="minutes" min={0} max={600} defaultValue={Math.round(minutesOf(t))} aria-label="Minut" />
                        <button type="submit" className={styles.timerBtn}>Opravit</button>
                      </form>
                    ) : null}
                  </li>
                ))}
                <li><strong>Celkem {hmLong(total)}</strong></li>
              </ul>
            ) : null}
            <details>
              <summary className={styles.link}>Doplnit čas</summary>
              <form action={addTime} className={styles.row} style={{ marginTop: 8 }}>
                <input type="hidden" name="case_id" value={c.id} />
                <input type="hidden" name="number" value={c.number} />
                <input className={styles.input} style={{ width: 90 }} type="number" name="minutes" min={1} max={600} placeholder="min" required aria-label="Minut" />
                <input className={styles.input} style={{ flex: 1, minWidth: 120 }} name="note" maxLength={200} placeholder="Poznámka" />
                <Button type="submit" variant="ghost">Přidat</Button>
              </form>
            </details>
          </section>

          {order || report ? (
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>SOUVISÍ</h2>
              <div className={styles.related}>
                {order ? <span>Objednávka č. {order.number} · {formatPrice(order.total_czk)} · {ORDER_STATUS[order.status] ?? order.status}</span> : null}
                {report ? <span>Hlášení {reportCode(report.number)}</span> : null}
              </div>
            </section>
          ) : null}

          {c.user_id ? (
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>{c.other_id ? 'NAHLÁSIL' : 'UŽIVATEL'}</h2>
              <Link href={`/sprava/podpora/uzivatele/${c.user_id}`}>{name(c.user_id)}</Link>
            </section>
          ) : null}

          {c.other_id ? (
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>DRUHÁ STRANA</h2>
              <strong>{name(c.other_id)}</strong>
              {info ? (
                <p className={styles.small}>
                  {info.cancelled_after_paid} zrušené po zaplacení · {info.disputes} spory · {info.listings} nabídek
                  {info.restriction ? ' · účet omezený' : ''}
                </p>
              ) : null}
              <div className={styles.row}>
                <Link className={styles.link} href={`/sprava/podpora/uzivatele/${c.other_id}/omezit?pripad=${c.id}`}>Omezit účet…</Link>
                <Link className={styles.link} href={`/sprava/podpora/uzivatele/${c.other_id}`}>Profil a historie</Link>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** Nahlášený obsah: záznam obsahu v době nahlášení, všechna nahlášení a rozhodnutí (DS Support › Nahlášený obsah). */
function ContentPanel({ caseId, rows, name }: { caseId: string; rows: ContentRow[]; name: (id: string | null) => string }) {
  const first = rows[0];
  const s = first.snapshot ?? {};
  const kind = first.target_kind;
  const open = rows.some((r) => !r.decision);
  const decided = rows.find((r) => r.decision);
  const canHide = kind === 'listing' || kind === 'message' || kind === 'review';
  const hideLabel = kind === 'listing' ? 'Skrýt nabídku' : kind === 'message' ? 'Skrýt zprávu' : 'Skrýt hodnocení';
  return (
    <section className={styles.box} aria-label="Nahlášený obsah">
      <h2 className={styles.boxTitle}>NAHLÁŠENÝ OBSAH · {KIND_NOUN[kind].toUpperCase()}</h2>
      <div className={styles.snapshot}>
        {kind === 'listing' ? (
          <>
            <strong>{s.slug ? <Link href={`/karty/${s.slug}`}>{s.card}</Link> : s.card}</strong>
            <span className={styles.small}>{[s.set, s.number].filter(Boolean).join(' ')} · {s.condition}{s.graded ? ` · ${s.graded}` : ''} · {s.language} · {s.price != null ? formatPrice(s.price) : 'dohodou'} · {s.quantity} ks</span>
            {s.note ? <span>Poznámka: {s.note}</span> : null}
            <span className={styles.small}>Prodejce: {first.author_id ? <Link href={`/sprava/podpora/uzivatele/${first.author_id}`}>{s.seller ?? name(first.author_id)}</Link> : s.seller}</span>
          </>
        ) : kind === 'seller' ? (
          <>
            <strong>{first.author_id ? <Link href={`/sprava/podpora/uzivatele/${first.author_id}`}>{s.name}</Link> : s.name}</strong>
            {s.tagline ? <span>{s.tagline}</span> : null}
            <span className={styles.small}>{s.kind === 'shop' ? 'Obchod' : 'Sběratel'}</span>
          </>
        ) : kind === 'message' ? (
          <>
            <span className={styles.msgBody}>{s.body}</span>
            <span className={styles.small}>Od {s.sender ?? name(first.author_id)}{s.sent_at ? ` · ${formatDateTime(s.sent_at)}` : ''}</span>
          </>
        ) : kind === 'review' ? (
          <>
            <strong>{s.rating} z 5</strong>
            {s.comment ? <span>„{s.comment}“</span> : null}
            {s.reply ? <span className={styles.small}>Odpověď prodejce: {s.reply}</span> : null}
          </>
        ) : (
          <span>{first.url ? <a href={first.url} target="_blank" rel="noreferrer noopener">{first.url}</a> : 'Bez odkazu'}</span>
        )}
      </div>
      <ul className={styles.times}>
        {rows.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{contentCode(r.number)}</strong> · {CONTENT_REASON[r.reason]} · {r.reporter_id ? name(r.reporter_id) : `${r.reporter_name ?? ''} ${r.reporter_email ?? ''}`.trim()} · {formatDateTime(r.created_at)}
              {r.url && kind !== 'other' ? <> · {r.url}</> : null}
              <br />{r.body}
            </span>
          </li>
        ))}
      </ul>
      {open ? (
        <form action={decideContent} className={styles.field}>
          <input type="hidden" name="case_id" value={caseId} />
          <label className={styles.field}>Z čeho vycházíte {canHide ? '(při skrytí to uvidí autor)' : ''}
            <textarea className={styles.input} name="facts" rows={3} maxLength={4000} placeholder="Např. fotka je stažená z cizí aukce, karta v této edici neexistuje…" />
          </label>
          <div className={styles.row}>
            <Button type="submit" name="decision" value="kept" variant="secondary">V pořádku</Button>
            {canHide ? <Button type="submit" name="decision" value="removed" variant="secondary" className={styles.btnWarn}>{hideLabel}</Button> : null}
            {first.author_id ? <Link className={styles.link} href={`/sprava/podpora/uzivatele/${first.author_id}/omezit?pripad=${caseId}`}>Omezit účet…</Link> : null}
          </div>
          <p className={styles.small}>
            V pořádku: nahlašitelé dostanou výsledek e-mailem. {canHide ? `${hideLabel}: obsah zmizí z webu a autor dostane e-mail s důvodem a možností se ohradit. ` : ''}Případ se tím vyřeší.
          </p>
        </form>
      ) : decided ? (
        <p className={styles.small}>
          {decided.decision === 'removed' ? 'Obsah skryt' : 'Ponecháno'} · {decided.decided_at ? formatDateTime(decided.decided_at) : ''}{decided.facts ? ` · ${decided.facts}` : ''}
        </p>
      ) : null}
    </section>
  );
}
