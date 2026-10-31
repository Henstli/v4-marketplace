-- Název alba až 60 znaků (na deskách se dlouhý název zmenší nebo zkrátí na tři tečky)
alter table public.collection_albums drop constraint collection_albums_name_check;
alter table public.collection_albums add constraint collection_albums_name_check check (char_length(btrim(name)) between 1 and 60);
