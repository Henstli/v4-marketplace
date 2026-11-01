// Přátelé v centru účtu (DS Trezor › ProfileMat › Přátelé): mřížka malých profilových karet s akcí.
import Link from 'next/link';
import { ProfileCard } from '@/components/trezor';
import { FriendButton } from '@/components/profile/FriendButton';
import type { FriendStatus } from '@/app/ucet/pratele-actions';
import { plural } from '@/lib/format';
import type { ProfileCardData } from '@/lib/profile-card';

export interface FriendTile { card: ProfileCardData; trades: number; status: FriendStatus; since: string }

export function FriendsGrid({ items, empty }: { items: FriendTile[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="tz-friends">
      {items.map((f) => (
        <div key={f.card.id} className="tz-friend">
          <Link href={`/prodejci/${f.card.id}`} className="tz-friend-card" aria-label={f.card.name}>
            <ProfileCard data={f.card} headingLevel={3} />
          </Link>
          <span className="tz-friend-exp" data-none={f.trades ? undefined : ''}>
            {f.trades ? plural(f.trades, ['společný obchod', 'společné obchody', 'společných obchodů']) : 'Zatím spolu neobchodovali'}
          </span>
          <div className="tz-friend-act">
            {f.status === 'friends' ? <Link href={`/zpravy/${f.card.id}`} className="tz-btn tz-btn-sm tz-btn-orange">Napsat</Link> : null}
            <FriendButton other={f.card.id} initial={f.status} small />
          </div>
        </div>
      ))}
    </div>
  );
}
