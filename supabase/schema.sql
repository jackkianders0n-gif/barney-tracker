-- =====================================================================
-- Barney's Tracker — database setup
-- Run this in the gym tracker's Supabase project:
--   Dashboard → SQL Editor → New query → paste all of this → Run
--
-- Everything is prefixed bt_ so it sits alongside the gym and house hunt
-- tables without touching them. Only the people in bt_members (step 9 at the
-- bottom) can see or change anything. Safe to run again.
--
-- This copy has placeholder emails so it's safe in a public repo. Your real
-- emails only ever go into the copy you paste into the SQL Editor.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;


-- 1. Members: the only accounts that can see or change Barney's data
create table if not exists public.bt_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  added_at     timestamptz not null default now()
);
alter table public.bt_members enable row level security;
-- No policies on purpose: the app never reads this table directly.

create or replace function public.bt_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.bt_members where user_id = auth.uid());
$$;
revoke all on function public.bt_is_member() from public;
grant execute on function public.bt_is_member() to authenticated;

-- Names, so the app can show who logged what (members only)
create or replace function public.bt_member_names()
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.display_name from public.bt_members m
   where public.bt_is_member()
   order by m.display_name;
$$;
revoke all on function public.bt_member_names() from public;
grant execute on function public.bt_member_names() to authenticated;


-- 2. The log: every meal, wee, poo, walk, treatment, weight, medicine,
--    behaviour note and grooming session, one row each
create table if not exists public.bt_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in (
                'fed','water','wee','poo','walk','daycare',
                'flea','worm','weight','med','behaviour','grooming')),
  at          timestamptz not null default now(),
  details     jsonb not null default '{}'::jsonb,
  -- fed:       { portion: full|half|treat, eaten: 0–100 }
  -- walk:      { mins, distance }
  -- weight:    { kg }
  -- med:       { name, dose }
  -- behaviour: { type }     grooming: { type }
  -- imported rows also carry { by: "<old logged_by>" }
  note        text not null default '',
  created_by  uuid default auth.uid(),
  legacy_id   text unique,          -- set on rows brought over from the old app
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bt_log_at_idx on public.bt_log (at desc);
create index if not exists bt_log_kind_at_idx on public.bt_log (kind, at desc);


-- 3. Where Barney will be (shows in the shared iCloud calendar)
create table if not exists public.bt_plans (
  id          uuid primary key default gen_random_uuid(),
  place       text not null check (place in ('home','mum','jakey','daycare','walk')),
  day         date not null,
  all_day     boolean not null default false,
  start_time  time,
  end_time    time,
  note        text not null default '',
  created_by  uuid default auth.uid(),
  legacy_id   text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bt_plans_day_idx on public.bt_plans (day);


-- 4. Vet and grooming appointments (also go into the iCloud calendar)
create table if not exists public.bt_appointments (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('vet','grooming')),
  day         date not null,
  at_time     time,
  title       text not null default '',
  notes       text not null default '',
  created_by  uuid default auth.uid(),
  legacy_id   text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bt_appointments_day_idx on public.bt_appointments (day);


-- 5. Shared settings: food cupboard, Barney's details, photo, Alexa link key,
--    iCloud sync status
create table if not exists public.bt_settings (
  key    text primary key,
  value  jsonb not null
);

-- Phones that get notifications
create table if not exists public.bt_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  endpoint      text not null unique,
  subscription  jsonb not null,
  device_name   text not null default '',
  user_id       uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

-- Keys only the Edge Functions can read (push keys, the key the database
-- uses to call the functions). No access rules, so the app can't read it.
create table if not exists public.bt_secrets (
  key    text primary key,
  value  jsonb not null
);
alter table public.bt_secrets enable row level security;
revoke all on public.bt_secrets from anon, authenticated;


-- 6. Keep updated_at current
create or replace function public.bt_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bt_log_touch on public.bt_log;
create trigger bt_log_touch before update on public.bt_log
  for each row execute function public.bt_touch_updated_at();
drop trigger if exists bt_plans_touch on public.bt_plans;
create trigger bt_plans_touch before update on public.bt_plans
  for each row execute function public.bt_touch_updated_at();
drop trigger if exists bt_appointments_touch on public.bt_appointments;
create trigger bt_appointments_touch before update on public.bt_appointments
  for each row execute function public.bt_touch_updated_at();


-- 7. Access rules: members only, on every table
do $$
declare t text;
begin
  foreach t in array array['bt_log','bt_plans','bt_appointments','bt_settings','bt_push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "bt members only" on public.%I', t);
    execute format('create policy "bt members only" on public.%I for all to authenticated
                      using (public.bt_is_member()) with check (public.bt_is_member())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Live updates between phones
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['bt_log','bt_plans','bt_appointments','bt_settings','bt_push_subscriptions'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;  -- already added
      end;
    end loop;
  end if;
end $$;

-- Change the food cupboard without overwriting someone else's change
create or replace function public.bt_food_update(p_delta integer default 0, p_pouches integer default null, p_alert_at integer default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v jsonb;
begin
  insert into public.bt_settings (key, value) values ('food', '{"pouches":0,"alert_at":5}'::jsonb)
  on conflict (key) do nothing;
  update public.bt_settings
     set value = jsonb_build_object(
           'pouches',  greatest(0, coalesce(p_pouches, coalesce((value->>'pouches')::int, 0) + coalesce(p_delta, 0))),
           'alert_at', greatest(0, coalesce(p_alert_at, coalesce((value->>'alert_at')::int, 5))))
   where key = 'food'
  returning value into v;
  return v;
end;
$$;
grant execute on function public.bt_food_update(integer, integer, integer) to authenticated;


-- Starting values and private keys
insert into public.bt_settings (key, value) values
  ('food', '{"pouches":0,"alert_at":5}'::jsonb),
  ('info', '{}'::jsonb),
  ('alexa_key', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;

insert into public.bt_secrets (key, value) values
  ('fn_key', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;


-- 8. Notifications and the iCloud calendar.
-- The database calls the bt-push and bt-calendar Edge Functions with pg_net,
-- using the private fn_key. If your project URL ever changes, update it here.
create or replace function public.bt_call(p_fn text, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare k text;
begin
  select value #>> '{}' into k from public.bt_secrets where key = 'fn_key';
  if k is null then return; end if;
  perform net.http_post(
    url     := 'https://wvedhcuebfdfkhfvphlb.supabase.co/functions/v1/' || p_fn,
    body    := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bt-key', k)
  );
end;
$$;
revoke all on function public.bt_call(text, jsonb) from public, anon, authenticated;

-- A notification when someone logs a meal, water, wee, poo, walk or daycare day.
-- (Not for rows brought over from the old app, or for logs more than 6 hours old.)
create or replace function public.bt_log_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.legacy_id is null
     and new.kind in ('fed','water','wee','poo','walk','daycare')
     and new.at > now() - interval '6 hours' then
    perform public.bt_call('bt-push', jsonb_build_object('action', 'log', 'id', new.id));
  end if;
  return null;
end;
$$;
revoke all on function public.bt_log_notify() from public;

drop trigger if exists bt_log_notify on public.bt_log;
create trigger bt_log_notify after insert on public.bt_log
  for each row execute function public.bt_log_notify();

-- Plans and appointments go into the shared iCloud calendar
create or replace function public.bt_calendar_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := case tg_table_name when 'bt_plans' then 'plan' else 'appt' end;
begin
  if tg_op = 'DELETE' then
    perform public.bt_call('bt-calendar', jsonb_build_object('type', t, 'id', old.id));
  elsif not (tg_op = 'INSERT' and new.legacy_id is not null) then
    -- imported rows are sent in one go by "Sync calendar now" instead
    perform public.bt_call('bt-calendar', jsonb_build_object('type', t, 'id', new.id));
  end if;
  return null;
end;
$$;
revoke all on function public.bt_calendar_notify() from public;

drop trigger if exists bt_plans_calendar on public.bt_plans;
create trigger bt_plans_calendar after insert or update or delete on public.bt_plans
  for each row execute function public.bt_calendar_notify();
drop trigger if exists bt_appointments_calendar on public.bt_appointments;
create trigger bt_appointments_calendar after insert or update or delete on public.bt_appointments
  for each row execute function public.bt_calendar_notify();

-- Reminders: every hour, bt-push checks the UK time and sends the 8am, 12pm,
-- 4pm and 6pm reminders when they're due (so it's right in summer and winter).
create or replace function public.bt_run_reminders()
returns void
language sql
security definer
set search_path = public
as $$
  select public.bt_call('bt-push', jsonb_build_object('action', 'check'));
$$;
revoke all on function public.bt_run_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bt-reminders') then
    perform cron.unschedule('bt-reminders');
  end if;
  perform cron.schedule('bt-reminders', '0 * * * *', 'select public.bt_run_reminders()');
end $$;


-- 9. Add the three of you as members.
--    Replace the emails with the ones you sign in with. Mum needs a login in
--    this project first: Authentication → Users → Add user.
insert into public.bt_members (user_id, display_name)
select id, 'Jack' from auth.users where email = 'YOUR-EMAIL@example.com'
on conflict (user_id) do update set display_name = excluded.display_name;

insert into public.bt_members (user_id, display_name)
select id, 'Jakey' from auth.users where email = 'JAKEY-EMAIL@example.com'
on conflict (user_id) do update set display_name = excluded.display_name;

insert into public.bt_members (user_id, display_name)
select id, 'Mum' from auth.users where email = 'MUM-EMAIL@example.com'
on conflict (user_id) do update set display_name = excluded.display_name;

-- Check: this should list all three of you
select m.display_name, u.email from public.bt_members m join auth.users u on u.id = m.user_id;
