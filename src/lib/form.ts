import { startTransition, type FormEvent } from 'react';

/**
 * Odeslání formuláře bez automatického vymazání polí.
 * React po akci předané přes `<form action>` formulář vždy vrátí na výchozí hodnoty,
 * takže při chybě (např. strop ceny dopravy) zmizí vše, co člověk vyplnil.
 */
export function keepForm(action: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(form));
  };
}
