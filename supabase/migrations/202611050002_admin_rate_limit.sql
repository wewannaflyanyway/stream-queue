-- Shared, database-backed PIN throttling for admin routes.
begin;
create table public.admin_auth_failures (client_hash text primary key, failures integer not null, window_started timestamptz not null);
create index admin_auth_failures_window on public.admin_auth_failures(window_started);
alter table public.admin_auth_failures enable row level security;
revoke all on public.admin_auth_failures from public, anon, authenticated;
grant all on public.admin_auth_failures to service_role;
create function public.admin_auth_gate(p_client text, p_success boolean) returns boolean
language plpgsql security definer set search_path=public as $$
declare attempts admin_auth_failures;
begin
  if p_client is null or length(p_client) <> 64 or p_success is null then return false; end if;
  if not p_success then delete from admin_auth_failures where window_started < clock_timestamp()-interval '1 day'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client, 37365));
  select * into attempts from admin_auth_failures where client_hash=p_client for update;
  if attempts.client_hash is not null and attempts.window_started < clock_timestamp()-interval '15 minutes' then
    delete from admin_auth_failures where client_hash=p_client;
    attempts := null;
  end if;
  if attempts.failures >= 8 then return false; end if;
  if p_success then
    delete from admin_auth_failures where client_hash=p_client;
    return true;
  end if;
  insert into admin_auth_failures(client_hash,failures,window_started) values(p_client,1,clock_timestamp())
    on conflict(client_hash) do update set failures=admin_auth_failures.failures+1;
  return false;
end;
$$;
revoke all on function public.admin_auth_gate(text,boolean) from public, anon, authenticated;
grant execute on function public.admin_auth_gate(text,boolean) to service_role;
commit;
