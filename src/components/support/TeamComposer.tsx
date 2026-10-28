'use client';

import { useRef } from 'react';
import { Button } from '@/components/trezor';
import { sendTeamMessage } from '@/app/sprava/podpora/chat/actions';
import styles from '@/app/sprava/podpora/podpora.module.css';

/** Pole pro zprávu týmu: Enter odešle, Shift+Enter nový řádek, Odkázat případ vloží #P-. */
export function TeamComposer({ room, withId }: { room: string; withId: string }) {
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const insertRef = () => {
    const el = area.current;
    if (!el) return;
    const at = el.selectionStart ?? el.value.length;
    const pre = el.value.slice(0, at);
    el.value = `${pre}${pre && !pre.endsWith(' ') ? ' ' : ''}#P-${el.value.slice(at)}`;
    el.focus();
    el.selectionStart = el.selectionEnd = at + (pre && !pre.endsWith(' ') ? 4 : 3);
  };
  return (
    <form ref={form} action={sendTeamMessage} className={styles.chatForm}>
      <input type="hidden" name="room" value={room} />
      <input type="hidden" name="with" value={withId} />
      <textarea ref={area} className={styles.input} name="body" rows={2} maxLength={2000} required
        placeholder="Napište zprávu týmu… (@jméno, #P-0128)" aria-label="Zpráva"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.current?.requestSubmit(); } }} />
      <div className={styles.row}>
        <Button variant="secondary" onClick={insertRef}>Odkázat případ</Button>
        <span style={{ flex: 1 }} />
        <Button type="submit">Odeslat</Button>
      </div>
    </form>
  );
}
