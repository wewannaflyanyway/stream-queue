-- Additive migration. Existing music tables and policies are unchanged.
begin;
create table public.stream_polls (
  id uuid primary key,
  question text not null check (length(trim(question)) between 1 and 160),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  status text not null default 'draft' check (status in ('draft','running','ended')),
  duration_sec integer check (duration_sec between 15 and 3600),
  allow_revote boolean not null default true,
  hide_results boolean not null default false,
  voting_mode text not null default 'number' check (voting_mode in ('number','command')),
  created_at timestamptz not null default now(), started_at timestamptz, ends_at timestamptz, ended_at timestamptz
);
create unique index stream_polls_one_running on public.stream_polls ((status)) where status = 'running';
create table public.stream_poll_votes (
  poll_id uuid not null references public.stream_polls(id) on delete cascade,
  user_id text not null, choice integer not null check (choice between 1 and 6),
  message_id text not null, voted_at timestamptz not null,
  primary key (poll_id, user_id)
);
create table public.stream_poll_deliveries (
  message_id text primary key, received_at timestamptz not null default clock_timestamp()
);
create index stream_poll_deliveries_received on public.stream_poll_deliveries(received_at);
create table public.stream_poll_settings (
  id integer primary key check (id = 1), style jsonb not null default '{}', visible boolean not null default true
);
insert into public.stream_poll_settings (id) values (1);
create table public.stream_poll_twitch (
  id integer primary key check (id = 1), broadcaster_id text, login text,
  subscription_id text, secret_fingerprint text, status text not null default 'disconnected',
  last_event_at timestamptz, last_checked_at timestamptz
);
insert into public.stream_poll_twitch (id) values (1);

alter table public.stream_polls enable row level security;
alter table public.stream_poll_votes enable row level security;
alter table public.stream_poll_deliveries enable row level security;
alter table public.stream_poll_settings enable row level security;
alter table public.stream_poll_twitch enable row level security;
revoke all on public.stream_polls, public.stream_poll_votes, public.stream_poll_deliveries, public.stream_poll_settings, public.stream_poll_twitch from anon, authenticated;
grant all on public.stream_polls, public.stream_poll_votes, public.stream_poll_deliveries, public.stream_poll_settings, public.stream_poll_twitch to service_role;

create function public.stream_poll_expire() returns void
language sql set search_path = public as $$
  update stream_polls set status = 'ended', ended_at = ends_at
  where status = 'running' and ends_at <= clock_timestamp();
$$;

create function public.stream_poll_state(p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  perform pg_advisory_xact_lock(37364, 1);
  perform stream_poll_expire();
  select jsonb_build_object(
    'polls', coalesce((select jsonb_agg(item order by item->>'created_at' desc) from (
      select (to_jsonb(p)-'poll_rank') || jsonb_build_object(
        'counts', (select jsonb_agg((select count(*) from stream_poll_votes v where v.poll_id = p.id and v.choice = n)) from generate_series(1,jsonb_array_length(p.options)) n),
        'total_votes', (select count(*) from stream_poll_votes v where v.poll_id = p.id)
      ) as item from (
        select p.*,row_number() over(partition by status order by coalesce(started_at,created_at) desc) as poll_rank
        from stream_polls p
      ) p
      where (p_admin and p.poll_rank <= 50) or (not p_admin and p.status <> 'draft')
      order by (p.status = 'running') desc, coalesce(p.started_at,p.created_at) desc
      limit case when p_admin then 101 else 1 end
    ) rows), '[]'::jsonb),
    'settings', (select to_jsonb(s) from stream_poll_settings s where id=1),
    'chat', case when p_admin then (select to_jsonb(t) from stream_poll_twitch t where id=1) else null end,
    'server_now', clock_timestamp()
  ) into result;
  return result;
end;
$$;

create function public.stream_poll_action(p_action text, p_payload jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare target stream_polls; pid uuid; running_id uuid;
begin
  perform pg_advisory_xact_lock(37364, 1);
  perform stream_poll_expire();
  if p_action in ('save','start','finish','extend','delete') then pid := (p_payload->>'id')::uuid; end if;
  if p_action in ('save','start') then
    if p_action = 'start' then
      select id into running_id from stream_polls where status='running';
      if running_id = pid then return; end if;
      if running_id is not null then raise exception 'Сначала завершите текущее голосование.'; end if;
      if not exists(select 1 from stream_poll_twitch where id=1 and status='enabled') then raise exception 'Сначала подключите и проверьте Twitch.'; end if;
    end if;
    if jsonb_typeof(p_payload->'options') <> 'array' or exists (
      select 1 from jsonb_array_elements(p_payload->'options') o
      where jsonb_typeof(o) <> 'string' or length(trim(o #>> '{}')) not between 1 and 80
    ) then raise exception 'Некорректные варианты.'; end if;
    select * into target from stream_polls where id=pid;
    if found and target.status <> 'draft' then raise exception 'Запущенное голосование нельзя редактировать.'; end if;
    insert into stream_polls(id,question,options,duration_sec,allow_revote,hide_results,voting_mode)
    values(pid,p_payload->>'question',p_payload->'options',(p_payload->>'durationSec')::integer,
      (p_payload->>'allowRevote')::boolean,(p_payload->>'hideResults')::boolean,p_payload->>'votingMode')
    on conflict(id) do update set question=excluded.question,options=excluded.options,duration_sec=excluded.duration_sec,
      allow_revote=excluded.allow_revote,hide_results=excluded.hide_results,voting_mode=excluded.voting_mode;
    if p_action='start' then
      delete from stream_poll_deliveries where received_at < clock_timestamp()-interval '1 day';
      update stream_polls set status='running',started_at=clock_timestamp(),
        ends_at=case when duration_sec is null then null else clock_timestamp()+make_interval(secs=>duration_sec) end where id=pid;
      update stream_poll_settings set visible=true where id=1;
    end if;
  elsif p_action='finish' then
    update stream_polls set status='ended',ended_at=clock_timestamp() where id=pid and status='running';
  elsif p_action='extend' then
    update stream_polls set ends_at=ends_at+interval '30 seconds' where id=pid and status='running' and ends_at is not null;
  elsif p_action='delete' then
    delete from stream_polls where id=pid and status='draft';
  elsif p_action='style' then
    update stream_poll_settings set style=p_payload where id=1;
  elsif p_action='visibility' then
    update stream_poll_settings set visible=(p_payload->>'visible')::boolean where id=1;
  else raise exception 'Неизвестное действие.';
  end if;
end;
$$;

create function public.stream_poll_vote(p_subscription text, p_broadcaster text, p_user text, p_message text, p_text text, p_time timestamptz) returns boolean
language plpgsql security definer set search_path = public as $$
declare current_poll stream_polls; selected integer; pattern text;
begin
  perform pg_advisory_xact_lock(37364, 1);
  if not exists(select 1 from stream_poll_twitch where id=1 and broadcaster_id=p_broadcaster and subscription_id=p_subscription and status in ('enabled','webhook_callback_verification_pending')) then return false; end if;
  update stream_poll_twitch set last_event_at=greatest(last_event_at,p_time),status='enabled' where id=1;
  perform stream_poll_expire();
  select * into current_poll from stream_polls where status='running';
  if not found or p_time < current_poll.started_at or p_time >= current_poll.ends_at or p_time > clock_timestamp()+interval '10 seconds' then return false; end if;
  if p_user is null or p_user='' or p_message is null or p_message='' then return false; end if;
  pattern := case when current_poll.voting_mode='command' then '^!vote[[:space:]]+([1-6])$' else '^([1-6])$' end;
  selected := (regexp_match(trim(p_text),pattern,'i'))[1]::integer;
  if selected is null or selected > jsonb_array_length(current_poll.options) then return false; end if;
  -- A retried old message must not undo a newer choice, even with a new delivery timestamp.
  insert into stream_poll_deliveries(message_id) values(p_message) on conflict do nothing;
  if not found then return false; end if;
  insert into stream_poll_votes(poll_id,user_id,choice,message_id,voted_at)
    values(current_poll.id,p_user,selected,p_message,p_time)
  on conflict(poll_id,user_id) do update set choice=excluded.choice,message_id=excluded.message_id,voted_at=excluded.voted_at
    where current_poll.allow_revote and (excluded.voted_at,excluded.message_id) > (stream_poll_votes.voted_at,stream_poll_votes.message_id);
  return found;
end;
$$;

revoke all on function public.stream_poll_expire(), public.stream_poll_state(boolean), public.stream_poll_action(text,jsonb), public.stream_poll_vote(text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.stream_poll_state(boolean), public.stream_poll_action(text,jsonb), public.stream_poll_vote(text,text,text,text,text,timestamptz) to service_role;
commit;
