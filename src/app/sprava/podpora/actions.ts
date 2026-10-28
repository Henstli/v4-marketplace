'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { siteOrigin } from '@/lib/auth-helpers';
import {
  CONTENT_REASON, contentCode, KIND_NOUN, REASON_ARTICLE, snapshotLine,
  type ContentKind, type ContentReason, type ContentSnapshot,
} from '@/lib/content-reports';
import { sendSupportEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';
import {
  caseCode, dueFor, isoToPragueLocal, liftMail, MEASURES, PRIORITY, pragueLocalToIso, restrictionMail, STATUS,
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
  if (!recipients.length) back(path, { chyba: 'Vyberte, komu e-mail poslat' });

  const subject = `[${caseCode(c.number)}] ${str(form, 'subject') || c.subject}`;
  const origin = await siteOrigin();
  // Každému zvlášť, aby strany sporu neviděly e-mail té druhé.
  const sent = await Promise.all(recipients.map((r) => sendSupportEmail([r.email], subject, [{ text: body }], origin)));
  const okTo = recipients.filter((_, i) => sent[i]);
  if (!okTo.length) back(path, { chyba: 'E-mail se nepodařilo odeslat (Resend). Zkuste to znovu.' });

  await supabase.from('case_events').insert({
    case_id: c.id, kind: 'email', author_id: me, body, recipients: okTo.map((r) => r.label).join(', '),
  });
  const patch: Partial<CaseRow> = {};
  if (form.get('waiting')) patch.status = 'waiting';
  if (!c.assignee_id) patch.assignee_id = me;
  if (Object.keys(patch).length) await supabase.from('support_cases').update(patch).eq('id', c.id);
  revalidatePath(path);
  back(path, okTo.length < recipients.length
    ? { chyba: `E-mail odešel jen: ${okTo.map((r) => r.label).join(', ')}` }
    : { ok: `E-mail odeslán: ${okTo.map((r) => r.label).join(', ')}` });
}

export async function updateCase(form: FormData) {
  const { supabase, me } = await staff();
  const c = await caseOf(supabase, str(form, 'case_id', 40));
  if (!c) back('/sprava/podpora', { chyba: 'Případ neexistuje' });
  const path = `/sprava/podpora/${c.number}`;
  const status = STATUSES.includes(str(form, 'status') as CaseStatus) ? (str(form, 'status') as CaseStatus) : c.status;
  const priority = PRIOS.includes(str(form, 'priority') as CasePriority) ? (str(form, 'priority') as CasePriority) : c.priority;
  const assignee = str(form, 'assignee', 40) || null;
  const dueRaw = str(form, 'due', 20);
  // Pole má přesnost na minuty; beze změny termín nepřepisujeme.
  const due = dueRaw && dueRaw !== (c.due_at ? isoToPragueLocal(c.due_at) : '') ? pragueLocalToIso(dueRaw) : null;
  const patch: Partial<CaseRow> = {};
  const changes: string[] = [];
  if (status !== c.status) {
    patch.status = status;
    patch.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
    changes.push(`stav ${STATUS[status]}`);
    // Případ vrácený podpoře dostane nový termín, pokud ho nikdo nezadal.
    if (status === 'open' && !due) patch.due_at = dueFor(c.kind, priority);
  }
  if (priority !== c.priority) { patch.priority = priority; changes.push(`priorita ${PRIORITY[priority]}`); }
  if (assignee !== c.assignee_id) { patch.assignee_id = assignee; changes.push(assignee ? 'nový řešitel' : 'bez řešitele'); }
  if (due) { patch.due_at = due; changes.push('nový termín'); }
  if (!changes.length) redirect(path);
  const { error } = await supabase.from('support_cases').update(patch).eq('id', c.id);
  if (error) back(path, { chyba: error.message });
  await supabase.from('case_events').insert({ case_id: c.id, kind: 'event', author_id: me, body: `Změna: ${changes.join(', ')}` });
  revalidatePath(path);
  revalidatePath('/sprava/podpora');
  redirect(path);
}

// --- Čas -----------------------------------------------------------------------

export async function startTimer(form: FormData) {
  const { supabase, me } = await staff();
  const id = str(form, 'case_id', 40);
  const now = new Date().toISOString();
  await supabase.from('case_time').update({ ended_at: now }).eq('staff_id', me).is('ended_at', null);
  const { error } = await supabase.from('case_time').insert({ case_id: id, staff_id: me, started_at: now });
  const back_ = str(form, 'back', 200) || '/sprava/podpora';
  if (error) back(back_, { chyba: error.message });
  revalidatePath('/sprava/podpora', 'layout');
  redirect(back_);
}

export async function stopTimer(form: FormData) {
  const { supabase, me } = await staff();
  const note = str(form, 'note') || null;
  await supabase.from('case_time').update({ ended_at: new Date().toISOString(), ...(note ? { note } : {}) })
    .eq('staff_id', me).is('ended_at', null);
  revalidatePath('/sprava/podpora', 'layout');
  redirect(str(form, 'back', 200) || '/sprava/podpora');
}

export async function addTime(form: FormData) {
  const { supabase, me } = await staff();
  const number = str(form, 'number', 10);
  const minutes = Math.round(Number(str(form, 'minutes', 6)));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) back(`/sprava/podpora/${number}`, { chyba: 'Zadejte 1 až 600 minut' });
  const end = new Date();
  const { error } = await supabase.from('case_time').insert({
    case_id: str(form, 'case_id', 40), staff_id: me,
    started_at: new Date(end.getTime() - minutes * 60000).toISOString(), ended_at: end.toISOString(),
    note: str(form, 'note') || null,
  });
  if (error) back(`/sprava/podpora/${number}`, { chyba: error.message });
  revalidatePath(`/sprava/podpora/${number}`);
  redirect(`/sprava/podpora/${number}`);
}

export async function fixTime(form: FormData) {
  const { supabase } = await staff();
  const number = str(form, 'number', 10);
  const minutes = Math.round(Number(str(form, 'minutes', 6)));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 600) back(`/sprava/podpora/${number}`, { chyba: 'Zadejte 0 až 600 minut' });
  const id = Number(str(form, 'id', 20));
  const { data: t } = await supabase.from('case_time').select('started_at').eq('id', id).maybeSingle();
  if (!t) back(`/sprava/podpora/${number}`, { chyba: 'Záznam neexistuje' });
  const { error } = await supabase.from('case_time')
    .update({ ended_at: new Date(new Date(t.started_at).getTime() + minutes * 60000).toISOString(), auto_stopped: false })
    .eq('id', id);
  if (error) back(`/sprava/podpora/${number}`, { chyba: error.message });
  revalidatePath(`/sprava/podpora/${number}`);
  redirect(`/sprava/podpora/${number}`);
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
    { text: 'Tým podpory V4cards' },
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
      { text: 'Tým podpory V4cards' },
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
