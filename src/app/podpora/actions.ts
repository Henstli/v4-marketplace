'use server';

import { siteOrigin } from '@/lib/auth-helpers';
import { sendSupportEmail } from '@/lib/email';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { caseCode, SIGNATURE, SUPPORT_TOPICS } from '@/lib/support';

export interface ContactState {
  ok?: number;
  error?: string;
  /** Podepsané nahrání přílohy (soubor jde z prohlížeče rovnou do úložiště, ne přes Vercel) */
  upload?: { caseId: string; path: string; token: string };
}

const str = (form: FormData, key: string, max: number) => String(form.get(key) ?? '').trim().slice(0, max);
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/**
 * Napsat podpoře: databáze založí případ (support_contact), tady potvrzení e-mailem
 * a případně odkaz pro nahrání přílohy.
 */
export async function contactSupport(form: FormData): Promise<ContactState> {
  const topic = str(form, 'topic', 20);
  const body = str(form, 'body', 4000);
  if (!SUPPORT_TOPICS.some((t) => t.id === topic)) return { error: 'Vyberte téma.' };
  if (body.length < 10) return { error: 'Napište zprávu (aspoň pár slov).' };
  // Past na roboty: skryté pole, které člověk nevyplní.
  if (str(form, 'web', 100)) return { ok: 0 };
  const order = Number(str(form, 'order', 10)) || null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('support_contact', {
    p_topic: topic,
    p_body: body,
    p_order: topic === 'order' ? order : null,
    p_name: str(form, 'name', 120) || null,
    p_email: str(form, 'email', 200) || null,
  });
  if (error) return { error: error.message };
  const row = ((data ?? []) as Array<{ case_id: string; number: number; email: string | null }>)[0];
  if (!row) return { error: 'Zprávu se nepodařilo odeslat. Zkuste to znovu, nebo pište na podpora@v4cards.com.' };

  const code = caseCode(row.number);
  if (row.email) {
    await sendSupportEmail([row.email], `[${code}] Přijali jsme váš dotaz`, [
      { text: 'Dobrý den,' },
      { text: `děkujeme za zprávu, má číslo ${code}. Odpověď vám pošleme e-mailem, nejpozději do 2 dnů. Pokud chcete něco doplnit, odpovězte na tento e-mail.` },
      { title: 'Vaše zpráva:', text: body },
      { text: SIGNATURE },
    ], await siteOrigin(), false);
  }

  // Příloha: jen typ a velikost z prohlížeče, skutečný soubor zkontroluje úložiště (limit bucketu).
  const fileType = str(form, 'file_type', 60);
  const fileName = str(form, 'file_name', 120);
  const fileSize = Number(str(form, 'file_size', 12));
  const admin = fileName ? createAdminClient() : null;
  if (admin && FILE_TYPES.includes(fileType) && fileSize > 0 && fileSize <= 10 * 1024 * 1024) {
    const safe = fileName.normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60) || 'soubor';
    const path = `${row.case_id}/${crypto.randomUUID()}-${safe}`;
    const { data: signed } = await admin.storage.from('support-files').createSignedUploadUrl(path);
    if (signed) return { ok: row.number, upload: { caseId: row.case_id, path, token: signed.token } };
  }
  return { ok: row.number };
}

/** Zapíše nahranou přílohu k případu. Cesta je náhodná a zná ji jen ten, kdo zprávu poslal. */
export async function attachSupportFile(caseId: string, path: string, name: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  if (!admin || !/^[0-9a-f-]{36}$/i.test(caseId) || !path.startsWith(`${caseId}/`) || path.includes('..')) return { error: 'Přílohu se nepodařilo uložit.' };
  const { data: c } = await admin.from('support_cases').select('id, created_at').eq('id', caseId).maybeSingle();
  if (!c || Date.now() - Date.parse(c.created_at as string) > 3600_000) return { error: 'Přílohu se nepodařilo uložit.' };
  const { count } = await admin.from('case_files').select('id', { count: 'exact', head: true }).eq('case_id', caseId);
  if ((count ?? 0) > 0) return { error: 'K případu už příloha je.' };
  const folder = path.slice(caseId.length + 1);
  const { data: files } = await admin.storage.from('support-files').list(caseId, { search: folder });
  const file = files?.find((f) => f.name === folder);
  if (!file) return { error: 'Přílohu se nepodařilo nahrát.' };
  await admin.from('case_files').insert({ case_id: caseId, path, name: name.slice(0, 120) || 'soubor', size: (file.metadata as { size?: number } | null)?.size ?? null });
  return {};
}
