'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { SearchField, SearchSuggest, type SearchSuggestItem } from '@/components/trezor';
import type { Suggestion } from '@/lib/catalog';
import { getGame, type GameId } from '@/lib/games';
import { thumbUrl } from '@/lib/images';

export interface SearchBoxProps {
  placeholder: string;
  label: string;
  defaultValue?: string;
  /** Návrhy jen z jedné hry (filtr katalogu) */
  game?: GameId;
  /** Další parametry katalogu, které hledání zachová (filtry) */
  keep?: Record<string, string>;
  /** Klávesa „/“ skočí do pole odkudkoli na stránce (jen jedno pole na stránce, v hlavičce) */
  shortcut?: boolean;
  className?: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 150;

function fold(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function toItem(s: Suggestion): SearchSuggestItem {
  return {
    href: `/karty/${s.slug}`,
    name: s.name,
    set: s.setName,
    number: s.number,
    dot: getGame(s.game)?.dot,
    color: `var(--game-${s.game}-art, var(--surface-sunken))`,
    image: thumbUrl(s.image),
    price: s.minPrice,
  };
}

// Vyhledávací pole s našeptávačem: při psaní ukáže pár nejpodobnějších karet (vzor combobox).
// Bez JavaScriptu zůstává obyčejný formulář, který hledá v katalogu.
export function SearchBox({ placeholder, label, defaultValue = '', game, keep, shortcut, className }: SearchBoxProps) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, SearchSuggestItem[]>());
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Návrhy a dotaz, ke kterému patří. Během načítání zůstávají předchozí, ať nic neproblikává.
  const [result, setResult] = useState<{ q: string; items: SearchSuggestItem[] } | null>(null);

  const q = value.trim();
  const key = `${game ?? ''}|${fold(q)}`;
  const enough = fold(q).length >= MIN_CHARS;

  useEffect(() => {
    if (!enough) {
      setResult(null);
      return;
    }
    const cached = cache.current.get(key);
    if (cached) {
      setResult({ q, items: cached });
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q });
      if (game) params.set('hra', game);
      try {
        const res = await fetch(`/api/naseptavac?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const items = ((await res.json()) as Suggestion[]).map(toItem);
        cache.current.set(key, items);
        setResult({ q, items });
      } catch {
        // Zrušený nebo neúspěšný dotaz: zůstanou předchozí návrhy, hledání formulářem funguje dál.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // q se mění spolu s key, stačí sledovat key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enough, game]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const allParams = new URLSearchParams({ ...keep, q });
  const allHref = `/karty?${allParams}`;
  const items = result?.items ?? [];
  // Prázdný stav jen tehdy, když opravdu přišla odpověď pro to, co je v poli.
  const show = open && enough && result !== null && (items.length > 0 || fold(result.q) === fold(q));
  const count = items.length + 1;

  function go(href: string) {
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
    router.push(href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!show) {
        setOpen(true);
        return;
      }
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a < 0 && step < 0 ? count - 1 : (a + step + count) % count));
    } else if (e.key === 'Enter') {
      if (show && active >= 0 && active < items.length) {
        e.preventDefault();
        go(items[active].href);
      } else {
        // Bez vybrané karty odešle formulář a hledá v katalogu.
        setOpen(false);
      }
    } else if (e.key === 'Escape' && show) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <form action="/karty" role="search" className={className} onSubmit={() => setOpen(false)}>
      {keep ? Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      <div className="tz-suggest-wrap">
        <SearchField
          ref={inputRef}
          name="q"
          value={value}
          placeholder={placeholder}
          label={label}
          shortcut={shortcut ? '/' : undefined}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={show}
          aria-controls={listId}
          aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => {
            setValue(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
        />
        {show ? (
          <SearchSuggest
            id={listId}
            query={q}
            items={items}
            activeIndex={active}
            allHref={allHref}
            onSelect={(href, e) => {
              e.preventDefault();
              go(href);
            }}
          />
        ) : null}
      </div>
    </form>
  );
}
