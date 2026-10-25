-- Katalogy Riftbound, Lorcana, One Piece a Cyberpunk (import-catalog je stahuje stejně jako Pokémon a Magic).
-- Obrázky Cyberpunku mají u zdroje podepsané odkazy, které po pár dnech vyprší, proto je funkce kopíruje sem.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

update public.games set live = true where id in ('riftbound', 'lorcana', 'onepiece', 'cyberpunk');
