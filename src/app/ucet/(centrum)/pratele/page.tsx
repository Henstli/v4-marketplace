import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageTabs } from '@/components/account/PageTabs';
import { FriendsGrid } from '@/components/friends/FriendsGrid';
import { getCurrentUser } from '@/lib/auth';
import { getMyFriends } from '@/lib/friends';

export const metadata: Metadata = { title: 'Přátelé' };

type Props = { searchParams: Promise<{ z?: string }> };

// Přátelé v centru účtu: záložky Přátelé, Žádosti (čekají na mě) a Odeslané.
export default async function FriendsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/pratele');
  const { friends, incoming, outgoing } = await getMyFriends(user.id);
  const z = (await searchParams).z;
  const tab = z === 'zadosti' || z === 'odeslane' ? z : incoming.length && !friends.length ? 'zadosti' : 'pratele';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Přátelé</h1>
        <PageTabs label="Přátelé" current={`/ucet/pratele${tab === 'pratele' ? '' : `?z=${tab}`}`} tabs={[
          { label: 'Přátelé', href: '/ucet/pratele', n: friends.length },
          { label: 'Žádosti', href: '/ucet/pratele?z=zadosti', count: incoming.length },
          { label: 'Odeslané', href: '/ucet/pratele?z=odeslane', n: outgoing.length },
        ]} />
        <p className="muted">Přátelé se ukazují na podložce profilu: u sběratelů jako Společní přátelé, u obchodů jako Zkušenosti přátel. Přidáš je na jejich profilu.</p>
      </div>
      {tab === 'zadosti' ? <FriendsGrid items={incoming} empty="Žádná nová žádost." />
        : tab === 'odeslane' ? <FriendsGrid items={outgoing} empty="Žádná odeslaná žádost nečeká." />
        : <FriendsGrid items={friends} empty="Zatím žádní přátelé. Přidáš je na jejich profilu tlačítkem Přidat přítele." />}
    </div>
  );
}
