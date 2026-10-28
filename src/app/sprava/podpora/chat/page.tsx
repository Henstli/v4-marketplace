import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AutoRefresh } from '@/components/support/AutoRefresh';
import { TeamComposer } from '@/components/support/TeamComposer';
import { getCurrentUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { caseCode } from '@/lib/support';
import { dmRoom, TEAM_ROOM, type TeamMessage } from '@/lib/team-chat';
import styles from '../podpora.module.css';

export const metadata: Metadata = { title: 'Chat týmu · podpora' };

type Props = { searchParams: Promise<{ s?: string; chyba?: string }> };

interface Member { user_id: string; display_name: string | null; email: string; seen_at: string | null; case_number: number | null }
interface Room { room: string; last_body: string; last_kind: string; last_sender: string | null; last_at: string; unread: number }

const online = (m: Member) => !!m.seen_at && Date.now() - new Date(m.seen_at).getTime() < 5 * 60000;

/** @jméno zvýrazněné a #P-0128 jako odkaz na případ. */
function rich(body: string, cases: Map<number, boolean>): ReactNode[] {
  return body.split(/(@[\p{L}\d_.-]+|#?\bP-?\d{1,6}\b)/u).map((part, i) => {
    if (part.startsWith('@')) return <span key={i} className={styles.mention}>{part}</span>;
    const m = /^#?P-?0*(\d{1,6})$/i.exec(part);
    if (m && cases.has(Number(m[1]))) return <Link key={i} href={`/sprava/podpora/${m[1]}`} className={styles.mention}>{caseCode(Number(m[1]))}</Link>;
    return part;
  });
}

/** Chat týmu: skupina Celý tým a soukromé konverzace (DS Support › Chat týmu). Uživatelé ho nevidí. */
export default async function TeamChatPage({ searchParams }: Props) {
  const { s = '', chyba } = await searchParams;
  const me = (await getCurrentUser())!;
  const supabase = await createClient();
  const [{ data: team }, { data: roomsData }] = await Promise.all([supabase.rpc('team_overview'), supabase.rpc('team_rooms')]);
  const members = ((team ?? []) as Member[]).filter((m) => m.user_id !== me.id);
  const other = members.find((m) => m.user_id === s) ?? null;
  const room = other ? dmRoom(me.id, other.user_id) : TEAM_ROOM;
  const rooms = new Map(((roomsData ?? []) as Room[]).map((r) => [r.room, r]));

  const [{ data: msgs }] = await Promise.all([
    supabase.from('team_messages').select('*').eq('room', room).order('id', { ascending: false }).limit(200).returns<TeamMessage[]>(),
    supabase.from('team_reads').upsert({ staff_id: me.id, room, read_at: new Date().toISOString() }),
  ]);
  // Nejnovější první; seznam je column-reverse, takže drží dole jako chat.
  const list = msgs ?? [];
  const caseIds = [...new Set(list.map((m) => m.case_id).filter((x): x is string => !!x))];
  const { data: casesData } = caseIds.length
    ? await supabase.from('support_cases').select('id, number, subject').in('id', caseIds)
    : { data: [] };
  const cases = new Map(((casesData ?? []) as Array<{ id: string; number: number; subject: string }>).map((c) => [c.id, c]));
  const caseNumbers = new Map([...cases.values()].map((c) => [c.number, true]));
  const allNames = new Map<string, string>([[me.id, me.displayName], ...((team ?? []) as Member[]).map((m) => [m.user_id, m.display_name ?? m.email] as [string, string])]);
  const nameOf = (id: string | null) => (id ? allNames.get(id) ?? 'bývalý člen' : 'Systém');
  const preview = (r: Room | undefined) => (r ? `${r.last_sender === me.id ? 'Vy: ' : ''}${r.last_body.replace(/\s+/g, ' ').slice(0, 60)}` : 'Zatím bez zpráv');
  const teamRoom = rooms.get(TEAM_ROOM);

  return (
    <div className={styles.page}>
      <AutoRefresh every={10000} />
      <div className={styles.head}><h1 className="t-heading-l">Chat týmu</h1></div>
      {chyba ? <p className={`${styles.flash} ${styles.flashErr}`}>{chyba}</p> : null}

      <div className={styles.chat}>
        <aside className={`${styles.box} ${styles.chatRooms}`}>
          <span className={styles.label}>SKUPINA</span>
          <Link href="/sprava/podpora/chat" className={styles.chatRoom} aria-current={!other ? 'page' : undefined}>
            <span className={styles.chatHash} aria-hidden="true">#</span>
            <span className={styles.chatRoomText}><strong>Celý tým</strong><span className={styles.qmuted}>{preview(teamRoom)}</span></span>
            {(teamRoom?.unread ?? 0) > 0 && other ? <span className={styles.newBadge}>{teamRoom?.unread}</span> : null}
          </Link>
          <span className={styles.label}>KOLEGOVÉ</span>
          {members.map((m) => {
            const r = rooms.get(dmRoom(me.id, m.user_id));
            const name = m.display_name ?? m.email;
            return (
              <Link key={m.user_id} href={`/sprava/podpora/chat?s=${m.user_id}`} className={styles.chatRoom} aria-current={other?.user_id === m.user_id ? 'page' : undefined}>
                <span className={styles.chatAvatar} aria-hidden="true">
                  {name.slice(0, 1).toUpperCase()}
                  <span className={`${styles.dot} ${online(m) ? '' : styles.dotOff}`} />
                </span>
                <span className={styles.chatRoomText}><strong>{name}</strong><span className={styles.qmuted}>{preview(r)}</span></span>
                {(r?.unread ?? 0) > 0 && other?.user_id !== m.user_id ? <span className={styles.newBadge}>{r?.unread}</span> : null}
              </Link>
            );
          })}
          {!members.length ? <span className={styles.small}>V týmu jste zatím sami.</span> : null}
        </aside>

        <section className={`${styles.box} ${styles.chatMain}`}>
          <div className={styles.chatHead}>
            <strong>{other ? other.display_name ?? other.email : '# Celý tým'}</strong>
            <span className={styles.small}>
              {other ? (online(other) ? (other.case_number ? `teď v ${caseCode(other.case_number)}` : 'teď v podpoře') : 'není v podpoře')
                : `${members.length + 1} lidí · uživatelé chat nevidí`}
            </span>
          </div>
          <ol className={styles.chatList}>
            {list.map((m) => {
              if (m.kind === 'system') {
                return (
                  <li key={m.id} className={styles.chatSystem}>
                    <span className={styles.dot} style={{ background: 'var(--info)' }} aria-hidden="true" />
                    <span>{rich(m.body, caseNumbers)}</span>
                    <span> · {formatDateTime(m.created_at)}</span>
                  </li>
                );
              }
              const c = m.case_id ? cases.get(m.case_id) : null;
              return (
                <li key={m.id} className={styles.chatMsg}>
                  <span className={styles.chatAvatar} aria-hidden="true">{nameOf(m.sender_id).slice(0, 1).toUpperCase()}</span>
                  <div className={styles.chatBody}>
                    <span><strong>{nameOf(m.sender_id)}</strong> <span className={styles.small}>{formatDateTime(m.created_at)}</span></span>
                    <div className={styles.msgBody}>{rich(m.body, caseNumbers)}</div>
                    {c ? (
                      <Link href={`/sprava/podpora/${c.number}`} className={styles.caseTile}>
                        <span className="code">{caseCode(c.number)}</span><span>{c.subject}</span>
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
            {!list.length ? <li className={styles.small}>Zatím tu nic není. Napište první zprávu.</li> : null}
          </ol>
          <TeamComposer room={room} withId={other?.user_id ?? ''} />
        </section>
      </div>
    </div>
  );
}
