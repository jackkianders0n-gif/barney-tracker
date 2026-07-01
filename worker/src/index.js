// Barney Tracker — Cloudflare Worker API

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const GOOGLE_CLIENT_ID     = "367028371700-oqiilok6tgej5enleq9ch0nide00pn5p.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const GOOGLE_TOKEN_URL     = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API  = "https://www.googleapis.com/calendar/v3";
const REDIRECT_URI         = "https://barney-tracker-api.barneythebigdog.workers.dev/api/auth/callback";
const APP_URL              = "https://barney-tracker.pages.dev";
const TOKEN_KEY            = "google_tokens"; // KV key — store tokens in D1 instead

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function err(msg, status = 400) { return json({ error: msg }, status); }

// ── TOKEN HELPERS ─────────────────────────────────────────────────────────────

async function saveTokens(db, tokens) {
  const val = JSON.stringify(tokens);
  await db.prepare(
    "INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)"
  ).bind(TOKEN_KEY, val, new Date().toISOString()).run();
}

async function loadTokens(db) {
  const row = await db.prepare("SELECT value FROM kv_store WHERE key = ?").bind(TOKEN_KEY).first();
  return row ? JSON.parse(row.value) : null;
}

async function refreshAccessToken(db, refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to refresh token");
  const tokens = {
    access_token:  data.access_token,
    refresh_token: refreshToken, // refresh token doesn't change
    expires_at:    Date.now() + (data.expires_in * 1000),
  };
  await saveTokens(db, tokens);
  return tokens;
}

async function getValidToken(db) {
  const tokens = await loadTokens(db);
  if (!tokens) return null;
  // Refresh if expiring within 5 minutes
  if (Date.now() > tokens.expires_at - 300000) {
    return await refreshAccessToken(db, tokens.refresh_token);
  }
  return tokens;
}

// ── GOOGLE CALENDAR PROXY ─────────────────────────────────────────────────────

async function gcalProxy(db, gcalPath, method = "GET", body = null) {
  const tokens = await getValidToken(db);
  if (!tokens) throw new Error("Not authenticated");
  const opts = {
    method,
    headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${GOOGLE_CALENDAR_API}${gcalPath}`, opts);
  if (res.status === 204) return { ok: true };
  return res.json();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, "");
    const method = request.method;
    const db     = env.DB;

    try {

      // ── AUTH: Start OAuth flow ────────────────────────────────
      if (path === "/api/auth/google" && method === "GET") {
        const params = new URLSearchParams({
          client_id:     GOOGLE_CLIENT_ID,
          redirect_uri:  REDIRECT_URI,
          response_type: "code",
          scope:         "https://www.googleapis.com/auth/calendar",
          access_type:   "offline",
          prompt:        "consent", // force refresh token every time
        });
        return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
      }

      // ── AUTH: OAuth callback ──────────────────────────────────
      if (path === "/api/auth/callback" && method === "GET") {
        const code = url.searchParams.get("code");
        if (!code) return Response.redirect(`${APP_URL}?auth=error`, 302);

        const res = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id:     GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri:  REDIRECT_URI,
            grant_type:    "authorization_code",
          }),
        });
        const data = await res.json();
        if (!data.access_token || !data.refresh_token) {
          return Response.redirect(`${APP_URL}?auth=error`, 302);
        }
        await saveTokens(db, {
          access_token:  data.access_token,
          refresh_token: data.refresh_token,
          expires_at:    Date.now() + (data.expires_in * 1000),
        });
        return Response.redirect(`${APP_URL}?auth=success`, 302);
      }

      // ── AUTH: Check status ────────────────────────────────────
      if (path === "/api/auth/status" && method === "GET") {
        const tokens = await loadTokens(db);
        return json({ connected: !!tokens });
      }

      // ── AUTH: Disconnect ──────────────────────────────────────
      if (path === "/api/auth/disconnect" && method === "POST") {
        await db.prepare("DELETE FROM kv_store WHERE key = ?").bind(TOKEN_KEY).run();
        return json({ ok: true });
      }

      // ── CALENDAR: Get events ──────────────────────────────────
      if (path === "/api/gcal/events" && method === "GET") {
        const timeMin = url.searchParams.get("timeMin");
        const timeMax = url.searchParams.get("timeMax");
        const data = await gcalProxy(db,
          `/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
        );
        const barneyEvents = (data.items || []).filter(e => e.summary?.startsWith("🐾 Barney"));
        return json(barneyEvents);
      }

      // ── CALENDAR: Create event ────────────────────────────────
      if (path === "/api/gcal/events" && method === "POST") {
        const body = await request.json();
        const data = await gcalProxy(db, "/calendars/primary/events", "POST", body);
        return json(data);
      }

      // ── CALENDAR: Delete event ────────────────────────────────
      if (path.startsWith("/api/gcal/events/") && method === "DELETE") {
        const eventId = path.split("/").pop();
        await gcalProxy(db, `/calendars/primary/events/${eventId}`, "DELETE");
        return json({ ok: true });
      }

      // ── FEEDING ───────────────────────────────────────────────
      if (path === "/api/feeding" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM feeding ORDER BY created_at DESC LIMIT 100").all();
        return json(results);
      }
      if (path === "/api/feeding" && method === "POST") {
        const { logged_by, amount, note } = await request.json();
        await db.prepare("INSERT INTO feeding (created_at, logged_by, amount, note) VALUES (?, ?, ?, ?)").bind(new Date().toISOString(), logged_by, amount, note || null).run();
        return json({ ok: true });
      }

      // ── TOILET ────────────────────────────────────────────────
      if (path === "/api/toilet" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM toilet ORDER BY created_at DESC LIMIT 200").all();
        return json(results);
      }
      if (path === "/api/toilet" && method === "POST") {
        const { logged_by, type } = await request.json();
        await db.prepare("INSERT INTO toilet (created_at, logged_by, type) VALUES (?, ?, ?)").bind(new Date().toISOString(), logged_by, type).run();
        return json({ ok: true });
      }

      // ── FOOD STOCK ────────────────────────────────────────────
      if (path === "/api/food" && method === "GET") {
        const row = await db.prepare("SELECT * FROM food_stock WHERE id = 1").first();
        return json(row);
      }
      if (path === "/api/food" && method === "PUT") {
        const { pouches, alert_at, updated_by } = await request.json();
        await db.prepare("UPDATE food_stock SET pouches = ?, alert_at = ?, updated_at = ?, updated_by = ? WHERE id = 1").bind(pouches, alert_at, new Date().toISOString(), updated_by).run();
        return json({ ok: true });
      }

      // ── TREATMENTS ────────────────────────────────────────────
      if (path === "/api/treatments" && method === "GET") {
        const flea = await db.prepare("SELECT * FROM treatments WHERE type = 'flea' ORDER BY treated_at DESC LIMIT 1").first();
        const worm = await db.prepare("SELECT * FROM treatments WHERE type = 'worm' ORDER BY treated_at DESC LIMIT 1").first();
        return json({ flea, worm });
      }
      if (path === "/api/treatments" && method === "POST") {
        const { type, logged_by, treated_at } = await request.json();
        await db.prepare("INSERT INTO treatments (type, treated_at, logged_by) VALUES (?, ?, ?)").bind(type, treated_at || new Date().toISOString(), logged_by).run();
        return json({ ok: true });
      }

      // ── CALENDAR EVENTS (D1) ──────────────────────────────────
      if (path === "/api/calendar" && method === "GET") {
        const from = url.searchParams.get("from") || "";
        const to   = url.searchParams.get("to")   || "9999-12-31";
        const { results } = await db.prepare("SELECT * FROM calendar_events WHERE event_date >= ? AND event_date <= ? ORDER BY event_date, start_time").bind(from, to).all();
        return json(results);
      }
      if (path === "/api/calendar" && method === "POST") {
        const { id, event_date, location_id, start_time, end_time, all_day, note, added_by } = await request.json();
        await db.prepare("INSERT INTO calendar_events (id, event_date, location_id, start_time, end_time, all_day, note, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, event_date, location_id, start_time || null, end_time || null, all_day ? 1 : 0, note || null, added_by, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (path.startsWith("/api/calendar/") && method === "DELETE") {
        await db.prepare("DELETE FROM calendar_events WHERE id = ?").bind(path.split("/").pop()).run();
        return json({ ok: true });
      }

      // ── WEIGHT ────────────────────────────────────────────────
      if (path === "/api/weight" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM weight ORDER BY logged_date ASC LIMIT 50").all();
        return json(results);
      }
      if (path === "/api/weight" && method === "POST") {
        const { weight_kg, logged_by } = await request.json();
        await db.prepare("INSERT INTO weight (logged_date, weight_kg, logged_by) VALUES (?, ?, ?)").bind(new Date().toISOString().slice(0,10), weight_kg, logged_by).run();
        return json({ ok: true });
      }

      // ── WALKS ─────────────────────────────────────────────────
      if (path === "/api/walks" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM walks ORDER BY created_at DESC LIMIT 100").all();
        return json(results);
      }
      if (path === "/api/walks" && method === "POST") {
        const { logged_by, duration_mins, distance, note } = await request.json();
        await db.prepare("INSERT INTO walks (created_at, logged_by, duration_mins, distance, note) VALUES (?, ?, ?, ?, ?)").bind(new Date().toISOString(), logged_by, duration_mins, distance || null, note || null).run();
        return json({ ok: true });
      }

      // ── MEDICATIONS ───────────────────────────────────────────
      if (path === "/api/medications" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM medications ORDER BY created_at DESC LIMIT 100").all();
        return json(results);
      }
      if (path === "/api/medications" && method === "POST") {
        const { logged_by, name, dose, note } = await request.json();
        await db.prepare("INSERT INTO medications (created_at, logged_by, name, dose, note) VALUES (?, ?, ?, ?, ?)").bind(new Date().toISOString(), logged_by, name, dose || null, note || null).run();
        return json({ ok: true });
      }

      // ── BEHAVIOUR ─────────────────────────────────────────────
      if (path === "/api/behaviour" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM behaviour ORDER BY created_at DESC LIMIT 100").all();
        return json(results);
      }
      if (path === "/api/behaviour" && method === "POST") {
        const { logged_by, type, note } = await request.json();
        await db.prepare("INSERT INTO behaviour (created_at, logged_by, type, note) VALUES (?, ?, ?, ?)").bind(new Date().toISOString(), logged_by, type, note || null).run();
        return json({ ok: true });
      }

      // ── VET APPOINTMENTS ──────────────────────────────────────
      if (path === "/api/vet" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM vet_appointments ORDER BY appt_date DESC").all();
        return json(results);
      }
      if (path === "/api/vet" && method === "POST") {
        const { id, appt_date, reason, notes, upcoming, added_by } = await request.json();
        await db.prepare("INSERT INTO vet_appointments (id, appt_date, reason, notes, upcoming, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, appt_date, reason, notes || null, upcoming ? 1 : 0, added_by, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (path.startsWith("/api/vet/") && method === "DELETE") {
        await db.prepare("DELETE FROM vet_appointments WHERE id = ?").bind(path.split("/").pop()).run();
        return json({ ok: true });
      }

      // ── INFO CARD ─────────────────────────────────────────────
      if (path === "/api/info" && method === "GET") {
        const row = await db.prepare("SELECT * FROM info_card WHERE id = 1").first();
        return json(row || {});
      }
      if (path === "/api/info" && method === "PUT") {
        const { microchip, vet, vet_phone, insurance, emergency_name, emergency_phone, notes } = await request.json();
        await db.prepare("UPDATE info_card SET microchip=?, vet=?, vet_phone=?, insurance=?, emergency_name=?, emergency_phone=?, notes=?, updated_at=? WHERE id=1").bind(microchip, vet, vet_phone, insurance, emergency_name, emergency_phone, notes, new Date().toISOString()).run();
        return json({ ok: true });
      }

      // ── GROOMING ──────────────────────────────────────────────
      if (path === "/api/grooming" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM grooming ORDER BY created_at DESC LIMIT 50").all();
        return json(results);
      }
      if (path === "/api/grooming" && method === "POST") {
        const { logged_by, type, note } = await request.json();
        await db.prepare("INSERT INTO grooming (created_at, logged_by, type, note) VALUES (?, ?, ?, ?)").bind(new Date().toISOString(), logged_by, type, note || null).run();
        return json({ ok: true });
      }

      // ── MOOD ──────────────────────────────────────────────────
      if (path === "/api/mood" && method === "GET") {
        const { results } = await db.prepare("SELECT * FROM mood ORDER BY logged_date DESC LIMIT 50").all();
        return json(results);
      }
      if (path === "/api/mood" && method === "POST") {
        const { mood, logged_by, note } = await request.json();
        await db.prepare("INSERT INTO mood (logged_date, mood, logged_by, note) VALUES (?, ?, ?, ?)").bind(new Date().toISOString().slice(0,10), mood, logged_by, note || null).run();
        return json({ ok: true });
      }

      // ── ALEXA SUMMARY ─────────────────────────────────────────
      if (path === "/api/alexa/summary" && method === "GET") {
        const today = new Date().toISOString().slice(0,10);
        const [lastFeed, lastWee, lastPoo, food, todayWalks, nextVet, flea, worm] = await Promise.all([
          db.prepare("SELECT * FROM feeding ORDER BY created_at DESC LIMIT 1").first(),
          db.prepare("SELECT * FROM toilet WHERE type='wee' ORDER BY created_at DESC LIMIT 1").first(),
          db.prepare("SELECT * FROM toilet WHERE type='poo' ORDER BY created_at DESC LIMIT 1").first(),
          db.prepare("SELECT * FROM food_stock WHERE id=1").first(),
          db.prepare("SELECT SUM(duration_mins) as total FROM walks WHERE created_at LIKE ?").bind(`${today}%`).first(),
          db.prepare("SELECT * FROM vet_appointments WHERE upcoming=1 AND appt_date >= ? ORDER BY appt_date ASC LIMIT 1").bind(today).first(),
          db.prepare("SELECT * FROM treatments WHERE type='flea' ORDER BY treated_at DESC LIMIT 1").first(),
          db.prepare("SELECT * FROM treatments WHERE type='worm' ORDER BY treated_at DESC LIMIT 1").first(),
        ]);
        return json({ lastFeed, lastWee, lastPoo, food, todayWalkMins: todayWalks?.total || 0, nextVet, flea, worm });
      }

      return err("Not found", 404);
    } catch (e) {
      console.error(e);
      return err("Server error: " + e.message, 500);
    }
  }
};
