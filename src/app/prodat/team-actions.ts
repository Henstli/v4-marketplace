'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { PERMS, type Perm } from './team';
import { stockChange } from './actions';

export interface Res { ok?: boolean; error?: string; text?: string; id?: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ROLES = ['ved', 'pro', 'skl'];
const bad = (e: { code?: string } | null, fallback = 'Změnu se nepodařilo uložit. Zkuste to prosím znovu.') =>
  e?.code === '42501' ? 'Na tuto změnu nemáte právo.' : fallback;

function done() {
  revalidatePath('/prodat');
}

// ===== Zaměstnanci a role =====

export async function staffAdd(owner: string, email: string, role: string): Promise<Res> {
  if (!UUID.test(owner) || !ROLES.includes(role)) return { error: 'Vyberte roli.' };
  const mail = String(email).trim().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { error: 'Zadejte e-mail, se kterým se člověk přihlašuje do V4cards.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('staff_add', { p_owner: owner, p_email: mail, p_role: role });
  if (error) return { error: bad(error) };
  if (data === 'no_account') return { error: 'S tímto e-mailem zatím nikdo účet nemá. Ať se nejdřív zaregistruje na V4cards.' };
  if (data === 'owner') return { error: 'To jste vy, majitel obchodu.' };
  done();
  return { ok: true, text: 'Přidáno do týmu. Sklad obchodu uvidí v menu Sklad.' };
}

export async function staffRole(owner: string, user: string, role: string): Promise<Res> {
  if (!UUID.test(owner) || !UUID.test(user) || !ROLES.includes(role)) return { error: 'Vyberte roli.' };
  const supabase = await createClient();
  const { error } = await supabase.from('shop_staff').update({ role }).eq('owner_id', owner).eq('user_id', user);
  if (error) return { error: bad(error) };
  done();
  return { ok: true };
}

export async function staffRemove(owner: string, user: string): Promise<Res> {
  if (!UUID.test(owner) || !UUID.test(user)) return { error: 'Člověk nenalezen.' };
  const supabase = await createClient();
  const { error } = await supabase.from('shop_staff').delete().eq('owner_id', owner).eq('user_id', user);
  if (error) return { error: bad(error) };
  done();
  return { ok: true };
}

export async function rolesSave(owner: string, matrix: Record<'pro' | 'skl', Perm[]>): Promise<Res> {
  if (!UUID.test(owner)) return { error: 'Obchod nenalezen.' };
  const valid = new Set<string>(PERMS.map((p) => p[0]));
  const rows = (['pro', 'skl'] as const).map((role) => ({ owner_id: owner, role, perms: [...new Set((matrix[role] ?? []).filter((p) => valid.has(p)))] }));
  const supabase = await createClient();
  const { error } = await supabase.from('shop_roles').upsert(rows, { onConflict: 'owner_id,role' });
  if (error) return { error: bad(error) };
  done();
  return { ok: true, text: 'Práva rolí jsou uložená.' };
}

export async function teamSettings(owner: string, shiftMode: 'lead' | 'self', diffLimit: number): Promise<Res> {
  if (!UUID.test(owner) || !['lead', 'self'].includes(shiftMode)) return { error: 'Neplatné nastavení.' };
  const lim = Math.max(0, Math.min(100000, Math.round(Number(diffLimit) || 0)));
  const supabase = await createClient();
  const { error } = await supabase.from('shop_team').upsert({ owner_id: owner, shift_mode: shiftMode, diff_limit: lim, updated_at: new Date().toISOString() });
  if (error) return { error: bad(error) };
  done();
  return { ok: true, text: 'Uloženo.' };
}

// ===== Inventura =====

export async function placeSave(owner: string, name: string, group: string, every: number): Promise<Res> {
  if (!UUID.test(owner) || !String(name).trim()) return { error: 'Zadejte název místa.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('stock_place_save', { p_owner: owner, p_name: String(name).slice(0, 60), p_group: String(group ?? '').slice(0, 40), p_every: Math.round(Number(every) || 30) });
  if (error) return { error: bad(error) };
  done();
  return { ok: true };
}

export async function groupSave(owner: string, name: string, blind: boolean, person: string | null): Promise<Res> {
  if (!UUID.test(owner) || !String(name).trim()) return { error: 'Zadejte název skupiny.' };
  if (person && !UUID.test(person)) return { error: 'Vyberte člověka.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('stock_group_save', { p_owner: owner, p_name: String(name).slice(0, 40), p_blind: !!blind, p_person: person || null });
  if (error) return { error: bad(error) };
  done();
  return { ok: true };
}

export async function inventoryStart(owner: string, place: string): Promise<Res> {
  if (!UUID.test(owner) || !String(place).trim()) return { error: 'Vyberte místo.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('inventory_start', { p_owner: owner, p_place: String(place).slice(0, 60) });
  if (error) return { error: error.message?.includes('někdo jiný') ? 'Místo právě počítá někdo jiný.' : bad(error, 'Inventuru se nepodařilo začít.') };
  done();
  return { ok: true, id: Number(data) };
}

export async function inventorySave(id: number, counts: Record<string, number>, finish: boolean, note?: string): Promise<Res> {
  if (!Number.isInteger(id)) return { error: 'Inventura nenalezena.' };
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts ?? {})) if (UUID.test(k) && Number.isInteger(v) && v >= 0) clean[k] = Math.min(v, 100000);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('inventory_save', { p_id: id, p_counts: clean, p_finish: finish, p_note: note ?? null });
  if (error) return { error: error.message?.includes('všechny') ? 'Napočítejte prosím všechny karty (chybějící zadejte jako 0).' : error.message?.includes('neběží') ? 'Inventura už neběží.' : bad(error) };
  done();
  const text = data === 'ok' ? 'Hotovo, vše sedí.' : data === 'applied' ? 'Hotovo, rozdíly jsou zapsané do skladu a v Historii.' : data === 'review' ? 'Hotovo. Rozdíly teď zkontroluje vedoucí.' : 'Uloženo.';
  return { ok: true, text };
}

export async function inventoryDecide(id: number, approve: boolean): Promise<Res> {
  if (!Number.isInteger(id)) return { error: 'Inventura nenalezena.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('inventory_decide', { p_id: id, p_approve: approve });
  if (error) return { error: bad(error) };
  done();
  return { ok: true, text: approve ? 'Rozdíly jsou zapsané do skladu.' : 'Místo půjde přepočítat znovu.' };
}

export async function inventoryCancel(id: number): Promise<Res> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('inventory_cancel', { p_id: id });
  if (error) return { error: bad(error) };
  done();
  return { ok: true };
}

export async function planSet(owner: string, day: string, user: string, places: string[]): Promise<Res> {
  if (!UUID.test(owner) || !UUID.test(user) || !DAY.test(day)) return { error: 'Vyberte den a člověka.' };
  const list = [...new Set((places ?? []).map((p) => String(p).slice(0, 60)).filter(Boolean))].slice(0, 50);
  const supabase = await createClient();
  const { data: off } = await supabase.from('staff_shifts').select('off').eq('owner_id', owner).eq('user_id', user).eq('day', day).maybeSingle();
  if (off?.off && list.length) return { error: 'Ten den má volno, vyberte jiný den.' };
  const { error } = list.length
    ? await supabase.from('inventory_plan').upsert({ owner_id: owner, day, user_id: user, places: list })
    : await supabase.from('inventory_plan').delete().eq('owner_id', owner).eq('day', day).eq('user_id', user);
  if (error) return { error: bad(error) };
  done();
  return { ok: true };
}

export async function planApply(owner: string, tasks: { day: string; userId: string; places: string[] }[]): Promise<Res> {
  if (!UUID.test(owner)) return { error: 'Obchod nenalezen.' };
  const rows = (tasks ?? []).filter((t) => DAY.test(t.day) && UUID.test(t.userId) && t.places?.length)
    .map((t) => ({ owner_id: owner, day: t.day, user_id: t.userId, places: [...new Set(t.places.map((p) => String(p).slice(0, 60)))].slice(0, 50) }));
  if (!rows.length) return { error: 'Návrh je prázdný.' };
  const supabase = await createClient();
  const { error } = await supabase.from('inventory_plan').upsert(rows);
  if (error) return { error: bad(error) };
  done();
  return { ok: true, text: `Do plánu přidáno ${rows.length} úkolů.` };
}

export async function shiftToggle(owner: string, user: string, day: string, off: boolean): Promise<Res> {
  if (!UUID.test(owner) || !UUID.test(user) || !DAY.test(day)) return { error: 'Vyberte den.' };
  const supabase = await createClient();
  const { error } = off
    ? await supabase.from('staff_shifts').upsert({ owner_id: owner, user_id: user, day, off: true })
    : await supabase.from('staff_shifts').delete().eq('owner_id', owner).eq('user_id', user).eq('day', day);
  if (error) return { error: bad(error) };
  done();
  return { ok: true };
}

// ===== Trh a automatické ceny =====

export async function autopriceSave(owner: string, r: {
  enabled: boolean; mode: string; pct: number; floorPct: number; capPct: number; exclLocations: string[]; exclGames: string[];
}): Promise<Res> {
  if (!UUID.test(owner) || !['under', 'market', 'over'].includes(r.mode)) return { error: 'Neplatné nastavení.' };
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(n) || 0));
  const supabase = await createClient();
  const { error } = await supabase.from('stock_autoprice').upsert({
    owner_id: owner, enabled: !!r.enabled, mode: r.mode, pct: Math.round(clamp(r.pct, 0, 50) * 10) / 10,
    floor_pct: Math.round(clamp(r.floorPct, 0, 500)), cap_pct: Math.round(clamp(r.capPct, 1, 50)),
    excl_locations: [...new Set((r.exclLocations ?? []).map((x) => String(x).slice(0, 60)))].slice(0, 200),
    excl_games: [...new Set((r.exclGames ?? []).map((x) => String(x).slice(0, 40)))].slice(0, 20),
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: bad(error) };
  done();
  return { ok: true, text: r.enabled ? 'Uloženo. Ceny se přepočítají dnes v noci ve 3:00.' : 'Uloženo. Automatické ceny jsou vypnuté.' };
}

/** Poptávka u vás → Dát na prodej: všechny kusy karty mimo prodej půjdou na prodej. */
export async function demandSell(owner: string, cardId: string): Promise<Res> {
  if (!UUID.test(owner) || !UUID.test(cardId)) return { error: 'Karta nenalezena.' };
  const supabase = await createClient();
  const { data } = await supabase.from('listing_stock').select('listing_id, keep_qty, listings!inner(card_id, seller_id)')
    .eq('listings.card_id', cardId).eq('listings.seller_id', owner).gt('keep_qty', 0);
  const ids = ((data ?? []) as { listing_id: string }[]).map((r) => r.listing_id);
  if (!ids.length) return { error: 'Kartu mimo prodej nemáte.' };
  const res = await stockChange(ids, 'sell');
  if (res.error) return { error: res.error };
  return { ok: true, text: 'Karta je na prodej. Kdo ji hlídá, dostane upozornění.' };
}
