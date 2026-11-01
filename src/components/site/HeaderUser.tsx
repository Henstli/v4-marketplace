'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/trezor';
import { AccountMenu } from '@/components/account/AccountNav';
import { MessagesLink } from '@/components/messages/MessagesLink';
import { CartLink } from '@/components/cart/CartLink';
import { HeaderIcon } from './HeaderIcon';
import { createClient } from '@/lib/supabase/browser';
import type { AccountSummary } from '@/lib/account';
import { loadAccountSummary } from './header-actions';
import { HeaderAccountPlaceholder } from './HeaderAccountPlaceholder';
import { PresencePing } from '@/components/profile/PresencePing';

/** Souhrn účtu se znovu načte nejdřív po minutě (počty v menu), přihlášení se kontroluje při každém přechodu. */
const SUMMARY_TTL = 60_000;

type State = { kind: 'unknown' } | { kind: 'out'; mfa: boolean } | { kind: 'in'; a: AccountSummary };

/**
 * Zprávy, košík a Můj profil v hlavičce. Načítají se až v prohlížeči, aby server posílal stejnou
 * hlavičku všem a veřejné stránky šly z mezipaměti (nic osobního se do ní nedostane).
 */
export function HeaderUser() {
  const [state, setState] = useState<State>({ kind: 'unknown' });
  const pathname = usePathname();
  const loaded = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      if (!session) {
        loaded.current = null;
        setState({ kind: 'out', mfa: false });
        return;
      }
      // Heslo zadané, kód z aplikace ještě ne: jako nepřihlášený, Přihlásit vede na druhý krok.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!alive) return;
      if (aal?.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
        loaded.current = null;
        setState({ kind: 'out', mfa: true });
        return;
      }
      const prev = loaded.current;
      if (prev && prev.id === session.user.id && Date.now() - prev.at < SUMMARY_TTL) return;
      const a = await loadAccountSummary().catch(() => null);
      if (!alive) return;
      loaded.current = a ? { id: a.id, at: Date.now() } : null;
      setState(a ? { kind: 'in', a } : { kind: 'out', mfa: false });
    })();
    return () => { alive = false; };
  }, [pathname]);

  return (
    <>
      {state.kind === 'in' ? <PresencePing /> : null}
      {state.kind === 'in' ? <HeaderIcon href="/kolekce" icon="album" label="Moje kolekce" count={0} current={pathname.startsWith('/kolekce')} /> : null}
      {state.kind === 'in' ? <MessagesLink initial={0} /> : null}
      <CartLink />
      {state.kind === 'in' ? (
        <AccountMenu a={state.a} />
      ) : state.kind === 'out' ? (
        <ButtonLink href={state.mfa ? '/prihlaseni/overeni' : '/prihlaseni'}>Přihlásit</ButtonLink>
      ) : (
        <HeaderAccountPlaceholder />
      )}
    </>
  );
}
