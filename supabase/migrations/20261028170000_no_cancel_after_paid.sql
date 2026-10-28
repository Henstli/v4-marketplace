-- Po Zaplaceno od kupujícího prodejce objednávku nezruší; když platba nepřišla, nejdřív Nepřišla (Šimon 28. 10.).
create or replace function public.set_order_status(target uuid, next_status public.order_status) returns void
  language plpgsql security definer set search_path = '' as $$
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
  -- prodejce: platba přišla
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'paid' and pay = 'transfer' and o.buyer_paid_at is not null then
    update public.orders set status = 'paid' where id = target;
  -- prodejce: odesláno (po zaplacení, nebo rovnou u dobírky)
  elsif o.seller_id = me and o.delivery = 'ship' and next_status = 'shipped'
      and ((o.status = 'paid' and pay = 'transfer') or (o.status = 'confirmed' and pay = 'cod')) then
    update public.orders set status = 'shipped' where id = target;
  -- prodejce: předáno a zaplaceno hotově
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'delivered' and o.delivery = 'pickup' and pay = 'cash' then
    update public.orders set status = 'delivered' where id = target;
  elsif o.seller_id = me and o.status = 'confirmed' and next_status = 'cancelled' and o.buyer_paid_at is null then
    update public.orders set status = 'cancelled' where id = target;
    perform public.release_order_items(target);
  elsif o.buyer_id = me and o.status = 'requested' and next_status = 'cancelled' then
    update public.orders set status = 'cancelled' where id = target;
    perform public.release_order_items(target);
  -- kupující: převzato po odeslání, u osobního předání po zaplacení převodem
  elsif o.buyer_id = me and next_status = 'delivered'
      and (o.status = 'shipped' or (o.status = 'paid' and o.delivery = 'pickup')) then
    update public.orders set status = 'delivered' where id = target;
  else
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
end;
$$;
