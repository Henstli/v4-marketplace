'use server';

import { createClient as createPlainClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { siteOrigin } from '@/lib/auth-helpers';
import {
  CONTENT_REASON, contentCode, KIND_NOUN, REASON_ARTICLE, snapshotLine,
  type ContentKind, type ContentReason, type ContentSnapshot,
} from '@/lib/content-reports';
import { sendSupportEmail } from '@/lib/email';
import { createAdminClient } from '@/lib/supabase/admin';
import { SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { dmRoom } from '@/lib/team-chat';
import {
  caseCode, dueFor, isoToPragueLocal, liftMail, MEASURES, PRIORITY, pragueLocalToIso, restrictionMail, SIGNATURE, STATUS,
  type CaseKind, type CasePriority, type CaseRow, type CaseStatus,
} from '@/lib/support';

// Oprávnění hlídá databáze: případy, osu, čas i omezení smí měnit jen správce (RLS a funkce admin_*).

const str = (form: FormData, key: string, max = 200) => String(form.get(key) ?? '').trim().slice(0, max);
const KINDS: CaseKind[] = ['report', 'question', 'appeal', 'content', 'other'];
const PRIOS: CasePriority[] = ['high', 'mid', 'low'];
const STATUSES: CaseStatus[] = ['open', 'waiting', 'resolved'];

async function staff() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/prihlaseni?dalsi=/sprava/podpora');
  return { supabase, me: data.user.id };
}

function back(path: string, msg: { ok?: string; chyba?: string }): never {
  const q = new URLSearchParams(msg as Record<string, string>).toString();
  redirect(`${path}${path.includes('?') ? '&' : '?'}${q}`);
}

async function caseOf(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from('support_cases').select('*').eq('id', id).maybeSingle<CaseRow>();
  return data;
}

// --- Případ ------------------------------------------------------------------

export async function createCase(form: FormData) {
  const { supabase, me } = await staff();
  const kind = KINDS.includes(str(form, 'kind') as CaseKind) ? (str(form, 'kind') as CaseKind) : 'question';
  const priority = PRIOS.includes(str(form, 'priority') as CasePriority) ? (str(form, 'priority') as CasePriority) : 'mid';
  const subject = str(form, 'subject');
  const who = str(form, 'who');
  const body = str(form, 'body', 8000);
  let userId = str(form, 'user_id') || null;
  let contact: string | null = null;
  if (subject.length < 3) back('/sprava/podpora/novy', { chyba: 'Napište předmět případu' });
  if (!userId && who) {
    const { data } = await supabase.rpc('admin_find_users', { p_q: who });
    const rows = (data ?? []) as Array<{ id: string; display_name: string; email: string }>;
    const exact = rows.find((r) => r.email?.toLowerCase() === who.toLowerCase() || r.display_name?.toLowerCase() === who.toLowerCase() || r.id === who);
    if (exact) userId = exact.id;
    else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(who)) contact = who;
    else back('/sprava/podpora/novy', { chyba: `Uživatele „${who}“ jsme nenašli. Zadejte e-mail nebo přesnou přezdívku.` });
  }
  const { data: c, error } = await supabase.from('support_cases').insert({
    kind, priority, subject, user_id: userId, contact_email: contact, due_at: dueFor(kind, priority),
    assignee_id: me, created_by: me,
  }).select('number, id').single();
  if (error || !c) back('/sprava/podpora/novy', { chyba: error?.message ?? 'Případ se nepodařilo založit' });
  if (body) await supabase.from('case_events').insert({ case_id: c.id, kind: 'note', author_id: me, body });
  revalidatePath('/sprava/podpora');
  redirect(`/sprava/podpora/${c.number}`);
}

export async function addNote(form: FormData) {
  const { supabase, me } = await staff();
  const id = str(form, 'case_id', 40);
  const number = str(form, 'number', 10);
  const body = str(form, 'body', 8000);
  if (!body) back(`/sprava/podpora/${number}`, { chyba: 'Napište poznámku' });
  const { error } = await supabase.from('case_events').insert({ case_id: id, kind: 'note', author_id: me, body });
  if (error) back(`/sprava/podpora/${number}`, { chyba: error.message });
  revalidatePath(`/sprava/podpora/${number}`);
  redirect(`/sprava/podpora/${number}`);
}

export async function sendCaseEmail(form: FormData) {
  const { supabase, me } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const path = `/sprava/podpora/${c.number}`;
  const to = str(form, 'to', 20);
  const body = str(form, 'body', 8000);
  const after = str(form, 'after', 10) === 'resolve' ? 'resolve' : 'wait';
  if (body.length < 10) back(path, { chyba: 'Napište text odpovědi' });

  const ids = (to === 'both' ? [c.user_id, c.other_id] : to === 'other' ? [c.other_id] : to === 'user' ? [c.user_id] : [])
    .filter((x): x is string => !!x);
  const recipients: Array<{ email: string; label: string }> = [];
  if (ids.length) {
    const [{ data: emails }, { data: people }] = await Promise.all([
      supabase.rpc('admin_user_emails', { p_ids: ids }),
      supabase.from('profiles').select('id, display_name').in('id', ids),
    ]);
    for (const e of (emails ?? []) as Array<{ id: string; email: string }>) {
      const name = people?.find((p) => p.id === e.id)?.display_name ?? e.email;
      recipients.push({ email: e.email, label: name });
    }
  } else if (to === 'contact' && c.contact_email) {
    recipients.push({ email: c.contact_email, label: c.contact_email });
  }
  if (!recipients.length) back(path, { chyba: 'Vyberte, komu odpověď poslat' });

  // Příloha nahraná z prohlížeče do support-files/<případ>/staff-…; k e-mailu jde jako odkaz na hodinu.
  const file = await savedReplyFile(c.id, str(form, 'file_path', 300), str(form, 'file_name', 120));
  const attachments = file ? [{ filename: file.name, path: file.url }] : [];

  const subject = `[${caseCode(c.number)}] ${str(form, 'subject') || c.subject}`;
  const origin = await siteOrigin();
  const paragraphs = [{ text: body }, { text: SIGNATURE }];
  // Každému zvlášť, aby strany sporu neviděly e-mail té druhé.
  const sent = await Promise.all(recipients.map((r) => sendSupportEmail([r.email], subject, paragraphs, origin, true, attachments)));
  const okTo = recipients.filter((_, i) => sent[i]);
  if (!okTo.length) back(path, { chyba: 'E-mail se nepodařilo odeslat (Resend). Zkuste to znovu.' });

  await supabase.from('case_events').insert({
    case_id: c.id, kind: 'email', author_id: me, body: file ? `${body}\n\nPříloha: ${file.name}` : body,
    recipients: okTo.map((r) => r.label).join(', '),
  });
  const patch: Partial<CaseRow> = after === 'resolve'
    ? { status: 'resolved', resolved_at: new Date().toISOString(), snoozed_until: null }
    : { status: 'waiting' };
  if (!c.assignee_id) patch.assignee_id = me;
  await supabase.from('support_cases').update(patch).eq('id', c.id);
  revalidatePath(path);
  revalidatePath('/sprava/podpora');
  back(path, okTo.length < recipients.length
    ? { chyba: `Odpověď odešla jen: ${okTo.map((r) => r.label).join(', ')}` }
    : { ok: `Odesláno: ${okTo.map((r) => r.label).join(', ')}${after === 'resolve' ? ' · případ vyřešen' : ' · čeká na odpověď'}` });
}

/** Podepsaný odkaz pro nahrání přílohy k odpovědi (fotka nebo PDF do 10 MB). */
export async function replyUpload(caseId: string, name: string, type: string, size: number): Promise<{ path?: string; token?: string; error?: string }> {
  const { supabase } = await staff();
  const { data: role } = await supabase.rpc('staff_role');
  const admin = createAdminClient();
  if (!role || !admin || !/^[0-9a-f-]{36}$/i.test(caseId)) return { error: 'Přílohu teď nejde nahrát.' };
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(type) || size <= 0 || size > 10 * 1024 * 1024) {
    return { error: 'Jen fotka nebo PDF do 10 MB.' };
  }
  const safe = name.normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60) || 'soubor';
  const path = `${caseId}/staff-${crypto.randomUUID()}-${safe}`;
  const { data } = await admin.storage.from('support-files').createSignedUploadUrl(path);
  return data ? { path, token: data.token } : { error: 'Přílohu teď nejde nahrát.' };
}

async function savedReplyFile(caseId: string, path: string, name: string) {
  if (!path) return null;
  const admin = createAdminClient();
  if (!admin || !path.startsWith(`${caseId}/staff-`) || path.includes('..')) return null;
  const folder = path.slice(caseId.length + 1);
  const { data: files } = await admin.storage.from('support-files').list(caseId, { search: folder });
  const f = files?.find((x) => x.name === folder);
  if (!f) return null;
  const clean = name.slice(0, 120) || 'příloha';
  await admin.from('case_files').insert({ case_id: caseId, path, name: clean, size: (f.metadata as { size?: number } | null)?.size ?? null });
  const { data: signed } = await admin.storage.from('support-files').createSignedUrl(path, 3600);
  return signed ? { name: clean, url: signed.signedUrl } : null;
}

// --- Stav, předání, odložení, sloučení, priorita ----------------------------------

async function logChange(supabase: Awaited<ReturnType<typeof createClient>>, caseId: string, me: string, body: string) {
  await supabase.from('case_events').insert({ case_id: caseId, kind: 'event', author_id: me, body });
}

function done(c: CaseRow): never {
  revalidatePath(`/sprava/podpora/${c.number}`);
  revalidatePath('/sprava/podpora');
  redirect(`/sprava/podpora/${c.number}`);
}

/** Stav a Řeší z pravého panelu (uloží se hned po výběru). */
export async function updateCase(form: FormData) {
  const { supabase, me } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const status = STATUSES.includes(str(form, 'status') as CaseStatus) ? (str(form, 'status') as CaseStatus) : c.status;
  const assignee = form.has('assignee') ? str(form, 'assignee', 40) || null : c.assignee_id;
  const patch: Partial<CaseRow> = {};
  const changes: string[] = [];
  if (status !== c.status) {
    patch.status = status;
    patch.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
    changes.push(`stav ${STATUS[status]}`);
    // Případ vrácený podpoře dostane nový termín.
    if (status === 'open') patch.due_at = dueFor(c.kind, c.priority);
  }
  if (assignee !== c.assignee_id) {
    patch.assignee_id = assignee;
    changes.push(assignee ? `řeší ${await staffName(supabase, assignee)}` : 'bez řešitele');
  }
  if (!changes.length) redirect(`/sprava/podpora/${c.number}`);
  const { error } = await supabase.from('support_cases').update(patch).eq('id', c.id);
  if (error) back(`/sprava/podpora/${c.number}`, { chyba: error.message });
  await logChange(supabase, c.id, me, `Změna: ${changes.join(', ')}`);
  done(c);
}

async function staffName(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from('profiles').select('display_name').eq('id', id).maybeSingle();
  return (data?.display_name as string | undefined) ?? 'kolega';
}

/** Předat případ kolegovi s poznámkou proč. */
export async function handoverCase(form: FormData) {
  const { supabase, me } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const to = str(form, 'to', 40);
  const note = str(form, 'note', 500);
  if (!to || to === c.assignee_id) back(`/sprava/podpora/${c.number}`, { chyba: 'Vyberte, komu případ předat' });
  const { error } = await supabase.from('support_cases').update({ assignee_id: to }).eq('id', c.id);
  if (error) back(`/sprava/podpora/${c.number}`, { chyba: error.message });
  const [from, who] = await Promise.all([staffName(supabase, me), staffName(supabase, to)]);
  await logChange(supabase, c.id, me, `${from} předal(a) případ: ${who}${note ? ` · ${note}` : ''}`);
  // Kolega dostane zprávu v Chatu týmu (soukromá konverzace) s odkazem na případ.
  await supabase.from('team_messages').insert({
    room: dmRoom(me, to), sender_id: me, kind: 'system', case_id: c.id,
    body: `${from} předal(a) případ ${caseCode(c.number)} (${c.subject})${note ? `: ${note}` : ''}`,
  });
  done(c);
}

/** Odložit do data: do té doby se ve frontě neukazuje, odpověď uživatele ho vrátí hned. */
export async function snoozeCase(form: FormData) {
  const { supabase, me } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const days = Number(str(form, 'days', 3));
  const until = days > 0 && days <= 60 ? new Date(Date.now() + days * 86400000).toISOString() : pragueLocalToIso(str(form, 'until', 20));
  if (form.get('cancel')) {
    await supabase.from('support_cases').update({ snoozed_until: null }).eq('id', c.id);
    await logChange(supabase, c.id, me, 'Odložení zrušeno');
    done(c);
  }
  if (!until || Date.parse(until) <= Date.now()) back(`/sprava/podpora/${c.number}`, { chyba: 'Vyberte datum v budoucnu' });
  const { error } = await supabase.from('support_cases').update({ snoozed_until: until }).eq('id', c.id);
  if (error) back(`/sprava/podpora/${c.number}`, { chyba: error.message });
  await logChange(supabase, c.id, me, `Odloženo do ${new Date(until).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Prague' })}`);
  done(c);
}

/** Sloučit tento případ do jiného (osa, přílohy a nahlášení se přesunou). */
export async function mergeCase(form: FormData) {
  const { supabase } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const m = /^(?:p-?)?0*(\d+)$/i.exec(str(form, 'into', 12));
  if (!m) back(`/sprava/podpora/${c.number}`, { chyba: 'Zadejte číslo případu, např. P-0128' });
  const { data: target } = await supabase.from('support_cases').select('id').eq('number', Number(m[1])).maybeSingle();
  if (!target) back(`/sprava/podpora/${c.number}`, { chyba: 'Takový případ neexistuje' });
  const { data: n, error } = await supabase.rpc('admin_merge_cases', { p_from: c.id, p_into: target.id });
  if (error) back(`/sprava/podpora/${c.number}`, { chyba: error.message });
  revalidatePath('/sprava/podpora');
  back(`/sprava/podpora/${n}`, { ok: `Sloučeno s ${caseCode(c.number)}` });
}

/** Priorita a termín. */
export async function setPriority(form: FormData) {
  const { supabase, me } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const priority = PRIOS.includes(str(form, 'priority') as CasePriority) ? (str(form, 'priority') as CasePriority) : c.priority;
  const dueRaw = str(form, 'due', 20);
  const due = dueRaw && dueRaw !== (c.due_at ? isoToPragueLocal(c.due_at) : '') ? pragueLocalToIso(dueRaw) : null;
  const patch: Partial<CaseRow> = {};
  const changes: string[] = [];
  if (priority !== c.priority) { patch.priority = priority; changes.push(`priorita ${PRIORITY[priority]}`); }
  if (due) { patch.due_at = due; changes.push('nový termín'); }
  if (!changes.length) redirect(`/sprava/podpora/${c.number}`);
  const { error } = await supabase.from('support_cases').update(patch).eq('id', c.id);
  if (error) back(`/sprava/podpora/${c.number}`, { chyba: error.message });
  await logChange(supabase, c.id, me, `Změna: ${changes.join(', ')}`);
  done(c);
}

// --- Čas -----------------------------------------------------------------------
// Čas se počítá sám (support_beat z prohlížeče). Ručně jde jen opravit délku záznamu ve Výkazu.

export async function fixTime(form: FormData) {
  const { supabase } = await staff();
  const backTo = str(form, 'back', 200) || '/sprava/podpora/vykaz';
  const minutes = Math.round(Number(str(form, 'minutes', 6)));
  if (!Number.isFinite(minutes)) back(backTo, { chyba: 'Zadejte počet minut' });
  const { error } = await supabase.rpc('admin_fix_time', { p_id: Number(str(form, 'id', 20)), p_minutes: minutes });
  if (error) back(backTo, { chyba: error.message });
  revalidatePath('/sprava/podpora/vykaz');
  back(backTo, { ok: 'Čas opraven' });
}

// --- Omezení účtu ----------------------------------------------------------------

export async function restrictUser(form: FormData) {
  const { supabase, me } = await staff();
  const userId = str(form, 'user_id', 40);
  const path = `/sprava/podpora/uzivatele/${userId}/omezit`;
  const action = str(form, 'action', 20) as (typeof MEASURES)[number]['id'];
  if (!MEASURES.some((m) => m.id === action)) back(path, { chyba: 'Vyberte opatření' });
  const reason = str(form, 'reason', 40);
  const facts = str(form, 'facts', 4000);
  const days = action === 'ban' || action === 'warning' ? 0 : Math.max(0, Math.round(Number(str(form, 'days', 4)) || 0));
  let caseId = str(form, 'case_id', 40) || null;

  const { data: person } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  if (!person) back(path, { chyba: 'Uživatel neexistuje' });
  let c: CaseRow | null = caseId ? await caseOf(supabase, caseId) : null;
  // Každé opatření má svůj případ, aby se na něj dalo odvolat s číslem v předmětu.
  if (!c) {
    const m = MEASURES.find((x) => x.id === action)!;
    const { data } = await supabase.from('support_cases').insert({
      kind: 'other', priority: 'mid', status: 'resolved', resolved_at: new Date().toISOString(),
      subject: `${m.label}: ${person.display_name}`, user_id: userId, assignee_id: me, created_by: me,
    }).select('*').single<CaseRow>();
    c = data;
    caseId = c?.id ?? null;
  }

  const { error } = await supabase.rpc('admin_restrict', {
    p_user: userId, p_action: action, p_reason: reason, p_facts: facts, p_days: days || null, p_case: caseId,
  });
  if (error) back(path, { chyba: error.message });

  const mail = restrictionMail({ action, name: person.display_name, reasonId: reason, facts, days, caseNumber: c?.number });
  const sent = await mailUser(supabase, userId, mail, c, me);
  revalidatePath(`/sprava/podpora/uzivatele/${userId}`);
  back(`/sprava/podpora/uzivatele/${userId}`, sent
    ? { ok: 'Opatření uloženo a odůvodnění odesláno e-mailem' }
    : { chyba: 'Opatření uloženo, ale e-mail s odůvodněním neodešel. Pošlete ho z případu ručně.' });
}

export async function liftRestriction(form: FormData) {
  const { supabase, me } = await staff();
  const userId = str(form, 'user_id', 40);
  const path = `/sprava/podpora/uzivatele/${userId}`;
  const { data: r } = await supabase.from('account_restrictions').select('case_id').eq('user_id', userId).is('ended_at', null).maybeSingle();
  const c = r?.case_id ? await caseOf(supabase, r.case_id) : null;
  const { error } = await supabase.rpc('admin_restrict', {
    p_user: userId, p_action: 'lift', p_reason: null, p_facts: str(form, 'note', 4000) || null, p_days: null, p_case: c?.id ?? null,
  });
  if (error) back(path, { chyba: error.message });
  const { data: person } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  const sent = await mailUser(supabase, userId, liftMail(person?.display_name ?? 'účtu', c?.number), c, me);
  revalidatePath(path);
  back(path, sent ? { ok: 'Omezení zrušeno, uživatel dostal e-mail' } : { ok: 'Omezení zrušeno (e-mail neodešel)' });
}

async function mailUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  mail: ReturnType<typeof liftMail>,
  c: CaseRow | null,
  me: string,
): Promise<boolean> {
  const { data: emails } = await supabase.rpc('admin_user_emails', { p_ids: [userId] });
  const email = ((emails ?? []) as Array<{ email: string }>)[0]?.email;
  if (!email) return false;
  const ok = await sendSupportEmail([email], mail.subject, mail.paragraphs, await siteOrigin());
  if (ok && c) {
    await supabase.from('case_events').insert({
      case_id: c.id, kind: 'email', author_id: me, recipients: email,
      body: mail.paragraphs.map((p) => (p.title ? `${p.title} ${p.text}` : p.text)).join('\n\n'),
    });
  }
  return ok;
}

// --- Akce s účtem (smí celá podpora, ověření obchodu jen správce) --------------------------
// Každá akce chce krátký důvod; zápis do Záznamu akcí dělá databáze.

function userBack(form: FormData) {
  const id = str(form, 'user_id', 40);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/sprava/podpora/uzivatele');
  const tab = str(form, 'karta', 20);
  return { id, path: `/sprava/podpora/uzivatele/${id}${tab ? `?karta=${tab}` : ''}` };
}

async function userEmail(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.rpc('admin_user_emails', { p_ids: [id] });
  return ((data ?? []) as Array<{ email: string }>)[0]?.email ?? null;
}

function userDone(id: string, path: string, ok: string): never {
  revalidatePath(`/sprava/podpora/uzivatele/${id}`);
  back(path, { ok });
}

export async function userPlan(form: FormData) {
  const { supabase } = await staff();
  const { id, path } = userBack(form);
  const plan = str(form, 'plan', 10);
  const { error } = await supabase.rpc('admin_user_plan', { p_user: id, p_plan: plan, p_note: str(form, 'reason', 300) });
  if (error) back(path, { chyba: error.message });
  userDone(id, path, plan === 'free' ? 'Tarif změněn na Zdarma' : `Tarif ${plan === 'pro' ? 'Pro' : 'Plus'} udělen`);
}

export async function userVerify(form: FormData) {
  const { supabase } = await staff();
  const { id, path } = userBack(form);
  const email = await userEmail(supabase, id);
  const method = str(form, 'method', 10);
  const { error } = await supabase.rpc('admin_set_verified', {
    p_email: email ?? '', p_method: ['identity', 'ico'].includes(method) ? method : 'none', p_ico: str(form, 'ico', 20) || null,
  });
  if (error) back(path, { chyba: error.message });
  userDone(id, path, method === 'none' ? 'Ověření odebráno' : 'Obchod ověřen');
}

export async function userProfile(form: FormData) {
  const { supabase } = await staff();
  const { id, path } = userBack(form);
  const { error } = await supabase.rpc('admin_user_profile', {
    p_user: id, p_name: str(form, 'name', 40), p_kind: str(form, 'kind', 10), p_ico: str(form, 'ico', 20), p_reason: str(form, 'reason', 300),
  });
  if (error) back(path, { chyba: error.message });
  revalidatePath('/', 'layout');
  userDone(id, path, 'Údaje účtu upraveny');
}

export async function userSignout(form: FormData) {
  const { supabase } = await staff();
  const { id, path } = userBack(form);
  const { data, error } = await supabase.rpc('admin_user_signout', { p_user: id, p_reason: str(form, 'reason', 300) || 'Na žádost podpory' });
  if (error) back(path, { chyba: error.message });
  userDone(id, path, `Odhlášeno ze všech zařízení (${data ?? 0})`);
}

export async function userMfaReset(form: FormData) {
  const { supabase } = await staff();
  const { id, path } = userBack(form);
  if (!form.get('verified')) back(path, { chyba: 'Nejdřív ověřte totožnost a zaškrtněte to' });
  const { error } = await supabase.rpc('admin_user_mfa_reset', { p_user: id, p_reason: str(form, 'reason', 300) });
  if (error) back(path, { chyba: error.message });
  userDone(id, path, 'Dvoufázové ověření vypnuto, uživatel je odhlášený');
}

/** Odkaz na nové heslo nebo nové potvrzení posíláme stejně, jako když o ně požádá uživatel sám (Supabase Auth). */
export async function userAuthMail(form: FormData) {
  const { supabase } = await staff();
  const { id, path } = userBack(form);
  const kind = str(form, 'kind', 20) === 'confirm' ? 'confirm_resend' : 'password_reset';
  const reason = str(form, 'reason', 200);
  if (reason.length < 3) back(path, { chyba: 'Napište krátce proč' });
  const email = await userEmail(supabase, id);
  if (!email) back(path, { chyba: 'Uživatel nemá e-mail' });
  // Klient bez cookies podpory, aby se odkaz nevázal na prohlížeč podpory.
  const auth = createPlainClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
  const origin = await siteOrigin();
  const { error } = kind === 'confirm_resend'
    ? await auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${origin}/auth/callback` } })
    : await auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?dalsi=/nove-heslo` });
  if (error) back(path, { chyba: `E-mail neodešel: ${error.message}` });
  await supabase.rpc('admin_log_action', {
    p_user: id, p_action: kind, p_detail: `${kind === 'confirm_resend' ? 'Znovu posláno potvrzení e-mailu' : 'Poslán odkaz na nové heslo'} · ${reason}`,
  });
  userDone(id, path, kind === 'confirm_resend' ? `Potvrzení posláno na ${email}` : `Odkaz na nové heslo poslán na ${email}`);
}

export async function saveUserNote(form: FormData) {
  const { supabase, me } = await staff();
  const { id, path } = userBack(form);
  const body = str(form, 'body', 2000);
  const { error } = await supabase.from('user_notes').upsert({ user_id: id, body, updated_by: me, updated_at: new Date().toISOString() });
  if (error) back(path, { chyba: error.message });
  userDone(id, path, 'Poznámka uložena');
}

export async function listingVisibility(form: FormData) {
  const { supabase } = await staff();
  const { id, path } = userBack(form);
  const hide = str(form, 'hide', 2) === '1';
  const { error } = await supabase.rpc('admin_listing_visibility', {
    p_listing: str(form, 'listing_id', 40), p_hide: hide, p_reason: str(form, 'reason', 200) || (hide ? 'Skryto podporou' : 'Obnoveno podporou'),
  });
  if (error) back(path, { chyba: error.message });
  revalidatePath('/karty', 'layout');
  userDone(id, path, hide ? 'Nabídka skryta' : 'Nabídka obnovena');
}

// --- Nahlášený obsah ---------------------------------------------------------

const YOURS: Partial<Record<ContentKind, string>> = { listing: 'vaši nabídku', message: 'vaši zprávu', review: 'vaše hodnocení' };

/**
 * Rozhodnutí o nahlášeném obsahu (DS Support › Nahlášený obsah). Databáze skryje obsah a vyřeší případ,
 * tady e-maily: nahlašitelům výsledek, autorovi při skrytí odůvodnění (DSA čl. 17).
 */
export async function decideContent(form: FormData) {
  const { supabase, me } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const path = `/sprava/podpora/${c.number}`;
  const decision = str(form, 'decision', 10) === 'removed' ? 'removed' : 'kept';
  const facts = str(form, 'facts', 4000);
  const { data: reasons } = await supabase.from('content_reports').select('reason').eq('case_id', c.id).is('decision', null);
  const { data, error } = await supabase.rpc('admin_decide_content', { p_case: c.id, p_decision: decision, p_facts: facts || null });
  if (error) back(path, { chyba: error.message });
  const r = ((data ?? []) as Array<{
    target_kind: ContentKind; author_email: string | null; author_name: string | null;
    reporter_emails: string[]; numbers: number[]; snapshot: ContentSnapshot;
  }>)[0];
  if (!r) back(path, { chyba: 'Rozhodnutí se nepodařilo uložit' });

  const origin = await siteOrigin();
  const codes = r.numbers.map(contentCode).join(', ');
  const what = snapshotLine(r.target_kind, r.snapshot);
  const sentTo: string[] = [];
  // Nahlašitelé: každý zvlášť, bez kopie (jde o hromadné oznámení, ne o konverzaci).
  const reporterMails = await Promise.all(r.reporter_emails.map((email) => sendSupportEmail([email], `Výsledek nahlášení ${codes}`, [
    { text: 'Dobrý den,' },
    { text: decision === 'removed'
      ? `děkujeme za nahlášení. Prověřili jsme ho a obsah (${KIND_NOUN[r.target_kind]}: ${what}) jsme skryli.`
      : `děkujeme za nahlášení. Prověřili jsme ho a obsah (${KIND_NOUN[r.target_kind]}: ${what}) podle nás pravidla V4cards neporušuje, proto zůstává.` },
    { text: 'Rozhodl člověk z týmu V4cards. Pokud nesouhlasíte, odpovězte na tento e-mail do 6 měsíců a podíváme se na to znovu.' },
    { text: SIGNATURE },
  ], origin, false)));
  if (reporterMails.some(Boolean)) sentTo.push(`${reporterMails.filter(Boolean).length}× nahlašitel`);

  if (decision === 'removed' && r.author_email) {
    const yours = YOURS[r.target_kind];
    const reasonList = [...new Set((reasons ?? []).map((x) => x.reason as ContentReason))];
    const ok = await sendSupportEmail([r.author_email], `Skryli jsme ${yours} na V4cards`, [
      { text: `Dobrý den${r.author_name ? `, ${r.author_name}` : ''},` },
      { text: `na základě nahlášení jsme skryli ${yours}: ${what}.` },
      { text: `Důvod: ${reasonList.map((x) => `${CONTENT_REASON[x]} (obchodní podmínky ${REASON_ARTICLE[x]})`).join('; ') || 'porušení obchodních podmínek'}.` },
      { text: `Z čeho vycházíme: ${facts}` },
      { text: 'Skrytý je jen tento obsah, váš účet omezený není. Rozhodl člověk z týmu V4cards, ne automat.' },
      { text: 'Pokud nesouhlasíte, odpovězte na tento e-mail do 6 měsíců a vysvětlete proč. Rozhodnutí znovu prověříme a odpovíme vám. Můžete se také obrátit na mimosoudní řešení sporů nebo na soud.' },
      { text: SIGNATURE },
    ], origin);
    if (ok) sentTo.push(r.author_name ?? r.author_email);
  }
  if (sentTo.length) {
    await supabase.from('case_events').insert({
      case_id: c.id, kind: 'email', author_id: me, recipients: sentTo.join(', '),
      body: decision === 'removed' ? 'Výsledek nahlašitelům a odůvodnění autorovi' : 'Výsledek nahlašitelům',
    });
  }
  revalidatePath(path);
  revalidatePath('/sprava/podpora');
  revalidatePath('/karty', 'layout');
  back(path, { ok: decision === 'removed' ? `Obsah skryt${sentTo.length ? `, e-mail: ${sentTo.join(', ')}` : ''}` : 'Obsah ponechán, nahlašitelé dostali výsledek' });
}
