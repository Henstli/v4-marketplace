-- Přestavba Objednávek (DS Orders, Šimon 1. 11. 2026):
-- důvod odmítnutí objednávky a zrušení potvrzené nezaplacené objednávky kupujícím.

alter table public.orders add column if not exists decline_reason text
  check (decline_reason is null or char_length(decline_reason) <= 200);

-- Prodejce odmítne objednávku s důvodem pro kupujícího (DS Orders › Odmítnout).
create or replace function public.decline_order(target uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is not null and char_length(v_reason) > 200 then raise exception 'Důvod může mít nejvýš 200 znaků'; end if;
  update public.orders set decline_reason = v_reason
    where id = target and seller_id = auth.uid() and status = 'requested';
  perform public.set_order_status(target, 'declined');
end;
$$;
revoke all on function public.decline_order(uuid, text) from public, anon;
grant execute on function public.decline_order(uuid, text) to authenticated;

-- Zpráva v chatu při odmítnutí ukáže i důvod, zrušení kupujícím po potvrzení se pozná.
create or replace function public.order_chat_event()
 returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_conv uuid;
  v_body text;
begin
  if new.buyer_id is null or new.seller_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_conv := public.conversation_for(new.buyer_id, new.seller_id);
    perform public.post_message(v_conv, new.buyer_id, 'order', 'Nová objednávka č. ' || new.number, new.id);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  v_body := case new.status::text
    when 'confirmed' then case when auth.uid() = new.buyer_id
      then 'Kupující souhlasil se změnou dopravy, potvrzena objednávka č. ' else 'Prodejce potvrdil objednávku č. ' end
    when 'declined' then 'Prodejce odmítl objednávku č. '
    when 'expired' then 'Vypršela nepotvrzená objednávka č. '
    when 'cancelled' then case when auth.uid() = new.buyer_id and old.status = 'confirmed'
      then 'Kupující zrušil objednávku č. ' else 'Zrušena objednávka č. ' end
    when 'paid' then 'Prodejce potvrdil platbu za objednávku č. '
    when 'shipped' then 'Prodejce odeslal objednávku č. '
    when 'delivered' then case when new.delivery = 'pickup' then 'Předána objednávka č. ' else 'Kupující převzal objednávku č. ' end
    else null end;
  if v_body is null then return new; end if;
  v_body := v_body || new.number;
  if new.status = 'declined' and new.decline_reason is not null then
    v_body := v_body || ': „' || new.decline_reason || '“';
  end if;
  v_conv := public.conversation_for(new.buyer_id, new.seller_id);
  perform public.post_message(v_conv, auth.uid(), 'status', v_body, new.id);
  return new;
end;
$function$;

-- Kupující smí zrušit i potvrzenou objednávku, dokud neklikl Zaplaceno (Šimon 1. 11.).
create or replace function public.set_order_status(target uuid, next_status order_status)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  o public.orders;
  me uuid := auth.uid();
  pay text;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found then raise exception 'Objednávka neexistuje'; end if;
  pay := coalesce(o.payment, 'transfer');

  if o.seller_id = me and o.status = 'requested' and next_status in ('confirmed', 'declined') then
    if o.expires_at < now() then raise exception 'Na objednávku už vypršel čas'; end if;
    update public.orders set status = next_status, decided_at = now() where id = target;
    if next_status = 'declined' then perform public.release_order_items(target); end if;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'paid' and pay = 'transfer' and o.buyer_paid_at is not null then
    update public.orders set status = 'paid', cancel_request_at = null where id = target;
  elsif o.seller_id = me and o.delivery = 'ship' and next_status = 'shipped'
      and ((o.status = 'paid' and pay = 'transfer') or (o.status = 'confirmed' and pay = 'cod')) then
    update public.orders set status = 'shipped' where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'delivered' and o.delivery = 'pickup' and pay = 'cash' then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'cancelled' then
    if o.buyer_paid_at is not null and now() < public.order_cancel_from(o) then
      raise exception 'Zrušit půjde až po čekací době, nebo se souhlasem kupujícího';
    end if;
    update public.orders set status = 'cancelled', cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and next_status = 'cancelled'
      and (o.status = 'requested' or (o.status = 'confirmed' and o.buyer_paid_at is null)) then
    update public.orders set status = 'cancelled', cancel_request_at = null where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and next_status = 'delivered'
      and (o.status = 'shipped' or (o.status = 'paid' and o.delivery = 'pickup')) then
    update public.orders set status = 'delivered', delivered_at = now() where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$function$;
