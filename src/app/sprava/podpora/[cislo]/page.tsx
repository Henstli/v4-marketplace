import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReportPanel } from '@/components/reports/ReportPanel';
import { BeatCase, CaseClock, CasePresence } from '@/components/support/Beat';
import { CaseActions, StatusForm } from '@/components/support/CaseTools';
import { ReplyBox, type ReplyTarget } from '@/components/support/ReplyBox';
import { Button, Status } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDateTime, formatPrice } from '@/lib/format';
import { ORDER_STATUS } from '@/lib/order-status';
import { loadReportFiles, REPORT_SELECT, reportCode, type ReportRow } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import {
  caseCode, caseOrigin, dueGroup, dueText, isoToPragueLocal, KIND, minutesOf, PRIORITY, STATUS,
  type CaseEvent, type CaseRow, type Template, type TimeRow,
} from '@/lib/support';
import { decideContent } from '../actions';
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

/** Případ podpory: časová osa, odpověď, stav, akce a čas, který se počítá sám (DS Support › Případ). */
export default async function CasePage({ params, searchParams }: Props) {
  const [{ cislo }, { ok, chyba }] = await Promise.all([params, searchParams]);
  const number = Number(cislo);
  if (!Number.isInteger(number) || number < 1) notFound();
  const user = (await getCurrentUser())!;
  const supabase = await createClient();
  const { data: c } = await supabase.from('support_cases').select('*').eq('number', number).maybeSingle<CaseRow>();
  if (!c) notFound();

  const [{ data: events }, { data: times }, { data: staff }, { data: report }, { data: orders }, { data: templates }, { data: merged }] = await Promise.all([
    supabase.from('case_events').select('*').eq('case_id', c.id).order('created_at').returns<CaseEvent[]>(),
    supabase.from('case_time').select('*').eq('case_id', c.id).order('started_at').returns<TimeRow[]>(),
    supabase.rpc('admin_staff'),
    c.report_id ? supabase.from('reports').select(REPORT_SELECT).eq('id', c.report_id).maybeSingle<ReportRow>() : Promise.resolve({ data: null }),
    c.order_id ? supabase.rpc('admin_orders', { p_ids: [c.order_id] }) : Promise.resolve({ data: [] }),
    supabase.from('support_templates').select('id, label, body, sort').order('sort').returns<Template[]>(),
    c.merged_into ? supabase.from('support_cases').select('number').eq('id', c.merged_into).maybeSingle() : Promise.resolve({ data: null }),
    // Přečteno: štítek Nová odpověď ve frontě zmizí.
    supabase.from('case_reads').upsert({ staff_id: user.id, case_id: c.id, read_at: new Date().toISOString() }),
  ]);
  // Přílohy z formuláře Napsat podpoře: odkaz platí hodinu.
  const { data: caseFiles } = await supabase.from('case_files').select('path, name, size').eq('case_id', c.id).order('created_at');
  const attachments = await Promise.all(((caseFiles ?? []) as Array<{ path: string; name: string; size: number | null }>).map(async (f) => ({
    ...f, url: (await supabase.storage.from('support-files').createSignedUrl(f.path, 3600)).data?.signedUrl ?? null,
  })));
  const { data: content } = c.kind === 'content'
    ? await supabase.from('content_reports').select('*').eq('case_id', c.id).order('created_at').returns<ContentRow[]>()
    : { data: null };
  const order = ((orders ?? []) as AdminOrder[])[0] ?? null;
  // Správce cizí objednávky přes RLS nevidí, údaje doplníme z admin_orders.
  if (report && order) report.orders = { number: order.number, buyer_id: order.buyer_id, seller_id: order.seller_id, total_czk: order.total_czk, shipping_czk: order.shipping_czk };
  const files = report ? await loadReportFiles(supabase, report.id) : [];

  const ids = [...new Set([c.user_id, c.other_id, ...(events ?? []).map((e) => e.author_id), ...(times ?? []).map((t) => t.staff_id)].filter((x): x is string => !!x))];
  const [{ data: people }, { data: first }, { data: other }] = await Promise.all([
    ids.length ? supabase.from('profiles').select('id, display_name, kind, support_reply_via').in('id', ids) : Promise.resolve({ data: [] }),
    c.user_id ? supabase.rpc('admin_user_info', { p_user: c.user_id }) : Promise.resolve({ data: null }),
    c.other_id ? supabase.rpc('admin_user_info', { p_user: c.other_id }) : Promise.resolve({ data: null }),
  ]);
  const name = (id: string | null) => (id ? (people ?? []).find((p) => p.id === id)?.display_name ?? 'smazaný účet' : '');
  const staffList = (staff ?? []) as Array<{ id: string; name: string }>;
  const role = (id: string | null) => (!order || !id ? '' : id === order.buyer_id ? 'kupující' : id === order.seller_id ? 'prodejce' : '');

  const targets: ReplyTarget[] = [];
  // Kudy odpověď dojde: do chatu na webu (e-mail po 30 minutách nepřečtení), nebo hned e-mailem.
  const via = (id: string) => ((people ?? []).find((p) => p.id === id)?.support_reply_via === 'email' ? 'e-mailem' : 'do chatu na webu');
  if (c.user_id) targets.push({ id: 'user', label: `${name(c.user_id)}${role(c.user_id) ? ` (${role(c.user_id)})` : ''}`, via: via(c.user_id) });
  if (c.other_id) targets.push({ id: 'other', label: `${name(c.other_id)}${role(c.other_id) ? ` (${role(c.other_id)})` : ''}`, via: via(c.other_id) });
  if (c.user_id && c.other_id) targets.push({ id: 'both', label: 'Oběma stranám', via: 'každému podle jeho volby' });
  if (c.contact_email) targets.push({ id: 'contact', label: c.contact_email, via: 'e-mailem' });

  const total = (times ?? []).reduce((s, t) => s + minutesOf(t), 0);
  const perStaff = new Map<string, number>();
  for (const t of times ?? []) if (t.staff_id) perStaff.set(t.staff_id, (perStaff.get(t.staff_id) ?? 0) + minutesOf(t));
  const others = [...perStaff].filter(([id]) => id !== user.id).map(([id, minutes]) => ({ name: name(id).split(' ')[0], minutes }));
  const group = dueGroup(c);
  const snoozed = !!c.snoozed_until && c.snoozed_until > new Date().toISOString();

  return (
    <div className={styles.page}>
      <BeatCase id={c.id} />
      <div className={styles.caseHead}>
        <div className={styles.row}>
          <Link href="/sprava/podpora" className={styles.link}>← Fronta</Link>
          <span style={{ flex: 1 }} />
          <CasePresence me={user.id} />
        </div>
        <div className={styles.caseTitle}>
          <span className={styles.caseCode}>{caseCode(c.number)}</span>
          <h1>{c.subject}</h1>
        </div>
        <div className={styles.row}>
          <Status tone={c.status === 'open' ? 'info' : c.status === 'waiting' ? 'warn' : 'muted'}>{STATUS[c.status]}</Status>
          {snoozed ? <Status tone="muted">Odloženo do {dueText(c.snoozed_until!)}</Status>
            : c.status !== 'resolved' && c.due_at ? (
              <Status tone={group === 'late' ? 'warn' : 'muted'}>{group === 'late' ? 'Po termínu · ' : 'Termín '}{dueText(c.due_at)}</Status>
            ) : null}
          <span className={`${styles.prio} ${styles[`prio-${c.priority}`]}`}>{PRIORITY[c.priority]}</span>
          {content && content.length > 1 ? <span className={`${styles.prio} ${styles['prio-high']}`}>Nahlášeno {content.length}×</span> : null}
          <span className={styles.small}>{KIND[c.kind]} · {caseOrigin(c)} · založeno {formatDateTime(c.created_at)}</span>
        </div>
        {merged ? <p className={styles.small}>Sloučeno do <Link href={`/sprava/podpora/${merged.number}`} className={styles.link}>{caseCode(merged.number as number)}</Link>.</p> : null}
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
                ) : e.kind === 'user' ? (
                  <div className={styles.msg}>
                    <span className={styles.small}>
                      {name(e.author_id) || c.contact_email || 'Uživatel'}{role(e.author_id) ? ` · ${role(e.author_id)}` : ''} · {formatDateTime(e.created_at)}
                    </span>
                    <div className={styles.msgBody}>{e.body}</div>
                  </div>
                ) : (
                  <div className={`${styles.msg} ${e.kind === 'note' ? styles.msgNote : styles.msgMail}`}>
                    <div className={styles.msgAuthor}>
                      <span className={styles.msgAvatar} aria-hidden="true">{(name(e.author_id) || '?').slice(0, 1).toUpperCase()}</span>
                      <strong>{name(e.author_id) || 'Systém'}</strong>
                      <span className={styles.small}>{formatDateTime(e.created_at)}</span>
                      <span className={styles.msgLabel}>
                        {e.kind === 'note' ? 'INTERNÍ POZNÁMKA · UŽIVATEL NEVIDÍ' : `ODPOVĚĎ E-MAILEM → ${(e.recipients ?? '').toUpperCase()}`}
                      </span>
                    </div>
                    <div className={styles.msgBody}>{e.body}</div>
                  </div>
                )}
              </li>
            ))}
            {!events?.length ? <li className={styles.small}>Zatím žádné události.</li> : null}
            {attachments.map((f) => (
              <li key={f.path}>
                <span className={styles.ev}>
                  Příloha: {f.url ? <a href={f.url} target="_blank" rel="noreferrer noopener" className={styles.link}>{f.name}</a> : f.name}
                  {f.size ? ` · ${Math.max(1, Math.round(f.size / 1024))} kB` : ''}
                </span>
              </li>
            ))}
          </ol>

          {content?.length ? <ContentPanel caseId={c.id} rows={content} name={name} /> : null}

          {!c.merged_into ? <ReplyBox caseId={c.id} number={c.number} targets={targets} templates={templates ?? []} /> : null}

          {report ? (
            <ReportPanel r={report} me={user.id} files={files} admin
              otherName={`${name(report.reporter_id)} (${report.reporter_role === 'buyer' ? 'kupující' : 'prodejce'}) → ${name(report.against_id)}`} />
          ) : null}
        </div>

        <aside className={styles.side}>
          <CaseClock mine={perStaff.get(user.id) ?? 0} total={total} others={others} />

          <section className={styles.box}>
            <StatusForm caseId={c.id} status={c.status} assignee={c.assignee_id} staff={staffList} />
            <CaseActions caseId={c.id} me={user.id} assignee={c.assignee_id} staff={staffList} snoozed={snoozed}
              priority={c.priority} due={c.due_at ? isoToPragueLocal(c.due_at) : ''} />
          </section>

          {order ? (
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>OBJEDNÁVKA Č. {order.number}</h2>
              <div className={styles.related}>
                <span>{formatPrice(order.total_czk)} · {ORDER_STATUS[order.status] ?? order.status}</span>
                {report ? <span className={styles.small}>Hlášení {reportCode(report.number)}</span> : null}
                <Link href={`/sprava/podpora/${c.number}/zpravy`} className={styles.link}>Zprávy mezi stranami ›</Link>
                <span className={styles.small}>Otevření zpráv se zapíše do Záznamu akcí.</span>
              </div>
            </section>
          ) : report ? (
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>SOUVISÍ</h2>
              <span>Hlášení {reportCode(report.number)}</span>
            </section>
          ) : null}

          {c.user_id ? <PersonCard title={c.other_id ? (c.kind === 'report' ? 'NAHLÁSIL' : 'KDO PÍŠE') : 'UŽIVATEL'} id={c.user_id} caseId={c.id}
            label={`${name(c.user_id)}${role(c.user_id) ? ` · ${role(c.user_id)}` : ''}`} info={first as PersonInfo | null} /> : null}
          {c.other_id ? <PersonCard title="DRUHÁ STRANA" id={c.other_id} caseId={c.id}
            label={`${name(c.other_id)}${role(c.other_id) ? ` · ${role(c.other_id)}` : ''}`} info={other as PersonInfo | null} /> : null}
          {!c.user_id && c.contact_email ? (
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>KDO PÍŠE</h2>
              <span>{c.contact_email}</span>
              <span className={styles.small}>Bez účtu na V4cards.</span>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

interface PersonInfo { cancelled_after_paid: number; disputes: number; listings: number; sold: number; restriction: { kind: string } | null }

/** Karta strany případu: odkazy Profil a Omezit účet u obou stran. */
function PersonCard({ title, id, caseId, label, info }: { title: string; id: string; caseId: string; label: string; info: PersonInfo | null }) {
  return (
    <section className={styles.box}>
      <h2 className={styles.boxTitle}>{title}</h2>
      <strong>{label}</strong>
      {info ? (
        <p className={styles.small}>
          {info.sold} prodáno · {info.cancelled_after_paid} zrušené po zaplacení · {info.disputes} spory · {info.listings} nabídek
          {info.restriction ? ' · účet omezený' : ''}
        </p>
      ) : null}
      <div className={styles.row}>
        <Link className={styles.link} href={`/sprava/podpora/uzivatele/${id}`}>Profil</Link>
        <Link className={styles.link} href={`/sprava/podpora/uzivatele/${id}/omezit?pripad=${caseId}`}>Omezit účet…</Link>
      </div>
    </section>
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
