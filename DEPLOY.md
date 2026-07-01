# Barney Tracker — Deployment Guide (No Node.js required)

Everything is done through the Cloudflare dashboard and GitHub. No terminal needed.

---

## Step 1: Push the code to GitHub

1. Extract the zip file on your computer
2. Open your GitHub repo: https://github.com/jackkianders0n-gif/barney-tracker
3. Upload the files — you can drag and drop them directly in the GitHub web interface:
   - Click **Add file → Upload files**
   - Drag in everything from the extracted zip
   - Click **Commit changes**

Your repo should end up with this structure:
```
barney-tracker/
├── worker/
│   ├── src/index.js
│   ├── schema.sql
│   ├── wrangler.toml
│   └── package.json
└── app/
    ├── src/
    │   ├── App.jsx
    │   └── main.jsx
    ├── index.html
    ├── package.json
    └── vite.config.js
```

---

## Step 2: Set up the D1 database tables

1. Go to dash.cloudflare.com
2. Click **Workers & Pages → D1**
3. Click on your **barney-tracker** database
4. Click the **Console** tab
5. Open `worker/schema.sql` from your extracted zip in any text editor
6. Copy the entire contents and paste it into the Console
7. Click **Execute**

You should see a success message. This creates all the tables Barney's data will live in.

---

## Step 3: Create and deploy the Worker

1. In the Cloudflare dashboard, go to **Workers & Pages → Create**
2. Click **Create Worker**
3. Name it `barney-tracker-api`
4. Click **Deploy** (just to get past the initial screen)
5. Click **Edit code**
6. Open `worker/src/index.js` from your extracted zip in any text editor
7. Select all the code in the Cloudflare editor and delete it
8. Paste in the contents of `index.js`
9. Click **Deploy**

---

## Step 4: Bind the D1 database to the Worker

After deploying the Worker:

1. Go to your Worker → **Settings → Bindings**
2. Click **Add binding**
3. Choose **D1 Database**
4. Set the variable name to exactly: `DB`
5. Select **barney-tracker** from the dropdown
6. Click **Save**

---

## Step 5: Get your Worker URL

1. Go to your Worker's overview page
2. You'll see a URL like:
   https://barney-tracker-api.YOUR-SUBDOMAIN.workers.dev
3. Copy this URL — you need it in the next step

---

## Step 6: Update the Worker URL in the app

1. In your GitHub repo, open `app/src/App.jsx`
2. Click the pencil icon to edit
3. Find line 7:

   const WORKER_URL = "https://barney-tracker-api.YOUR-SUBDOMAIN.workers.dev";

4. Replace YOUR-SUBDOMAIN with your actual subdomain
5. Click **Commit changes**

IMPORTANT: Just like Pegasus, always check this line hasn't been
reset if you ever push from a different branch.

---

## Step 7: Deploy the frontend on Cloudflare Pages

1. Go to **Workers & Pages → Create → Pages**
2. Click **Connect to Git**
3. Select your **barney-tracker** GitHub repo
4. Set the build settings:
   - Framework preset: Vite
   - Root directory: app
   - Build command: npm run build
   - Build output directory: dist
5. Click **Save and Deploy**

Cloudflare handles the build in the cloud — no Node.js needed on your end.

Your app will be live at something like:
https://barney-tracker.pages.dev

---

## Step 8: Add to home screen on all three phones

On each iPhone (Jack, Jakey, Mum):

1. Open Safari (must be Safari, not Chrome)
2. Go to your Pages URL
3. Tap the Share button (box with arrow)
4. Tap Add to Home Screen
5. Name it Barney
6. Tap Add

It will appear as an icon on the home screen and open full screen like a proper app.

---

## Troubleshooting

App loads but data won't save
→ Check the Worker URL in App.jsx is correct (Step 6)
→ Check the D1 binding is named exactly DB (Step 4)

Pages build fails
→ Make sure Root directory is set to app not the repo root

D1 Console errors on schema
→ Safe to ignore "table already exists" errors — just means it ran before

---

## Alexa (Phase 2 — when you're ready)

The Worker already has a summary endpoint built:
GET /api/alexa/summary

When we build the Alexa skill, this is the URL it will call to get
Barney's stats. No changes needed to the Worker for that step.
