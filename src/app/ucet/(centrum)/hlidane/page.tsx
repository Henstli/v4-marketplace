import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, CardThumb } from '@/components/trezor';
import { unwatchCard } from '@/app/hlidani/actions';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { thumbUrl } from '@/lib/images';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Hlídané karty' };

interface CardRef { id: string; name: string; slug: string; image_url: string | null; game_id: string | null }

const row = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' } as const;

export default async function WatchedPage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/hlidane');
  const supabase = await createClient();
  const [{ data: alerts }, { data: watches }] = await Promise.all([
    supabase.from('watch_alerts').select('id, created_at, seen_at, cards(id, name, slug, image_url, game_id)')
      .order('created_at', { ascending: false }).limit(30).returns<Array<{ id: number; created_at: string; seen_at: string | null; cards: CardRef | null }>>(),
    supabase.from('card_watches').select('created_at, cards(id, name, slug, image_url, game_id)')
      .order('created_at', { ascending: false }).returns<Array<{ created_at: string; cards: CardRef | null }>>(),
  ]);
  const unseen = (alerts ?? []).filter((a) => !a.seen_at).map((a) => a.id);
  // Zobrazená upozornění se označí jako přečtená (zmizí tečka v menu). Čeká se na to přímo,
  // protože v after() u serverové komponenty už nejde číst cookies přihlášení.
  if (unseen.length) await supabase.from('watch_alerts').update({ seen_at: new Date().toISOString() }).in('id', unseen);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Hlídané karty</h1>
        <p className="muted">
          Když karta není skladem, klikněte u ní na „Dát vědět, až bude skladem“. Jakmile ji někdo vystaví nebo se uvolní
          rezervace, pošleme e-mail všem, kdo ji hlídají. Kdo objedná dřív, ten ji má.
        </p>
      </div>

      {alerts?.length ? (
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h2 className="t-heading-m">Znovu skladem</h2>
          {alerts.map((a) => a.cards ? (
            <div key={a.id} style={row}>
              <CardThumb image={thumbUrl(a.cards.image_url ?? undefined)} color={a.cards.game_id ? `var(--game-${a.cards.game_id}-art)` : undefined} />
              <Link href={`/karty/${a.cards.slug}`} style={{ fontWeight: a.seen_at ? 500 : 600 }}>{a.cards.name}</Link>
              <span className="t-small muted">{a.seen_at ? '' : 'Nové · '}{formatDate(a.created_at)}</span>
            </div>
          ) : null)}
        </section>
      ) : null}

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 className="t-heading-m">Čekám na</h2>
        {watches?.length ? watches.map((w) => w.cards ? (
          <div key={w.cards.id} style={row}>
            <CardThumb image={thumbUrl(w.cards.image_url ?? undefined)} color={w.cards.game_id ? `var(--game-${w.cards.game_id}-art)` : undefined} />
            <Link href={`/karty/${w.cards.slug}`} style={{ fontWeight: 500 }}>{w.cards.name}</Link>
            <span className="t-small muted">od {formatDate(w.created_at)}</span>
            <form action={unwatchCard} style={{ marginLeft: 'auto' }}>
              <input type="hidden" name="cardId" value={w.cards.id} />
              <Button type="submit" variant="ghost">Nehlídat</Button>
            </form>
          </div>
        ) : null) : <p className="muted">Zatím nic nehlídáte. <Link href="/karty">Procházet karty</Link></p>}
      </section>
    </div>
  );
}
