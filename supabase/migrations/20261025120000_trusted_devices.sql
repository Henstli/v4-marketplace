-- Přihlášení z nového zařízení: po hesle ještě kód z e-mailu. Zařízení, kde člověk kód zadal
-- (nebo klikl na odkaz z e-mailu), si pamatujeme podle náhodného tokenu v cookie; ukládáme jen jeho otisk.

create table public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (user_id, token_hash)
);
alter table public.trusted_devices enable row level security;
create policy "vlastní zařízení" on public.trusted_devices for select to authenticated using (user_id = auth.uid());

-- Ověřil se člověk v posledních 15 minutách kódem nebo odkazem z e-mailu?
create or replace function public.recent_email_proof() returns boolean
  language sql stable set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
    where a->>'method' in ('otp', 'recovery', 'magiclink', 'email/signup', 'email_change')
      and (a->>'timestamp')::bigint > extract(epoch from now()) - 900
  );
$$;

create or replace function public.is_trusted_device(token text) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  hit boolean;
begin
  if auth.uid() is null or coalesce(token, '') = '' then return false; end if;
  update public.trusted_devices set last_used_at = now()
    where user_id = auth.uid() and token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    returning true into hit;
  return coalesce(hit, false);
end;
$$;

create or replace function public.trust_device(token text, device_label text default null) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Nejste přihlášeni'; end if;
  if length(coalesce(token, '')) < 32 then raise exception 'Neplatné zařízení'; end if;
  if not public.recent_email_proof() then raise exception 'Nejdřív zadejte kód z e-mailu'; end if;
  insert into public.trusted_devices (user_id, token_hash, label)
    values (auth.uid(), encode(extensions.digest(token, 'sha256'), 'hex'), left(device_label, 200))
    on conflict (user_id, token_hash) do update set last_used_at = now();
end;
$$;

-- Kontrola současného hesla před citlivou změnou (změna e-mailu).
create or replace function public.verify_current_password(current_password text) returns boolean
  language plpgsql stable security definer set search_path = '' as $$
declare
  hash text;
begin
  select coalesce(encrypted_password, '') into hash from auth.users where id = auth.uid();
  if coalesce(hash, '') = '' or coalesce(current_password, '') = '' then return false; end if;
  return extensions.crypt(current_password, hash) = hash;
end;
$$;

-- Uvítací e-mail: vrátí true jen poprvé, takže se pošle jednou.
-- Stávající účty dostanou dnešní datum, uvítání už nepotřebují.
alter table public.profiles add column welcome_sent_at timestamptz default now();
alter table public.profiles alter column welcome_sent_at drop default;

create or replace function public.claim_welcome_email() returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  hit boolean;
begin
  update public.profiles set welcome_sent_at = now()
    where id = auth.uid() and welcome_sent_at is null
    returning true into hit;
  return coalesce(hit, false);
end;
$$;

revoke execute on function public.recent_email_proof(), public.is_trusted_device(text), public.trust_device(text, text),
  public.verify_current_password(text), public.claim_welcome_email() from public, anon;
grant execute on function public.recent_email_proof(), public.is_trusted_device(text), public.trust_device(text, text),
  public.verify_current_password(text), public.claim_welcome_email() to authenticated;
