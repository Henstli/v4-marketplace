-- Souhlas kupujícího se změnou dopravy před potvrzením objednávku rovnou potvrdí (Šimon 28. 10.):
-- prodejce cenu navrhl sám, takže další potvrzení od něj není potřeba. Objednávka čeká na platbu.

create or replace function public.answer_shipping_change(target uuid, p_accept boolean) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status not in ('requested', 'confirmed') or o.ship_change_czk is null then raise exception 'Změna dopravy už neplatí'; end if;
  if o.status = 'requested' and o.expires_at < now() then raise exception 'Na objednávku už vypršel čas'; end if;
  if p_accept then
    update public.orders set total_czk = total_czk + (ship_change_czk - shipping_czk), shipping_czk = ship_change_czk,
      ship_change_czk = null, ship_change_reason = null where id = target;
    if o.status = 'requested' then
      -- řádek do chatu napíše order_chat_event
      update public.orders set status = 'confirmed', decided_at = now() where id = target;
    else
      perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
        'Kupující souhlasil se změnou dopravy u objednávky č. ' || o.number, o.id);
    end if;
  else
    perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
      'Kupující nesouhlasil se změnou dopravy u objednávky č. ' || o.number, o.id);
    update public.orders set status = 'cancelled', ship_change_czk = null, ship_change_reason = null where id = target;
    perform public.release_order_items(target);
  end if;
end;
$$;

create or replace function public.order_chat_event() returns trigger
  language plpgsql security definer set search_path = '' as $$
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
    when 'cancelled' then 'Zrušena objednávka č. '
    when 'paid' then 'Prodejce potvrdil platbu za objednávku č. '
    when 'shipped' then 'Prodejce odeslal objednávku č. '
    when 'delivered' then case when new.delivery = 'pickup' then 'Předána objednávka č. ' else 'Kupující převzal objednávku č. ' end
    else null end;
  if v_body is null then return new; end if;
  v_conv := public.conversation_for(new.buyer_id, new.seller_id);
  perform public.post_message(v_conv, auth.uid(), 'status', v_body || new.number, new.id);
  return new;
end;
$$;
