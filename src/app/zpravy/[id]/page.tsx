import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ShopLogo, shopStyle } from '@/components/trezor';
import { Thread } from '@/components/messages/Thread';
import { getCurrentUser } from '@/lib/auth';
import { getListingRefs, getPeople, getThread, isUserId } from '@/lib/messages';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import styles from '@/components/messages/messages.module.css';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ text?: string; nabidka?: string }> };

export const metadata: Metadata = { title: 'Zprávy' };

export default async function ConversationPage({ params, searchParams }: Props) {
  if (!isSupabaseConfigured()) redirect('/');
  const { id } = await params;
  const user = await getCurrentUser();
  const { text, nabidka } = await searchParams;
  if (!user) {
    // Po přihlášení zpět i s odkazem na nabídku.
    const back = `/zpravy/${id}${nabidka ? `?nabidka=${encodeURIComponent(nabidka)}` : ''}`;
    redirect(`/prihlaseni?dalsi=${encodeURIComponent(back)}`);
  }
  if (!isUserId(id)) notFound();
  if (id === user.id) redirect('/zpravy');
  const [people, thread] = await Promise.all([getPeople([id]), getThread(user.id, id)]);
  const other = people.get(id);
  if (!other) notFound();
  // Otevřená konverzace je přečtená. Čeká se přímo, v after() u serverové komponenty nejdou číst cookies.
  if (thread.id && thread.unread) {
    const supabase = await createClient();
    await supabase.rpc('mark_conversation_read', { p_conversation: thread.id });
  }
  // Dotaz k nabídce z katalogu (tlačítko Napsat u nabídky).
  const listing = nabidka && isUserId(nabidka) ? (await getListingRefs([nabidka])).get(nabidka) ?? null : null;

  return (
    <section className={styles.thread} aria-label={`Konverzace: ${other.name}`}>
      <div className={styles.head}>
        <Link href="/zpravy" className={styles.back} aria-label="Zpět na konverzace">←</Link>
        <span style={shopStyle(other.color)}><ShopLogo name={other.name} image={other.logo} size={32} /></span>
        <strong className={styles.headName}>{other.name}</strong>
        <Link href={other.href} className={styles.headLink}>{other.kind === 'shop' ? 'Stránka obchodu' : 'Profil'}</Link>
      </div>
      <Thread to={id} name={other.name} messages={thread.messages} initialText={text?.slice(0, 2000) ?? ''} listing={listing} />
    </section>
  );
}
