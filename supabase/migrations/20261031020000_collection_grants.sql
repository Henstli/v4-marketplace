-- Oprava k migraci collection: projekt nemá výchozí oprávnění pro nové tabulky,
-- přihlášení proto nemohli zakládat alba ani vkládat karty. Řádky dál hlídá RLS (každý jen svoje).
grant select, insert, update, delete on public.collection_cards to authenticated;
grant select, insert, update, delete on public.collection_albums to authenticated;
grant select, insert, update, delete on public.collection_album_cards to authenticated;
