-- Profil jako sběratelská karta (kolo 1): typová řádka, status, stav a odznak věrnosti.
-- Nic se nemaže ani nepřepisuje, jen přibývají sloupce, tabulka a funkce.
-- Aplikováno 1. 11. 2026 (bez revoke: konektor Supabase se na ně ptá a dotaz se nezobrazí;
-- touch_presence bez přihlášení nic nezapíše, ostatní funkce jsou veřejné záměrně).

-- Vzhled karty, který si nastaví každý sám. Kódy stylů a rámečků zná jen web (src/lib/profile-card.ts),
-- databáze hlídá jen délku, takže nové styly v kole 2 nepotřebují migraci.
alter table public.profiles
  add column card_style text check (char_length(card_style) <= 30),
  add column card_form text not null default 'm' check (card_form in ('m', 'f')),
  add column card_frame text not null default 'sklo' check (char_length(card_frame) <= 30),
  add column card_city text check (char_length(card_city) <= 40),
  add column status_text text check (char_length(status_text) <= 60),
  add column presence_mode text not null default 'auto' check (presence_mode in ('auto', 'dnd', 'hidden')),
  add column member_no int;

-- Číslo člena podle pořadí registrace (#0042), nové profily dostanou další číslo.
create sequence public.profiles_member_no_seq;
with ranked as (
  select id, row_number() over (order by created_at, id) as n from public.profiles
)
update public.profiles p set member_no = r.n from ranked r where r.id = p.id and p.member_no is null;
select setval('public.profiles_member_no_seq', greatest((select max(member_no) from public.profiles), 0) + 1, false);
alter table public.profiles alter column member_no set default nextval('public.profiles_member_no_seq');
alter sequence public.profiles_member_no_seq owned by public.profiles.member_no;
create unique index profiles_member_no_idx on public.profiles (member_no);

-- Od kdy má někdo nepřetržitě Plus nebo Pro (odznak věrnosti). Změna mezi Plus a Pro ho nemaže,
-- zrušení předplatného (smazání řádku) ano.
alter table public.subscriptions add column since timestamptz;
alter table public.subscriptions alter column since set default now();
update public.subscriptions set since = granted_at where since is null;
alter table public.subscriptions alter column since set not null;

-- Tarif a začátek předplatného pro veřejné karty. Tabulka subscriptions zůstává soukromá.
create or replace function public.seller_loyalty(p_ids uuid[])
returns table (user_id uuid, plan text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.plan, s.since from public.subscriptions s where s.user_id = any(p_ids[1:200]);
$$;
grant execute on function public.seller_loyalty(uuid[]) to anon, authenticated;

-- Stav Online: kdy byl kdo naposledy na webu. Tabulku nikdo nečte přímo, ven jde jen
-- online / offline / dnd, takže skrytý režim neprozradí, kdy tu kdo byl.
create table public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;

create or replace function public.touch_presence()
returns void
language sql security definer set search_path = '' as $$
  insert into public.user_presence (user_id, last_seen_at)
  select auth.uid(), now() where auth.uid() is not null
  on conflict (user_id) do update set last_seen_at = now()
    where public.user_presence.last_seen_at < now() - interval '60 seconds';
$$;
grant execute on function public.touch_presence() to authenticated;

create or replace function public.profile_presence(p_ids uuid[])
returns table (user_id uuid, presence text)
language sql stable security definer set search_path = '' as $$
  select p.id,
    case
      when p.presence_mode = 'hidden' then 'offline'
      when u.last_seen_at is null or u.last_seen_at < now() - interval '5 minutes' then 'offline'
      when p.presence_mode = 'dnd' then 'dnd'
      else 'online'
    end
  from public.profiles p left join public.user_presence u on u.user_id = p.id
  where p.id = any(p_ids[1:200]);
$$;
grant execute on function public.profile_presence(uuid[]) to anon, authenticated;
