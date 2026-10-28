-- Žádost o zrušení jen jednou (Šimon 28. 10.): po Nesouhlasím už prodejce znovu žádat nemůže,
-- jen počkat na konec čekací doby a zrušit. Žádat jde až po Nepřišla.
alter table public.orders add column cancel_rejected_at timestamptz;

create or replace function public.request_order_cancel(target uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.seller_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.buyer_paid_at is null or o.not_received_at is null or o.cancel_request_at is not null then
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
  if o.cancel_rejected_at is not null then raise exception 'Kupující už se zrušením nesouhlasil, zrušit půjde po čekací době'; end if;
  update public.orders set cancel_request_at = now() where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
    'Prodejce nenašel platbu a žádá o zrušení objednávky č. ' || o.number, o.id);
end;
$$;

create or replace function public.answer_cancel_request(target uuid, p_accept boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.cancel_request_at is null then raise exception 'Tuto změnu stavu nelze provést'; end if;
  if p_accept then
    -- řádek do chatu napíše order_chat_event
    update public.orders set status = 'cancelled', cancel_agreed = true, cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  else
    update public.orders set cancel_request_at = null, cancel_rejected_at = now() where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující nesouhlasí se zrušením objednávky č. ' || o.number || ', platba podle něj odešla', o.id);
  end if;
end;
$$;

-- „Ještě jsem nezaplatil(a)“ začíná platbu znovu, takže i žádost o zrušení.
create or replace function public.answer_not_received(target uuid, p_sent boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.not_received_at is null then raise exception 'Tuto změnu stavu nelze provést'; end if;
  if p_sent then
    if o.buyer_insist_at is not null then return; end if;
    update public.orders set buyer_insist_at = now() where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující potvrdil, že platba za objednávku č. ' || o.number || ' odešla', o.id);
  else
    update public.orders set buyer_paid_at = null, paid_via = null, not_received_at = null,
      buyer_insist_at = null, cancel_request_at = null, cancel_rejected_at = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující ještě nezaplatil objednávku č. ' || o.number, o.id);
  end if;
end;
$$;
