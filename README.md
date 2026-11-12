# Barney's Tracker

A shared phone app for looking after Barney: log meals, water, wees, poos and walks in one tap, keep on top of flea and worming treatments, vet and groomer appointments, weight and medication, and see where he'll be each day. Works with no signal and stays in sync between your phones.

Same setup as the gym tracker and House Hunt: `index.html` + `app.jsx` (React, compiled in the browser, no build step), Supabase for logins and data (in the gym tracker's project), hosted on GitHub Pages and added to the Home Screen.

## What's in here

| File | What it is |
|---|---|
| `index.html`, `app.jsx`, `styles.css`, `barney.jpg` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home Screen install, offline copy and notifications |
| `supabase/schema.sql` | Tables, access rules, live updates, reminders schedule. Run once |
| `supabase/functions/bt-push/index.ts` | Edge Function: notifications and the 8am / 12pm / 4pm / 6pm reminders |
| `supabase/functions/bt-calendar/index.ts` | Edge Function: puts plans and appointments in a shared iCloud calendar |
| `supabase/functions/bt-alexa/index.ts` | Edge Function: Barney's summary for Alexa |

## Setup (about 20 minutes)

### 1. Logins
Jack and Jakey already have gym tracker logins. Mum needs one in the same Supabase project: **Authentication → Users → Add user → Create new user**, with her email and a password, and tick **Auto Confirm User**.

### 2. Database
1. Open `supabase/schema.sql` and replace the three emails in step 9 (at the bottom) with the ones you each sign in with.
2. Supabase → **SQL Editor** → New query → paste the whole file → **Run**.
3. The last result should list all three of you. Safe to run again.

Everything is in `bt_` tables, so the gym and house hunt data isn't touched. Only the accounts in `bt_members` can see or change anything.

If the run stops at `pg_cron`, turn it on under **Database → Extensions → pg_cron** and run the file again.

### 3. Functions
Deploy each of these the same way: **Edge Functions → Deploy a new function → Via Editor**, name it exactly as below, paste in the file, **Deploy function**, then open its settings and turn **Verify JWT** off.

| Name | File |
|---|---|
| `bt-push` | `supabase/functions/bt-push/index.ts` |
| `bt-calendar` | `supabase/functions/bt-calendar/index.ts` |
| `bt-alexa` | `supabase/functions/bt-alexa/index.ts` |

JWT verification is off because the database and Alexa can't sign in. Each function checks a private key instead (made by `schema.sql`), and anything from the app is checked against `bt_members`.

No new secrets are needed. The push keys are made the first time someone turns notifications on, and kept in a table only the functions can read.

### 4. iCloud calendar
Plans and appointments go into a shared iCloud calendar called **Barney**.
1. On Jack's iPhone (the Apple ID House Hunt's calendar uses): Calendar → **Calendars** → **Add Calendar** → name it `Barney`, account **iCloud**. Tap ⓘ next to it → **Add Person** → Jakey, then Mum. They accept the invites.
2. The `ICLOUD_APPLE_ID` and `ICLOUD_APP_PASSWORD` secrets House Hunt uses are shared across the project, so there's nothing to add. To use a different calendar name, add a `BT_ICLOUD_CALENDAR` secret.

### 5. GitHub Pages
Repo **Settings → Pages** → Deploy from branch → `main` / root. The app will be at https://jackkianders0n-gif.github.io/barney-tracker/

### 6. Each phone
1. Open the link in **Safari** → Share → **Add to Home Screen**. Delete the old Barney icon.
2. Open Barney from the Home Screen and sign in.
3. **Barney → Notifications → Turn on notifications**. This has to be done from the Home Screen app, not Safari.

### 7. Bring over the old data (once, any of you)
**Barney → Settings → Bring over data**. It copies meals, toilet trips, walks, health logs, vet visits, his details, the food cupboard and the Google Calendar plans from the old app, then sends the plans to the iCloud calendar. Running it again only adds anything new.

The old app only hands over its most recent entries (the last 100 meals, 200 toilet trips, 100 walks, 50 weights and so on) and the latest flea and worming dates, so very old history stays behind.

### 8. Alexa
Copy the link from **Barney → Settings → Alexa link** and swap it in wherever the old `…workers.dev/api/alexa/summary` address was. The answer is in the same shape as before.

### 9. Retire the old app
Once the data is over and Alexa is pointed at the new link, delete these in Cloudflare: the `barney-tracker-api` Worker, the `barney-tracker` D1 database and the `barney-tracker` Pages project. Then delete the OAuth client in Google Cloud Console (APIs & Services → Credentials). The old code had its secret written into it, so it shouldn't be left active.

## Using it
- **Today:** tap Fed, Water, Wee or Poo and it's logged. A bar appears for a few seconds: **Undo** if it was a mistake, **Change** to add details (portion, how much he ate, a note, an earlier time). Walk asks how long, or tap **He's at daycare today**.
- **Needs doing** shows treatments due in the next few days and appointments in the next week. **Done** logs a treatment for today.
- **Food cupboard:** −1 when you open a pouch, +12 when you buy a box. Tap the count to set an exact number or the warning level.
- **Diary:** everything logged, newest first, by day. Tap any entry to change or delete it. **Add** logs something at an earlier time.
- **Health:** treatments, vet and groomer appointments, weight chart, medication, grooming and behaviour notes.
- **Barney:** where he'll be each day, his details (microchip, vet, insurance, emergency contact), notifications and settings.
- **No signal:** logging, changes and deletes save on the phone and send when you're back online. Plans, appointments and details need signal.

### Notifications
- When someone logs a meal, water, wee, poo, walk or daycare day, the others get a notification (not the person who logged it). It waits 12 seconds so an Undo cancels it.
- 8am: flea or worming due, food running low, appointments that day.
- 12pm: if no meal has been logged. 4pm: if he hasn't been walked. 6pm: if fewer than two meals have been logged.

## Updating
After changing any file, bump `CACHE` in `sw.js` (`barney-v1` → `barney-v2`) and `APP_VERSION` in `app.jsx`, so phones pick up the new version. The app offers a reload when it sees one.
