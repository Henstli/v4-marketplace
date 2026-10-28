'use client';

import { createClient } from '@/lib/supabase/browser';
import { addReportFile } from '@/app/ucet/hlaseni-actions';

export const MAX_FILES = 5;
export const MAX_SIZE = 10 * 1024 * 1024;
export const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function checkFile(f: File): string | null {
  if (!FILE_TYPES.includes(f.type)) return `${f.name}: nahrajte JPG, PNG, WebP nebo PDF.`;
  if (f.size > MAX_SIZE) return `${f.name}: soubor může mít nejvýš 10 MB.`;
  return null;
}

/** Nahraje přílohy do soukromého úložiště (<hlášení>/<uživatel>/…) a zapíše je k hlášení. Vrací chybu nebo null. */
export async function uploadReportFiles(report: string, uid: string | null, files: File[]): Promise<string | null> {
  const supabase = createClient();
  // V chatu uid nemáme po ruce, zjistí se z přihlášení.
  uid ??= (await supabase.auth.getUser()).data.user?.id ?? null;
  if (!uid) return 'Přílohy se nepodařilo nahrát, přihlaste se znovu.';
  for (const f of files) {
    const safe = f.name.normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60) || 'soubor';
    const path = `${report}/${uid}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${safe}`;
    const { error } = await supabase.storage.from('report-files').upload(path, f, { contentType: f.type });
    if (error) return `${f.name} se nepodařilo nahrát. Máte-li zapnuté dvoufázové ověření, přihlaste se znovu s kódem.`;
    const res = await addReportFile(report, path, f.name);
    if (res.error) return res.error;
  }
  return null;
}
