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
import { addTime, fixTime, startTimer, stopTimer, updateCase } from '../actions';
import styles from '../podpora.module.css';

type Props = { params: Promise<{ cislo: string }>; searchParams: Promise<{ ok?: string; chyba?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cislo } = await params;
  return { title: `${caseCode(Number(cislo) || 0)} · podpora` };
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
