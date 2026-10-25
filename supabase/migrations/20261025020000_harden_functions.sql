-- Opravy podle bezpečnostního poradce Supabase.
alter function public.unaccent_immutable(text) set search_path = '';

-- Funkce pro trigger a automatické RLS nemají jít volat přes API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- rls_auto_enable vytváří Supabase, jen když je při založení projektu zapnuté automatické RLS.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
