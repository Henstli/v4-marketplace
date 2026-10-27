-- Inzertní platforma: objednávka je žádost, kterou prodejce potvrdí. Platí se přímo prodejci, ne přes V4cards.
-- Nové stavy jsou v samostatné migraci, protože hodnotu výčtu nejde použít ve stejné transakci, ve které vznikla.
alter type public.order_status add value if not exists 'requested' before 'pending_payment';
alter type public.order_status add value if not exists 'confirmed' after 'requested';
alter type public.order_status add value if not exists 'declined';
alter type public.order_status add value if not exists 'expired';
