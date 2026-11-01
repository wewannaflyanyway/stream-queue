-- Allow an explicit manual opening between streams while preserving automatic closing.
begin;
alter table public.music_stream_state add column manual_offline_since timestamptz;

create or replace function public.music_attach_session() returns trigger language plpgsql security definer set search_path=public as $$
declare s music_stream_state;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1;
  if s.automation_enabled and ((not s.online and s.manual_offline_since is null) or s.manual_paused or s.online_subscription_id is null or s.offline_subscription_id is null) then
    raise exception 'Прием заявок закрыт';
  end if;
  if new.stream_session_id is null and s.online then new.stream_session_id := s.session_id; end if;
  if new.status='approved' and new.queued_at is null then new.queued_at=clock_timestamp(); end if;
  return new;
end;
$$;

create or replace function public.music_stream_manual(p_accepting boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s music_stream_state;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1 for update;
  update music_stream_state set manual_paused=not p_accepting,
    manual_offline_since=case when p_accepting and not s.online then coalesce(s.manual_offline_since,clock_timestamp()) else s.manual_offline_since end where id=1;
  update stream_settings set is_accepting=case when s.automation_enabled then p_accepting and s.online_subscription_id is not null and s.offline_subscription_id is not null else p_accepting end where id=1;
  return (select to_jsonb(x) from music_stream_state x where id=1);
end;
$$;

create or replace function public.music_stream_event(p_type text, p_event_at timestamptz, p_stream_id text default null, p_started_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s music_stream_state; session music_stream_sessions;
begin
  perform pg_advisory_xact_lock(37364,2);
  select * into s from music_stream_state where id=1 for update;
  if p_type not in ('online','offline') or p_event_at is null then raise exception 'Invalid stream event'; end if;
  if s.last_event_at is not null and p_event_at <= s.last_event_at then return to_jsonb(s); end if;
  if p_type='offline' then
    update music_stream_state set online=false,offline_at=case when online then p_event_at else coalesce(offline_at,p_event_at) end,last_event_at=p_event_at,manual_offline_since=null where id=1;
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
    if s.manual_offline_since is not null then
      update song_requests set stream_session_id=session.id where stream_session_id is null and created_at >= s.manual_offline_since and not stream_pending_archived;
    end if;
    update music_stream_state set online=true,session_id=session.id,offline_at=null,last_event_at=p_event_at,current_twitch_stream_id=p_stream_id,manual_offline_since=null where id=1;
    if s.automation_enabled then update stream_settings set is_accepting=not s.manual_paused and s.online_subscription_id is not null and s.offline_subscription_id is not null where id=1; end if;
  end if;
  return (select to_jsonb(x) from music_stream_state x where id=1);
end;
$$;
commit;
