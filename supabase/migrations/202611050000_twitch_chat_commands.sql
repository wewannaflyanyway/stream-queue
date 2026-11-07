-- Additive setup for verified Twitch chat commands; disabled until enabled by the admin.
begin;
alter table public.song_requests add column sender_twitch_id text;
alter table public.stream_poll_twitch add column chat_write_granted boolean not null default false;
alter table public.stream_poll_twitch add column music_commands_enabled boolean not null default false;
create table public.music_chat_deliveries (message_id text primary key, received_at timestamptz not null default clock_timestamp());
create index music_chat_deliveries_received on public.music_chat_deliveries(received_at);
alter table public.music_chat_deliveries enable row level security;
revoke all on public.music_chat_deliveries from public, anon, authenticated;
grant all on public.music_chat_deliveries to service_role;
create function public.music_claim_chat_message(p_subscription text, p_broadcaster text, p_message text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if p_message is null or p_message='' or not exists(select 1 from stream_poll_twitch where id=1 and broadcaster_id=p_broadcaster and subscription_id=p_subscription and status='enabled' and music_commands_enabled and chat_write_granted) then return false; end if;
  delete from music_chat_deliveries where received_at < clock_timestamp() - interval '7 days';
  insert into music_chat_deliveries(message_id) values(p_message) on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.music_claim_chat_message(text,text,text) from public, anon, authenticated;
grant execute on function public.music_claim_chat_message(text,text,text) to service_role;
commit;
