-- Kupující u „Zaplaceno“ řekne, jak platil (Šimon 28. 10.): prodejce s víc způsoby ví, kde platbu hledat.
-- Jen informace od kupujícího, V4cards platbu neověřuje.

alter table public.orders add column paid_via text check (paid_via in ('bank', 'paypal', 'revolut'));

create or replace function public.mark_order_paid_via(target uuid, p_via text) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  v_bank boolean;
  v_paypal boolean;
  v_revolut boolean;
  v_via text := nullif(p_via, '');
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.buyer_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or coalesce(o.payment, 'transfer') <> 'transfer' or o.ship_change_czk is not null then
    raise exception 'Tuto změnu stavu nelze provést';
  end if;
  if o.buyer_paid_at is not null then return; end if;
  select coalesce(pr.pay_transfer, false) and exists (select 1 from public.seller_payment a where a.user_id = o.seller_id),
    coalesce(x.paypal_me is not null, false), coalesce(x.revtag is not null, false)
    into v_bank, v_paypal, v_revolut
  from public.profiles pr left join public.seller_payment_apps x on x.user_id = pr.id
  where pr.id = o.seller_id;
  -- jediný způsob se doplní sám, u víc způsobů musí kupující vybrat
  if v_via is null then
    if v_bank::int + v_paypal::int + v_revolut::int > 1 then raise exception 'Vyberte, jak jste zaplatili'; end if;
    v_via := case when v_paypal then 'paypal' when v_revolut then 'revolut' when v_bank then 'bank' end;
  elsif not ((v_via = 'bank' and v_bank) or (v_via = 'paypal' and v_paypal) or (v_via = 'revolut' and v_revolut)) then
    raise exception 'Tento způsob platby prodejce nenabízí';
  end if;
  update public.orders set buyer_paid_at = now(), paid_via = v_via where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.buyer_id, 'status',
    'Kupující zaplatil objednávku č. ' || o.number
      || coalesce(' přes ' || case v_via when 'bank' then 'převod' when 'paypal' then 'PayPal' when 'revolut' then 'Revolut' end, ''), o.id);
end;
$$;
revoke execute on function public.mark_order_paid_via(uuid, text) from public, anon;
grant execute on function public.mark_order_paid_via(uuid, text) to authenticated;

-- Nepřišla: kupující platí znovu a znovu vybere způsob.
create or replace function public.payment_not_received(target uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  if not public.mfa_ok() then raise exception 'Dokončete dvoufázové ověření'; end if;
  select * into o from public.orders where id = target for update;
  if not found or o.seller_id is distinct from auth.uid() then raise exception 'Objednávka neexistuje'; end if;
  if o.status <> 'confirmed' or o.buyer_paid_at is null then raise exception 'Tuto změnu stavu nelze provést'; end if;
  update public.orders set buyer_paid_at = null, paid_via = null where id = target;
  perform public.post_message(public.conversation_for(o.buyer_id, o.seller_id), o.seller_id, 'status',
    'Prodejce zatím nevidí platbu za objednávku č. ' || o.number, o.id);
end;
$$;
