import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccountActions } from '@/components/support/AccountActions';
import { Button, ButtonLink, ChipLink, Status } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDate, formatDateTime, formatPrice } from '@/lib/format';
import { ORDER_STATUS } from '@/lib/order-status';
import { PLANS, toPlan } from '@/lib/plans';
import { REASON, reportCode, type ReportReason } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import {
  ACTION_LABEL, caseCode, reasonOf, RESTRICTION_LABEL, STATUS,
  type CaseRow, type ModAction, type RestrictionKind,
} from '@/lib/support';
import { listingVisibility, liftRestriction, saveUserNote } from '../../actions';
import { CONTENT_REASON, KIND_NOUN, REASON_ARTICLE, type ContentKind, type ContentReason } from '@/lib/content-reports';
import styles from '../../podpora.module.css';

export const metadata: Metadata = { title: 'Uživatel · podpora' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; chyba?: string; karta?: string; h?: string }> };

interface UserInfo {
  email: string; confirmed?: boolean; created_at: string; last_sign_in_at: string | null; mfa: boolean; plan: string | null; verified: string | null;
  sold: number; bought: number; reviews: number; reviews_positive: number; cancelled_after_paid: number; disputes: number;
  reports_against: number; content_against?: number; reported?: number; listings: number; hidden: number;
  restriction: { kind: RestrictionKind; until: string | null; set_at: string } | null;
}

interface ActionRow { id: number; staff_id: string | null; action: ModAction; reason_code: string | null; facts: string | null; detail: string | null; until: string | null; case_id: string | null; created_at: string }
interface OrderRow { id: string; number: number; role: 'buyer' | 'seller'; other_id: string | null; other_name: string | null; status: string; total_czk: number; created_at: string }
interface ListingRow { id: string; card: string; slug: string | null; set_code: string | null; number: string | null; price_czk: number | null; quantity: number; hidden_qty: number | null; removed_at: string | null; created_at: string }
interface SessionRow { kind: 'session' | 'device'; created_at: string; last_at: string | null; agent: string | null; ip: string | null }
interface HistItem { at: string; kind: 'case' | 'mod'; title: string; detail?: string; who?: string; href?: string; status?: string }

const TABS = [
  { id: '', label: 'Historie' },
  { id: 'objednavky', label: 'Objednávky' },
  { id: 'nabidky', label: 'Nabídky' },
  { id: 'prihlaseni', label: 'Přihlášení' },
];

/** Prohlížeč a systém z user-agentu, krátce. */
function device(agent: string | null) {
  if (!agent) return 'Neznámé zařízení';
  const os = /iPhone|iPad/.test(agent) ? 'iPhone' : /Android/.test(agent) ? 'Android' : /Mac OS/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : '';
  const br = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || agent.slice(0, 60);
}

/** Profil uživatele pro podporu: dlaždice, záložky, akce s účtem a interní poznámka (DS Support › Uživatel). */
export default async function SupportUserPage({ params, searchParams }: Props) {
  const [{ id }, { ok, chyba, karta = '', h = '' }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = (await getCurrentUser())!;
  const supabase = await createClient();
  const { data: person } = await supabase.from('profiles').select('id, display_name, kind, ico').eq('id', id).maybeSingle();
  if (!person) notFound();
  const [{ data: infoData }, { data: actions }, { data: cases }, { data: reports }, { data: staff }, { data: note }, { data: orders }, { data: listings }, { data: sessions }] = await Promise.all([
    supabase.rpc('admin_user_info', { p_user: id }),
    supabase.from('staff_actions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(100).returns<ActionRow[]>(),
    supabase.from('support_cases').select('*').or(`user_id.eq.${id},other_id.eq.${id}`).order('created_at', { ascending: false }).limit(50).returns<CaseRow[]>(),
    supabase.from('reports').select('id, number, reason, status, reporter_id, against_id, created_at').or(`reporter_id.eq.${id},against_id.eq.${id}`)
      .order('created_at', { ascending: false }).limit(50),
    supabase.rpc('admin_staff'),
    supabase.from('user_notes').select('body, updated_by, updated_at').eq('user_id', id).maybeSingle(),
    supabase.rpc('admin_user_orders', { p_user: id }),
    supabase.rpc('admin_user_listings', { p_user: id }),
    karta === 'prihlaseni' ? supabase.rpc('admin_user_sessions', { p_user: id }) : Promise.resolve({ data: [] }),
  ]);
  const { data: removedRows } = await supabase.from('content_reports').select('case_id, target_kind, reason, facts, decided_at, decided_by')
    .eq('author_id', id).eq('decision', 'removed').order('decided_at', { ascending: false }).limit(50);
  const removed = [...new Map(((removedRows ?? []) as Array<{ case_id: string | null; target_kind: ContentKind; reason: ContentReason; facts: string | null; decided_at: string; decided_by: string | null }>)
    .map((x) => [x.case_id ?? x.decided_at, x])).values()];
  const info = infoData as UserInfo | null;
  const staffName = new Map(((staff ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name.split(' ')[0]]));
  const who = (sid: string | null) => (sid ? staffName.get(sid) ?? 'tým' : 'systém');
  const r = info?.restriction;
  const positive = info?.reviews ? Math.round((info.reviews_positive / info.reviews) * 100) : null;
  const casedReports = new Set((cases ?? []).map((c) => c.report_id).filter(Boolean));
  const orderList = (orders ?? []) as OrderRow[];
  const listingList = (listings ?? []) as ListingRow[];
  const userNote = note as { body: string; updated_by: string | null; updated_at: string } | null;
  const problems = info ? info.cancelled_after_paid + info.disputes + (info.content_against ?? 0) : 0;

  // Jedna historie podle data: případy, hlášení, moderace a úpravy účtu.
  const hist: HistItem[] = [
    ...(cases ?? []).map((c): HistItem => ({ at: c.created_at, kind: 'case', title: `${caseCode(c.number)} · ${c.subject}`, href: `/sprava/podpora/${c.number}`, status: STATUS[c.status] })),
    ...(reports ?? []).filter((x) => !casedReports.has(x.id)).map((x): HistItem => ({
      at: x.created_at as string, kind: 'case', title: `${reportCode(x.number as number)} · ${REASON[x.reason as ReportReason]}`,
      detail: x.reporter_id === id ? 'nahlásil(a)' : 'nahlášen(a)', status: x.status === 'closed' ? 'Uzavřeno' : 'Domlouvají se',
    })),
    ...(actions ?? []).map((a): HistItem => {
      const rs = reasonOf(a.reason_code);
      return {
        at: a.created_at, kind: 'mod',
        title: `${ACTION_LABEL[a.action] ?? a.action}${a.until ? ` do ${formatDate(a.until)}` : ''}`,
        detail: [rs ? `${rs.label} (${rs.article})` : null, a.detail, a.facts].filter(Boolean).join(' · '), who: who(a.staff_id),
      };
    }),
    ...removed.map((x): HistItem => ({
      at: x.decided_at, kind: 'mod', title: `Skrytý obsah · ${KIND_NOUN[x.target_kind]}`,
      detail: [`${CONTENT_REASON[x.reason]} (${REASON_ARTICLE[x.reason]})`, x.facts].filter(Boolean).join(' · '), who: who(x.decided_by),
    })),
  ].filter((x) => !h || (h === 'pripady' ? x.kind === 'case' : x.kind === 'mod'))
    .sort((a, b) => b.at.localeCompare(a.at));

  const base = `/sprava/podpora/uzivatele/${id}`;
  const tabHref = (t: string) => (t ? `${base}?karta=${t}` : base);

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
          </div>
          <span className={styles.small}>
            {person.kind === 'shop' ? 'Obchod' : 'Sběratel'} · {PLANS[toPlan(info?.plan ?? 'free')].name}
            {info?.verified ? ' · ověřený prodejce' : ''} · dvoufázové ověření {info?.mfa ? 'zapnuté' : 'vypnuté'}
          </span>
          {info ? (
            <span className={styles.small}>
              {info.email}{info.confirmed === false ? ' (nepotvrzený)' : ''}{person.ico ? ` · IČO ${person.ico}` : ''} · registrace {formatDate(info.created_at)}
              {info.last_sign_in_at ? ` · naposledy ${formatDateTime(info.last_sign_in_at)}` : ''}
            </span>
          ) : null}
        </div>
        <div className={styles.row}>
          <ButtonLink href={`/sprava/podpora/novy?uzivatel=${id}`} variant="secondary">Napsat zprávu</ButtonLink>
          {r ? (
            <form action={liftRestriction}>
              <input type="hidden" name="user_id" value={id} />
              <Button type="submit" variant="ghost">Zrušit omezení</Button>
            </form>
          ) : null}
          <Link href={`${base}/omezit`} className={styles.warnBtn}>Omezit účet…</Link>
        </div>
      </div>

      {info ? (
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span>Prodáno</span><span className={styles.tileNum}>{info.sold}</span>
            <span className={styles.small}>{positive === null ? 'bez hodnocení' : `${positive} % kladných`}</span>
          </div>
          <div className={`${styles.tile} ${problems ? styles.tileWarn : ''}`}>
            <span>Problémy za 12 měsíců</span><span className={styles.tileNum}>{problems}</span>
            <span className={styles.small}>{info.disputes} spor · {info.content_against ?? 0} nahlášení · {info.cancelled_after_paid} zrušené po zaplacení</span>
          </div>
          <div className={styles.tile}>
            <span>Nabídky</span><span className={styles.tileNum}>{info.listings}</span>
            <span className={styles.small}>{info.hidden ? `${info.hidden} skryté podporou` : 'žádné skryté'}</span>
          </div>
          <div className={styles.tile}>
            <span>Nahlásil sám</span><span className={styles.tileNum}>{info.reported ?? 0}</span>
          </div>
        </div>
      ) : null}

      <div className={styles.userCols}>
        <section className={styles.box}>
          <nav className={styles.tabs} aria-label="Záložky uživatele">
            {TABS.map((t) => (
              <Link key={t.id} href={tabHref(t.id)} aria-current={karta === t.id ? 'page' : undefined}>
                {t.label}
                {t.id === 'objednavky' ? <span className={styles.tabCount}>{orderList.length}</span> : null}
                {t.id === 'nabidky' ? <span className={styles.tabCount}>{listingList.length}</span> : null}
              </Link>
            ))}
          </nav>

          {karta === '' ? (
            <>
              <div className={styles.row}>
                <ChipLink href={base} selected={!h}>Vše</ChipLink>
                <ChipLink href={`${base}?h=pripady`} selected={h === 'pripady'}>Případy</ChipLink>
                <ChipLink href={`${base}?h=moderace`} selected={h === 'moderace'}>Moderace a úpravy účtu</ChipLink>
              </div>
              <ul className={styles.list}>
                {hist.map((x, i) => (
                  <li key={i} className={styles.hist}>
                    <span className={styles.small}>{formatDateTime(x.at)}</span>
                    <span>
                      <strong>{x.href ? <Link href={x.href}>{x.title}</Link> : x.title}</strong>
                      {x.detail ? <span className={styles.small}>{x.detail}</span> : null}
                    </span>
                    <span className={styles.small}>{x.status ?? x.who}</span>
                  </li>
                ))}
                {!hist.length ? <li className={styles.small}>Bez záznamu.</li> : null}
              </ul>
            </>
          ) : karta === 'objednavky' ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>ČÍSLO</th><th>ROLE</th><th>PROTISTRANA</th><th className={styles.num}>CENA</th><th>STAV</th><th>KDY</th></tr></thead>
                <tbody>
                  {orderList.map((o) => (
                    <tr key={o.id}>
                      <td className="code">č. {o.number}</td>
                      <td className={styles.small}>{o.role === 'buyer' ? 'kupuje' : 'prodává'}</td>
                      <td>{o.other_id ? <Link href={`/sprava/podpora/uzivatele/${o.other_id}`}>{o.other_name ?? 'smazaný účet'}</Link> : '–'}</td>
                      <td className={styles.num}>{formatPrice(o.total_czk)}</td>
                      <td className={styles.small}>{ORDER_STATUS[o.status] ?? o.status}</td>
                      <td className={styles.small}>{formatDate(o.created_at)}</td>
                    </tr>
                  ))}
                  {!orderList.length ? <tr><td colSpan={6} className={styles.dash}>Žádné objednávky.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : karta === 'nabidky' ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>KARTA</th><th className={styles.num}>CENA</th><th className={styles.num}>KUSY</th><th>STAV</th><th /></tr></thead>
                <tbody>
                  {listingList.map((l) => {
                    const hidden = l.hidden_qty !== null;
                    const state = l.removed_at ? 'Smazaná' : hidden ? 'Skrytá podporou' : l.quantity > 0 ? 'Aktivní' : 'Vyprodaná';
                    return (
                      <tr key={l.id}>
                        <td>
                          {l.slug ? <Link href={`/karty/${l.slug}`}>{l.card}</Link> : l.card}
                          <span className={styles.small}> {[l.set_code, l.number].filter(Boolean).join(' ')}</span>
                        </td>
                        <td className={styles.num}>{l.price_czk != null ? formatPrice(l.price_czk) : 'dohodou'}</td>
                        <td className={styles.num}>{hidden ? l.hidden_qty : l.quantity}</td>
                        <td className={styles.small}>{state}</td>
                        <td>
                          {!l.removed_at && (hidden || l.quantity > 0) ? (
                            <form action={listingVisibility} className={styles.fix}>
                              <input type="hidden" name="user_id" value={id} />
                              <input type="hidden" name="karta" value="nabidky" />
                              <input type="hidden" name="listing_id" value={l.id} />
                              <input type="hidden" name="hide" value={hidden ? '0' : '1'} />
                              {!hidden ? <input className={styles.input} style={{ width: 160 }} name="reason" placeholder="Proč skrýt" required minLength={3} aria-label="Proč skrýt" /> : null}
                              <Button type="submit" variant="ghost">{hidden ? 'Obnovit' : 'Skrýt'}</Button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!listingList.length ? <tr><td colSpan={5} className={styles.dash}>Žádné nabídky.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>KDY</th><th>ZAŘÍZENÍ A PROHLÍŽEČ</th><th>IP</th><th>NAPOSLEDY</th></tr></thead>
                <tbody>
                  {((sessions ?? []) as SessionRow[]).map((x, i) => (
                    <tr key={i}>
                      <td className={styles.small}>{formatDateTime(x.created_at)}</td>
                      <td>{x.kind === 'device' ? `Důvěryhodné zařízení · ${x.agent ?? ''}` : device(x.agent)}</td>
                      <td className="code">{x.ip ?? '–'}</td>
                      <td className={styles.small}>{x.last_at ? formatDateTime(x.last_at) : '–'}</td>
                    </tr>
                  ))}
                  {!sessions?.length ? <tr><td colSpan={4} className={styles.dash}>Žádné aktivní přihlášení.</td></tr> : null}
                </tbody>
              </table>
              <p className={styles.small}>Odhlásit ze všech zařízení jde v kartě Akce s účtem › Přihlášení a zabezpečení.</p>
            </div>
          )}
        </section>

        <div className={styles.side}>
          <AccountActions userId={id} fullAdmin={me.isAdmin} plan={info?.plan ?? 'free'} verified={info?.verified ?? null}
            name={person.display_name} kind={person.kind === 'shop' ? 'shop' : 'private'} ico={person.ico} mfa={!!info?.mfa} confirmed={info?.confirmed !== false} />

          <form action={saveUserNote} className={`${styles.box} ${styles.noteBox}`}>
            <h2 className={styles.boxTitle}>INTERNÍ POZNÁMKA (UŽIVATEL NEVIDÍ)</h2>
            <input type="hidden" name="user_id" value={id} />
            <textarea className={styles.input} name="body" rows={4} maxLength={2000} defaultValue={userNote?.body ?? ''}
              placeholder="Např. Preferuje e-mail. Domluveno vrácení 450 Kč." aria-label="Interní poznámka" />
            <div className={styles.row}>
              <span className={styles.small} style={{ flex: 1 }}>
                {userNote ? `${who(userNote.updated_by)} · ${formatDateTime(userNote.updated_at)}` : 'Zatím bez poznámky'}
              </span>
              <Button type="submit" variant="secondary">Uložit</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
