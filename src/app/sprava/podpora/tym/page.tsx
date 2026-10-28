import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, ChipLink } from '@/components/trezor';
import { getCurrentUser } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { ACTION_LABEL, caseCode, hm, reasonOf, type ModAction, type Template } from '@/lib/support';
import { deleteTemplate, saveTemplate, setTeamRole } from './actions';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Tým · podpora' };

type Props = { searchParams: Promise<{ ok?: string; chyba?: string; karta?: string; upravit?: string }> };

interface Member {
  user_id: string; display_name: string | null; email: string; role: 'admin' | 'support'; added_at: string;
  case_number: number | null; seen_at: string | null; open_cases: number; month_minutes: number;
}
interface LogRow { id: number; staff_id: string | null; user_id: string; old_role: string | null; new_role: string | null; created_at: string }
interface ActionRow { id: number; staff_id: string | null; user_id: string | null; action: ModAction; reason_code: string | null; detail: string | null; until: string | null; created_at: string }

const ROLE = { admin: 'Správce', support: 'Podpora' } as Record<string, string>;
const TABS = [{ id: '', label: 'Lidé' }, { id: 'odpovedi', label: 'Hotové odpovědi' }, { id: 'zaznam', label: 'Záznam akcí' }];

function change(r: LogRow) {
  if (!r.old_role) return `Přidán(a) jako ${ROLE[r.new_role!]}`;
  if (!r.new_role) return 'Odebrán(a) z týmu';
  return `${ROLE[r.old_role]} → ${ROLE[r.new_role]}`;
}

/** Tým V4cards: vidí ho celý tým, měnit smí jen správce (DS Support › Tým). */
export default async function TeamPage({ searchParams }: Props) {
  const { ok, chyba, karta = '', upravit } = await searchParams;
  const user = (await getCurrentUser())!;
  const admin = user.isAdmin;
  const supabase = await createClient();
  const [{ data: team }, { data: log }, { data: actions }, { data: templates }] = await Promise.all([
    supabase.rpc('team_overview'),
    admin ? supabase.from('team_log').select('*').order('created_at', { ascending: false }).limit(50).returns<LogRow[]>() : Promise.resolve({ data: [] as LogRow[] }),
    supabase.from('staff_actions').select('id, staff_id, user_id, action, reason_code, detail, until, created_at')
      .order('created_at', { ascending: false }).limit(karta === 'zaznam' ? 300 : 3).returns<ActionRow[]>(),
    karta === 'odpovedi' ? supabase.from('support_templates').select('id, label, body, sort').order('sort').returns<Template[]>() : Promise.resolve({ data: [] as Template[] }),
  ]);
  const members = (team ?? []) as Member[];
  const ids = [...new Set([...(log ?? []).flatMap((r) => [r.user_id, r.staff_id]), ...(actions ?? []).map((a) => a.user_id)].filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  const staffNames = new Map(members.map((m) => [m.user_id, (m.display_name ?? m.email).split(' ')[0]]));
  const online = (m: Member) => !!m.seen_at && Date.now() - new Date(m.seen_at).getTime() < 5 * 60000;

  const actionTable = (rows: ActionRow[]) => (
    <table className={styles.table}>
      <thead><tr><th>KDY</th><th>KDO</th><th>AKCE</th><th>UŽIVATEL</th><th>DŮVOD</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={styles.small}>{formatDateTime(r.created_at)}</td>
            <td>{r.staff_id ? staffNames.get(r.staff_id) ?? 'bývalý člen' : 'systém'}</td>
            <td>{ACTION_LABEL[r.action] ?? r.action}{r.until ? ` do ${formatDate(r.until)}` : ''}</td>
            <td>{r.user_id ? <Link href={`/sprava/podpora/uzivatele/${r.user_id}`}>{names.get(r.user_id) ?? 'smazaný účet'}</Link> : '–'}</td>
            <td className={styles.small}>{reasonOf(r.reason_code)?.label ?? r.detail ?? '–'}</td>
          </tr>
        ))}
        {!rows.length ? <tr><td colSpan={5} className={styles.dash}>Zatím nic.</td></tr> : null}
      </tbody>
    </table>
  );

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className="t-heading-l">Tým</h1>
        {admin && karta === '' ? <Link href="#pridat" className="tz-btn tz-btn-primary tz-btn-md">+ Přidat člena</Link> : null}
      </div>
      <div className={styles.row}>
        {TABS.map((t) => <ChipLink key={t.id} href={t.id ? `/sprava/podpora/tym?karta=${t.id}` : '/sprava/podpora/tym'} selected={karta === t.id}>{t.label}</ChipLink>)}
      </div>
      {ok ? <p className={styles.flash}>{ok}</p> : null}
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}

      {karta === '' ? (
        <>
          <div className={`${styles.box} ${styles.tableWrap}`}>
            <table className={styles.table}>
              <thead><tr><th>ČLEN</th><th>ROLE</th><th>TEĎ</th><th className={styles.num}>OTEVŘENÉ</th><th className={styles.num}>ČAS ZA MĚSÍC</th>{admin ? <th /> : null}</tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>
                      <span className={styles.member}>
                        <span className={styles.msgAvatar} aria-hidden="true">{(m.display_name ?? m.email).slice(0, 1).toUpperCase()}</span>
                        <span><strong>{m.display_name ?? m.email}</strong><span className={styles.small}>{m.email}</span></span>
                      </span>
                    </td>
                    <td>
                      {admin && m.user_id !== user.id ? (
                        <form action={setTeamRole} className={styles.fix}>
                          <input type="hidden" name="email" value={m.email} />
                          <input type="hidden" name="role" value={m.role === 'admin' ? 'support' : 'admin'} />
                          <span>{ROLE[m.role]}</span>
                          <button type="submit" className={styles.smallBtn}>Změnit na {m.role === 'admin' ? 'Podpora' : 'Správce'}</button>
                        </form>
                      ) : ROLE[m.role]}
                    </td>
                    <td className={styles.small}>
                      {online(m) ? (
                        <span className={styles.qinside}><span className={styles.dot} aria-hidden="true" />{m.case_number ? `v ${caseCode(m.case_number)}` : 'v podpoře'}</span>
                      ) : <span><span className={`${styles.dot} ${styles.dotOff}`} aria-hidden="true" /> {m.seen_at ? `naposledy ${formatDateTime(m.seen_at)}` : 'zatím nebyl(a)'}</span>}
                    </td>
                    <td className={styles.num}>{m.open_cases}</td>
                    <td className={styles.num}>{hm(Number(m.month_minutes))}</td>
                    {admin ? (
                      <td>
                        {m.user_id === user.id ? <span className={styles.small}>Vy</span> : (
                          <form action={setTeamRole}>
                            <input type="hidden" name="email" value={m.email} />
                            <input type="hidden" name="role" value="none" />
                            <button type="submit" className={styles.smallBtn}>Odebrat z týmu</button>
                          </form>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.cols}>
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>CO SMÍ KTERÁ ROLE</h2>
              <p className={styles.small} style={{ lineHeight: 1.6 }}>
                <strong>Podpora:</strong> fronta, případy, uživatelé, skrytí obsahu, upozornění, pozastavení a zrušení účtu, předplatné, úpravy účtu, vlastní výkaz času.
              </p>
              <p className={styles.small} style={{ lineHeight: 1.6 }}>
                <strong>Správce</strong> navíc: tým, hotové odpovědi, ověření obchodu, výkaz všech, oprava cizího času, schvalování karet.
              </p>
              <p className={styles.small}>Celý tým má výhody tarifu Pro, ale v sekci Obchody Pro se neukazuje.</p>
            </section>
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>POSLEDNÍ V ZÁZNAMU AKCÍ</h2>
              <ul className={styles.list}>
                {(actions ?? []).slice(0, 3).map((r) => (
                  <li key={r.id} className={styles.caseLink}>
                    <span>{ACTION_LABEL[r.action] ?? r.action} · {r.user_id ? names.get(r.user_id) ?? 'smazaný účet' : ''}</span>
                    <span className={styles.qmuted}>{r.staff_id ? staffNames.get(r.staff_id) ?? '' : 'systém'} · {formatDateTime(r.created_at)}</span>
                  </li>
                ))}
                {!actions?.length ? <li className={styles.small}>Zatím nic.</li> : null}
              </ul>
              <Link href="/sprava/podpora/tym?karta=zaznam" className={styles.link}>Celý záznam ›</Link>
            </section>
          </div>

          {admin ? (
            <form action={setTeamRole} className={styles.box} style={{ maxWidth: 720 }} id="pridat">
              <h2 className={styles.boxTitle}>PŘIDAT DO TÝMU</h2>
              <div className={styles.row}>
                <label className={styles.field} style={{ flex: '1 1 260px' }}>E-mail
                  <input className={styles.input} name="email" type="email" required placeholder="E-mail účtu na V4cards" />
                </label>
                <label className={styles.field}>Role
                  <select className={styles.input} name="role" defaultValue="support">
                    <option value="support">Podpora</option>
                    <option value="admin">Správce</option>
                  </select>
                </label>
              </div>
              <p className={styles.small}>Člověk musí mít na V4cards účet. Pro přístup potřebuje zapnuté dvoufázové ověření.</p>
              <div><Button type="submit">Přidat</Button></div>
            </form>
          ) : null}

          {admin ? (
            <section className={styles.box}>
              <h2 className={styles.boxTitle}>HISTORIE TÝMU</h2>
              <ul className={styles.list}>
                {(log ?? []).map((r) => (
                  <li key={r.id} className={styles.hist}>
                    <span className={styles.small}>{formatDateTime(r.created_at)}</span>
                    <span><strong>{names.get(r.user_id) ?? 'smazaný účet'}</strong><span className={styles.small}>{change(r)}</span></span>
                    <span className={styles.small}>{r.staff_id ? names.get(r.staff_id) ?? 'správce' : 'systém'}</span>
                  </li>
                ))}
                {!log?.length ? <li className={styles.small}>Zatím beze změn.</li> : null}
              </ul>
            </section>
          ) : null}
        </>
      ) : karta === 'odpovedi' ? (
        <>
          <p className={styles.small}>
            Připravené texty pro časté dotazy. V případu je vkládá každý z týmu jedním kliknutím a text pak jde upravit.
            Rozloučení se doplní samo. Hranaté závorky [číslo] označují místa k doplnění.{admin ? '' : ' Upravuje je správce.'}
          </p>
          <div className={styles.tplGrid}>
            {(templates ?? []).map((t) => (
              admin && upravit === t.id ? (
                <TemplateForm key={t.id} t={t} />
              ) : (
                <section key={t.id} className={styles.box}>
                  <div className={styles.caseLink}>
                    <strong>{t.label}</strong>
                    {admin ? <Link href={`/sprava/podpora/tym?karta=odpovedi&upravit=${t.id}`} className={styles.link}>Upravit</Link> : null}
                  </div>
                  <p className={styles.msgBody} style={{ margin: 0 }}>{t.body}</p>
                </section>
              )
            ))}
            {admin ? <TemplateForm /> : null}
          </div>
        </>
      ) : (
        <>
          <p className={styles.small}>
            Omezení, předplatné, ověření, úpravy účtu, odhlášení, vypnutí dvoufázového ověření, skrytí nabídky, otevření zpráv mezi stranami
            a opravy času. Záznam nejde upravit ani smazat.
          </p>
          <div className={`${styles.box} ${styles.tableWrap}`}>{actionTable(actions ?? [])}</div>
        </>
      )}
    </div>
  );
}

function TemplateForm({ t }: { t?: Template }) {
  return (
    <section className={styles.box}>
      <form action={saveTemplate} className={styles.main}>
        <h2 className={styles.boxTitle}>{t ? 'UPRAVIT HOTOVOU ODPOVĚĎ' : 'NOVÁ HOTOVÁ ODPOVĚĎ'}</h2>
        {t ? <input type="hidden" name="id" value={t.id} /> : null}
        <div className={styles.row}>
          <label className={styles.field} style={{ flex: 1 }}>Název
            <input className={styles.input} name="label" required minLength={2} maxLength={80} defaultValue={t?.label} />
          </label>
          <label className={styles.field} style={{ width: 90 }}>Pořadí
            <input className={styles.input} name="sort" type="number" min={0} max={9999} defaultValue={t?.sort ?? 100} />
          </label>
        </div>
        <label className={styles.field}>Text
          <textarea className={styles.input} name="body" rows={6} required minLength={10} maxLength={4000} defaultValue={t?.body ?? 'Dobrý den,\n\n'} />
        </label>
        <div className={styles.row}>
          <Button type="submit">{t ? 'Uložit' : 'Přidat'}</Button>
          {t ? <Link href="/sprava/podpora/tym?karta=odpovedi" className={styles.link}>Zrušit</Link> : null}
          {t ? <span style={{ flex: 1 }} /> : null}
          {t ? <Button type="submit" variant="ghost" formAction={deleteTemplate} formNoValidate>Smazat</Button> : null}
        </div>
      </form>
    </section>
  );
}
