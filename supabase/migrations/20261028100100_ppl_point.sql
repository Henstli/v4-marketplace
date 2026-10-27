-- PPL výdejní místo a box jako samostatný dopravce (Šimon 27. 10. 2026). Kupující vybírá místo na mapě PPL.
alter table public.seller_shipping_methods drop constraint seller_shipping_methods_carrier_check;
alter table public.seller_shipping_methods add constraint seller_shipping_methods_carrier_check
  check (carrier in ('zasilkovna', 'zasilkovna_home', 'balikovna', 'cp_doruky', 'ppl', 'ppl_point', 'dpd', 'gls', 'letter', 'custom'));
alter table public.carrier_rates drop constraint carrier_rates_carrier_check;
alter table public.carrier_rates add constraint carrier_rates_carrier_check
  check (carrier in ('zasilkovna', 'zasilkovna_home', 'balikovna', 'cp_doruky', 'ppl', 'ppl_point', 'dpd', 'gls', 'letter'));

-- Orientační ceník k 27. 10. 2026, před spuštěním ověřit na ppl.cz.
insert into public.carrier_rates (carrier, name, price_czk, cod_fee_czk, heavy_czk) values
  ('ppl_point', 'PPL · výdejní místo a box', 99, 46, 149)
on conflict (carrier) do nothing;
update public.carrier_rates set name = 'PPL · na adresu' where carrier = 'ppl';
