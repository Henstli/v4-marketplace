-- Registrace heslem / Googlem a dvoufázové ověření (TOTP).

-- Profil: jméno z registračního formuláře, z Google účtu, jinak část e-mailu.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    split_part(new.email, '@', 1)
  ), 40));
  return new;
end;
$$;

-- Kdo si zapnul dvoufázové ověření, smí měnit data jen po jeho dokončení (aal2).
-- Web to hlídá přesměrováním, tohle je pojistka pro přímé volání API.
create or replace function public.mfa_ok() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

create policy "zápis po dvoufázovém ověření" on public.listings as restrictive for insert to authenticated with check (public.mfa_ok());
create policy "úprava po dvoufázovém ověření" on public.listings as restrictive for update to authenticated using (public.mfa_ok());
create policy "mazání po dvoufázovém ověření" on public.listings as restrictive for delete to authenticated using (public.mfa_ok());
create policy "úprava po dvoufázovém ověření" on public.profiles as restrictive for update to authenticated using (public.mfa_ok());
create policy "zápis po dvoufázovém ověření" on public.reviews as restrictive for insert to authenticated with check (public.mfa_ok());
create policy "zápis po dvoufázovém ověření" on public.card_submissions as restrictive for insert to authenticated with check (public.mfa_ok());

create or replace function public.place_order(items jsonb) returns setof uuid
  language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  item record;
  l public.listings;
  seller uuid;
  order_id uuid;
begin
  if buyer is null then raise exception 'Nejste přihlášeni'; end if;
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Košík je prázdný'; end if;

  create temp table _items (listing_id uuid, seller_id uuid, quantity int, price int) on commit drop;

  for item in select (e->>'listing_id')::uuid as listing_id, (e->>'quantity')::int as quantity from jsonb_array_elements(items) e loop
    select * into l from public.listings where id = item.listing_id for update;
    if not found then raise exception 'Nabídka už neexistuje'; end if;
    if l.seller_id = buyer then raise exception 'Nelze koupit vlastní nabídku'; end if;
    if item.quantity is null or item.quantity < 1 or item.quantity > l.quantity then
      raise exception 'Nabídka už nemá dost kusů';
    end if;
    update public.listings set quantity = quantity - item.quantity where id = l.id;
    insert into _items values (l.id, l.seller_id, item.quantity, l.price_czk);
  end loop;

  for seller in select distinct seller_id from _items loop
    insert into public.orders (buyer_id, seller_id, status, total_czk, shipping_czk)
    select buyer, seller, 'paid', sum(price * quantity) + public.shipping_per_seller(), public.shipping_per_seller()
    from _items where seller_id = seller
    returning id into order_id;
    insert into public.order_items (order_id, listing_id, quantity, price_czk)
    select order_id, listing_id, quantity, price from _items where seller_id = seller;
    return next order_id;
  end loop;
end;
$$;

create or replace function public.set_order_status(target uuid, next_status public.order_status) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found then raise exception 'Objednávka neexistuje'; end if;
  if next_status = 'shipped' and o.status = 'paid' and o.seller_id = auth.uid() then
    update public.orders set status = 'shipped' where id = target;
  elsif next_status = 'delivered' and o.status = 'shipped' and o.buyer_id = auth.uid() then
    update public.orders set status = 'delivered' where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$$;

create or replace function public.review_card_submission(target uuid, approve boolean, reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.card_submissions;
  set_title text;
  set_code text;
  new_set uuid;
  new_slug text;
  new_card uuid;
begin
  if not public.is_admin() then
    raise exception 'Schvalovat může jen správce';
  end if;
  if not public.mfa_ok() then
    raise exception 'Dokončete dvoufázové ověření';
  end if;
  select * into s from public.card_submissions where id = target for update;
  if not found then raise exception 'Návrh neexistuje'; end if;
  if s.status <> 'pending' then raise exception 'Návrh už je vyřízený'; end if;

  if not approve then
    update public.card_submissions
      set status = 'rejected', reject_reason = nullif(trim(reason), ''), reviewed_at = now(), reviewed_by = auth.uid()
      where id = target;
    return null;
  end if;

  set_title := concat_ws(' ', s.season, s.manufacturer, s.set_name);
  set_code := upper(left(regexp_replace(public.unaccent_immutable(set_title), '[^A-Za-z0-9]+', '', 'g'), 32));
  insert into public.card_sets (game_id, code, name)
    values (s.game_id, set_code, set_title)
    on conflict (game_id, code) do update set name = public.card_sets.name
    returning id into new_set;

  new_slug := trim(both '-' from lower(regexp_replace(
    public.unaccent_immutable(concat_ws('-', s.player, s.season, s.manufacturer, s.set_name, s.number, nullif(s.variant, ''))), '[^A-Za-z0-9]+', '-', 'g')));
  if exists (select 1 from public.cards where slug = new_slug) then
    new_slug := new_slug || '-' || left(s.id::text, 6);
  end if;

  insert into public.cards (set_id, slug, name, number, rarity, image_url)
    values (new_set, new_slug, s.player, s.number, coalesce(nullif(s.variant, ''), 'Base'),
            'https://gnlgdawkdcwbhwvaijon.supabase.co/storage/v1/object/public/card-submissions/' || s.image_path)
    returning id into new_card;

  update public.card_submissions
    set status = 'approved', card_id = new_card, reviewed_at = now(), reviewed_by = auth.uid()
    where id = target;
  return new_slug;
end;
$$;

create policy "fotka návrhu po dvoufázovém ověření" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'card-submissions' or public.mfa_ok());
