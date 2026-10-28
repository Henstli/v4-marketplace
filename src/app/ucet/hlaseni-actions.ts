'use server';

import { revalidatePath } from 'next/cache';
import { normalizeAccount } from '@/lib/payment';
import { createClient } from '@/lib/supabase/server';

export interface ReportState { error?: string; ok?: boolean; number?: number; id?: string }

const message = (e: { code?: string; message: string } | null, fallback: string) =>
  e ? (e.code === 'P0001' ? `${e.message.replace(/\.$/, '')}.` : fallback) : undefined;

function refresh() {
  revalidatePath('/ucet/hlaseni', 'layout');
  revalidatePath('/objednavky', 'layout');
  revalidatePath('/sprava/hlaseni');
  revalidatePath('/', 'layout');
}

/** Nahlásit problém (DS Reports › Nahlásit problém). Přílohy nahraje prohlížeč až po založení hlášení. */
export async function createReport(order: string, reason: string, description: string): Promise<ReportState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_report', { p_order: order, p_reason: reason, p_description: description });
  if (error) return { error: message(error, 'Hlášení se nepodařilo odeslat.') };
  const { data: r } = await supabase.from('reports').select('number').eq('id', data as string).maybeSingle();
  refresh();
  return { ok: true, id: data as string, number: (r?.number as number | undefined) ?? undefined };
}

/** Zapíše přílohu, kterou prohlížeč nahrál do úložiště. */
export async function addReportFile(report: string, path: string, name: string): Promise<ReportState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_report_file', { p_report: report, p_path: path, p_name: name });
  if (error) return { error: message(error, 'Přílohu se nepodařilo uložit.') };
  refresh();
  return { ok: true };
}

/** Jedno tlačítko nebo formulář v hlášení; `op` určuje funkci v databázi. */
export async function reportStep(_prev: ReportState, form: FormData): Promise<ReportState> {
  const supabase = await createClient();
  const id = String(form.get('id') ?? '');
  const op = String(form.get('op') ?? '');
  const text = (k: string) => String(form.get(k) ?? '').trim();
  let res: { error: { code?: string; message: string } | null };
  switch (op) {
    case 'reply': res = await supabase.rpc('report_reply', { p_report: id, p_text: text('text') }); break;
    case 'withdraw': res = await supabase.rpc('withdraw_report', { p_report: id }); break;
    case 'escalate': res = await supabase.rpc('escalate_report', { p_report: id }); break;
    case 'offer': {
      const kind = text('kind');
      const raw = Number(text('amount').replace(/\s/g, '').replace(',', '.'));
      const base = Number(text('base'));
      const czk = text('unit') === 'pct' ? Math.round((base * raw) / 100) : Math.round(raw);
      res = await supabase.rpc('report_offer', { p_report: id, p_kind: kind, p_czk: Number.isFinite(czk) ? czk : null, p_note: text('note') });
      break;
    }
    case 'accept': res = await supabase.rpc('accept_report_offer', { p_report: id }); break;
    case 'payout': {
      const bank = text('bank') ? normalizeAccount(text('bank')) : '';
      if (bank === null) return { error: 'Číslo účtu nesedí. Napište ho ve tvaru 123456789/0800 nebo jako IBAN.' };
      const paypal = text('paypal').replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '');
      if (paypal && !/^[A-Za-z0-9]{1,20}$/.test(paypal)) return { error: 'Jméno PayPal.Me může mít jen písmena a číslice.' };
      const revtag = text('revtag').replace(/^@/, '').toLowerCase();
      if (revtag && !/^[a-z0-9._]{3,30}$/.test(revtag)) return { error: 'Revtag nesedí, najdete ho v aplikaci Revolut v profilu.' };
      res = await supabase.rpc('set_report_payout', { p_report: id, p_bank: bank, p_paypal: paypal, p_revtag: revtag });
      break;
    }
    case 'return_sent': res = await supabase.rpc('report_return_sent', { p_report: id, p_tracking: text('tracking'), p_cost: Math.round(Number(text('cost') || '0')) }); break;
    case 'return_received': res = await supabase.rpc('report_return_received', { p_report: id }); break;
    case 'comp_sent': res = await supabase.rpc('report_comp_sent', { p_report: id, p_via: text('via') }); break;
    case 'comp_ok': res = await supabase.rpc('report_comp_received', { p_report: id, p_ok: true }); break;
    case 'comp_missing': res = await supabase.rpc('report_comp_received', { p_report: id, p_ok: false }); break;
    case 'admin': res = await supabase.rpc('admin_update_report', { p_report: id, p_note: text('note'), p_outcome: text('outcome') }); break;
    default: return { error: 'Neznámá akce.' };
  }
  if (res.error) return { error: message(res.error, 'Nepodařilo se uložit. Zkuste to znovu.') };
  refresh();
  return { ok: true };
}
