-- Rezervované nabídky na stránce karty: všechny kusy čekají v objednávce na potvrzení prodejce.
-- Veřejně se ukáže jen to, že je nabídka rezervovaná a do kdy (kdo objednal, zůstává skryté).
create or replace function public.reserved_offers(p_card uuid)
  returns table (listing_id uuid, until timestamptz)
  language sql stable security definer set search_path = '' as $$
  select l.id, max(o.expires_at)
  from public.listings l
  join public.order_items i on i.listing_id = l.id
  join public.orders o on o.id = i.order_id
  where l.card_id = p_card and l.quantity = 0 and o.status = 'requested'
  group by l.id;
$$;
revoke execute on function public.reserved_offers(uuid) from public;
grant execute on function public.reserved_offers(uuid) to anon, authenticated;
