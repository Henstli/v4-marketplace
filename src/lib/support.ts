// Panel podpory (DS Support). Co kdo smí, hlídá databáze (jen správci); tady jsou texty, šablony a výpočty.

export type CaseKind = 'report' | 'question' | 'appeal' | 'content' | 'other';
export type CaseStatus = 'open' | 'waiting' | 'resolved';
export type CasePriority = 'high' | 'mid' | 'low';
export type EventKind = 'note' | 'email' | 'user' | 'event';
export type ModAction = 'warning' | 'hide_listings' | 'suspend' | 'ban' | 'lift' | 'expired' | 'plan' | 'verify'
  | 'profile' | 'signout' | 'mfa_reset' | 'password_reset' | 'confirm_resend' | 'listing_hide' | 'listing_restore' | 'messages_view' | 'time_fix';
export type RestrictionKind = 'hidden' | 'suspended' | 'banned';

export const KIND: Record<CaseKind, string> = {
  report: 'Hlášení objednávky',
  question: 'Dotaz',
  appeal: 'Odvolání',
  content: 'Nahlášený obsah',
  other: 'Jiné',
};
export const STATUS: Record<CaseStatus, string> = { open: 'Řeší podpora', waiting: 'Čeká na uživatele', resolved: 'Vyřešeno' };
export const PRIORITY: Record<CasePriority, string> = { high: 'Vysoká', mid: 'Střední', low: 'Nízká' };

export const caseCode = (n: number) => `P-${String(n).padStart(4, '0')}`;

export interface CaseRow {
  id: string;
  number: number;
  kind: CaseKind;
  subject: string;
  status: CaseStatus;
  priority: CasePriority;
  assignee_id: string | null;
  due_at: string | null;
  user_id: string | null;
  other_id: string | null;
  contact_email: string | null;
  order_id: string | null;
  report_id: string | null;
  last_event: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  snoozed_until: string | null;
  merged_into: string | null;
  last_user_at: string | null;
}

export interface CaseEvent {
  id: number;
  case_id: string;
  kind: EventKind;
  author_id: string | null;
  recipients: string | null;
  body: string;
  created_at: string;
}

export interface TimeRow {
  id: number;
  case_id: string | null;
  staff_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  auto_stopped: boolean;
}

/** Termín podle typu a priority (stejně jako case_due v databázi). Víkendy se počítají. */
export function dueFor(kind: CaseKind, priority: CasePriority, from = Date.now()): string {
  const days = kind === 'appeal' ? 7 : priority === 'high' ? 1 : 2;
  return new Date(from + days * 86400000).toISOString();
}

// --- Čas v Praze ------------------------------------------------------------

const TZ = 'Europe/Prague';

/** Datum v Praze jako YYYY-MM-DD. */
export function pragueDay(d: Date | string): string {
  return new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** Posun Prahy proti UTC v minutách v daný okamžik. */
function pragueOffset(d: Date): number {
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

/** Půlnoc pražského dne YYYY-MM-DD jako okamžik. */
export function pragueMidnight(day: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  return new Date(guess.getTime() - pragueOffset(guess) * 60000);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pondělí týdne, do kterého patří pražský den. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export type DueGroup = 'late' | 'today' | 'week' | 'later' | 'waiting' | 'resolved';
export const GROUP_LABEL: Record<DueGroup, string> = {
  late: 'PO TERMÍNU',
  today: 'DNES',
  week: 'TENTO TÝDEN',
  later: 'POZDĚJI',
  waiting: 'ČEKÁ NA UŽIVATELE',
  resolved: 'VYŘEŠENO',
};

export function dueGroup(c: Pick<CaseRow, 'status' | 'due_at'>, now = new Date()): DueGroup {
  if (c.status === 'resolved') return 'resolved';
  if (c.status === 'waiting') return 'waiting';
  if (!c.due_at) return 'later';
  const due = new Date(c.due_at);
  if (due < now) return 'late';
  const today = pragueDay(now);
  const day = pragueDay(due);
  if (day === today) return 'today';
  return day <= addDays(mondayOf(today), 6) ? 'week' : 'later';
}

const WEEKDAY = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];

/** „dnes 16:00“, „zítra 9:00“, „včera“, „pá 31. 10.“ */
export function dueText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const today = pragueDay(now);
  const day = pragueDay(d);
  if (day === today) return `dnes ${time}`;
  if (day === addDays(today, 1)) return `zítra ${time}`;
  if (day === addDays(today, -1)) return `včera ${time}`;
  const [, m, dd] = day.split('-').map(Number);
  const wd = WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return `${wd} ${dd}. ${m}.`;
}

/** Délka v minutách jako „1:05“ (hodiny:minuty). */
export function hm(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** „1 h 52 min“ */
export function hmLong(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

export function minutesOf(t: Pick<TimeRow, 'started_at' | 'ended_at'>, now = Date.now()): number {
  const end = t.ended_at ? new Date(t.ended_at).getTime() : now;
  return Math.max(0, (end - new Date(t.started_at).getTime()) / 60000);
}

// --- Hotové odpovědi (tabulka support_templates, upravuje správce v Týmu) ----------

export interface Template { id: string; label: string; body: string; sort: number }

// --- Omezení účtu --------------------------------------------------------------

export const MEASURES: Array<{ id: 'warning' | 'hide_listings' | 'suspend' | 'ban'; label: string; hint: string }> = [
  { id: 'warning', label: 'Upozornění', hint: 'Jen e-mail s odůvodněním, účet funguje dál' },
  { id: 'hide_listings', label: 'Skrýt nabídky', hint: 'Nabídky zmizí z webu a nové nejde vystavit, nakupovat může' },
  { id: 'suspend', label: 'Pozastavit účet', hint: 'Skryté nabídky, nemůže prodávat ani objednávat, rozpracované dokončí' },
  { id: 'ban', label: 'Zrušit účet', hint: 'Jen při závažném porušení. Obchodu 30 dní předem, pokud nejde o podvod' },
];

export type ReasonGroup = 'orders' | 'content' | 'conduct';
export const REASON_GROUPS: Array<{ id: ReasonGroup; label: string }> = [
  { id: 'orders', label: 'OBJEDNÁVKY' },
  { id: 'content', label: 'NABÍDKY A OBSAH' },
  { id: 'conduct', label: 'CHOVÁNÍ A ÚČET' },
];

/** Důvody omezení podle podmínek (DS Support › Omezit účet). hidden_shop zůstává jen kvůli starým záznamům. */
export const REASONS: Array<{ id: string; label: string; article: string; group: ReasonGroup | null }> = [
  { id: 'not_shipped', label: 'Neodeslané zboží po zaplacení', article: 'čl. 5 a 13', group: 'orders' },
  { id: 'cancel_paid', label: 'Zrušení zaplacených objednávek', article: 'čl. 7 a 13', group: 'orders' },
  { id: 'unproven_payment', label: 'Platba neprokázána', article: 'čl. 7 a 13', group: 'orders' },
  { id: 'misdescribed', label: 'Neodpovídá popisu', article: 'čl. 5 a 12', group: 'orders' },
  { id: 'counterfeit', label: 'Padělek nebo kopie karty', article: 'čl. 5 a 12', group: 'content' },
  { id: 'prohibited', label: 'Zakázané zboží', article: 'čl. 5 a 12', group: 'content' },
  { id: 'fake', label: 'Manipulace s cenou nebo hodnocením', article: 'čl. 11 a 12', group: 'content' },
  { id: 'spam', label: 'Spam a opakované nabídky', article: 'čl. 12', group: 'content' },
  { id: 'offensive', label: 'Urážlivý obsah obchodu', article: 'čl. 12', group: 'content' },
  { id: 'fraud', label: 'Podvod nebo pokus o podvod', article: 'čl. 12 a 13', group: 'conduct' },
  { id: 'phishing', label: 'Phishing, platba mimo dohodnutý postup', article: 'čl. 7 a 12', group: 'conduct' },
  { id: 'impersonation', label: 'Vydávání se za jiného', article: 'čl. 4 a 12', group: 'conduct' },
  { id: 'harassment', label: 'Obtěžování', article: 'čl. 12', group: 'conduct' },
  { id: 'illegal', label: 'Nezákonný obsah', article: 'čl. 12', group: 'conduct' },
  { id: 'report_abuse', label: 'Zneužívání nahlašování', article: 'čl. 12', group: 'conduct' },
  { id: 'accounts', label: 'Více účtů, skrytý obchod', article: 'čl. 4, 5 a 12', group: 'conduct' },
  { id: 'other', label: 'Jiné porušení obchodních podmínek', article: 'čl. 13', group: null },
  { id: 'hidden_shop', label: 'Obchod vydávající se za sběratele', article: 'čl. 5', group: null },
];
export const reasonOf = (id: string | null) => REASONS.find((r) => r.id === id);

export const DURATIONS = [
  { days: 7, label: '7 dní' },
  { days: 30, label: '30 dní' },
  { days: 90, label: '90 dní' },
  { days: 0, label: 'Do odvolání' },
];

export const ACTION_LABEL: Record<ModAction, string> = {
  warning: 'Upozornění e-mailem',
  hide_listings: 'Skryté všechny nabídky',
  suspend: 'Pozastavený účet',
  ban: 'Zrušený účet',
  lift: 'Zrušené omezení',
  expired: 'Omezení skončilo',
  plan: 'Změna tarifu',
  verify: 'Ověření prodejce',
  profile: 'Úprava údajů účtu',
  signout: 'Odhlášení ze všech zařízení',
  mfa_reset: 'Vypnuté dvoufázové ověření',
  password_reset: 'Odkaz na nové heslo',
  confirm_resend: 'Nové potvrzení e-mailu',
  listing_hide: 'Skrytá nabídka',
  listing_restore: 'Obnovená nabídka',
  messages_view: 'Otevřené zprávy mezi stranami',
  time_fix: 'Oprava času',
};

export const RESTRICTION_LABEL: Record<RestrictionKind, string> = {
  hidden: 'Skryté nabídky',
  suspended: 'Pozastaveno',
  banned: 'Zrušený účet',
};

/** Rozloučení pod e-maily podpory. */
export const SIGNATURE = 'S pozdravem\ntým V4cards\npodpora@v4cards.com · v4cards.com';

export interface RestrictionMail { subject: string; paragraphs: Array<{ title?: string; text: string }> }

/** E-mail s odůvodněním omezení podle nařízení o digitálních službách (čl. 17). */
export function restrictionMail(p: {
  action: 'warning' | 'hide_listings' | 'suspend' | 'ban';
  name: string;
  reasonId: string;
  facts: string;
  days: number;
  caseNumber?: number | null;
  now?: Date;
}): RestrictionMail {
  const reason = reasonOf(p.reasonId);
  const until = p.days ? new Date((p.now ?? new Date()).getTime() + p.days * 86400000) : null;
  const untilText = until ? until.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: TZ }) : '';
  const span = until ? ` na ${p.days} dní, do ${untilText}` : ' do odvolání';
  const what = {
    warning: `upozorňujeme vás na porušení obchodních podmínek u účtu ${p.name}. Účet funguje dál, při opakování ho ale můžeme omezit.`,
    hide_listings: `skryli jsme všechny nabídky účtu ${p.name}${span}. Po tu dobu je kupující neuvidí a nové nabídky nejde vystavit. Nakupovat a dokončit rozpracované objednávky můžete.`,
    suspend: `pozastavili jsme váš účet ${p.name}${span}. Vaše nabídky jsou po tu dobu skryté, nemůžete vystavovat ani objednávat. Rozpracované objednávky můžete dokončit.`,
    ban: `zrušili jsme váš účet ${p.name}. Nabídky jsou skryté, nemůžete vystavovat ani objednávat. Rozpracované objednávky můžete dokončit.`,
  }[p.action];
  const code = p.caseNumber ? ` (${caseCode(p.caseNumber)})` : '';
  const subject = {
    warning: `Upozornění od V4cards${code}`,
    hide_listings: `Skrytí nabídek na V4cards${code}`,
    suspend: `Pozastavení účtu na V4cards${code}`,
    ban: `Zrušení účtu na V4cards${code}`,
  }[p.action];
  return {
    subject,
    paragraphs: [
      { text: 'Dobrý den,' },
      { title: p.action === 'warning' ? 'Co se děje:' : 'Co jsme udělali:', text: what },
      { title: 'Proč:', text: reason ? `${reason.label.toLowerCase()} (${reason.article} obchodních podmínek).` : 'porušení obchodních podmínek.' },
      { title: 'Z čeho vycházíme:', text: p.facts.trim() || '…' },
      { text: 'O opatření rozhodl člověk z týmu V4cards, automatické nástroje jsme nepoužili.' },
      { title: 'Jak se ohradit:', text: 'odpovězte na tento e-mail do 6 měsíců. Stížnost posoudí jiný člověk než ten, kdo rozhodl, a odpovíme bez zbytečného odkladu. Spor můžete řešit i u soudu.' },
      { text: SIGNATURE },
    ],
  };
}

export function liftMail(name: string, caseNumber?: number | null): RestrictionMail {
  return {
    subject: `Omezení účtu na V4cards skončilo${caseNumber ? ` (${caseCode(caseNumber)})` : ''}`,
    paragraphs: [
      { text: 'Dobrý den,' },
      { text: `omezení účtu ${name} jsme zrušili. Nabídky jsou znovu vidět a účet funguje jako dřív.` },
      { text: SIGNATURE },
    ],
  };
}

/** Hodnota pole datetime-local v pražském čase → ISO. */
export function pragueLocalToIso(v: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return new Date(pragueMidnight(m[1]).getTime() + (Number(m[2]) * 60 + Number(m[3])) * 60000).toISOString();
}

/** ISO → hodnota pole datetime-local v pražském čase. */
export function isoToPragueLocal(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  return `${pragueDay(d)}T${time}`;
}

export type TimeWithCase = TimeRow & { support_cases: { number: number; subject: string; kind: CaseKind; status: CaseStatus; resolved_at: string | null } | null };

export interface MonthReport {
  people: Array<{ id: string; name: string; cases: number; other: number; total: number; count: number }>;
  total: number;
  resolved: number;
  avgPerResolved: number;
}

/** Výkaz času za měsíc (pražský čas). Záznam patří do dne, kdy začal; bez případu = Ostatní práce. */
export function monthReport(rows: TimeWithCase[], staff: Map<string, string>, month: string): MonthReport {
  const people = new Map<string, MonthReport['people'][number] & { ids: Set<string> }>();
  const perCase = new Map<string, number>();
  const resolvedCases = new Set<string>();
  let total = 0;
  for (const t of rows) {
    const m = minutesOf(t);
    const sid = t.staff_id ?? '?';
    const p = people.get(sid) ?? { id: sid, name: staff.get(sid) ?? 'smazaný účet', cases: 0, other: 0, total: 0, count: 0, ids: new Set<string>() };
    if (t.case_id) { p.cases += m; p.ids.add(t.case_id); perCase.set(t.case_id, (perCase.get(t.case_id) ?? 0) + m); } else p.other += m;
    p.total += m;
    total += m;
    people.set(sid, p);
    const c = t.support_cases;
    if (t.case_id && c?.status === 'resolved' && c.resolved_at && pragueDay(c.resolved_at).startsWith(month)) resolvedCases.add(t.case_id);
  }
  const resolvedMinutes = [...resolvedCases].reduce((s, id) => s + (perCase.get(id) ?? 0), 0);
  return {
    people: [...people.values()].map(({ ids, ...p }) => ({ ...p, count: ids.size })).sort((a, b) => b.total - a.total),
    total,
    resolved: resolvedCases.size,
    avgPerResolved: resolvedCases.size ? resolvedMinutes / resolvedCases.size : 0,
  };
}

export const TIME_SELECT = '*, support_cases(number, subject, kind, status, resolved_at)';

/** Měsíc z parametru ?mesic=2026-10, jinak tento měsíc. */
export function monthFrom(m?: string): string {
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : pragueDay(new Date()).slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Odkud případ přišel (sloupec ODKUD ve frontě). */
export function caseOrigin(c: Pick<CaseRow, 'kind' | 'created_by'>): string {
  if (c.kind === 'report') return 'Hlášení objednávky';
  if (c.kind === 'content') return 'Nahlášení';
  return c.created_by ? 'Podpora' : 'Formulář';
}

/** Témata formuláře Napsat podpoře (DS Support › Napsat podpoře); popisky hlídá i databáze (support_topic_label). */
export const SUPPORT_TOPICS = [
  { id: 'account', label: 'Účet a přihlášení' },
  { id: 'order', label: 'Objednávka' },
  { id: 'selling', label: 'Prodávání' },
  { id: 'plan', label: 'Předplatné' },
  { id: 'appeal', label: 'Odvolání proti omezení' },
  { id: 'other', label: 'Jiné' },
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number]['id'];
