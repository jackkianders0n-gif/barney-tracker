# Barney's Tracker — notes for Claude Code

A shared phone app for Jack, Jakey and Mum to look after Barney (a cockapoo): one-tap logging of meals, water, wees, poos and walks; treatments, vet and groomer appointments, weight, medication, grooming and behaviour notes; where he'll be each day (synced to a shared iCloud calendar); push notifications and reminders.

## Working with Jack
- List observations and ask before building. Don't pick what to implement yourself.
- Keep replies concise and direct. UK English. Never use the word "seldom".
- Jack has no local Node environment. No build step, no npm — changes must work as plain files on GitHub Pages.
- The app should stay easy to use and doggy, with few emoji: icons are drawn SVGs in `ICONS` in `app.jsx`.

## Stack
- `index.html` loads React 18, supabase-js v2 and Babel standalone from jsDelivr, then `app.jsx` as `type="text/babel"` (compiled in the browser, like the gym tracker and House Hunt).
- Hosting: GitHub Pages from `main` / root → https://jackkianders0n-gif.github.io/barney-tracker/ — installed on each iPhone via Safari → Add to Home Screen.
- Backend: the **gym tracker's Supabase project**. Everything Barney is prefixed `bt_` — never touch the gym (`*`) or house hunt (`hh_*`) tables.
- Same origin as House Hunt (`jackkianders0n-gif.github.io`), so localStorage keys are prefixed `bt-` and the supabase auth storage key is `bt-auth`. Caches are `barney-*`.
- Replaces an older version on Cloudflare (Pages + Worker + D1, Google Calendar OAuth). `OLD_API` in `app.jsx` is only used by the one-off import.

## Rules that bite
- **Bump `CACHE` in `sw.js` and `APP_VERSION` in `app.jsx` on every change to app files**, or the phones keep the old version.
- CDN scripts: exact pinned versions on cdn.jsdelivr.net (never `@2`), UMD builds (supabase-js: `dist/umd/supabase.js`). The same URLs are in `index.html` and `LIBRARIES` in `sw.js`; change both together.
- `SUPABASE_URL` in `app.jsx` must be the bare project URL — no trailing slash, no `/rest/v1/`. The publishable key is fine in public code; access rules protect the data.
- The project URL is also written into `bt_call()` in `schema.sql` (the database calls the functions with it).
- Never commit personal emails or secrets. `supabase/schema.sql` keeps placeholder emails on purpose.
- iOS: inputs need `font-size: 16px` or Safari zooms on focus. Respect safe areas (`env(safe-area-inset-*)`). `Notification.requestPermission()` must be the first thing awaited in the tap handler.
- Times are UK local time. Plans and appointments store a `date` plus `time` (wall clock); the functions convert with `Europe/London`.

## Files
| Path | What |
|---|---|
| `app.jsx` | The whole app: data store (`useBarney`), hash router (`#/today`, `#/diary`, `#/health`, `#/barney[/plans]`), all screens and sheets, the old-app import |
| `styles.css` | All styles; colour tokens at the top |
| `sw.js` | Service worker: app files network-first, CDN cache-first; `push` and `notificationclick` handlers |
| `barney.jpg` | Default photo (Barney → Change photo stores a replacement in `bt_settings.photo`) |
| `supabase/schema.sql` | Full database setup, idempotent (safe to rerun) |
| `supabase/functions/bt-push/index.ts` | Web push (RFC 8291 aes128gcm + VAPID, Web Crypto only), log notifications, hourly reminders |
| `supabase/functions/bt-calendar/index.ts` | iCloud CalDAV sync for plans and appointments (same discovery as House Hunt's `hh-calendar`) |
| `supabase/functions/bt-alexa/index.ts` | GET summary for Alexa, same JSON shape as the old `/api/alexa/summary` |

## Data model (Supabase, all RLS: members only via `bt_is_member()`)
- `bt_members` — the three user ids allowed in (Jack, Jakey, Mum). No policies; read only by security-definer `bt_is_member()` and `bt_member_names()`.
- `bt_log` — one row per thing logged. `kind` ∈ fed, water, wee, poo, walk, daycare, flea, worm, weight, med, behaviour, grooming. `at` (when it happened), `details` jsonb (fed `{portion: full|half|treat, eaten: 0–100}`, walk `{mins, distance}`, weight `{kg}`, med `{name, dose}`, behaviour/grooming `{type}`; imported rows also `{by}`), `note`, `created_by` (defaults to `auth.uid()`; null on imported rows), `legacy_id` (unique, set by the import).
- `bt_plans` — where Barney will be: `place` ∈ home, mum, jakey, daycare, walk; `day`, `all_day`, `start_time`, `end_time`, `note`; `repeat_id` + `repeat_day` on rows made from a weekly plan (unique together; `repeat_day` stays put if the plan is moved).
- `bt_plan_repeats` — weekly plans: `place`, `weekdays` int[] (1 = Mon … 7 = Sun), `all_day`, `start_time`, `end_time`, `note`, `starts_on`, `ends_on` (optional), `skipped` date[]. `bt_fill_repeats()` adds their days to `bt_plans` 8 weeks ahead (nightly pg_cron job `bt-repeats`, and on insert/update). Adding, changing or stopping one (`bt_repeat_changed`) deletes its plans from today on and refills them with `bt.regen` set, so those don't count as skipped or call the calendar one by one; it then calls `bt-calendar {all:true}` once. Deleting one day of it (`bt_plans_skipped`) adds that day to `skipped`.
- `bt_appointments` — `kind` ∈ vet, grooming; `day`, `at_time` (optional), `title`, `notes`. Upcoming = `day >= today`.
- `bt_settings` (key/value jsonb): `food` `{pouches, alert_at}` (change it with RPC `bt_food_update(p_delta, p_pouches, p_alert_at)` so two phones don't overwrite each other), `info` (microchip, vet, vet_phone, insurance, emergency_name, emergency_phone, notes), `photo` (data URL), `alexa_key`, `icloud_status` `{ok, error?, count?, removed?, at}`, `imported_at`, `treatments` `{flea|worm: {every, unit: days|weeks|months, due?, due_set_at?}}` (defaults flea 4 weeks, worm 3 months; `due` is a date set by hand and wins until a dose is logged with `at` after `due_set_at`. The rule is repeated in `treatmentPlan()` in the app, and `treatmentDates()` in `bt-push` and `bt-calendar`).
- `bt_push_subscriptions` — one row per phone (`endpoint` unique, `subscription` jsonb, `device_name`, `user_id`).
- `bt_secrets` — RLS on, no policies, no grants: `fn_key` (the database's key for calling the functions, header `x-bt-key`) and `vapid` (push keys, made by `bt-push` on first use).
- Triggers: `bt_log_notify` (insert of fed/water/wee/poo/walk/daycare, not imported, not >6h old) → `bt-push {action:"log"}`; `bt_plans_calendar` / `bt_appointments_calendar` → `bt-calendar {type, id}` (imported inserts and weekly-plan rebuilds skipped; those run a full sync instead, which `bt-calendar` runs in the background when the database asks); `bt_log_treatment_calendar` (flea/worm rows) and `bt_settings_treatment_calendar` (key `treatments`) → `bt-calendar {type:"treat"}`, which moves the all-day `bt-treat-flea.ics` / `bt-treat-worm.ics` events to the next due date. All via `bt_call()` and pg_net.
- pg_cron job `bt-reminders` runs `bt_run_reminders()` hourly; `bt-push` acts at 8, 12, 16 and 18 UK time.
- All `bt_` tables except members and secrets are in `supabase_realtime`; the app reloads on changes.

## How the app handles data
- `useBarney()` loads the last 60 days of logs (plus all weights and the latest treatments), plans from 4 weeks back, weekly plans, all appointments, settings, phones and member names; caches it in localStorage (`bt-cache-v1`); subscribes to realtime.
- Log inserts, edits and deletes, and food cupboard changes, go through `commit()`: they show at once, are kept in an outbox (`bt-queue-v1`) and sent in order; on a network error they wait and retry. Inserts carry a client-made uuid and use `upsert … ignoreDuplicates`, so a retry never doubles up. Undoing something that hasn't been sent just drops it.
- Plans, appointments, details, photo and phones need signal (`online()` helper), and say so.
- One-tap logs show the Undo bar (`UndoBar`, 6 seconds). `bt-push` waits 12 seconds and re-reads the row before notifying, so Undo cancels the notification.

## Changing the backend
- **Database:** write idempotent SQL (`create … if not exists`, `add column if not exists`, `drop policy if exists` then `create policy`). Any new table: `bt_` prefix, RLS on, `bt members only` policy using `bt_is_member()`, grants to `authenticated`, add to `supabase_realtime`. Update `schema.sql` too, and give Jack the snippet to run in **Supabase → SQL Editor**.
- **Edge Functions:** after editing, Jack redeploys in **Supabase → Edge Functions** (paste into the function's editor and deploy). All three have **Verify JWT off**. Functions deployed from the dashboard editor can't share files, so small helpers are repeated in each.
- iCloud secrets are shared with House Hunt: `ICLOUD_APPLE_ID`, `ICLOUD_APP_PASSWORD`; optional `BT_ICLOUD_CALENDAR` (default `Barney`). Optional `PUSH_SUBJECT` for VAPID (defaults to the app URL).

## Design
Biscuit theme: cream `#FBF4EA`, apricot `#E9B97F` (his coat), tan `#C98A4B` (icons; `#8A5523` for tan text), navy `#1B2340` (ink and the collar). Display type Baloo 2, body Figtree. Every screen's header is the navy "collar" (paw weave, stitched edge); on Today, Barney's photo hangs from it like a tag. Treatments are dog-tag shaped. Phone-first, 44px+ touch targets, max width 560px. No emoji in the interface.

## Before pushing
- Check `app.jsx` still parses (a JSX syntax error shows a blank screen on the phones).
- Bump `CACHE` in `sw.js` and `APP_VERSION` in `app.jsx`.
- Say what Jack needs to do outside the repo (SQL to run, function to redeploy), if anything.
