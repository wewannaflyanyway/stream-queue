-- Apply only after the application version using /api/viewer/config and
-- authenticated /api/admin read_data has been deployed and checked.
begin;
alter table public.song_requests enable row level security;
alter table public.stream_settings enable row level security;
revoke all on public.song_requests, public.stream_settings from public, anon, authenticated;
grant all on public.song_requests, public.stream_settings to service_role;
commit;
