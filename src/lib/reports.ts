// Hlášení a spory (DS Reports). Co kdo smí, hlídají funkce v databázi; tady jsou jen texty a načítání.
import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ReportReason = 'paid_cancelled' | 'not_delivered' | 'not_as_described' | 'buyer_not_paid' | 'buyer_not_collected' | 'other';
export type ReportStatus = 'seller' | 'buyer' | 'agreed' | 'review' | 'closed';
export type ReportOutcome = 'agreement' | 'withdrawn' | 'no_agreement' | 'violation' | 'resolved';
export type OfferKind = 'partial' | 'difference' | 'return' | 'refund_keep';

export const REASON: Record<ReportReason, string> = {
  paid_cancelled: 'Zaplatil(a) jsem a prodejce zrušil',
  not_delivered: 'Zaplatil(a) jsem a karta nepřišla',
  not_as_described: 'Karta neodpovídá popisu',
  buyer_not_paid: 'Kupující nezaplatil',
  buyer_not_collected: 'Kupující nepřevzal zásilku',
  other: 'Jiný problém',
};
export const BUYER_REASONS: ReportReason[] = ['paid_cancelled', 'not_delivered', 'not_as_described', 'other'];
export const SELLER_REASONS: ReportReason[] = ['buyer_not_paid', 'buyer_not_collected', 'other'];

export const OUTCOME: Record<ReportOutcome, string> = {
  agreement: 'Uzavřeno · dohoda',
  withdrawn: 'Uzavřeno · odvoláno',
  no_agreement: 'Uzavřeno · bez dohody',
  violation: 'Uzavřeno · porušení podmínek',
  resolved: 'Uzavřeno · vyřešeno',
};

export const OFFER: Record<OfferKind, string> = {
  partial: 'Dorovnání',
  difference: 'Rozdíl ceny',
  return: 'Vrácení karty',
  refund_keep: 'Peníze bez vrácení',
};

export const reportCode = (n: number) => `H-${String(n).padStart(4, '0')}`;

export interface ReportRow {
  id: string;
  number: number;
  order_id: string;
  reporter_id: string | null;
  against_id: string | null;
  reporter_role: 'buyer' | 'seller';
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  outcome: ReportOutcome | null;
  due_at: string | null;
  against_note: string | null;
  against_note_at: string | null;
  support_note: string | null;
  support_note_at: string | null;
  offer_kind: OfferKind | null;
  offer_czk: number | null;
  offer_by: string | null;
  offer_note: string | null;
  offer_at: string | null;
  rejects: number;
  agreed_at: string | null;
  payout_bank: string | null;
  payout_paypal: string | null;
  payout_revtag: string | null;
  payout_at: string | null;
  return_tracking: string | null;
  return_cost_czk: number | null;
  return_sent_at: string | null;
  return_received_at: string | null;
  comp_sent_at: string | null;
  comp_sent_via: 'bank' | 'paypal' | 'revolut' | null;
  comp_received_at: string | null;
  created_at: string;
  closed_at: string | null;
  orders: { number: number; buyer_id: string | null; seller_id: string | null; total_czk: number; shipping_czk: number } | null;
}

export const REPORT_SELECT = '*, orders(number, buyer_id, seller_id, total_czk, shipping_czk)';

/** Kdo je teď na tahu: buyer / seller / support / null (uzavřeno). */
export function turnOf(r: ReportRow): 'buyer' | 'seller' | 'support' | null {
  if (r.status === 'closed') return null;
  if (r.status === 'review') return 'support';
  if (r.status === 'buyer' || r.status === 'seller') return r.status;
  // agreed: podle kroku dohody
  if (r.offer_kind === 'return' && !r.return_sent_at) return 'buyer';
  if (r.offer_kind === 'return' && !r.return_received_at) return 'seller';
  if (!r.payout_at) return 'buyer';
  if (!r.comp_sent_at) return 'seller';
  return 'buyer';
}

/** Štítek stavu z pohledu uživatele (DS Reports › Stavy a barvy). */
export function reportLabel(r: ReportRow, me: string): { text: string; tone: 'ok' | 'warn' | 'muted' | 'info' } {
  if (r.status === 'closed') return { text: r.outcome ? OUTCOME[r.outcome] : 'Uzavřeno', tone: r.outcome === 'agreement' ? 'ok' : 'muted' };
  const turn = turnOf(r);
  if (turn === 'support') return { text: 'Prověřujeme', tone: 'info' };
  const mine = turn === 'buyer' ? r.orders?.buyer_id === me : r.orders?.seller_id === me;
  if (r.status === 'agreed') return mine ? { text: 'Dohoda · na tahu jste vy', tone: 'warn' } : { text: 'Dohoda · čeká na druhou stranu', tone: 'info' };
  return mine ? { text: 'Čeká na vás', tone: 'warn' } : { text: turn === 'seller' ? 'Čeká na prodejce' : 'Čeká na kupujícího', tone: 'info' };
}

/** Lhůta na nahlášení (stejně jako create_report): 30 dní od objednání, nebo 14 dní od převzetí, co je později. */
export function canReport(o: { created_at: string; delivered_at: string | null; status: string }): boolean {
  if (o.status === 'requested') return false;
  const until = Math.max(Date.parse(o.created_at) + 30 * 86400_000, o.delivered_at ? Date.parse(o.delivered_at) + 14 * 86400_000 : 0);
  return Date.now() <= until;
}

export interface ReportFile { id: string; uploader_id: string | null; path: string; name: string; size: number; created_at: string; url: string | null }

/** Přílohy, které uživatel smí vidět, s odkazem platným hodinu. */
export async function loadReportFiles(supabase: Supabase, reportId: string): Promise<ReportFile[]> {
  const { data } = await supabase.from('report_files').select('id, uploader_id, path, name, size, created_at').eq('report_id', reportId).order('created_at');
  const rows = (data ?? []) as Omit<ReportFile, 'url'>[];
  if (!rows.length) return [];
  const { data: signed } = await supabase.storage.from('report-files').createSignedUrls(rows.map((f) => f.path), 3600);
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((f) => ({ ...f, url: urls.get(f.path) ?? null }));
}

/** Otevřená hlášení k objednávkám (pro pruh „Objednávku prošetřujeme“). */
export async function loadOpenReports(supabase: Supabase, orderIds: string[]): Promise<Map<string, { id: string; number: number; status: string }>> {
  if (!orderIds.length) return new Map();
  const { data } = await supabase.rpc('order_open_reports', { p_orders: orderIds });
  return new Map(((data ?? []) as Array<{ order_id: string; report_id: string; number: number; status: string }>).map((r) => [r.order_id, { id: r.report_id, number: r.number, status: r.status }]));
}
