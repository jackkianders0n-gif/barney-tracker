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

-- Weekly plans (daycare every Tuesday and Thursday, Mum's every Sunday…).
-- The database adds each one's days to bt_plans 8 weeks ahead (bt_fill_repeats),
-- so everything else just sees ordinary plans. weekdays: 1 = Monday … 7 = Sunday.
-- A day someone deletes goes into skipped and isn't added again.
create table if not exists public.bt_plan_repeats (
  id          uuid primary key default gen_random_uuid(),
  place       text not null check (place in ('home','mum','jakey','daycare','walk')),
  weekdays    int[] not null check (cardinality(weekdays) > 0 and weekdays <@ array[1,2,3,4,5,6,7]),
  all_day     boolean not null default false,
  start_time  time,
  end_time    time,
  note        text not null default '',
  starts_on   date not null default ((now() at time zone 'Europe/London')::date),
  ends_on     date,
  skipped     date[] not null default '{}',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Plans made from a weekly plan: which one, and the day it was for (kept if
-- the plan is moved to another day, so it isn't added twice)
alter table public.bt_plans add column if not exists repeat_id uuid;
alter table public.bt_plans add column if not exists repeat_day date;
create unique index if not exists bt_plans_repeat_idx on public.bt_plans (repeat_id, repeat_day);


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
--    iCloud sync status, flea and worming schedule
--    (treatments: { flea: { every, unit: days|weeks|months, due?, due_set_at? }, worm: … })
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
-- Which logs and reminders this phone hears about; null means everything.
-- fed, water, toilet (wees and poos), walk (walks and daycare),
-- nudges (12pm, 4pm, 6pm meal and walk reminders), care (8am: treatments, food, appointments)
alter table public.bt_push_subscriptions add column if not exists notify text[];

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
drop trigger if exists bt_plan_repeats_touch on public.bt_plan_repeats;
create trigger bt_plan_repeats_touch before update on public.bt_plan_repeats
  for each row execute function public.bt_touch_updated_at();


-- 7. Access rules: members only, on every table
do $$
declare t text;
begin
  foreach t in array array['bt_log','bt_plans','bt_plan_repeats','bt_appointments','bt_settings','bt_push_subscriptions'] loop
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
    foreach t in array array['bt_log','bt_plans','bt_plan_repeats','bt_appointments','bt_settings','bt_push_subscriptions'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;  -- already added
      end;
    end loop;
  end if;
end $$;

-- Food: Barney's kibble, in grams. { grams, counted_at, meal_g, bag_g, alert_days }:
-- grams is how much there was at counted_at; what's left now is that minus the
-- meals logged since (full portion = meal_g, half = half that, treat only = 0).
-- The app works it out the same way (foodStatus in app.jsx); bt-push and
-- bt-alexa call this.
create or replace function public.bt_food_status(p_at timestamptz default now())
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with f as (
    select value, coalesce((value->>'meal_g')::numeric, 90) as meal_g from public.bt_settings where key = 'food'
  ), used as (
    select f.meal_g * coalesce((
             select sum(case l.details->>'portion' when 'half' then 0.5 when 'treat' then 0 else 1 end)
               from public.bt_log l
              where l.kind = 'fed' and l.at > (f.value->>'counted_at')::timestamptz and l.at <= p_at), 0) as g
      from f
  ), recent as (  -- grams a day over the last fortnight (two meals a day until there's enough to go on)
    select count(*) as meals,
           coalesce(sum(case l.details->>'portion' when 'half' then 0.5 when 'treat' then 0 else 1 end), 0) as portions,
           min(l.at) as first_at
      from public.bt_log l
     where l.kind = 'fed' and l.at > p_at - interval '14 days' and l.at <= p_at
  ), calc as (
    select greatest(0, coalesce((f.value->>'grams')::numeric, 0) - used.g) as left_g,
           f.meal_g * case when recent.meals >= 4
                           then recent.portions / greatest(1, least(14, extract(epoch from p_at - recent.first_at) / 86400))
                           else 2 end as per_day_g,
           f.value
      from f, used, recent
  )
  select jsonb_build_object(
           'left_g', round(left_g),
           'per_day_g', round(per_day_g),
           'days_left', case when per_day_g > 0 then floor(left_g / per_day_g) end,
           'alert_days', coalesce((value->>'alert_days')::int, 5),
           'counted_at', value->>'counted_at')
    from calc;
$$;
grant execute on function public.bt_food_status(timestamptz) to authenticated;

-- Bought food (p_add grams), said how full the bag is (p_set grams), or changed
-- the settings. p_at is when it happened on the phone, so a change sent later
-- from the outbox still lines up with the meals around it.
drop function if exists public.bt_food_update(integer, integer, integer);
drop function if exists public.bt_food_update(numeric, numeric, integer, timestamptz);
create or replace function public.bt_food_update(
  p_add numeric default null, p_set numeric default null, p_at timestamptz default now(),
  p_meal_g integer default null, p_bag_g integer default null, p_alert_days integer default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v jsonb;
  left_g numeric;
begin
  insert into public.bt_settings (key, value) values ('food', '{"meal_g":90,"bag_g":6000,"alert_days":5}'::jsonb)
  on conflict (key) do nothing;
  if p_add is not null or p_set is not null then
    left_g := coalesce((public.bt_food_status(p_at)->>'left_g')::numeric, 0);
    update public.bt_settings
       set value = value || jsonb_build_object('grams', round(greatest(0, coalesce(p_set, left_g + p_add))), 'counted_at', p_at)
     where key = 'food';
  end if;
  update public.bt_settings
     set value = value || jsonb_strip_nulls(jsonb_build_object(  -- only the ones given
           'meal_g', case when p_meal_g is not null then greatest(1, p_meal_g) end,
           'bag_g', case when p_bag_g is not null then greatest(1, p_bag_g) end,
           'alert_days', case when p_alert_days is not null then greatest(0, p_alert_days) end))
   where key = 'food';
  select value into v from public.bt_settings where key = 'food';
  return v;
end;
$$;
grant execute on function public.bt_food_update(numeric, numeric, timestamptz, integer, integer, integer) to authenticated;


-- Starting values and private keys
insert into public.bt_settings (key, value) values
  ('food', '{"meal_g":90,"bag_g":6000,"alert_days":5}'::jsonb),
  ('info', '{}'::jsonb),
  ('alexa_key', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;

-- From the old pouch counter: switch to kibble. How much is left isn't known
-- until someone taps Bought food or says how full the bag is.
update public.bt_settings
   set value = jsonb_build_object('meal_g', 90, 'bag_g', 6000, 'alert_days', coalesce((value->>'alert_days')::int, 5))
 where key = 'food' and not value ? 'meal_g';
-- His bags are 6kg (an earlier draft of this said 2kg): fix it if no one has used it yet
update public.bt_settings set value = value || '{"bag_g":6000}'::jsonb
 where key = 'food' and (value->>'bag_g')::int = 2000 and not value ? 'grams';

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
  -- a weekly plan being rebuilt sends one full sync at the end instead
  if coalesce(current_setting('bt.regen', true), '') = 'on' then return null; end if;
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

-- When flea and worming are next due also goes into the calendar: it moves when
-- a dose is logged, changed or removed, or the due date or how often is changed
create or replace function public.bt_treatment_calendar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare hit boolean := false;
begin
  if tg_table_name = 'bt_settings' then
    hit := new.key = 'treatments';
  else
    if tg_op <> 'DELETE' then
      -- imported rows are sent in one go by "Sync calendar now" instead
      hit := new.kind in ('flea','worm') and not (tg_op = 'INSERT' and new.legacy_id is not null);
    end if;
    if tg_op <> 'INSERT' and not hit then
      hit := old.kind in ('flea','worm');
    end if;
  end if;
  if hit then
    perform public.bt_call('bt-calendar', jsonb_build_object('type', 'treat'));
  end if;
  return null;
end;
$$;
revoke all on function public.bt_treatment_calendar() from public;

drop trigger if exists bt_log_treatment_calendar on public.bt_log;
create trigger bt_log_treatment_calendar after insert or update or delete on public.bt_log
  for each row execute function public.bt_treatment_calendar();
drop trigger if exists bt_settings_treatment_calendar on public.bt_settings;
create trigger bt_settings_treatment_calendar after insert or update on public.bt_settings
  for each row execute function public.bt_treatment_calendar();

-- Weekly plans: add their days as ordinary plans, 8 weeks ahead (each one
-- goes into the calendar through bt_plans_calendar). Skipped days aren't added.
create or replace function public.bt_fill_repeats(p_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare today date := (now() at time zone 'Europe/London')::date;
begin
  insert into public.bt_plans (place, day, all_day, start_time, end_time, note, created_by, repeat_id, repeat_day)
  select r.place, d::date, r.all_day, r.start_time, r.end_time, r.note, r.created_by, r.id, d::date
    from public.bt_plan_repeats r
   cross join lateral generate_series(greatest(r.starts_on, today), least(coalesce(r.ends_on, today + 56), today + 56), interval '1 day') d
   where (p_id is null or r.id = p_id)
     and extract(isodow from d)::int = any (r.weekdays)
     and not (d::date = any (r.skipped))
  on conflict (repeat_id, repeat_day) do nothing;
end;
$$;
revoke all on function public.bt_fill_repeats(uuid) from public, anon, authenticated;

-- A weekly plan added, changed or stopped: take its days from today on away
-- and (unless stopped) add them again. The calendar gets one full sync after,
-- rather than an update for every day.
create or replace function public.bt_repeat_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.place, new.weekdays, new.all_day, new.start_time, new.end_time, new.note, new.starts_on, new.ends_on)
         is not distinct from
         (old.place, old.weekdays, old.all_day, old.start_time, old.end_time, old.note, old.starts_on, old.ends_on) then
    return null;  -- only the skipped days changed
  end if;
  perform set_config('bt.regen', 'on', true);  -- not skipped days, no calendar call each
  if tg_op <> 'INSERT' then
    delete from public.bt_plans where repeat_id = old.id and day >= (now() at time zone 'Europe/London')::date;
  end if;
  if tg_op <> 'DELETE' then
    perform public.bt_fill_repeats(new.id);
  end if;
  perform set_config('bt.regen', 'off', true);
  perform public.bt_call('bt-calendar', jsonb_build_object('all', true));
  if tg_op = 'DELETE' then return old; end if;
  return null;
end;
$$;
revoke all on function public.bt_repeat_changed() from public;

drop trigger if exists bt_plan_repeats_changed on public.bt_plan_repeats;
create trigger bt_plan_repeats_changed after insert or update on public.bt_plan_repeats
  for each row execute function public.bt_repeat_changed();
drop trigger if exists bt_plan_repeats_stopped on public.bt_plan_repeats;
create trigger bt_plan_repeats_stopped before delete on public.bt_plan_repeats
  for each row execute function public.bt_repeat_changed();

-- Someone deleted one day of a weekly plan (a bank holiday, say): remember it
create or replace function public.bt_plan_skipped()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.repeat_id is not null
     and coalesce(current_setting('bt.regen', true), '') <> 'on'
     and old.repeat_day >= (now() at time zone 'Europe/London')::date then
    update public.bt_plan_repeats set skipped = array_append(skipped, old.repeat_day)
     where id = old.repeat_id and not (old.repeat_day = any (skipped));
  end if;
  return null;
end;
$$;
revoke all on function public.bt_plan_skipped() from public;

drop trigger if exists bt_plans_skipped on public.bt_plans;
create trigger bt_plans_skipped after delete on public.bt_plans
  for each row execute function public.bt_plan_skipped();

-- Every night, add the next day of each weekly plan
do $$
begin
  if exists (select 1 from cron.job where jobname = 'bt-repeats') then
    perform cron.unschedule('bt-repeats');
  end if;
  perform cron.schedule('bt-repeats', '15 1 * * *', 'select public.bt_fill_repeats()');
end $$;

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
