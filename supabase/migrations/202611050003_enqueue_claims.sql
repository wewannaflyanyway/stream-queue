-- Protect manual approval against concurrent clicks and ambiguous Spotify timeouts.
begin;
create table public.music_enqueue_claims (
  request_id uuid primary key references public.song_requests(id) on delete cascade,
  state text not null default 'sending' check (state in ('sending','uncertain')),
  claimed_at timestamptz not null default clock_timestamp()
);
alter table public.music_enqueue_claims enable row level security;
revoke all on public.music_enqueue_claims from public, anon, authenticated;
grant all on public.music_enqueue_claims to service_role;

create function public.music_claim_request(p_id uuid) returns text
language plpgsql security definer set search_path=public as $$
declare uri text;
begin
  select spotify_uri into uri from song_requests where id=p_id and status='pending' and not stream_pending_archived for update;
  if not found then return null; end if;
  insert into music_enqueue_claims(request_id) values(p_id) on conflict do nothing;
  if not found then return null; end if;
  return uri;
end;
$$;

create function public.music_guard_claimed_request() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.status='pending' and new.status is distinct from old.status
    and exists(select 1 from music_enqueue_claims where request_id=old.id)
    and current_setting('music.claim_id', true) is distinct from old.id::text then
    raise exception 'Заявка обрабатывается. Сначала проверьте очередь Spotify.';
  end if;
  return new;
end;
$$;
create trigger music_guard_claimed_request before update on public.song_requests for each row execute function public.music_guard_claimed_request();

create function public.music_resolve_claim(p_id uuid, p_outcome text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if p_outcome not in ('queued','retry','reject','uncertain') then raise exception 'Invalid outcome'; end if;
  perform 1 from song_requests where id=p_id for update;
  if not found then return false; end if;
  perform 1 from music_enqueue_claims where request_id=p_id for update;
  if not found then return false; end if;
  if p_outcome='uncertain' then
    update music_enqueue_claims set state='uncertain' where request_id=p_id;
    return true;
  end if;
  if p_outcome in ('queued','reject') then
    perform set_config('music.claim_id',p_id::text,true);
    update song_requests set status=case when p_outcome='queued' then 'approved' else 'rejected' end,
      queued_at=case when p_outcome='queued' then clock_timestamp() else queued_at end
      where id=p_id and status='pending';
    if not found then return false; end if;
  end if;
  delete from music_enqueue_claims where request_id=p_id;
  return true;
end;
$$;
create function public.music_reconcile_claim(p_id uuid, p_outcome text) returns boolean
language plpgsql security definer set search_path=public as $$
declare claim music_enqueue_claims;
begin
  if p_outcome not in ('queued','retry','reject') then return false; end if;
  perform 1 from song_requests where id=p_id for update;
  select * into claim from music_enqueue_claims where request_id=p_id for update;
  if not found or (claim.state='sending' and claim.claimed_at > clock_timestamp()-interval '30 seconds') then return false; end if;
  return music_resolve_claim(p_id,p_outcome);
end;
$$;
revoke all on function public.music_claim_request(uuid), public.music_guard_claimed_request(), public.music_resolve_claim(uuid,text), public.music_reconcile_claim(uuid,text) from public, anon, authenticated;
grant execute on function public.music_claim_request(uuid), public.music_resolve_claim(uuid,text), public.music_reconcile_claim(uuid,text) to service_role;
commit;
