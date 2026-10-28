'use server';

import { siteOrigin } from '@/lib/auth-helpers';
import { contentCode, isContentReason, type ContentKind } from '@/lib/content-reports';
import { sendSupportEmail } from '@/lib/email';
import { createClient } from '@/lib/supabase/server';
import { SIGNATURE } from '@/lib/support';

export interface ReportContentState { ok?: number; error?: string; login?: boolean }

const KINDS: ContentKind[] = ['listing', 'seller', 'message', 'review', 'other'];
const str = (form: FormData, key: string, max: number) => String(form.get(key) ?? '').trim().slice(0, max);

/**
 * Nahlášení obsahu (DS Reports › Nahlásit obsah). Ověření, limit a případ podpory zařídí databáze
 * (report_content); tady jen potvrzení e-mailem.
 */
export async function reportContent(_prev: ReportContentState, form: FormData): Promise<ReportContentState> {
  const kind = str(form, 'kind', 20) as ContentKind;
  const reason = str(form, 'reason', 30);
  if (!KINDS.includes(kind)) return { error: 'Neznámý typ nahlášení.' };
  if (!reason || !isContentReason(kind, reason)) return { error: 'Vyberte, co je špatně.' };
  if (str(form, 'body', 2000).length < 10) return { error: 'Popište, co je špatně (aspoň pár slov).' };
  if (!form.get('good_faith')) return { error: 'Potvrďte, že údaje uvádíte v dobré víře.' };
  // Past na roboty: skryté pole, které člověk nevyplní.
  if (str(form, 'web', 100)) return { ok: 0 };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub && kind !== 'other') return { login: true };

  const { data, error } = await supabase.rpc('report_content', {
    p_kind: kind,
    p_target: str(form, 'target', 60),
    p_reason: reason,
    p_body: str(form, 'body', 2000),
    p_url: str(form, 'url', 500) || null,
    p_name: str(form, 'name', 120) || null,
    p_email: str(form, 'email', 200) || null,
  });
  if (error) return { error: error.message };
  const row = ((data ?? []) as Array<{ number: number; email: string | null }>)[0];
  if (!row) return { error: 'Nahlášení se nepodařilo odeslat. Zkuste to znovu.' };

  if (row.email) {
    await sendSupportEmail([row.email], `Přijali jsme vaše nahlášení ${contentCode(row.number)}`, [
      { text: 'Dobrý den,' },
      { text: `děkujeme, nahlášení ${contentCode(row.number)} jsme přijali. Prověří ho člověk z týmu V4cards a o výsledku vám dáme vědět e-mailem.` },
      { text: SIGNATURE },
    ], await siteOrigin(), false);
  }
  return { ok: row.number };
}
