-- Stream sessions are additive: previous requests remain in the database.
begin;
create table public.music_stream_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at timestamptz,
  twitch_stream_id text not null
);
create table public.music_stream_state (
  id integer primary key check (id = 1),
  automation_enabled boolean not null default false,
  manual_paused boolean not null default false,
  online boolean not null default false,
  session_id uuid references public.music_stream_sessions(id),
  offline_at timestamptz,
  last_event_at timestamptz,
  last_checked_at timestamptz,
  current_twitch_stream_id text,
  secret_fingerprint text,
  online_subscription_id text,
  offline_subscription_id text
);
insert into public.music_stream_state(id) values (1);
create table public.music_playback_observation (
  id integer primary key check (id = 1),
  session_id uuid references public.music_stream_sessions(id),
  current_uri text,
  request_id uuid,
  observed_at timestamptz
);
insert into public.music_playback_observation(id) values (1);
alter table public.song_requests add column stream_session_id uuid references public.music_stream_sessions(id);
alter table public.song_requests add column queued_at timestamptz;
alter table public.song_requests add column stream_history_hidden boolean not null default false;
alter table public.song_requests add column stream_pending_archived boolean not null default false;
create index song_requests_stream_session on public.song_requests(stream_session_id, created_at);
alter table public.music_stream_sessions enable row level security;
alter table public.music_stream_state enable row level security;
alter table public.music_playback_observation enable row level security;
revoke all on public.music_stream_sessions, public.music_stream_state, public.music_playback_observation from public, anon, authenticated;
grant all on public.music_stream_sessions, public.music_stream_state, public.music_playback_observation to service_role;

create function public.music_attach_session() returns trigger language plpgsql security definer set search_path=public as $$
declare s music_stream_state;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1;
  if s.automation_enabled and (not s.online or s.manual_paused or s.online_subscription_id is null or s.offline_subscription_id is null) then
    raise exception 'Прием заявок закрыт';
  end if;
  if new.stream_session_id is null then
    if s.online then new.stream_session_id := s.session_id; end if;
  end if;
  if new.status='approved' and new.queued_at is null then new.queued_at=clock_timestamp(); end if;
  return new;
end;
$$;
create trigger music_attach_session_on_insert before insert on public.song_requests for each row execute function public.music_attach_session();

create function public.music_stream_event(p_type text, p_event_at timestamptz, p_stream_id text default null, p_started_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s music_stream_state; session music_stream_sessions;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1 for update;
  if p_type not in ('online','offline') or p_event_at is null then raise exception 'Invalid stream event'; end if;
  if s.last_event_at is not null and p_event_at <= s.last_event_at then return to_jsonb(s); end if;
  if p_type='offline' then
    update music_stream_state set online=false,offline_at=case when online then p_event_at else coalesce(offline_at,p_event_at) end,last_event_at=p_event_at where id=1;
    if s.automation_enabled then update stream_settings set is_accepting=false where id=1; end if;
  else
    if p_stream_id is null or p_started_at is null then raise exception 'Invalid stream identity'; end if;
    select * into session from music_stream_sessions where id=s.session_id;
    if session.id is null or (not s.online and (s.offline_at is null or p_event_at > s.offline_at + interval '30 minutes'))
      or (s.online and session.twitch_stream_id <> p_stream_id and (s.last_checked_at is null or p_started_at > s.last_checked_at + interval '30 minutes')) then
      if session.id is not null then
        update music_stream_sessions set ended_at=coalesce(s.offline_at,p_started_at) where id=session.id and ended_at is null;
        update song_requests set stream_pending_archived=true where stream_session_id=session.id and status='pending';
      end if;
      insert into music_stream_sessions(started_at,twitch_stream_id) values(case when s.offline_at is not null and p_started_at <= s.offline_at then p_event_at else p_started_at end,p_stream_id) returning * into session;
    else
      update music_stream_sessions set twitch_stream_id=p_stream_id,ended_at=null where id=session.id;
    end if;
    update music_stream_state set online=true,session_id=session.id,offline_at=null,last_event_at=p_event_at,current_twitch_stream_id=p_stream_id where id=1;
    if s.automation_enabled then update stream_settings set is_accepting=not s.manual_paused and s.online_subscription_id is not null and s.offline_subscription_id is not null where id=1; end if;
  end if;
  return (select to_jsonb(x) from music_stream_state x where id=1);
end;
$$;

create function public.music_stream_automation(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s music_stream_state;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1 for update;
  update music_stream_state set automation_enabled=p_enabled,
    manual_paused=case when p_enabled and not s.automation_enabled then not coalesce((select is_accepting from stream_settings where id=1),false) else manual_paused end where id=1;
  if p_enabled then update stream_settings set is_accepting=(select online and not manual_paused and online_subscription_id is not null and offline_subscription_id is not null from music_stream_state where id=1) where id=1; end if;
  return (select to_jsonb(x) from music_stream_state x where id=1);
end;
$$;

create function public.music_stream_manual(p_accepting boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s music_stream_state;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1 for update;
  update music_stream_state set manual_paused=not p_accepting where id=1;
  update stream_settings set is_accepting=case when s.automation_enabled then p_accepting and s.online and s.online_subscription_id is not null and s.offline_subscription_id is not null else p_accepting end where id=1;
  return (select to_jsonb(x) from music_stream_state x where id=1);
end;
$$;

create function public.music_stream_revoke(p_type text, p_subscription text, p_event_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare s music_stream_state;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1 for update;
  if (p_type='stream.online' and s.online_subscription_id=p_subscription) or (p_type='stream.offline' and s.offline_subscription_id=p_subscription) then
    update music_stream_state set
      online_subscription_id=case when p_type='stream.online' then null else online_subscription_id end,
      offline_subscription_id=case when p_type='stream.offline' then null else offline_subscription_id end,
      last_event_at=greatest(last_event_at,p_event_at)
      where id=1;
    if s.automation_enabled then update stream_settings set is_accepting=false where id=1; end if;
  end if;
end;
$$;

create function public.music_observe_playback(p_session uuid, p_uri text, p_request uuid, p_observed_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare previous music_playback_observation;
begin
  perform pg_advisory_xact_lock(37364,3);
  if not exists(select 1 from music_stream_state where id=1 and online and session_id=p_session) then return; end if;
  select * into previous from music_playback_observation where id=1 for update;
  if previous.observed_at is not null and p_observed_at <= previous.observed_at then return; end if;
  if p_request is not null and not exists(select 1 from song_requests where id=p_request and stream_session_id=p_session and spotify_uri=p_uri and status='approved') then p_request := null; end if;
  if previous.session_id=p_session and previous.current_uri is distinct from p_uri and previous.request_id is not null then
    update song_requests set status='played' where id=previous.request_id and stream_session_id=p_session and status='approved';
  end if;
  update music_playback_observation set session_id=p_session,current_uri=p_uri,
    request_id=case when previous.session_id=p_session and previous.current_uri is not distinct from p_uri then coalesce(previous.request_id,p_request) else p_request end,
    observed_at=p_observed_at where id=1;
end;
$$;
revoke all on function public.music_attach_session(), public.music_stream_event(text,timestamptz,text,timestamptz), public.music_stream_automation(boolean), public.music_stream_manual(boolean), public.music_stream_revoke(text,text,timestamptz), public.music_observe_playback(uuid,text,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.music_stream_event(text,timestamptz,text,timestamptz), public.music_stream_automation(boolean), public.music_stream_manual(boolean), public.music_stream_revoke(text,text,timestamptz), public.music_observe_playback(uuid,text,uuid,timestamptz) to service_role;
commit;
