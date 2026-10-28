import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ButtonLink, Status } from '@/components/trezor';
import { formatDate, formatDateTime } from '@/lib/format';
import { PLANS, toPlan } from '@/lib/plans';
import { REASON, reportCode, type ReportReason } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import {
  ACTION_LABEL, caseCode, reasonOf, RESTRICTION_LABEL, STATUS,
  type CaseRow, type ModAction, type RestrictionKind,
} from '@/lib/support';
import { liftRestriction } from '../../actions';
import { CONTENT_REASON, KIND_NOUN, REASON_ARTICLE, type ContentKind, type ContentReason } from '@/lib/content-reports';
import styles from '../../podpora.module.css';

export const metadata: Metadata = { title: 'Uživatel · podpora' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; chyba?: string }> };

interface UserInfo {
  email: string; created_at: string; last_sign_in_at: string | null; mfa: boolean; plan: string | null; verified: string | null;
  sold: number; bought: number; reviews: number; reviews_positive: number; cancelled_after_paid: number; disputes: number;
  reports_against: number; listings: number; hidden: number;
  restriction: { kind: RestrictionKind; until: string | null; set_at: string } | null;
}

interface ActionRow { id: number; staff_id: string | null; action: ModAction; reason_code: string | null; facts: string | null; detail: string | null; until: string | null; case_id: string | null; created_at: string }

/** Profil uživatele pro podporu: počítadla, historie moderace, případy (DS Support, Uživatel). */
export default async function SupportUserPage({ params, searchParams }: Props) {
  const [{ id }, { ok, chyba }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: person } = await supabase.from('profiles').select('id, display_name, kind, ico').eq('id', id).maybeSingle();
  if (!person) notFound();
  const [{ data: infoData }, { data: actions }, { data: cases }, { data: reports }, { data: staff }] = await Promise.all([
    supabase.rpc('admin_user_info', { p_user: id }),
    supabase.from('staff_actions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50).returns<ActionRow[]>(),
    supabase.from('support_cases').select('*').or(`user_id.eq.${id},other_id.eq.${id}`).order('created_at', { ascending: false }).limit(30).returns<CaseRow[]>(),
    supabase.from('reports').select('id, number, reason, status, reporter_id, against_id, created_at').or(`reporter_id.eq.${id},against_id.eq.${id}`)
      .order('created_at', { ascending: false }).limit(30),
    supabase.rpc('admin_staff'),
  ]);
  // Skrytý obsah po nahlášení (jedno rozhodnutí za případ).
  const { data: removedRows } = await supabase.from('content_reports').select('case_id, target_kind, reason, facts, decided_at, decided_by')
    .eq('author_id', id).eq('decision', 'removed').order('decided_at', { ascending: false }).limit(50);
  const removed = [...new Map(((removedRows ?? []) as Array<{ case_id: string | null; target_kind: ContentKind; reason: ContentReason; facts: string | null; decided_at: string; decided_by: string | null }>)
    .map((x) => [x.case_id ?? x.decided_at, x])).values()];
  const info = infoData as UserInfo | null;
  const staffName = new Map(((staff ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name.split(' ')[0]]));
  const r = info?.restriction;
  const positive = info?.reviews ? Math.round((info.reviews_positive / info.reviews) * 100) : null;
  const casedReports = new Set((cases ?? []).map((c) => c.report_id).filter(Boolean));

  const tiles = info ? [
    { label: 'Prodané objednávky', value: String(info.sold) },
    { label: 'Kladná hodnocení', value: positive === null ? '–' : `${positive} %` },
    { label: 'Zrušené po zaplacení', value: String(info.cancelled_after_paid), warn: info.cancelled_after_paid > 0 },
    { label: 'Spory bez dohody', value: String(info.disputes), warn: info.disputes > 0 },
    { label: 'Hlášení proti', value: String(info.reports_against) },
    { label: info.hidden ? 'Nabídky (skryté)' : 'Aktivní nabídky', value: info.hidden ? `${info.listings} (${info.hidden})` : String(info.listings) },
  ] : [];

  return (
    <div className={styles.page}>
      <Link href="/sprava/podpora/uzivatele" className={styles.link}>← Uživatelé</Link>
      {ok ? <p className={styles.flash}>{ok}</p> : null}
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}

      <div className={styles.who}>
        <div className={styles.avatar} aria-hidden="true">{person.display_name.slice(0, 1).toUpperCase()}</div>
        <div className={styles.whoText}>
          <div className={styles.whoName}>
            <h1>{person.display_name}</h1>
            {r ? <Status tone={r.kind === 'banned' ? 'muted' : 'warn'}>{RESTRICTION_LABEL[r.kind]}{r.until ? ` do ${formatDate(r.until)}` : ''}</Status> : <Status tone="ok">Aktivní</Status>}
            <Status tone="muted">{person.kind === 'shop' ? 'Obchod' : 'Sběratel'} · {PLANS[toPlan(info?.plan ?? 'free')].name}</Status>
          </div>
          {info ? (
            <span className={styles.small}>
              {info.email}{person.ico ? ` · IČO ${person.ico}` : ''} · registrace {formatDate(info.created_at)}
              {' · '}dvoufázové ověření {info.mfa ? 'zapnuté' : 'vypnuté'}
              {info.verified ? ' · ověřený prodejce' : ''}
              {info.last_sign_in_at ? ` · poslední přihlášení ${formatDateTime(info.last_sign_in_at)}` : ''}
            </span>
          ) : null}
        </div>
        <div className={styles.row}>
          <ButtonLink href={`/sprava/podpora/novy?uzivatel=${id}`} variant="ghost">Napsat e-mail</ButtonLink>
          {r ? (
            <form action={liftRestriction}>
              <input type="hidden" name="user_id" value={id} />
              <button type="submit" className={styles.timerBtn} style={{ height: 44, borderRadius: 'var(--radius-md)' }}>Zrušit omezení</button>
            </form>
          ) : null}
          <Link href={`/sprava/podpora/uzivatele/${id}/omezit`} className={styles.warnBtn} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Omezit účet…</Link>
        </div>
      </div>

      <div className={styles.tiles}>
        {tiles.map((t) => (
          <div key={t.label} className={`${styles.tile} ${t.warn ? styles.tileWarn : ''}`}>
            <span>{t.label}</span><span className={styles.tileNum}>{t.value}</span>
          </div>
        ))}
      </div>

      <div className={styles.cols}>
        <section className={styles.box}>
          <h2 className={styles.boxTitle}>HISTORIE MODERACE</h2>
          <ul className={styles.list}>
            {(actions ?? []).map((a) => (
              <li key={a.id} className={styles.hist}>
                <span className={styles.small}>{formatDateTime(a.created_at)}</span>
                <span>
                  <strong>{ACTION_LABEL[a.action]}{a.until ? ` do ${formatDate(a.until)}` : ''}</strong>
                  <span className={styles.small}>
                    {[reasonOf(a.reason_code) ? `${reasonOf(a.reason_code)!.label} (${reasonOf(a.reason_code)!.article})` : null, a.detail, a.facts].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={styles.small}>{a.staff_id ? staffName.get(a.staff_id) ?? 'správce' : 'systém'}</span>
              </li>
            ))}
            {removed.map((x) => (
              <li key={`c-${x.case_id ?? x.decided_at}`} className={styles.hist}>
                <span className={styles.small}>{formatDateTime(x.decided_at)}</span>
                <span>
                  <strong>Skrytý obsah: {KIND_NOUN[x.target_kind]}</strong>
                  <span className={styles.small}>{[`${CONTENT_REASON[x.reason]} (${REASON_ARTICLE[x.reason]})`, x.facts].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={styles.small}>{x.decided_by ? staffName.get(x.decided_by) ?? 'správce' : 'systém'}</span>
              </li>
            ))}
            {!actions?.length && !removed.length ? <li className={styles.small}>Bez záznamu.</li> : null}
          </ul>
        </section>

        <section className={styles.box}>
          <h2 className={styles.boxTitle}>PŘÍPADY A HLÁŠENÍ</h2>
          <ul className={styles.list}>
            {(cases ?? []).map((c) => (
              <li key={c.id}>
                <Link href={`/sprava/podpora/${c.number}`} className={styles.caseLink}>
                  <span><span className="code">{caseCode(c.number)}</span> · {c.subject}</span>
                  <Status tone={c.status === 'resolved' ? 'muted' : 'info'}>{STATUS[c.status]}</Status>
                </Link>
              </li>
            ))}
            {(reports ?? []).filter((x) => !casedReports.has(x.id)).map((x) => (
              <li key={x.id} className={styles.caseLink}>
                <span><span className="code">{reportCode(x.number)}</span> · {REASON[x.reason as ReportReason]} · {x.reporter_id === id ? 'nahlásil(a)' : 'proti'}</span>
                <Status tone={x.status === 'closed' ? 'muted' : 'info'}>{x.status === 'closed' ? 'Uzavřeno' : 'Domlouvají se'}</Status>
              </li>
            ))}
            {!cases?.length && !reports?.length ? <li className={styles.small}>Žádné případy.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
