'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CASE_REF } from '@/lib/team-chat';

// Oprávnění hlídá databáze (team_messages: jen tým, jen vlastní konverzace).
export async function sendTeamMessage(form: FormData) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/prihlaseni?dalsi=/sprava/podpora/chat');
  const room = String(form.get('room') ?? '');
  const with_ = String(form.get('with') ?? '');
  const body = String(form.get('body') ?? '').trim().slice(0, 2000);
  const path = `/sprava/podpora/chat${with_ ? `?s=${with_}` : ''}`;
  if (!body) redirect(path);
  // První odkaz #P-0128 ve zprávě se ukáže jako dlaždice případu.
  const ref = CASE_REF.exec(body);
  let caseId: string | null = null;
  if (ref) {
    const { data } = await supabase.from('support_cases').select('id').eq('number', Number(ref[1])).maybeSingle();
    caseId = (data?.id as string | undefined) ?? null;
  }
  const { error } = await supabase.from('team_messages').insert({ room, sender_id: auth.user.id, body, case_id: caseId });
  if (error) redirect(`${path}${path.includes('?') ? '&' : '?'}chyba=${encodeURIComponent(error.message)}`);
  revalidatePath('/sprava/podpora/chat');
  redirect(path);
}
