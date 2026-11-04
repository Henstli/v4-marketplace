-- Katalog a úvodní stránka: když je databáze (Nano) chvíli přetížená, první dotaz na novém spojení trvá i přes 3 s
-- a výchozí limit pro nepřihlášené (anon 3 s) stránku shodil. Delší limit jen pro tyto čtecí funkce
-- (PostgREST ho u RPC použije), pro ostatní dotazy zůstává 3 s.
alter function public.search_catalog(text, text, text, text, text, text, boolean, integer, integer, uuid, uuid) set statement_timeout = '10s';
alter function public.suggest_cards(text, text, integer) set statement_timeout = '8s';
