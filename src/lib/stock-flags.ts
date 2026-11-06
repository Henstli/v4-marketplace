import { createAdminClient } from '@/lib/supabase/admin';
import { sendStockFlagsEmail } from '@/lib/email';

/**
 * K prověření: projde nové změny ve skladech obchodů podle pravidel Co hlídat a jednou denně pošle e-mail
 * vedoucím (a podle nastavení i tomu, kdo změnu udělal). Volá noční cron se service_role klíčem.
 */
export async function flushStockFlags(origin: string): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  const { data: pend } = await admin.from('stock_events').select('owner_id').eq('flag_checked', false).not('actor_id', 'is', null).limit(5000);
  for (const o of [...new Set(((pend ?? []) as { owner_id: string }[]).map((x) => x.owner_id))]) {
    const { error } = await admin.rpc('stock_flags_check', { p_owner: o });
    if (error) console.error('stock_flags_check', o, error.message);
  }
  const { data } = await admin.from('stock_flags').select('id, owner_id, title, detail, actor_id').is('emailed_at', null).is('resolved_at', null).limit(2000);
  const flags = (data ?? []) as { id: number; owner_id: string; title: string; detail: string | null; actor_id: string | null }[];
  if (!flags.length) return 0;
  const owners = [...new Set(flags.map((f) => f.owner_id))];
  const users = [...new Set([...owners, ...flags.map((f) => f.actor_id).filter(Boolean) as string[]])];
  const [{ data: profs }, { data: leads }] = await Promise.all([
    admin.from('profiles').select('id, display_name').in('id', users),
    admin.from('shop_staff').select('owner_id, user_id').in('owner_id', owners).eq('role', 'ved'),
  ]);
  const name = new Map(((profs ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const emails = new Map<string, string | null>();
  const email = async (id: string) => {
    if (!emails.has(id)) emails.set(id, (await admin.auth.admin.getUserById(id)).data.user?.email ?? null);
    return emails.get(id) ?? null;
  };
  let sent = 0;
  for (const o of owners) {
    const mine = flags.filter((f) => f.owner_id === o);
    const { data: rules } = await admin.rpc('stock_watch_rules', { p_owner: o });
    const r = (rules ?? {}) as { notify_lead?: boolean; notify_actor?: boolean };
    const shopName = name.get(o) ?? 'Obchod';
    const href = `${origin}/prodat?zalozka=historie&druh=proverit`;
    const rows = mine.map((f) => ({ title: f.title, detail: f.detail, who: f.actor_id ? name.get(f.actor_id) ?? null : null }));
    if (r.notify_lead !== false) {
      const to = [o, ...((leads ?? []) as { owner_id: string; user_id: string }[]).filter((l) => l.owner_id === o).map((l) => l.user_id)];
      for (const u of [...new Set(to)]) {
        const e = await email(u);
        const link = u === o ? href : `${href}&obchod=${o}`;
        if (e) { await sendStockFlagsEmail(e, shopName, rows, link); sent++; }
      }
    }
    if (r.notify_actor) {
      for (const a of [...new Set(mine.map((f) => f.actor_id).filter((x): x is string => !!x && x !== o))]) {
        const e = await email(a);
        if (e) { await sendStockFlagsEmail(e, shopName, rows.filter((_, i) => mine[i].actor_id === a), `${href}&obchod=${o}`); sent++; }
      }
    }
    await admin.from('stock_flags').update({ emailed_at: new Date().toISOString() }).in('id', mine.map((f) => f.id));
  }
  return sent;
}
