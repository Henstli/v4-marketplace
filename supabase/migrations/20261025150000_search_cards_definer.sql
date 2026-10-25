-- search_cards jako security definer.
-- Pro roli anon (veřejný katalog) RLS na cards zakazovalo použít fulltextový index: operátor @@ není
-- „leakproof“, takže se hledání podle názvu vždy četlo sekvenčně přes všech 120 tisíc karet. Se studenou
-- pamětí to trvalo přes 3 s a PostgREST dotaz ukončil (statement timeout) → chyba stránky při hledání.
-- Funkce čte jen veřejná data katalogu a skryté karty vylučuje sama (not c.hidden), stejně jako RLS.
alter function public.search_cards(text, text, text, text, text, text, boolean, integer, integer) security definer;
