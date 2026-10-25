-- Smazání účtu: objednávky a hodnocení zůstanou (kvůli účetnictví a historii druhé strany),
-- jen ztratí odkaz na smazaný profil. Dřív smazání uživatele s objednávkou spadlo na orders_buyer_id_fkey.

-- Položka objednávky si pamatuje kartu a stav sama, protože nabídka zmizí spolu s prodejcem.
alter table public.order_items
  add column card_id uuid references public.cards(id),
  add column condition public.card_condition;

update public.order_items i set card_id = l.card_id, condition = l.condition
from public.listings l where l.id = i.listing_id;

create or replace function public.order_items_snapshot() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.card_id is null or new.condition is null then
    select coalesce(new.card_id, l.card_id), coalesce(new.condition, l.condition)
      into new.card_id, new.condition
    from public.listings l where l.id = new.listing_id;
  end if;
  return new;
end;
$$;

create trigger order_items_snapshot before insert on public.order_items
  for each row execute function public.order_items_snapshot();

-- Odkazy na smazaný profil se vynulují místo zablokování mazání.
alter table public.orders alter column buyer_id drop not null, alter column seller_id drop not null;
alter table public.orders
  drop constraint orders_buyer_id_fkey,
  add constraint orders_buyer_id_fkey foreign key (buyer_id) references public.profiles(id) on delete set null,
  drop constraint orders_seller_id_fkey,
  add constraint orders_seller_id_fkey foreign key (seller_id) references public.profiles(id) on delete set null;

alter table public.order_items alter column listing_id drop not null;
alter table public.order_items
  drop constraint order_items_listing_id_fkey,
  add constraint order_items_listing_id_fkey foreign key (listing_id) references public.listings(id) on delete set null;

alter table public.reviews alter column seller_id drop not null;
alter table public.reviews
  drop constraint reviews_seller_id_fkey,
  add constraint reviews_seller_id_fkey foreign key (seller_id) references public.profiles(id) on delete set null;

alter table public.card_submissions
  drop constraint card_submissions_reviewed_by_fkey,
  add constraint card_submissions_reviewed_by_fkey foreign key (reviewed_by) references auth.users(id) on delete set null;
