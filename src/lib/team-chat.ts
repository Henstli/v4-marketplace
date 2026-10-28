// Chat týmu (DS Support › Chat týmu). Místnost 'team' = Celý tým, jinak soukromá konverzace dvou lidí.

export const TEAM_ROOM = 'team';

/** Klíč soukromé konverzace: menší a větší uuid, aby ji oba viděli stejně. */
export const dmRoom = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;

/** Odkaz na případ ve zprávě: #P-0128 (nebo P-128). */
export const CASE_REF = /#?\bP-?0*(\d{1,6})\b/i;

export interface TeamMessage {
  id: number;
  room: string;
  sender_id: string | null;
  kind: 'text' | 'system';
  body: string;
  case_id: string | null;
  created_at: string;
}
