-- Plánovač importu katalogů: každé 3 minuty jedna sada (nové sady, pak obnova starších než 7 dní),
-- jednou týdně kontrola nově vydaných sad. Heslo pro funkci je ve Vaultu jako import_secret.
create or replace function public.call_import_catalog(payload jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := 'https://gnlgdawkdcwbhwvaijon.supabase.co/functions/v1/import-catalog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-import-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'import_secret')
    ),
    body := payload,
    timeout_milliseconds := 150000
  );
$$;

revoke execute on function public.call_import_catalog(jsonb) from public, anon, authenticated;

select cron.schedule('import-catalog-next', '*/3 * * * *', $$select public.call_import_catalog('{"mode":"next"}')$$);
select cron.schedule('import-catalog-discover', '0 3 * * 1', $$select public.call_import_catalog('{"mode":"discover"}')$$);
