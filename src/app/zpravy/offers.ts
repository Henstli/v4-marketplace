'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { siteOrigin } from '@/lib/auth-helpers';
import { sendMessageEmail } from '@/lib/email';
import { isUserId } from '@/lib/messages';
import { createClient } from '@/lib/supabase/server';

export interface OfferResult { ok?: true; error?: string; offerId?: string; orderNumber?: number }

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** E-mail druhé straně o návrhu ceny, stejně jako u zpráv jen jednou za dávku nepřečtených. */
async function notify(supabase: Supabase, offerId: string, text: string) {
  const [{ data: o }, { data: auth }, origin] = await Promise.all([
    supabase.from('price_offers').select('buyer_id, seller_id').eq('id', offerId).maybeSingle(),
    supabase.auth.getUser(),
    siteOrigin(),
  ]);
  const me = auth.user?.id;
  if (!o || !me) return;
  const [a, b] = o.buyer_id < o.seller_id ? [o.buyer_id, o.seller_id] : [o.seller_id, o.buyer_id];
  const { data: conv } = await supabase.from('conversations').select('id').eq('user_a', a).eq('user_b', b).maybeSingle();
  if (!conv) return;
  after(async () => {
    const { data: claim } = await supabase.rpc('claim_message_email', { p_conversation: conv.id });
    const row = (claim as Array<{ email: string | null; sender_name: string | null }> | null)?.[0];
    if (row?.email) await sendMessageEmail(row.email, row.sender_name ?? 'Uživatel V4cards', text, `${origin}/zpravy/${me}`);
  });
}

const price = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`;

/**
 * Návrh ceny. Kupující navrhuje u nabídky s cenou dohodou (buyer prázdný), prodejce komukoli,
 * s kým si píše (buyer = jeho id). Otevřený návrh se jen změní na novou cenu.
 */
export async function proposePrice(listingId: string, amount: number, quantity = 1, buyer?: string | null): Promise<OfferResult> {
  if (!isUserId(String(listingId))) return { error: 'Nabídka neexistuje.' };
  if (buyer != null && !isUserId(String(buyer))) return { error: 'Vyberte, komu cenu navrhujete.' };
  const p = Number(amount);
  const q = Number(quantity);
  if (!Number.isInteger(p) || p < 1) return { error: 'Zadejte cenu v celých korunách.' };
  if (!Number.isInteger(q) || q < 1) return { error: 'Zadejte počet kusů.' };
  const supabase = await createClient();
  // Kdo smí komu co navrhnout a limity hlídá funkce propose_price v databázi.
  const { data, error } = await supabase.rpc('propose_price', { p_listing: listingId, p_price: p, p_quantity: q, p_buyer: buyer ?? null });
  if (error) return { error: error.code === 'PGRST202' ? 'Návrhy ceny zatím nejdou, zkuste to později.' : error.message };
  const offerId = data as string;
  await notify(supabase, offerId, `Návrh ceny ${price(p)}${q > 1 ? ` za ${q} ks` : ''}. Otevřete zprávy a návrh přijměte, nebo pošlete jinou cenu.`);
  revalidatePath('/zpravy', 'layout');
  revalidatePath('/objednavky');
  return { ok: true, offerId };
}

/** Přijetí (vznikne potvrzená objednávka), odmítnutí prodejcem nebo stažení kupujícím. */
export async function answerOffer(offerId: string, action: 'accept' | 'decline' | 'cancel'): Promise<OfferResult> {
  if (!isUserId(String(offerId))) return { error: 'Návrh neexistuje.' };
  if (!['accept', 'decline', 'cancel'].includes(action)) return { error: 'Neznámá akce.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('answer_price_offer', { p_offer: offerId, p_action: action });
  if (error) return { error: error.message };
  let orderNumber: number | undefined;
  if (action === 'accept' && data) {
    const { data: order } = await supabase.from('orders').select('number').eq('id', data as string).maybeSingle();
    orderNumber = order?.number ?? undefined;
    await notify(supabase, offerId, `Cena je dohodnutá${orderNumber ? `, vznikla objednávka č. ${orderNumber}` : ''}. Domluvte se na platbě a předání.`);
    // Přijetím ubyly kusy, katalog to musí vědět.
    revalidatePath('/karty', 'layout');
  }
  revalidatePath('/zpravy', 'layout');
  revalidatePath('/objednavky');
  return { ok: true, orderNumber };
}
