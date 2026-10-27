import { ChatShell, ConversationList } from '@/components/messages/ChatShell';
import { getCurrentUser } from '@/lib/auth';
import { getConversations } from '@/lib/messages';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import styles from '@/components/messages/messages.module.css';

// Samostatná stránka (mimo Můj profil): seznam konverzací vlevo, otevřená konverzace vpravo.
// Nepřihlášené přesměruje sama stránka.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const user = isSupabaseConfigured() ? await getCurrentUser() : null;
  if (!user) return children;
  const conversations = await getConversations(user.id);
  return (
    <div className={`container ${styles.page}`}>
      <h1 className={`t-heading-l ${styles.title}`}>Zprávy</h1>
      <ChatShell list={<ConversationList items={conversations} />}>{children}</ChatShell>
    </div>
  );
}
