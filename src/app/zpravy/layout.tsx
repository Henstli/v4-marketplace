import { AccountShell } from '@/components/account/AccountShell';
import { ChatShell, ConversationList } from '@/components/messages/ChatShell';
import { getCurrentUser } from '@/lib/auth';
import { getConversations } from '@/lib/messages';
import { isSupabaseConfigured } from '@/lib/supabase/config';

// Seznam konverzací vlevo, otevřená konverzace vpravo. Nepřihlášené přesměruje sama stránka.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const user = isSupabaseConfigured() ? await getCurrentUser() : null;
  if (!user) return <AccountShell>{children}</AccountShell>;
  const conversations = await getConversations(user.id);
  return (
    <AccountShell>
      <ChatShell list={<ConversationList items={conversations} />}>{children}</ChatShell>
    </AccountShell>
  );
}
