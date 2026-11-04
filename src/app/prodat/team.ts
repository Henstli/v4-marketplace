import type { SupabaseClient } from '@supabase/supabase-js';

/** Práva v týmu obchodu (stejná jako v databázi, funkce stock_perm). */
export const PERMS = [
  ['view', 'Prohlížet sklad a karty'],
  ['add', 'Přidávat karty a měnit umístění'],
  ['price', 'Měnit ceny a dávat na prodej'],
  ['ord', 'Vyřizovat objednávky K odeslání'],
  ['inv', 'Dělat inventury (svoje úkoly)'],
  ['plan', 'Plánovat inventury, spravovat místa a směny'],
  ['diff', 'Vidět rozdíly a schvalovat inventury'],
  ['conn', 'Napojení, export a automatické ceny'],
  ['staff', 'Spravovat zaměstnance a práva'],
] as const;
export type Perm = (typeof PERMS)[number][0];
export const ROLE_NAMES: Record<string, string> = { ved: 'Vedoucí', pro: 'Prodavač', skl: 'Skladník' };
export const DEFAULT_PERMS: Record<'pro' | 'skl', Perm[]> = { pro: ['view', 'add', 'price', 'ord', 'inv'], skl: ['inv'] };

export interface StockCtx {
  /** Čí sklad se ukazuje */
  owner: string;
  ownerName: string;
  /** Přihlášený je majitel */
  isOwner: boolean;
  /** Role přihlášeného v týmu (majitel = ved) */
  role: 'ved' | 'pro' | 'skl';
  perms: Set<Perm>;
  /** Obchody, ve kterých je přihlášený v týmu (přepínač) */
  shops: { owner: string; name: string; role: string }[];
  /** Doplněk odkazů na sklad obchodu: '' nebo 'obchod=…' */
  q: string;
}

/** Kontext skladu: vlastní, nebo obchodu, kde je přihlášený v týmu (?obchod=…). */
export async function loadCtx(supabase: SupabaseClient, me: { id: string; displayName: string }, obchod?: string): Promise<StockCtx> {
  const { data } = await supabase.rpc('my_shops');
  const shops = ((data ?? []) as { owner_id: string; name: string; role: string }[]).map((s) => ({ owner: s.owner_id, name: s.name, role: s.role }));
  const shop = obchod ? shops.find((s) => s.owner === obchod) : undefined;
  if (!shop) {
    return { owner: me.id, ownerName: me.displayName, isOwner: true, role: 'ved', perms: new Set(PERMS.map((p) => p[0])), shops, q: '' };
  }
  const checks = await Promise.all(PERMS.map(([p]) => supabase.rpc('stock_perm', { p_owner: shop.owner, p_perm: p })));
  const perms = new Set(PERMS.filter((_, i) => checks[i].data === true).map((p) => p[0]));
  return { owner: shop.owner, ownerName: shop.name, isOwner: false, role: shop.role as StockCtx['role'], perms, shops, q: `obchod=${shop.owner}` };
}

/** Odkaz v rámci skladu se zachovaným obchodem. */
export function stockHref(ctx: Pick<StockCtx, 'q'>, params: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  if (ctx.q) sp.set('obchod', ctx.q.slice('obchod='.length));
  const s = sp.toString();
  return s ? `/prodat?${s}` : '/prodat';
}

export interface TeamMember { id: string; name: string; email: string | null; role: string; since: string }
export interface TeamData {
  members: TeamMember[];
  roles: Record<'pro' | 'skl', Perm[]>;
  shiftMode: 'lead' | 'self';
  diffLimit: number;
}

/** Záložka Zaměstnanci a role: lidé v týmu, práva rolí, nastavení inventur a směn. */
export async function loadTeam(supabase: SupabaseClient, owner: string): Promise<TeamData> {
  const [team, roles, setting] = await Promise.all([
    supabase.rpc('shop_team_list', { p_owner: owner }),
    supabase.from('shop_roles').select('role, perms').eq('owner_id', owner),
    supabase.from('shop_team').select('shift_mode, diff_limit').eq('owner_id', owner).maybeSingle(),
  ]);
  const matrix: Record<'pro' | 'skl', Perm[]> = { pro: [...DEFAULT_PERMS.pro], skl: [...DEFAULT_PERMS.skl] };
  for (const r of (roles.data ?? []) as { role: 'pro' | 'skl'; perms: Perm[] }[]) if (r.role in matrix) matrix[r.role] = r.perms;
  return {
    members: ((team.data ?? []) as { user_id: string; name: string; email: string | null; role: string; created_at: string }[])
      .map((t) => ({ id: t.user_id, name: t.name, email: t.email, role: t.role, since: t.created_at })),
    roles: matrix,
    shiftMode: ((setting.data as { shift_mode?: string } | null)?.shift_mode ?? 'lead') as 'lead' | 'self',
    diffLimit: (setting.data as { diff_limit?: number } | null)?.diff_limit ?? 0,
  };
}
