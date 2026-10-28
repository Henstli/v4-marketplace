// Panel podpory (DS Support). Co kdo smí, hlídá databáze (jen správci); tady jsou texty, šablony a výpočty.

export type CaseKind = 'report' | 'question' | 'appeal' | 'content' | 'other';
export type CaseStatus = 'open' | 'waiting' | 'resolved';
export type CasePriority = 'high' | 'mid' | 'low';
export type EventKind = 'note' | 'email' | 'user' | 'event';
export type ModAction = 'warning' | 'hide_listings' | 'suspend' | 'ban' | 'lift' | 'expired' | 'plan' | 'verify';
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
  case_id: string;
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

// --- Šablony odpovědí ---------------------------------------------------------

export interface Template { id: string; label: string; text: string }

export const TEMPLATES: Template[] = [
  {
    id: 'ack',
    label: 'Potvrzení přijetí',
    text: 'Dobrý den,\n\nděkujeme za zprávu. Případ jsme převzali a ozveme se vám nejpozději do 2 dnů.\n\nTým podpory V4cards',
  },
  {
    id: 'pay-proof',
    label: 'Platba doložena, výzva prodejci',
    text: 'Dobrý den,\n\nkupující u objednávky č. [číslo] doložil platbu [částka] Kč ze dne [datum]. Prosíme, zkontrolujte svůj účet a buď kartu odešlete, nebo peníze kupujícímu vraťte. Odpovězte nám prosím do [datum].\n\nV4cards peníze nepřijímá ani nevrací, platba šla přímo vám. Pokud se neozvete, můžeme podle čl. 13 obchodních podmínek omezit váš účet.\n\nTým podpory V4cards',
  },
  {
    id: 'need-proof',
    label: 'Prosba o doklad platby',
    text: 'Dobrý den,\n\npro posouzení potřebujeme doklad o platbě (výpis nebo potvrzení z banky, PayPalu či Revolutu) s datem, částkou a příjemcem. Ostatní platby na výpisu prosím zakryjte. Doklad přiložte v Můj profil › Hlášení, nebo ho pošlete odpovědí na tento e-mail.\n\nTým podpory V4cards',
  },
  {
    id: 'bank',
    label: 'Doporučení: reklamace u banky',
    text: 'Dobrý den,\n\nprodejce se k vaší platbě nevyjádřil. V4cards peníze nedrží, a proto je nemůže vrátit. Doporučujeme obrátit se na svou banku (u karetní platby reklamace, u PayPalu spor v Centru řešení). Podklady z hlášení vám rádi pošleme.\n\nTým podpory V4cards',
  },
  {
    id: 'police',
    label: 'Doporučení: trestní oznámení',
    text: 'Dobrý den,\n\npokud máte za to, že šlo o podvod, můžete podat trestní oznámení na kterékoli služebně Policie ČR. Vezměte s sebou doklad o platbě a číslo objednávky. Na žádost policie jí předáme údaje, které o objednávce máme.\n\nTým podpory V4cards',
  },
  {
    id: 'agreement',
    label: 'Nezávazné doporučení k dohodě',
    text: 'Dobrý den,\n\nprošli jsme podklady obou stran. Naše nezávazné doporučení: [doporučení]. Rozhodnutí je na vás a prodejci, V4cards spor nerozhoduje a peníze nedrží.\n\nTým podpory V4cards',
  },
  {
    id: 'closed',
    label: 'Uzavření případu',
    text: 'Dobrý den,\n\npřípad uzavíráme. Kdybyste cokoli potřebovali, stačí odpovědět na tento e-mail.\n\nTým podpory V4cards',
  },
];

// --- Omezení účtu --------------------------------------------------------------

export const MEASURES: Array<{ id: 'warning' | 'hide_listings' | 'suspend' | 'ban'; label: string; hint: string }> = [
  { id: 'warning', label: 'Upozornění', hint: 'Jen e-mail s odůvodněním, účet funguje dál' },
  { id: 'hide_listings', label: 'Skrýt všechny nabídky', hint: 'Nabídky zmizí z webu a nové nejde vystavit, nakupovat může' },
  { id: 'suspend', label: 'Pozastavit účet', hint: 'Skryté nabídky, nemůže prodávat ani objednávat, rozpracované dokončí' },
  { id: 'ban', label: 'Zrušit účet', hint: 'Jen při závažném porušení. Obchodu 30 dní předem, pokud nejde o podvod' },
];

export const REASONS: Array<{ id: string; label: string; article: string }> = [
  { id: 'not_shipped', label: 'Neodeslání zaplacené karty', article: 'čl. 5 a 13' },
  { id: 'cancel_paid', label: 'Opakované zrušení zaplacených objednávek', article: 'čl. 7 a 13' },
  { id: 'unproven_payment', label: 'Nedoložená platba', article: 'čl. 7 a 13' },
  { id: 'counterfeit', label: 'Padělek, kopie (proxy) nebo kradená karta', article: 'čl. 5 a 12' },
  { id: 'misdescribed', label: 'Záměrně zkreslený stav nebo popis karty', article: 'čl. 5 a 12' },
  { id: 'fake', label: 'Falešné nabídky, objednávky nebo hodnocení', article: 'čl. 11 a 12' },
  { id: 'harassment', label: 'Obtěžování nebo nezákonný obsah', article: 'čl. 12' },
  { id: 'hidden_shop', label: 'Obchod vydávající se za sběratele', article: 'čl. 5' },
  { id: 'accounts', label: 'Více účtů nebo zneužití cizího účtu', article: 'čl. 4 a 12' },
  { id: 'other', label: 'Jiné porušení obchodních podmínek', article: 'čl. 13' },
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
};

export const RESTRICTION_LABEL: Record<RestrictionKind, string> = {
  hidden: 'Skryté nabídky',
  suspended: 'Pozastaveno',
  banned: 'Zrušený účet',
};

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
      { text: 'Tým podpory V4cards' },
    ],
  };
}

export function liftMail(name: string, caseNumber?: number | null): RestrictionMail {
  return {
    subject: `Omezení účtu na V4cards skončilo${caseNumber ? ` (${caseCode(caseNumber)})` : ''}`,
    paragraphs: [
      { text: 'Dobrý den,' },
      { text: `omezení účtu ${name} jsme zrušili. Nabídky jsou znovu vidět a účet funguje jako dřív.` },
      { text: 'Tým podpory V4cards' },
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

export interface WeekReport {
  monday: string;
  days: string[];
  people: Array<{ id: string; name: string; days: number[]; total: number }>;
  kinds: Array<{ kind: CaseKind; minutes: number }>;
  top: Array<{ number: number; subject: string; who: string; minutes: number }>;
  resolved: number;
  avgPerResolved: number;
}

/** Výkaz času za týden od pondělí (pražský čas). Záznam patří do dne, kdy začal. */
export function weekReport(
  monday: string,
  rows: Array<TimeRow & { support_cases: { number: number; subject: string; kind: CaseKind; status: CaseStatus; resolved_at: string | null } | null }>,
  staff: Map<string, string>,
): WeekReport {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const people = new Map<string, { id: string; name: string; days: number[]; total: number }>();
  const kinds = new Map<CaseKind, number>();
  const perCase = new Map<string, { number: number; subject: string; who: Map<string, number>; minutes: number }>();
  const resolvedCases = new Set<string>();
  for (const t of rows) {
    const m = minutesOf(t);
    const idx = days.indexOf(pragueDay(t.started_at));
    if (idx < 0) continue;
    const sid = t.staff_id ?? '?';
    const p = people.get(sid) ?? { id: sid, name: staff.get(sid) ?? 'smazaný účet', days: Array(7).fill(0), total: 0 };
    p.days[idx] += m;
    p.total += m;
    people.set(sid, p);
    const c = t.support_cases;
    if (!c) continue;
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + m);
    const pc = perCase.get(t.case_id) ?? { number: c.number, subject: c.subject, who: new Map(), minutes: 0 };
    pc.minutes += m;
    pc.who.set(p.name, (pc.who.get(p.name) ?? 0) + m);
    perCase.set(t.case_id, pc);
    if (c.status === 'resolved' && c.resolved_at && days.includes(pragueDay(c.resolved_at))) resolvedCases.add(t.case_id);
  }
  const resolvedMinutes = [...resolvedCases].reduce((s, id) => s + (perCase.get(id)?.minutes ?? 0), 0);
  return {
    monday,
    days,
    people: [...people.values()].sort((a, b) => b.total - a.total),
    kinds: [...kinds.entries()].map(([kind, minutes]) => ({ kind, minutes })).sort((a, b) => b.minutes - a.minutes),
    top: [...perCase.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 5).map((c) => ({
      number: c.number, subject: c.subject, minutes: c.minutes,
      who: [...c.who.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    })),
    resolved: resolvedCases.size,
    avgPerResolved: resolvedCases.size ? resolvedMinutes / resolvedCases.size : 0,
  };
}

export const TIME_SELECT = '*, support_cases(number, subject, kind, status, resolved_at)';

/** Pondělí z parametru ?od=, jinak tento týden. */
export function weekFrom(od?: string): string {
  return mondayOf(od && /^\d{4}-\d{2}-\d{2}$/.test(od) ? od : pragueDay(new Date()));
}
