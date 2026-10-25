-- Katalogy Riftbound, Lorcana a One Piece (import-catalog je stahuje stejně jako Pokémon a Magic).
update public.games set live = true where id in ('riftbound', 'lorcana', 'onepiece');
