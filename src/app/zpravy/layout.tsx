import { ChatShell, ConversationList } from '@/components/messages/ChatShell';
import { getCurrentUser } from '@/lib/auth';
import { getChatFriends } from '@/lib/friends';
import { getConversations } from '@/lib/messages';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import styles from '@/components/messages/messages.module.css';

// Samostatná stránka (mimo Můj profil): vlevo záložky Konverzace a Přátelé, otevřená konverzace vpravo.
// Nepřihlášené přesměruje sama stránka.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const user = isSupabaseConfigured() ? await getCurrentUser() : null;
  if (!user) return children;
  const [conversations, friends] = await Promise.all([getConversations(user.id), getChatFriends(user.id)]);
  return (
    <div className={`container ${styles.page}`}>
      <h1 className={`t-heading-l ${styles.title}`}>Zprávy</h1>
      <ChatShell list={<ConversationList items={conversations} friends={friends} />}>{children}</ChatShell>
    </div>
  );
}
