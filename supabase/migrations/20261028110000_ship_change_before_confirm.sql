-- Úprava dopravy už před potvrzením objednávky (Šimon 27. 10., DS DeliveryPayment varianta B + 2).
-- Nižší cena platí hned, vyšší čeká na souhlas kupujícího a platí i po potvrzení: do souhlasu kupující nevidí QR.
-- Kupující může změnu odsouhlasit nebo objednávku zrušit už před potvrzením.

create or replace function public.change_order_shipping(target uuid, p_price int, p_reason text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  r public.carrier_rates;
  v_reason text := nullif(left(trim(p_reason), 200), '');
  v_cap int;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.seller_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status not in ('requested', 'confirmed') or o.delivery <> 'ship' or o.buyer_paid_at is not null then
    raise exception 'Dopravu jde upravit jen před zaplacením';
  end if;
  if o.status = 'requested' and o.expires_at < now() then raise exception 'Na objednávku už vypršel čas'; end if;
  if p_price is null or p_price < 0 or p_price > 1000 then raise exception 'Cena dopravy musí být 0 až 1 000 Kč'; end if;
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'Napište kupujícímu důvod'; end if;
  if p_price = o.shipping_czk then
    -- návrat na původní cenu = zrušení čekající změny
    if o.ship_change_czk is null then raise exception 'Cena dopravy je stejná'; end if;
    update public.orders set ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
      'Prodejce vzal zpět změnu dopravy u objednávky č. ' || o.number, o.id);
    return;
  end if;

  if p_price < o.shipping_czk then
    update public.orders set total_czk = total_czk - (shipping_czk - p_price), shipping_czk = p_price,
      ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
      'Prodejce snížil dopravu u objednávky č. ' || o.number || ': ' || o.shipping_czk || ' → ' || p_price || ' Kč · ' || v_reason, o.id);
    return;
  end if;

  select * into r from public.carrier_rates where carrier = o.carrier;
  if found then
    v_cap := greatest(r.heavy_czk, r.price_czk) + public.shipping_packing_czk();
    if p_price > v_cap then
      raise exception 'Nejvýš % Kč (ceník větší zásilky % Kč + % Kč balné)', v_cap, greatest(r.heavy_czk, r.price_czk), public.shipping_packing_czk();
    end if;
  end if;
  update public.orders set ship_change_czk = p_price, ship_change_reason = v_reason where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
    'Prodejce změnil dopravu u objednávky č. ' || o.number || ': ' || o.shipping_czk || ' → ' || p_price || ' Kč · ' || v_reason, o.id);
end;
$$;

create or replace function public.answer_shipping_change(target uuid, p_accept boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status not in ('requested', 'confirmed') or o.ship_change_czk is null then raise exception 'Změna dopravy už neplatí'; end if;
  if p_accept then
    update public.orders set total_czk = total_czk + (ship_change_czk - shipping_czk), shipping_czk = ship_change_czk,
      ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující souhlasil se změnou dopravy u objednávky č. ' || o.number, o.id);
  else
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující nesouhlasil se změnou dopravy u objednávky č. ' || o.number, o.id);
    update public.orders set status = 'cancelled', ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.release_order_items(target);
  end if;
end;
$$;
