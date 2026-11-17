-- JusticeRoom feature pack: case types, appointed judge, optional jury (3/5/7/9), turn-taking,
-- objections, public cases + seat requests, winner-only certificates with unique code, evidence limits.
alter table public.cases
  add column if not exists case_type text not null default 'other' check (case_type in ('criminal','civil','academic','workplace','other')),
  add column if not exists is_public boolean not null default false,
  add column if not exists jury_size int not null default 0 check (jury_size in (0,3,5,7)),
  add column if not exists jury_min int not null default 0 check (jury_min in (0,1,3,5)),
  add column if not exists stage text not null default 'opening' check (stage in ('opening','evidence','closing')),
  add column if not exists hearing_round int not null default 1,
  add column if not exists evidence_seen boolean not null default false,
  add column if not exists turn text not null default 'prosecutor' check (turn in ('prosecutor','defense')),
  add column if not exists pending_objection uuid,
  add column if not exists certificate_code text unique;


create table if not exists public.seat_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.case_role not null check (role in ('judge','juror')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  prosecutor_ok boolean, defense_ok boolean,
  created_at timestamptz not null default now(),
  unique (case_id, user_id, role));
grant select on public.seat_requests to authenticated;
alter table public.seat_requests enable row level security;
create policy "members or requester read requests" on public.seat_requests for select to authenticated
  using (user_id = auth.uid() or public.is_member(case_id, auth.uid()));

-- evidence: images or PDF, max 1 MB (the bucket enforces it too)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('evidence','evidence',false,1048576, array['application/pdf','image/png','image/jpeg','image/webp','image/gif'])
  on conflict (id) do update set file_size_limit = 1048576, allowed_mime_types = excluded.allowed_mime_types;
alter table public.evidence add constraint evidence_file_rules check (
  size_bytes is not null and size_bytes <= 1048576
  and mime_type in ('application/pdf','image/png','image/jpeg','image/webp','image/gif')) not valid;

-- the prosecutor opens the case and appoints the judge by sharing the judge code
drop function if exists public.create_case(text, text);
create or replace function public.create_case(_title text, _description text, _type text default 'other', _public boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(trim(_title)) < 3 then raise exception 'Title must be at least 3 characters'; end if;
  if _type not in ('criminal','civil','academic','workplace','other') then raise exception 'Invalid case type'; end if;
  insert into public.cases(title, description, created_by, case_type, is_public) values (trim(_title), coalesce(_description,''), auth.uid(), _type, coalesce(_public,false)) returning id into cid;
  insert into public.case_members(case_id, user_id, role) values (cid, auth.uid(), 'prosecutor');
  insert into public.hearing_events(case_id, kind, content) values (cid, 'system', 'Case filed by the prosecutor. Waiting for a judge, the defense and the jury (if any).');
  return cid;
end $$;


-- ONE code for everyone. Judge and defense take a free seat at once. Jurors ask, and the judge decides.
create or replace function public.join_case(_code text, _role public.case_role) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.cases; uname text; n int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from public.cases where invite_code = upper(trim(_code));
  if c.id is null then raise exception 'Invalid code'; end if;
  if c.locked then raise exception 'This case is closed'; end if;
  if public.is_member(c.id, auth.uid()) then return c.id; end if;
  if c.phase <> 'pre_trial' then raise exception 'Seats can only be taken before the hearing starts'; end if;
  if _role not in ('judge','defense','juror') then raise exception 'Choose judge, defense or juror'; end if;
  select display_name into uname from public.profiles where id = auth.uid();
  if _role in ('judge','defense') then
    if exists(select 1 from public.case_members where case_id = c.id and role = _role) then raise exception 'The % seat is already taken', _role; end if;
    insert into public.case_members(case_id, user_id, role, joined_via) values (c.id, auth.uid(), _role, 'code');
    insert into public.hearing_events(case_id, kind, content) values (c.id, 'system', uname || ' joined as ' || _role::text || '.');
    perform public.notify_case(c.id, uname || ' joined "' || c.title || '" as ' || _role::text, auth.uid());
    return c.id;
  end if;
  if coalesce(c.jury_size,0) = 0 then raise exception 'This case does not use a jury'; end if;
  select count(*) into n from public.case_members where case_id = c.id and role = 'juror';
  if n >= c.jury_size then raise exception 'The jury is full (% of % seats taken)', n, c.jury_size; end if;
  if exists(select 1 from public.seat_requests where case_id = c.id and user_id = auth.uid() and role = 'juror' and status = 'pending') then raise exception 'You already asked to join this jury'; end if;
  insert into public.seat_requests(case_id, user_id, role, via) values (c.id, auth.uid(), 'juror', 'code')
    on conflict (case_id, user_id, role) do update set via = 'code', status = 'pending', prosecutor_ok = null, defense_ok = null where public.seat_requests.status <> 'pending';
  insert into public.notifications(user_id, case_id, message)
    select user_id, c.id, uname || ' asked to join the jury of "' || c.title || '"' from public.case_members where case_id = c.id and role = 'judge';
  return null;
end $$;

create or replace function public.set_jury_size(_case uuid, _min int, _max int) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; n int;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge sets the jury size'; end if;
  if c.locked or c.phase <> 'pre_trial' then raise exception 'The jury size can only change before the hearing'; end if;
  if (_min, _max) not in ((0,0),(1,3),(3,5),(5,7)) then raise exception 'Choose not required, 1-3, 3-5 or 5-7 jurors'; end if;
  select count(*) into n from public.case_members where case_id = _case and role = 'juror';
  if n > coalesce(_max, 0) then raise exception '% jurors are already seated, which is more than the maximum', n; end if;
  update public.cases set jury_min = _min, jury_size = _max where id = _case;
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
      raise exception 'The prosecutor, defense and judge must all be present before the hearing starts'; end if;
    nxt := 'hearing';
    update public.cases set turn = 'prosecutor', stage = 'opening', hearing_round = 1, evidence_seen = false where id = _case;
  elsif c.phase = 'hearing' then
    if c.pending_objection is not null then raise exception 'Rule on the pending objection first'; end if;
    if c.stage <> 'closing' then raise exception 'Finish the opening, evidence and closing stages before the jury deliberates'; end if;
    nxt := 'deliberation';
  else raise exception 'Submit the verdict to close the case'; end if;
  update public.cases set phase = nxt where id = _case;
  insert into public.hearing_events(case_id, kind, content) values (_case, 'system',
    case nxt when 'hearing' then 'Court is now in session. The prosecutor speaks first.' else 'Hearing adjourned. The case goes to deliberation.' end);
  perform public.notify_case(_case, '"' || c.title || '" moved to ' || replace(nxt::text,'_',' '), auth.uid());
  return nxt;
end $$;

-- turn rules: prosecutor, then defense, alternating; the judge may speak at any time (that resets the turn to the prosecutor)
create or replace function public.post_hearing_event(_case uuid, _kind text, _content text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.case_role; c public.cases; eid uuid;
begin
  select * into c from public.cases where id = _case;
  r := public.member_role(_case, auth.uid());
  if r is null then raise exception 'Not a member of this case'; end if;
  if c.locked then raise exception 'Case is closed and locked'; end if;
  if c.phase <> 'hearing' then raise exception 'The hearing is not in session'; end if;
  if _kind not in ('statement','objection') then raise exception 'Invalid entry type'; end if;
  if char_length(trim(_content)) = 0 then raise exception 'Entry cannot be empty'; end if;
  if r not in ('judge','prosecutor','defense') then raise exception 'Your role cannot speak in the hearing'; end if;
  if _kind = 'objection' and r = 'judge' then raise exception 'The judge rules on objections, not raises them'; end if;
  if r in ('prosecutor','defense') and c.pending_objection is not null then raise exception 'An objection is pending. The judge must rule on it first'; end if;
  if r in ('prosecutor','defense') and c.stage = 'evidence' then raise exception 'The judge is reviewing the evidence. Please wait until the judge decides'; end if;
  if _kind = 'statement' and r in ('prosecutor','defense') and c.turn <> r::text then raise exception 'It is not your turn to speak'; end if;
  insert into public.hearing_events(case_id, user_id, kind, content) values (_case, auth.uid(), _kind, trim(_content)) returning id into eid;
  if _kind = 'objection' then update public.cases set pending_objection = eid where id = _case;
  elsif r = 'judge' then null; -- the judge may speak at any time without changing whose turn it is
  else update public.cases set turn = case when r = 'prosecutor' then 'defense' else 'prosecutor' end where id = _case; end if;
end $$;

create or replace function public.rule_objection(_case uuid, _accept boolean, _note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can rule on objections'; end if;
  if c.locked or c.phase <> 'hearing' then raise exception 'The hearing is not in session'; end if;
  if c.pending_objection is null then raise exception 'There is no pending objection'; end if;
  insert into public.hearing_events(case_id, user_id, kind, content) values (_case, auth.uid(), 'ruling',
    case when _accept then 'Objection sustained.' else 'Objection overruled.' end || case when char_length(trim(coalesce(_note,''))) > 0 then ' ' || trim(_note) else '' end);
  update public.cases set pending_objection = null where id = _case;
end $$;

-- public cases: anyone may browse and ask for a seat; codes are never exposed
create or replace function public.list_public_cases() returns table(id uuid, title text, case_type text, jury_size int, has_judge boolean, jurors int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.case_type, c.jury_size,
    exists(select 1 from public.case_members m where m.case_id = c.id and m.role = 'judge'),
    (select count(*)::int from public.case_members m where m.case_id = c.id and m.role = 'juror'), c.created_at
  from public.cases c where c.is_public and not c.locked and c.phase = 'pre_trial' and auth.uid() is not null
    and not public.is_member(c.id, auth.uid()) order by c.created_at desc $$;

create or replace function public.request_seat(_case uuid, _role public.case_role) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; uname text;
begin
  select * into c from public.cases where id = _case;
  if auth.uid() is null or c.id is null or not c.is_public then raise exception 'This case is not public'; end if;
  if c.locked or c.phase <> 'pre_trial' then raise exception 'Seats can only be requested before the hearing'; end if;
  if _role not in ('judge','juror') then raise exception 'You can request the judge or jury seat'; end if;
  if public.is_member(_case, auth.uid()) then raise exception 'You are already in this case'; end if;
  if _role = 'judge' and exists(select 1 from public.case_members where case_id = _case and role = 'judge') then raise exception 'A judge is already seated'; end if;
  if _role = 'juror' and coalesce(c.jury_size,0) = 0 then raise exception 'This case has no jury yet'; end if;
  insert into public.seat_requests(case_id, user_id, role) values (_case, auth.uid(), _role);
  select display_name into uname from public.profiles where id = auth.uid();
  insert into public.notifications(user_id, case_id, message)
    select user_id, _case, uname || ' asked to serve as ' || _role::text || ' on "' || c.title || '"' from public.case_members
    where case_id = _case and role in (case when _role = 'judge' then 'prosecutor'::public.case_role else 'judge'::public.case_role end, case when _role = 'judge' then 'defense'::public.case_role else 'judge'::public.case_role end);
exception when unique_violation then raise exception 'You already sent this request';
end $$;

create or replace function public.decide_request(_request uuid, _approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare q public.seat_requests; c public.cases; r public.case_role;
begin
  select * into q from public.seat_requests where id = _request for update;
  if q.id is null or q.status <> 'pending' then raise exception 'Request is not pending'; end if;
  select * into c from public.cases where id = q.case_id;
  r := public.member_role(q.case_id, auth.uid());
  if c.locked or c.phase <> 'pre_trial' then raise exception 'Seats can only change before the hearing'; end if;
  if q.role = 'juror' then
    if r is distinct from 'judge' then raise exception 'Only the judge approves jury requests'; end if;
    if _approve and (coalesce(c.jury_size,0) = 0 or (select count(*) from public.case_members where case_id = c.id and role = 'juror') >= c.jury_size) then raise exception 'No jury seat is free'; end if;
  else
    if r not in ('prosecutor','defense') then raise exception 'Only the two parties approve a judge'; end if;
    if exists(select 1 from public.case_members where case_id = c.id and role = 'judge') then raise exception 'A judge is already seated'; end if;
    if _approve then
      update public.seat_requests set prosecutor_ok = case when r = 'prosecutor' then true else prosecutor_ok end, defense_ok = case when r = 'defense' then true else defense_ok end where id = q.id;
      select * into q from public.seat_requests where id = q.id;
      if not (q.prosecutor_ok and q.defense_ok) then return; end if;
    end if;
  end if;
  if _approve then
    insert into public.case_members(case_id, user_id, role, joined_via) values (q.case_id, q.user_id, q.role, case when q.via = 'code' then 'code' else 'request' end);
    update public.seat_requests set status = 'approved' where id = q.id;
  else update public.seat_requests set status = 'rejected' where id = q.id; end if;
  insert into public.notifications(user_id, case_id, message) values (q.user_id, q.case_id, 'Your request to serve as ' || q.role::text || ' on "' || c.title || '" was ' || case when _approve then 'approved' else 'declined' end);
end $$;

-- verdict: certificate goes to the winning party only; every participant is told the unique code
create or replace function public.submit_verdict(_case uuid, _outcome text, _summary text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; t record; win public.case_role; code text;
begin
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can submit the verdict'; end if;
  select * into c from public.cases where id=_case for update;
  if c.locked then raise exception 'Verdict already submitted; case is locked'; end if;
  if c.phase <> 'deliberation' then raise exception 'Verdict can only be submitted during deliberation'; end if;
  if _outcome not in ('guilty','not_guilty','mistrial') then raise exception 'Invalid outcome'; end if;
  if char_length(trim(coalesce(_summary,''))) < 10 then raise exception 'Summary must be at least 10 characters'; end if;
  select * into t from public.jury_tally(_case);
  if t.status = 'pending' then raise exception 'All jurors and the judge must vote first'; end if;
  if t.status = 'majority_guilty' and _outcome <> 'guilty' then raise exception 'Verdict must follow the jury majority (guilty)'; end if;
  if t.status = 'majority_not_guilty' and _outcome <> 'not_guilty' then raise exception 'Verdict must follow the jury majority (not guilty)'; end if;
  win := case _outcome when 'guilty' then 'prosecutor' when 'not_guilty' then 'defense' else null end;
  code := case when win is null then null else 'JR-' || upper(substr(md5(gen_random_uuid()::text),1,10)) end;
  update public.cases set verdict_outcome=_outcome, verdict_summary=trim(_summary), locked=true, phase='closed', closed_at=now(), certificate_code=code where id=_case;
  update public.evidence set expires_at = now() + interval '3 days' where case_id=_case;
  insert into public.hearing_events(case_id, kind, content) values (_case,'system','Verdict entered: ' || replace(upper(_outcome),'_',' ') || '. The case is closed and permanently locked.');
  if win is not null then
    insert into public.certificates(case_id,user_id,role) select case_id,user_id,role from public.case_members where case_id=_case and role=win on conflict do nothing;
  end if;
  perform public.notify_case(_case, 'Verdict entered on "' || c.title || '".' || case when code is null then ' The trial ended without a winner.' else ' Certificate code: ' || code end, null);
end $$;

create or replace function public.verify_certificate_code(_code text)
returns table(certificate_code text, holder text, winner_role public.case_role, case_title text, case_type text, outcome text, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.certificate_code, p.display_name, ce.role, c.title, c.case_type, c.verdict_outcome, ce.issued_at
  from public.cases c join public.certificates ce on ce.case_id = c.id join public.profiles p on p.id = ce.user_id
  where c.certificate_code = upper(trim(_code)) $$;
grant execute on function public.verify_certificate_code(text) to anon, authenticated;
alter publication supabase_realtime add table public.seat_requests;

-- ===================== EVIDENCE APPROVAL =====================
-- New exhibits wait for the judge. Judge, prosecutor and defense see every exhibit (pending, approved, rejected).
-- Jurors only see approved, non-restricted exhibits.
alter table public.evidence
  add column if not exists approval text not null default 'pending' check (approval in ('pending','approved','rejected')),
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz;

create or replace function public.evidence_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reviewed_by := null; new.reviewed_at := null;
  if public.member_role(new.case_id, new.uploaded_by) = 'judge' then new.approval := 'approved';
  else
    new.approval := 'pending';
    insert into public.notifications(user_id, case_id, message)
      select m.user_id, new.case_id, 'New exhibit "' || new.title || '" is waiting for your approval'
      from public.case_members m where m.case_id = new.case_id and m.role = 'judge';
  end if;
  return new;
end $$;
drop trigger if exists evidence_before_insert on public.evidence;
create trigger evidence_before_insert before insert on public.evidence for each row execute function public.evidence_before_insert();

create or replace function public.can_view_evidence(_case uuid, _restricted boolean, _uploader uuid, _user uuid, _approval text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not public.is_member(_case, _user) then false
    when public.member_role(_case, _user) in ('judge','prosecutor','defense') then true
    when _uploader = _user then true
    when _restricted then false
    else _approval = 'approved' end $$;
drop policy if exists "view evidence" on public.evidence;
create policy "view evidence" on public.evidence for select to authenticated
  using (public.can_view_evidence(case_id, restricted, uploaded_by, auth.uid(), approval));
drop policy if exists "evidence read" on storage.objects;
create policy "evidence read" on storage.objects for select to authenticated using (
  bucket_id = 'evidence' and exists (select 1 from public.evidence e where e.file_path = name
    and public.can_view_evidence(e.case_id, e.restricted, e.uploaded_by, auth.uid(), e.approval)));

create or replace function public.review_evidence(_evidence uuid, _approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e public.evidence; c public.cases;
begin
  select * into e from public.evidence where id = _evidence;
  if e.id is null then raise exception 'Exhibit not found'; end if;
  select * into c from public.cases where id = e.case_id;
  if public.member_role(e.case_id, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can approve or reject exhibits'; end if;
  if c.locked then raise exception 'Case is closed and locked'; end if;
  if e.approval <> 'pending' then raise exception 'This exhibit was already reviewed'; end if;
  update public.evidence set approval = case when _approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now() where id = _evidence;
  insert into public.notifications(user_id, case_id, message) values (e.uploaded_by, e.case_id, 'Your exhibit "' || e.title || '" was ' || case when _approve then 'approved' else 'rejected' end || ' by the judge');
  insert into public.hearing_events(case_id, kind, content) values (e.case_id, 'system', 'Exhibit "' || e.title || '" was ' || case when _approve then 'admitted' else 'rejected' end || ' by the judge.');
end $$;

-- ===================== EMAIL INVITATIONS =====================
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  email text not null,
  role public.case_role not null check (role in ('judge','defense','juror')),
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','removed')),
  created_at timestamptz not null default now(), responded_at timestamptz);
create unique index if not exists invitations_one_pending on public.invitations (case_id, lower(email), role) where status = 'pending';
grant select on public.invitations to authenticated;
alter table public.invitations enable row level security;
create policy "invitee or case member reads invitations" on public.invitations for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')) or public.is_member(case_id, auth.uid()));
alter publication supabase_realtime add table public.invitations;

create or replace function public.send_invitation(_case uuid, _email text, _role public.case_role) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; r public.case_role; em text := lower(trim(_email)); uid uuid; inviter text;
begin
  select * into c from public.cases where id = _case;
  r := public.member_role(_case, auth.uid());
  if r is null then raise exception 'Not a member of this case'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if c.locked or c.phase <> 'pre_trial' then raise exception 'Invitations can only be sent before the hearing starts'; end if;
  if not ((r = 'prosecutor' and _role in ('judge','defense')) or (r = 'defense' and _role = 'judge') or (r = 'judge' and _role = 'juror')) then raise exception 'Your role cannot invite a %', _role; end if;
  if _role in ('judge','defense') and exists(select 1 from public.case_members where case_id = _case and role = _role) then raise exception 'The % seat is already taken', _role; end if;
  if _role = 'juror' then
    if coalesce(c.jury_size,0) = 0 then raise exception 'This case does not use a jury. The judge can enable one first'; end if;
    if (select count(*) from public.case_members where case_id = _case and role = 'juror') >= c.jury_size then raise exception 'The jury is full'; end if;
  end if;
  if exists(select 1 from public.case_members m join auth.users u on u.id = m.user_id where m.case_id = _case and lower(u.email) = em) then raise exception 'That person is already in this case'; end if;
  insert into public.invitations(case_id, email, role, invited_by) values (_case, em, _role, auth.uid());
  insert into public.invitation_log(case_id, email, role, action, actor) values (_case, em, _role, 'invited', auth.uid());
  select id into uid from auth.users where lower(email) = em;
  select display_name into inviter from public.profiles where id = auth.uid();
  if uid is not null then
    insert into public.notifications(user_id, case_id, message) values (uid, null, inviter || ' invited you to "' || c.title || '" as ' || _role::text || '. Open your dashboard to respond.');
  end if;
exception when unique_violation then raise exception 'That email already has a pending invitation for this role';
end $$;

create or replace function public.my_invitations() returns table(id uuid, case_id uuid, case_title text, case_type text, role public.case_role, invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.case_id, c.title, c.case_type, i.role, p.display_name, i.created_at
  from public.invitations i join public.cases c on c.id = i.case_id join public.profiles p on p.id = i.invited_by
  where i.status = 'pending' and not c.locked and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email','')) order by i.created_at desc $$;

create or replace function public.respond_invitation(_id uuid, _accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.invitations; c public.cases; uname text; uemail text := lower(coalesce(auth.jwt() ->> 'email',''));
begin
  select * into i from public.invitations where id = _id for update;
  if i.id is null or lower(i.email) <> uemail then raise exception 'Invitation not found'; end if;
  if i.status <> 'pending' then raise exception 'This invitation was already answered'; end if;
  select * into c from public.cases where id = i.case_id;
  select display_name into uname from public.profiles where id = auth.uid();
  if not _accept then
    update public.invitations set status = 'declined', responded_at = now() where id = i.id;
    insert into public.invitation_log(case_id, email, role, action, actor) values (i.case_id, lower(i.email), i.role, 'declined', auth.uid());
    insert into public.notifications(user_id, case_id, message) values (i.invited_by, i.case_id, uname || ' declined the ' || i.role::text || ' invitation for "' || c.title || '"');
    return i.case_id;
  end if;
  if c.locked or c.phase <> 'pre_trial' then raise exception 'This case is no longer accepting participants'; end if;
  if public.is_member(c.id, auth.uid()) then raise exception 'You are already in this case'; end if;
  if i.role in ('judge','defense') and exists(select 1 from public.case_members where case_id = c.id and role = i.role) then raise exception 'The % seat was already filled', i.role; end if;
  if i.role = 'juror' and (coalesce(c.jury_size,0) = 0 or (select count(*) from public.case_members where case_id = c.id and role = 'juror') >= c.jury_size) then raise exception 'The jury is full'; end if;
  insert into public.case_members(case_id, user_id, role, joined_via) values (c.id, auth.uid(), i.role, 'invitation');
  update public.invitations set status = 'accepted', responded_at = now() where id = i.id;
  insert into public.invitation_log(case_id, email, role, action, actor) values (i.case_id, lower(i.email), i.role, 'accepted', auth.uid());
  insert into public.hearing_events(case_id, kind, content) values (c.id, 'system', uname || ' accepted the invitation and joined as ' || i.role::text || '.');
  insert into public.notifications(user_id, case_id, message) values (i.invited_by, c.id, uname || ' accepted your invitation as ' || i.role::text);
  return c.id;
end $$;

-- certificate lookup by code (keeps the old column names so the verify page works unchanged)
drop function if exists public.verify_certificate(uuid);
create or replace function public.verify_certificate(_id text)
returns table(certificate_id text, holder text, role public.case_role, case_title text, outcome text, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.certificate_code, p.display_name, ce.role, c.title, c.verdict_outcome, ce.issued_at
  from public.cases c join public.certificates ce on ce.case_id = c.id join public.profiles p on p.id = ce.user_id
  where c.certificate_code = upper(trim(_id)) $$;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- exactly one judge, one prosecutor and one defense per case
create unique index if not exists one_seat_per_role on public.case_members (case_id, role) where role in ('judge','prosecutor','defense');

-- the judge may remove a juror, but must give a reason (kept in the case log and sent to the juror)
drop function if exists public.remove_juror(uuid, text, uuid);
drop function if exists public.remove_juror(uuid, uuid, text);
create or replace function public.remove_juror(_case uuid, _user uuid, _reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; uname text;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can remove a juror'; end if;
  if c.locked or c.phase not in ('pre_trial','hearing') then raise exception 'Jurors can only be removed before deliberation'; end if;
  if char_length(trim(coalesce(_reason,''))) < 10 then raise exception 'Give a reason of at least 10 characters'; end if;
  if public.member_role(_case, _user) is distinct from 'juror' then raise exception 'That person is not a juror on this case'; end if;
  select display_name into uname from public.profiles where id = _user;
  insert into public.invitation_log(case_id, email, role, action, actor)
    select _case, lower(u.email), 'juror', 'removed', auth.uid() from auth.users u where u.id = _user;
  delete from public.case_members where case_id = _case and user_id = _user;
  insert into public.case_removals(case_id, user_id, reason) values (_case, _user, trim(_reason));
  insert into public.hearing_events(case_id, kind, content) values (_case, 'system', 'Juror ' || uname || ' was removed by the judge. Reason: ' || trim(_reason));
  insert into public.notifications(user_id, case_id, message) values (_user, null, 'You were removed from the jury of "' || c.title || '". Reason: ' || trim(_reason));
end $$;


-- end my turn (for spoken statements; typing a statement also passes the turn)
create or replace function public.pass_turn(_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; r public.case_role;
begin
  select * into c from public.cases where id = _case;
  r := public.member_role(_case, auth.uid());
  if c.locked or c.phase <> 'hearing' then raise exception 'The hearing is not in session'; end if;
  if r not in ('prosecutor','defense') or c.turn <> r::text then raise exception 'It is not your turn'; end if;
  if c.pending_objection is not null then raise exception 'An objection is pending. The judge must rule first'; end if;
  if r in ('prosecutor','defense') and c.stage = 'evidence' then raise exception 'The judge is reviewing the evidence. Please wait until the judge decides'; end if;
  update public.cases set turn = case when r = 'prosecutor' then 'defense' else 'prosecutor' end where id = _case;
  insert into public.hearing_events(case_id, kind, content) values (_case, 'system',
    case when r = 'prosecutor' then 'The prosecutor has finished. The defense may now speak.' else 'The defense has finished. The prosecutor may now speak.' end);
end $$;

-- voice: only members of a case may use its private realtime channel (call setup messages only)
create policy "case members receive voice signals" on realtime.messages for select to authenticated using (
  realtime.messages.extension in ('broadcast') and
  case when realtime.topic() ~ '^voice:[0-9a-f-]{36}$' then public.is_member(substr(realtime.topic(), 7)::uuid, auth.uid()) else false end);
create policy "case members send voice signals" on realtime.messages for insert to authenticated with check (
  realtime.messages.extension in ('broadcast') and
  case when realtime.topic() ~ '^voice:[0-9a-f-]{36}$' then public.is_member(substr(realtime.topic(), 7)::uuid, auth.uid()) else false end);

-- ============ stage flow, join source, removals, emails, public record ============
alter table public.case_members add column if not exists joined_via text not null default 'creator';
alter table public.seat_requests add column if not exists via text not null default 'public';
alter table public.case_members replica identity full;
alter table public.invitations replica identity full;
alter table public.seat_requests replica identity full;

create table if not exists public.case_removals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null, created_at timestamptz not null default now());
grant select on public.case_removals to authenticated;
alter table public.case_removals enable row level security;
create policy "removed user reads own removal" on public.case_removals for select to authenticated using (user_id = auth.uid());
alter publication supabase_realtime add table public.case_removals;

create or replace function public.case_member_emails(_case uuid) returns table(user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text from public.case_members m join auth.users u on u.id = m.user_id
  where m.case_id = _case and public.is_member(_case, auth.uid()) $$;

-- Opening -> Evidence -> (judge confirms the evidence was seen) -> another hearing, or Closing
create or replace function public.end_opening(_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can do this'; end if;
  if c.locked or c.phase <> 'hearing' or c.stage <> 'opening' then raise exception 'The opening stage is not running'; end if;
  if c.pending_objection is not null then raise exception 'Rule on the pending objection first'; end if;
  update public.cases set stage = 'evidence', evidence_seen = false where id = _case;
  insert into public.hearing_events(case_id, kind, content) values (_case, 'system', 'Opening is closed. The evidence stage has begun. The judge will review the exhibits.');
  perform public.notify_case(_case, '"' || c.title || '" moved to the evidence stage', auth.uid());
end $$;

create or replace function public.confirm_evidence_seen(_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can do this'; end if;
  if c.locked or c.phase <> 'hearing' or c.stage <> 'evidence' then raise exception 'The evidence stage is not running'; end if;
  if exists(select 1 from public.evidence where case_id = _case and approval = 'pending') then raise exception 'Approve or reject every pending exhibit first'; end if;
  update public.cases set evidence_seen = true where id = _case;
  insert into public.hearing_events(case_id, kind, content) values (_case, 'system', 'The judge confirmed that all the evidence has been reviewed.');
end $$;

create or replace function public.decide_further_hearing(_case uuid, _further boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; n int;
begin
  select * into c from public.cases where id = _case;
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can do this'; end if;
  if c.locked or c.phase <> 'hearing' or c.stage <> 'evidence' or not c.evidence_seen then raise exception 'Confirm that you have seen the evidence first'; end if;
  if _further then
    n := c.hearing_round + 1;
    update public.cases set stage = 'opening', hearing_round = n, evidence_seen = false, turn = 'prosecutor' where id = _case;
    insert into public.hearing_events(case_id, kind, content) values (_case, 'system', 'Hearing ' || n);
    perform public.notify_case(_case, '"' || c.title || '": hearing ' || n || ' has begun', auth.uid());
  else
    update public.cases set stage = 'closing' where id = _case;
    insert into public.hearing_events(case_id, kind, content) values (_case, 'system', 'No further hearing is required. Closing statements may begin.');
  end if;
end $$;

-- public record behind a certificate code: everything except the chat
create or replace function public.verify_record(_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.cases; parts jsonb; ev jsonb; hidden int; g int; n int; pros text; def text;
begin
  select * into c from public.cases where certificate_code = upper(trim(_code)) and locked;
  if c.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'email', u.email, 'role', m.role)
      order by case m.role when 'judge' then 1 when 'prosecutor' then 2 when 'defense' then 3 else 4 end, m.joined_at), '[]'::jsonb)
    into parts from public.case_members m join public.profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id where m.case_id = c.id;
  select coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'file_name', e.file_name, 'filed_by', p.display_name, 'filed_at', e.created_at, 'path', e.file_path, 'expired', (e.purged_at is not null or (e.expires_at is not null and e.expires_at < now()))) order by e.created_at), '[]'::jsonb)
    into ev from public.evidence e join public.profiles p on p.id = e.uploaded_by where e.case_id = c.id and e.approval = 'approved' and not e.restricted;
  select count(*) into hidden from public.evidence e where e.case_id = c.id and e.approval = 'approved' and e.restricted;
  select count(*) filter (where vote = 'guilty'), count(*) filter (where vote = 'not_guilty') into g, n from public.jury_votes where case_id = c.id and round = c.jury_round;
  select p.display_name into pros from public.case_members m join public.profiles p on p.id = m.user_id where m.case_id = c.id and m.role = 'prosecutor';
  select p.display_name into def from public.case_members m join public.profiles p on p.id = m.user_id where m.case_id = c.id and m.role = 'defense';
  return jsonb_build_object('certificate_code', c.certificate_code, 'title', c.title, 'case_type', c.case_type, 'outcome', c.verdict_outcome,
    'summary', c.verdict_summary, 'closed_at', c.closed_at, 'hearings', c.hearing_round, 'participants', parts, 'evidence', ev, 'hidden_evidence', hidden,
    'votes', jsonb_build_object('guilty', g, 'not_guilty', n), 'prosecutor', pros, 'defense', def);
end $$;
grant execute on function public.verify_record(text) to anon, authenticated;

create or replace function public.schema_version() returns int language sql immutable as $$ select 6 $$;
grant execute on function public.schema_version() to anon, authenticated;

-- ===================== v6: history log, voting with the judge, evidence retention =====================
create table if not exists public.invitation_log (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  email text not null,
  role public.case_role not null,
  action text not null check (action in ('invited','accepted','declined','removed')),
  actor uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now());
grant select on public.invitation_log to authenticated;
alter table public.invitation_log enable row level security;
create policy "members read invitation history" on public.invitation_log for select to authenticated using (public.is_member(case_id, auth.uid()));
alter publication supabase_realtime add table public.invitation_log;
-- one-time backfill of history that existed before the log
insert into public.invitation_log(case_id, email, role, action, actor, created_at)
  select case_id, lower(email), role, 'invited', invited_by, created_at from public.invitations
  where not exists (select 1 from public.invitation_log);
insert into public.invitation_log(case_id, email, role, action, created_at)
  select case_id, lower(email), role, case when status = 'removed' then 'accepted' else status end, coalesce(responded_at, created_at) from public.invitations
  where status in ('accepted','declined','removed') and not exists (select 1 from public.invitation_log where action <> 'invited');

-- voting: jurors AND the judge vote. A single majority decides. Only a tie opens another round, and the judge may always enter the final verdict instead.
create or replace function public.cast_vote(_case uuid, _vote text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; r public.case_role; j int;
begin
  select * into c from public.cases where id = _case;
  r := public.member_role(_case, auth.uid());
  if coalesce(r::text, '') not in ('juror','judge') then raise exception 'Only jurors and the judge can vote'; end if;
  if c.locked or c.phase <> 'deliberation' then raise exception 'Voting is only open during deliberation'; end if;
  if _vote not in ('guilty','not_guilty') then raise exception 'Invalid vote'; end if;
  select count(*) into j from public.case_members where case_id = _case and role = 'juror';
  if j = 0 then raise exception 'With no jury, the judge decides the case directly'; end if;
  if exists(select 1 from public.jury_votes where case_id = _case and user_id = auth.uid() and round = c.jury_round) then raise exception 'You already voted this round'; end if;
  insert into public.jury_votes(case_id, user_id, round, vote) values (_case, auth.uid(), c.jury_round, _vote);
end $$;

create or replace function public.jury_tally(_case uuid)
returns table(round int, jurors int, voted int, guilty int, not_guilty int, status text)
language plpgsql stable security definer set search_path = public as $$
declare c public.cases; j int; g int; n int;
begin
  if not public.is_member(_case, auth.uid()) then raise exception 'Not a member'; end if;
  select * into c from public.cases where id = _case;
  select count(*) into j from public.case_members where case_id = _case and role = 'juror';
  if j > 0 then j := j + 1; end if; -- the judge votes too
  select count(*) filter (where v.vote = 'guilty'), count(*) filter (where v.vote = 'not_guilty') into g, n
    from public.jury_votes v where v.case_id = _case and v.round = c.jury_round;
  round := c.jury_round; jurors := j; guilty := g; not_guilty := n; voted := g + n;
  status := case when j = 0 then 'no_jury' when g + n < j then 'pending' when g > n then 'majority_guilty' when n > g then 'majority_not_guilty' else 'deadlock' end;
  return next;
end $$;

create or replace function public.new_jury_round(_case uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t record; c public.cases;
begin
  if public.member_role(_case, auth.uid()) is distinct from 'judge' then raise exception 'Only the judge can order a new round'; end if;
  select * into c from public.cases where id = _case;
  if c.locked or c.phase <> 'deliberation' then raise exception 'Not in deliberation'; end if;
  select * into t from public.jury_tally(_case);
  if t.status <> 'deadlock' then raise exception 'Another round is only possible when the vote is tied'; end if;
  if c.jury_round >= 3 then raise exception 'Three rounds have been held. Enter the final verdict instead'; end if;
  update public.cases set jury_round = jury_round + 1 where id = _case;
  insert into public.hearing_events(case_id, kind, content) values (_case, 'system', 'The vote was tied. The judge ordered round ' || (c.jury_round + 1) || ' of voting.');
  perform public.notify_case(_case, 'The vote on "' || c.title || '" was tied. A new voting round is open', auth.uid());
  return c.jury_round + 1;
end $$;

-- earlier rounds stay on record (counts only; individual ballots stay secret)
create or replace function public.jury_rounds(_case uuid) returns table(round int, guilty int, not_guilty int)
language sql stable security definer set search_path = public as $$
  select v.round, (count(*) filter (where v.vote = 'guilty'))::int, (count(*) filter (where v.vote = 'not_guilty'))::int
  from public.jury_votes v join public.cases c on c.id = v.case_id
  where v.case_id = _case and (public.member_role(_case, auth.uid()) = 'judge' or (c.locked and public.is_member(_case, auth.uid())))
  group by v.round order by v.round $$;

-- evidence is kept for 3 days after the case is locked, then removed
alter table public.evidence add column if not exists expires_at timestamptz;
alter table public.evidence add column if not exists purged_at timestamptz;
create or replace function public.evidence_is_public(_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.evidence e join public.cases c on c.id = e.case_id
    where e.file_path = _path and e.approval = 'approved' and not e.restricted and c.locked and e.purged_at is null
      and (e.expires_at is null or e.expires_at > now())) $$;
create or replace function public.evidence_is_expired_for_member(_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.evidence e where e.file_path = _path and e.expires_at is not null and e.expires_at < now()
    and public.is_member(e.case_id, auth.uid())) $$;
create policy "closed case evidence is public" on storage.objects for select to anon, authenticated
  using (bucket_id = 'evidence' and public.evidence_is_public(name));
create policy "members remove expired evidence files" on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and public.evidence_is_expired_for_member(name));
create or replace function public.expired_evidence(_case uuid) returns table(id uuid, file_path text)
language sql stable security definer set search_path = public as $$
  select e.id, e.file_path from public.evidence e where e.case_id = _case and e.purged_at is null and e.expires_at is not null and e.expires_at < now()
    and public.is_member(_case, auth.uid()) $$;
create or replace function public.mark_evidence_purged(_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.evidence e set purged_at = now() where e.id = any(_ids) and e.purged_at is null and e.expires_at is not null and e.expires_at < now()
    and public.is_member(e.case_id, auth.uid()) $$;
