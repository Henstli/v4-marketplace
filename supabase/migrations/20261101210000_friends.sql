-- Přátelé (deska P5, Společní přátelé / Zkušenosti přátel): žádost, přijetí, odmítnutí, odebrání.
-- Jeden řádek na dvojici: requester poslal žádost addressee; accepted_at = jsou přátelé.

create table if not exists public.friendships (
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair_idx on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);

alter table public.friendships enable row level security;
create policy friendships_read on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
grant select on public.friendships to authenticated;

-- Stav vztahu s druhým uživatelem: none, outgoing (čeká na něj), incoming (čeká na mě), friends.
create or replace function public.friend_status(p_other uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when f.accepted_at is not null then 'friends'
                when f.requester = auth.uid() then 'outgoing' else 'incoming' end
    from public.friendships f
    where (f.requester = auth.uid() and f.addressee = p_other) or (f.requester = p_other and f.addressee = auth.uid())
  ), 'none');
$$;

-- Přidat přítele: pošle žádost, nebo přijme jeho žádost, pokud už nějakou poslal.
create or replace function public.friend_request(p_other uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Nepřihlášen' using errcode = '42501'; end if;
  if p_other = me then raise exception 'Sám sebe přidat nejde'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'Uživatel neexistuje'; end if;
  update public.friendships set accepted_at = now()
    where requester = p_other and addressee = me and accepted_at is null;
  if found then return 'friends'; end if;
  insert into public.friendships (requester, addressee) values (me, p_other) on conflict do nothing;
  return public.friend_status(p_other);
end $$;

-- Odpověď na žádost: přijmout, nebo odmítnout (žádost zmizí).
create or replace function public.friend_respond(p_other uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Nepřihlášen' using errcode = '42501'; end if;
  if p_accept then
    update public.friendships set accepted_at = now() where requester = p_other and addressee = me and accepted_at is null;
  else
    delete from public.friendships where requester = p_other and addressee = me and accepted_at is null;
  end if;
  return public.friend_status(p_other);
end $$;

-- Zrušit vlastní žádost nebo odebrat z přátel.
create or replace function public.friend_remove(p_other uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Nepřihlášen' using errcode = '42501'; end if;
  delete from public.friendships
    where (requester = me and addressee = p_other) or (requester = p_other and addressee = me);
  return 'none';
end $$;

-- Přátelé na podložce profilu p_profile pro přihlášeného diváka (nejvýš 8):
-- obchod: diváckovi přátelé (u vlastního obchodu přátelé majitele), kteří v obchodě nakoupili;
-- sběratel: společní přátelé diváka a majitele (u vlastního profilu všichni přátelé).
-- U každého počet obchodů s majitelem a poslední hodnocení mezi nimi.
create or replace function public.profile_friends(p_profile uuid)
returns table (id uuid, trades int, rating int, comment text, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  shop boolean;
begin
  if me is null then return; end if;
  select (p.kind = 'shop') into shop from public.profiles p where p.id = p_profile;
  return query
  with mine as (
    select case when f.requester = me then f.addressee else f.requester end as fid, f.accepted_at
    from public.friendships f
    where f.accepted_at is not null and (f.requester = me or f.addressee = me)
  ), theirs as (
    select case when f.requester = p_profile then f.addressee else f.requester end as fid
    from public.friendships f
    where f.accepted_at is not null and (f.requester = p_profile or f.addressee = p_profile)
  ), pool as (
    select m.fid, m.accepted_at from mine m
    where m.fid <> p_profile
      and (me = p_profile or coalesce(shop, false) or m.fid in (select t.fid from theirs t))
  ), stats as (
    select p.fid, p.accepted_at,
      (select count(*)::int from public.orders o where o.status = 'delivered' and (
         case when coalesce(shop, false) then o.buyer_id = p.fid and o.seller_id = p_profile
              else (o.buyer_id = p.fid and o.seller_id = p_profile) or (o.buyer_id = p_profile and o.seller_id = p.fid) end)) as trades
    from pool p
  )
  select s.fid, s.trades, r.rating::int, r.comment, s.accepted_at
  from stats s
  left join lateral (
    select rv.rating, nullif(btrim(rv.comment), '') as comment
    from public.reviews rv join public.orders o on o.id = rv.order_id
    where rv.hidden_at is null and (
      (o.buyer_id = s.fid and o.seller_id = p_profile) or (not coalesce(shop, false) and o.buyer_id = p_profile and o.seller_id = s.fid))
    order by rv.created_at desc limit 1
  ) r on true
  where not coalesce(shop, false) or s.trades > 0
  order by s.trades desc, s.accepted_at desc
  limit 8;
end $$;

-- Žádosti o přátelství, které čekají na mě (pro vlastní podložku a tečku v menu).
create or replace function public.friend_requests()
returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.requester, f.created_at from public.friendships f
  where f.addressee = auth.uid() and f.accepted_at is null
  order by f.created_at desc limit 20;
$$;

grant execute on function public.friend_status(uuid), public.friend_request(uuid), public.friend_respond(uuid, boolean),
  public.friend_remove(uuid), public.profile_friends(uuid), public.friend_requests() to authenticated;
