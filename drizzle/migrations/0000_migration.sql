
create type public.case_role as enum ('judge','prosecutor','defense','witness','juror','observer');
create type public.case_phase as enum ('pre_trial','hearing','deliberation','closed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Member',
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by signed in" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 150),
  description text not null default '' check (char_length(description) <= 4000),
  created_by uuid not null,
  phase public.case_phase not null default 'pre_trial',
  jury_round int not null default 1,
  invite_code text not null unique default upper(substr(md5(random()::text),1,8)),
  verdict_outcome text,
  verdict_summary text,
  locked boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.cases to authenticated;
grant all on public.cases to service_role;
alter table public.cases enable row level security;

create table public.case_members (
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.case_role not null,
  joined_at timestamptz not null default now(),
  primary key (case_id, user_id)
);
grant select on public.case_members to authenticated;
grant all on public.case_members to service_role;
alter table public.case_members enable row level security;

create or replace function public.member_role(_case uuid, _user uuid) returns public.case_role
language sql stable security definer set search_path = public as $$
  select role from public.case_members where case_id = _case and user_id = _user
$$;
create or replace function public.is_member(_case uuid, _user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.case_members where case_id = _case and user_id = _user)
$$;

create policy "members read case" on public.cases for select to authenticated using (public.is_member(id, auth.uid()));
create policy "members read members" on public.case_members for select to authenticated using (public.is_member(case_id, auth.uid()));

create table public.hearing_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('statement','objection','ruling','system')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
grant select on public.hearing_events to authenticated;
grant all on public.hearing_events to service_role;
alter table public.hearing_events enable row level security;
create policy "members read events" on public.hearing_events for select to authenticated using (public.is_member(case_id, auth.uid()));

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  file_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  restricted boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert on public.evidence to authenticated;
grant all on public.evidence to service_role;
alter table public.evidence enable row level security;
-- restricted evidence: only judge, prosecutor, defense, and uploader
create or replace function public.can_view_evidence(_case uuid, _restricted boolean, _uploader uuid, _user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when not public.is_member(_case,_user) then false
    when not _restricted then true
    when _uploader = _user then true
    else public.member_role(_case,_user) in ('judge','prosecutor','defense') end
$$;
create policy "view evidence" on public.evidence for select to authenticated using (public.can_view_evidence(case_id, restricted, uploaded_by, auth.uid()));
create policy "upload evidence" on public.evidence for insert to authenticated with check (
  uploaded_by = auth.uid()
  and public.member_role(case_id, auth.uid()) in ('judge','prosecutor','defense','witness')
  and exists (select 1 from public.cases c where c.id = case_id and not c.locked and c.phase in ('pre_trial','hearing'))
  and split_part(file_path,'/',1) = case_id::text
);

create table public.jury_votes (
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  round int not null,
  vote text not null check (vote in ('guilty','not_guilty')),
  created_at timestamptz not null default now(),
  primary key (case_id, user_id, round)
);
grant select on public.jury_votes to authenticated;
grant all on public.jury_votes to service_role;
alter table public.jury_votes enable row level security;
-- jurors see own vote; judge sees all; everyone after close
create policy "read votes" on public.jury_votes for select to authenticated using (
  user_id = auth.uid()
  or public.member_role(case_id, auth.uid()) = 'judge'
  or (public.is_member(case_id, auth.uid()) and exists(select 1 from public.cases c where c.id = case_id and c.locked))
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own notifications update" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "own notifications delete" on public.notifications for delete to authenticated using (user_id = auth.uid());

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.case_role not null,
  issued_at timestamptz not null default now(),
  unique (case_id, user_id)
);
grant select on public.certificates to authenticated;
grant all on public.certificates to service_role;
alter table public.certificates enable row level security;
create policy "own certificates" on public.certificates for select to authenticated using (user_id = auth.uid());

-- helpers
create or replace function public.notify_case(_case uuid, _msg text, _except uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications(user_id, case_id, message)
  select user_id, _case, _msg from public.case_members where case_id = _case and (_except is null or user_id <> _except)
$$;
revoke execute on function public.notify_case(uuid,text,uuid) from public, anon, authenticated;

create or replace function public.create_case(_title text, _description text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(trim(_title)) < 3 then raise exception 'Title must be at least 3 characters'; end if;
  insert into public.cases(title, description, created_by) values (trim(_title), coalesce(_description,''), auth.uid()) returning id into cid;
  insert into public.case_members(case_id, user_id, role) values (cid, auth.uid(), 'judge');
  insert into public.hearing_events(case_id, user_id, kind, content) values (cid, null, 'system', 'Case filed. The presiding judge has opened the docket.');
  return cid;
end $$;

create or replace function public.join_case(_code text, _role public.case_role) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.cases; uname text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from public.cases where invite_code = upper(trim(_code));
  if c.id is null then raise exception 'Invalid invite code'; end if;
  if c.locked then raise exception 'This case is closed'; end if;
  if public.is_member(c.id, auth.uid()) then return c.id; end if;
  if _role = 'judge' then raise exception 'A case can only have one judge'; end if;
  if _role in ('prosecutor','defense') and exists(select 1 from public.case_members where case_id = c.id and role = _role) then
    raise exception 'The % seat is already taken', _role; end if;
  if _role = 'juror' and c.phase <> 'pre_trial' then raise exception 'Jurors can only join before the hearing starts'; end if;
  if _role = 'juror' and (select count(*) from public.case_members where case_id = c.id and role='juror') >= 12 then raise exception 'Jury is full (12)'; end if;
  insert into public.case_members(case_id, user_id, role) values (c.id, auth.uid(), _role);
  select display_name into uname from public.profiles where id = auth.uid();
  perform public.notify_case(c.id, uname || ' joined "' || c.title || '" as ' || _role::text, auth.uid());
  insert into public.hearing_events(case_id, kind, content) values (c.id, 'system', uname || ' joined as ' || _role::text || '.');
  return c.id;
end $$;

create or replace function public.post_hearing_event(_case uuid, _kind text, _content text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.case_role; c public.cases;
begin
  select * into c from public.cases where id = _case;
  r := public.member_role(_case, auth.uid());
  if r is null then raise exception 'Not a member of this case'; end if;
  if c.locked then raise exception 'Case is closed and locked'; end if;
  if c.phase <> 'hearing' then raise exception 'The hearing is not in session'; end if;
  if _kind not in ('statement','objection','ruling') then raise exception 'Invalid entry type'; end if;
  if _kind = 'ruling' and r <> 'judge' then raise exception 'Only the judge can issue rulings'; end if;
  if _kind = 'objection' and r not in ('prosecutor','defense') then raise exception 'Only counsel can object'; end if;
  if _kind = 'statement' and r not in ('judge','prosecutor','defense','witness') then raise exception 'Your role cannot speak in the hearing'; end if;
  if char_length(trim(_content)) = 0 then raise exception 'Entry cannot be empty'; end if;
  insert into public.hearing_events(case_id, user_id, kind, content) values (_case, auth.uid(), _kind, trim(_content));
end $$;

create or replace function public.advance_phase(_case uuid) returns public.case_phase
language plpgsql security definer set search_path = public as $$
declare c public.cases; nxt public.case_phase;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can change the phase'; end if;
  if c.locked then raise exception 'Case is closed and locked'; end if;
  if c.phase = 'pre_trial' then
    if not exists(select 1 from public.case_members where case_id=_case and role='prosecutor')
       or not exists(select 1 from public.case_members where case_id=_case and role='defense') then
      raise exception 'Both prosecutor and defense must join before the hearing starts'; end if;
    nxt := 'hearing';
  elsif c.phase = 'hearing' then nxt := 'deliberation';
  else raise exception 'Submit the verdict to close the case'; end if;
  update public.cases set phase = nxt where id = _case;
  insert into public.hearing_events(case_id, kind, content) values (_case, 'system',
    case nxt when 'hearing' then 'Court is now in session.' else 'Hearing adjourned. The jury has retired to deliberate.' end);
  perform public.notify_case(_case, '"' || c.title || '" moved to ' || replace(nxt::text,'_',' '), auth.uid());
  return nxt;
end $$;

create or replace function public.cast_vote(_case uuid, _vote text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'juror' then raise exception 'Only jurors can vote'; end if;
  if c.locked or c.phase <> 'deliberation' then raise exception 'Voting is only open during deliberation'; end if;
  if _vote not in ('guilty','not_guilty') then raise exception 'Invalid vote'; end if;
  if exists(select 1 from public.jury_votes where case_id=_case and user_id=auth.uid() and round=c.jury_round) then
    raise exception 'You already voted this round'; end if;
  insert into public.jury_votes(case_id,user_id,round,vote) values (_case, auth.uid(), c.jury_round, _vote);
end $$;

-- tally for current round: returns status pending|majority_guilty|majority_not_guilty|deadlock|no_jury
create or replace function public.jury_tally(_case uuid)
returns table(round int, jurors int, voted int, guilty int, not_guilty int, status text)
language plpgsql stable security definer set search_path = public as $$
declare c public.cases; j int; g int; n int;
begin
  if not public.is_member(_case, auth.uid()) then raise exception 'Not a member'; end if;
  select * into c from public.cases where id = _case;
  select count(*) into j from public.case_members where case_id=_case and role='juror';
  select count(*) filter (where v.vote='guilty'), count(*) filter (where v.vote='not_guilty') into g, n
    from public.jury_votes v where v.case_id=_case and v.round=c.jury_round;
  round := c.jury_round; jurors := j; guilty := g; not_guilty := n; voted := g+n;
  status := case when j = 0 then 'no_jury'
    when g+n < j then 'pending'
    when g > n then 'majority_guilty'
    when n > g then 'majority_not_guilty'
    else 'deadlock' end;
  return next;
end $$;

create or replace function public.new_jury_round(_case uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t record; c public.cases;
begin
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can order a new round'; end if;
  select * into c from public.cases where id=_case;
  if c.locked or c.phase <> 'deliberation' then raise exception 'Not in deliberation'; end if;
  select * into t from public.jury_tally(_case);
  if t.status <> 'deadlock' then raise exception 'A new round is only allowed when the jury is deadlocked'; end if;
  if c.jury_round >= 3 then raise exception 'Maximum of 3 rounds reached — declare a mistrial'; end if;
  update public.cases set jury_round = jury_round + 1 where id=_case;
  insert into public.hearing_events(case_id, kind, content) values (_case,'system','Jury deadlocked. The judge ordered round ' || (c.jury_round+1) || ' of deliberation.');
  perform public.notify_case(_case, 'Jury deadlocked on "' || c.title || '" — new voting round opened', auth.uid());
  return c.jury_round + 1;
end $$;

create or replace function public.submit_verdict(_case uuid, _outcome text, _summary text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; t record;
begin
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can submit the verdict'; end if;
  select * into c from public.cases where id=_case for update;
  if c.locked then raise exception 'Verdict already submitted; case is locked'; end if;
  if c.phase <> 'deliberation' then raise exception 'Verdict can only be submitted during deliberation'; end if;
  if _outcome not in ('guilty','not_guilty','mistrial') then raise exception 'Invalid outcome'; end if;
  if char_length(trim(coalesce(_summary,''))) < 10 then raise exception 'Summary must be at least 10 characters'; end if;
  select * into t from public.jury_tally(_case);
  if t.status = 'pending' then raise exception 'All jurors must vote first'; end if;
  if t.status = 'majority_guilty' and _outcome <> 'guilty' then raise exception 'Verdict must follow the jury majority (guilty)'; end if;
  if t.status = 'majority_not_guilty' and _outcome <> 'not_guilty' then raise exception 'Verdict must follow the jury majority (not guilty)'; end if;
  if t.status = 'deadlock' and _outcome <> 'mistrial' then raise exception 'A deadlocked jury can only result in a mistrial'; end if;
  update public.cases set verdict_outcome=_outcome, verdict_summary=trim(_summary), locked=true, phase='closed', closed_at=now() where id=_case;
  insert into public.hearing_events(case_id, kind, content) values (_case,'system','Verdict entered: ' || replace(upper(_outcome),'_',' ') || '. The case is closed and permanently locked.');
  insert into public.certificates(case_id,user_id,role) select case_id,user_id,role from public.case_members where case_id=_case on conflict do nothing;
  perform public.notify_case(_case, 'Verdict entered on "' || c.title || '". Your certificate is ready.', null);
end $$;

-- block any direct modification of locked cases (defense in depth)
create or replace function public.prevent_locked_changes() returns trigger language plpgsql as $$
begin
  if old.locked then raise exception 'Case is permanently locked'; end if;
  return new;
end $$;
create trigger cases_lock_guard before update or delete on public.cases for each row execute function public.prevent_locked_changes();

-- public certificate verification
create or replace function public.verify_certificate(_id uuid)
returns table(certificate_id uuid, holder text, role public.case_role, case_title text, outcome text, issued_at timestamptz, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select ce.id, p.display_name, ce.role, c.title, c.verdict_outcome, ce.issued_at, c.closed_at
  from public.certificates ce join public.profiles p on p.id = ce.user_id join public.cases c on c.id = ce.case_id
  where ce.id = _id
$$;
grant execute on function public.verify_certificate(uuid) to anon, authenticated;

alter publication supabase_realtime add table public.hearing_events, public.notifications, public.cases, public.case_members, public.jury_votes, public.evidence;

-- storage policies for 'evidence' bucket (path: <case_id>/<file>)
create policy "evidence read" on storage.objects for select to authenticated using (
  bucket_id = 'evidence' and exists (
    select 1 from public.evidence e where e.file_path = name and public.can_view_evidence(e.case_id, e.restricted, e.uploaded_by, auth.uid()))
);
create policy "evidence upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'evidence'
  and public.member_role(((storage.foldername(name))[1])::uuid, auth.uid()) in ('judge','prosecutor','defense','witness')
  and exists (select 1 from public.cases c where c.id = ((storage.foldername(name))[1])::uuid and not c.locked)
);
