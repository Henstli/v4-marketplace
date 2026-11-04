import type { SupabaseClient } from '@supabase/supabase-js';

export interface Place {
  name: string;
  group: string | null;
  every: number;
  lastChecked: string | null;
  rows: number;
  pcs: number;
  /** Kdo místo právě počítá */
  counting: { id: number; user: string; mine: boolean } | null;
  /** Dny po termínu kontroly (záporné = do termínu zbývá) */
  overdue: number;
  /** Dnes v plánu (komu) */
  today: string[];
  /** Náhled karet na místě (nejvýš 4) */
  images: string[];
}

export interface Group { name: string; blind: boolean; person: string | null }
export interface Person { id: string; name: string; role: string }

export interface InvLine { listing_id: string; name: string; set: string; cond: string; lang: string; image: string | null; expected: number; counted: number | null }

export interface Inventory {
  id: number;
  place: string;
  user: string;
  userId: string | null;
  status: 'counting' | 'review' | 'done' | 'cancelled';
  blind: boolean;
  startedAt: string;
  finishedAt: string | null;
  seconds: number | null;
  lines: InvLine[];
  decidedBy: string | null;
  note: string | null;
}

export interface PlanTask { day: string; userId: string; places: string[] }
export interface Shift { userId: string; day: string }

const DAY = 86400000;

/** Pondělí týdne (offset v týdnech od dnešního), YYYY-MM-DD v pražském čase. */
export function weekStart(offset = 0): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  const dow = (now.getDay() + 6) % 7;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
}
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });

/** Vše pro záložku Inventura: místa, skupiny, lidé, běžící a dokončené inventury, plán a směny týdne. */
export async function loadInventory(supabase: SupabaseClient, owner: string, me: string, ownerName: string, week: number) {
  const from = weekStart(week);
  const to = addDays(from, 6);
  const today = todayStr();
  const [stock, places, groups, team, invs, plan, shifts, setting] = await Promise.all([
    (async () => {
      const out: { location: string | null; qty: number; image: string | null }[] = [];
      for (let i = 0; i < 10; i++) {
        const { data } = await supabase.from('listing_stock').select('location, keep_qty, listings!inner(quantity, removed_at, hidden_qty, cards(image_url))')
          .eq('seller_id', owner).not('location', 'is', null).range(i * 1000, i * 1000 + 999);
        for (const r of (data ?? []) as unknown as { location: string; keep_qty: number; listings: { quantity: number; removed_at: string | null; hidden_qty: number | null; cards: { image_url: string | null } | null } }[]) {
          if (r.listings.removed_at || r.listings.hidden_qty != null) continue;
          out.push({ location: r.location, qty: r.keep_qty + r.listings.quantity, image: r.listings.cards?.image_url ?? null });
        }
        if (!data || data.length < 1000) break;
      }
      return out;
    })(),
    supabase.from('stock_places').select('name, group_name, every_days, last_checked_at').eq('owner_id', owner),
    supabase.from('stock_groups').select('name, blind, person').eq('owner_id', owner),
    supabase.rpc('shop_team_list', { p_owner: owner }),
    supabase.from('inventories').select('id, place, user_id, status, blind, started_at, finished_at, seconds, lines, decided_by, note')
      .eq('owner_id', owner).order('started_at', { ascending: false }).limit(200),
    supabase.from('inventory_plan').select('day, user_id, places').eq('owner_id', owner).gte('day', from).lte('day', to),
    supabase.from('staff_shifts').select('user_id, day, off').eq('owner_id', owner).gte('day', from).lte('day', to),
    supabase.from('shop_team').select('shift_mode, diff_limit').eq('owner_id', owner).maybeSingle(),
  ]);

  const people: Person[] = [
    { id: owner, name: ownerName, role: 'ved' },
    ...((team.data ?? []) as { user_id: string; name: string; role: string }[]).map((t) => ({ id: t.user_id, name: t.name, role: t.role })),
  ];
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? 'Bývalý člen týmu';

  const inventories: Inventory[] = ((invs.data ?? []) as Record<string, unknown>[]).map((i) => ({
    id: i.id as number, place: i.place as string, userId: i.user_id as string | null, user: nameOf(i.user_id as string | null),
    status: i.status as Inventory['status'], blind: i.blind as boolean, startedAt: i.started_at as string, finishedAt: i.finished_at as string | null,
    seconds: i.seconds as number | null, lines: (i.lines ?? []) as InvLine[], decidedBy: i.decided_by ? nameOf(i.decided_by as string) : null, note: i.note as string | null,
  }));

  const planTasks: PlanTask[] = ((plan.data ?? []) as { day: string; user_id: string; places: string[] }[]).map((p) => ({ day: p.day, userId: p.user_id, places: p.places }));
  const settings = new Map(((places.data ?? []) as { name: string; group_name: string | null; every_days: number; last_checked_at: string | null }[]).map((p) => [p.name, p]));
  const agg = new Map<string, { rows: number; pcs: number; images: string[] }>();
  for (const s of stock) {
    if (!s.location || s.qty <= 0) continue;
    const a = agg.get(s.location) ?? { rows: 0, pcs: 0, images: [] };
    a.rows++; a.pcs += s.qty;
    if (s.image && a.images.length < 4) a.images.push(s.image);
    agg.set(s.location, a);
  }
  const names = new Set([...agg.keys(), ...settings.keys()]);
  const list: Place[] = [...names].map((name) => {
    const st = settings.get(name);
    const every = st?.every_days ?? 30;
    const last = st?.last_checked_at ?? null;
    const overdue = last ? Math.floor((Date.now() - new Date(last).getTime()) / DAY) - every : 1;
    const run = inventories.find((i) => i.place === name && i.status === 'counting');
    return {
      name, group: st?.group_name ?? null, every, lastChecked: last, rows: agg.get(name)?.rows ?? 0, pcs: agg.get(name)?.pcs ?? 0,
      counting: run ? { id: run.id, user: run.user, mine: run.userId === me } : null,
      overdue,
      today: planTasks.filter((t) => t.day === today && t.places.includes(name)).map((t) => t.userId),
      images: agg.get(name)?.images ?? [],
    };
  });
  // Dnes na řadě první, pak nejdéle bez kontroly.
  list.sort((a, b) => Number(b.today.length > 0) - Number(a.today.length > 0) || b.overdue - a.overdue || a.name.localeCompare(b.name, 'cs', { numeric: true }));

  return {
    week: { from, to, offset: week, today },
    places: list,
    groups: ((groups.data ?? []) as Group[]),
    people,
    inventories,
    plan: planTasks,
    shifts: ((shifts.data ?? []) as { user_id: string; day: string; off: boolean }[]).filter((s) => s.off).map((s) => ({ userId: s.user_id, day: s.day })),
    shiftMode: ((setting.data as { shift_mode?: string } | null)?.shift_mode ?? 'lead') as 'lead' | 'self',
    diffLimit: (setting.data as { diff_limit?: number } | null)?.diff_limit ?? 0,
  };
}
export type InventoryData = Awaited<ReturnType<typeof loadInventory>>;
