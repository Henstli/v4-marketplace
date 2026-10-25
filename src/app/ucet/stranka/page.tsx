import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { getCardsByIds, getShopProfile } from '@/lib/shop';
import { ShopEditor, type ListingOption } from './ShopEditor';
import type { PickerCard } from './actions';

export const metadata: Metadata = { title: 'Moje stránka' };

type CardRow = { name: string; number: string; image_url: string | null; card_sets: { code: string } | { code: string }[] | null };

// Editor vlastní stránky obchodu nebo sběratele. Co se z nastavení ukáže, určuje tarif.
export default async function ShopEditorPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/stranka');
  const p = await getShopProfile(user.id);
  if (!p) redirect('/ucet');

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('listings')
    .select('id, price_czk, condition, cards(name, number, image_url, card_sets(code))')
    .eq('seller_id', user.id)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
    .limit(1000);
  const listings: ListingOption[] = (rows ?? []).map((l) => {
    const c = (Array.isArray(l.cards) ? l.cards[0] : l.cards) as CardRow | null;
    const s = Array.isArray(c?.card_sets) ? c.card_sets[0] : c?.card_sets;
    return { id: l.id, name: c?.name ?? 'Karta', sub: `${s?.code ?? ''} ${c?.number ?? ''} · ${l.condition}`, price: l.price_czk, image: c?.image_url ?? undefined };
  });

  const cardIds = p.saved.blocks.flatMap((b) => [...(b.data.showcase ?? []), ...(b.data.wanted ?? [])].map((x) => x.cardId));
  const refs = await getCardsByIds([...new Set(cardIds)]);
  const cards: PickerCard[] = [...refs.values()].map((c) => ({ id: c.id, name: c.name, number: c.number, setCode: c.setCode, image: c.image, game: c.game }));

  return (
    <div className="container section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <p className="t-small"><Link href="/ucet">← Účet</Link></p>
        <h1 className="t-heading-l">Moje stránka</h1>
      </div>
      <ShopEditor
        uid={user.id}
        name={p.seller.name}
        kind={p.seller.kind}
        plan={p.plan}
        badge={p.badge}
        initial={p.saved}
        listings={listings}
        cards={cards}
      />
    </div>
  );
}
