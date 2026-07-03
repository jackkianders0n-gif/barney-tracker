/ Barney Tracker — Cloudflare Worker API
 
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
 
 
const VAPID_PUBLIC_KEY  = "BDL-4Qg2xdz5eWGweQaOm9mtrLP6-uxnr5S-eJ7e0TW9au_jHzQwOfnloaPRabQhr7GLQaWBkIYJvRvVEgVgeMY";
const VAPID_PRIVATE_KEY = "npMmXEx8elpvzwEOvC0DNhsp3QDokt2CQpbljBxOpnM";
const VAPID_SUBJECT     = "mailto:barney@barneythebigdog.com";
const APP_ORIGIN        = "https://barney-tracker.pages.dev";
 
// ── VAPID / WEB PUSH HELPERS ──────────────────────────────────────────────────
 
function b64urlToBytes(b64) {
  const pad = b64.replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
 
function bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
 
async function getVapidHeaders(audience) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { typ:'JWT', alg:'ES256' };
  const payload = { aud:audience, exp:now+43200, sub:VAPID_SUBJECT };
  const enc = s => bytesToB64url(new TextEncoder().encode(JSON.stringify(s)));
  const sigInput = enc(header) + '.' + enc(payload);
 
  const privBytes = b64urlToBytes(VAPID_PRIVATE_KEY);
  const privKey = await crypto.subtle.importKey(
    'raw', privBytes,
    { name:'ECDSA', namedCurve:'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name:'ECDSA', hash:'SHA-256' },
    privKey,
    new TextEncoder().encode(sigInput)
  );
  const jwt = sigInput + '.' + bytesToB64url(new Uint8Array(sig));
  return {
    Authorization: `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
    'Content-Type': 'application/octet-stream',
    TTL: '86400',
  };
}
 
async function sendPush(subscription, payload) {
  const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
  const endpoint = sub.endpoint;
  const audience = new URL(endpoint).origin;
  const headers  = await getVapidHeaders(audience);
 
  // Encrypt payload using Web Push content encryption (aes128gcm)
  // For simplicity use the push service's public key from the subscription
  const authBytes = b64urlToBytes(sub.keys.auth);
  const p256dhBytes = b64urlToBytes(sub.keys.p256dh);
 
  // Generate salt and ephemeral key pair
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const localKeyPair = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']);
  const localPubRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
 
  // Import receiver public key
  const recvPubKey = await crypto.subtle.importKey('raw', p256dhBytes, { name:'ECDH', namedCurve:'P-256' }, false, []);
 
  // Derive shared secret
  const sharedBits = await crypto.subtle.deriveBits({ name:'ECDH', public:recvPubKey }, localKeyPair.privateKey, 256);
 
  // HKDF to derive PRK
  const authInfo  = new TextEncoder().encode('Content-Encoding: auth');
  const authKey   = await crypto.subtle.importKey('raw', authBytes, 'HKDF', false, ['deriveBits']);
  const prk = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt:new Uint8Array(sharedBits), info:authInfo }, authKey, 256);
 
  // Derive CEK and nonce
  const localPubArr = new Uint8Array(localPubRaw);
  const keyInfo   = buildInfo('aesgcm', p256dhBytes, localPubArr);
  const nonceInfo = buildInfo('nonce',  p256dhBytes, localPubArr);
 
  const prkKey = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
  const cekBits   = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info:keyInfo   }, prkKey, 128);
  const nonceBits = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info:nonceInfo }, prkKey, 96);
 
  const cek   = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const nonce = new Uint8Array(nonceBits);
 
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const padded    = new Uint8Array([0, 0, ...plaintext]); // 2-byte padding length prefix = 0
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv:nonce }, cek, padded);
 
  // Build body: salt (16) + rs (4) + keyid_len (1) + localPubKey (65) + ciphertext
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  const body = concatBuffers(salt, rs, new Uint8Array([65]), localPubArr, new Uint8Array(ciphertext));
 
  headers['Content-Encoding'] = 'aesgcm';
  headers['Encryption'] = 'salt=' + bytesToB64url(salt);
  headers['Crypto-Key'] = `dh=${bytesToB64url(localPubArr)};p256ecdsa=${VAPID_PUBLIC_KEY}`;
  headers['Content-Type'] = 'application/octet-stream';
 
  const resp = await fetch(endpoint, { method:'POST', headers, body });
  return resp.status < 300 || resp.status === 410;
}
 
function buildInfo(type, recvPub, senderPub) {
  const label = new TextEncoder().encode('Content-Encoding: ' + type + '\0P-256\0');
  const recvLen  = new Uint8Array([0, recvPub.length]);
  const senderLen = new Uint8Array([0, senderPub.length]);
  return concatBuffers(label, recvLen, recvPub, senderLen, senderPub);
}
 
function concatBuffers(...bufs) {
  const total = bufs.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of bufs) { out.set(new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer, b.byteOffset, b.byteLength), offset); offset += b.byteLength; }
  return out;
}
 
async function notifyAll(db, payload) {
  let { results } = await db.prepare("SELECT * FROM push_subscriptions").all();
  for (const row of results) {
    try { await sendPush(row.subscription, payload); } catch(e) { console.error('Push failed', e); }
  }
}
 
export default {
  async scheduled(event, env) {
    // Called by Cloudflare Cron — run the push check
    const url = "https://barney-tracker-api.barneythebigdog.workers.dev/api/push/check";
    await fetch(url, { method: "POST" });
  },
 
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
 
      // ── PUSH: Get VAPID public key ────────────────────────────
      if (path === "/api/push/vapid-key" && method === "GET") {
        return json({ publicKey: VAPID_PUBLIC_KEY });
      }
 
      // ── PUSH: Save subscription ───────────────────────────────
      if (path === "/api/push/subscribe" && method === "POST") {
        const { subscription, deviceName } = await request.json();
        const id = Date.now().toString(36);
        await db.prepare(
          "INSERT OR REPLACE INTO push_subscriptions (id, subscription, device_name, created_at) VALUES (?, ?, ?, ?)"
        ).bind(id, JSON.stringify(subscription), deviceName || "Device", new Date().toISOString()).run();
        return json({ ok: true });
      }
 
      // ── PUSH: List subscriptions ──────────────────────────────
      if (path === "/api/push/subscriptions" && method === "GET") {
        const { results } = await db.prepare("SELECT id, device_name, created_at FROM push_subscriptions").all();
        return json(results);
      }
 
      // ── PUSH: Delete subscription ─────────────────────────────
      if (path.startsWith("/api/push/subscribe/") && method === "DELETE") {
        await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(path.split("/").pop()).run();
        return json({ ok: true });
      }
 
      // ── PUSH: Send test notification ──────────────────────────
      if (path === "/api/push/test" && method === "POST") {
        await notifyAll(db, { title:"Barney's Tracker 🐾", body:"Notifications are working!", tag:"test" });
        return json({ ok: true });
      }
 
      // ── PUSH: Send notification to all ────────────────────────
      if (path === "/api/push/send" && method === "POST") {
        const payload = await request.json();
        await notifyAll(db, payload);
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
        if (amount !== "Water") {
          notifyAll(db, { title:"🍽️ Barney has been fed", body:`${amount}${note ? ' · ' + note : ''}`, tag:"feeding" }).catch(()=>{});
        }
        return json({ ok: true });
      }
      if (path.startsWith("/api/feeding/") && method === "DELETE") {
        await db.prepare("DELETE FROM feeding WHERE id = ?").bind(path.split("/").pop()).run();
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
        notifyAll(db, { title: type === "wee" ? "💧 Barney had a wee" : "💩 Barney had a poo", body:"Logged just now", tag:"toilet" }).catch(()=>{});
        return json({ ok: true });
      }
      if (path.startsWith("/api/toilet/") && method === "DELETE") {
        await db.prepare("DELETE FROM toilet WHERE id = ?").bind(path.split("/").pop()).run();
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
        const isDay = distance === "daycare";
        notifyAll(db, {
          title: isDay ? "🐾 Barney is at daycare" : `🦮 Barney has been walked`,
          body: isDay ? (note || "Daycare day logged") : `${duration_mins} mins${distance && !isDay ? ' · ' + distance : ''}${note ? ' · ' + note : ''}`,
          tag: "walk"
        }).catch(()=>{});
        return json({ ok: true });
      }
      if (path.startsWith("/api/walks/") && method === "DELETE") {
        await db.prepare("DELETE FROM walks WHERE id = ?").bind(path.split("/").pop()).run();
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
      if (path.startsWith("/api/medications/") && method === "DELETE") {
        await db.prepare("DELETE FROM medications WHERE id = ?").bind(path.split("/").pop()).run();
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
      if (path.startsWith("/api/behaviour/") && method === "DELETE") {
        await db.prepare("DELETE FROM behaviour WHERE id = ?").bind(path.split("/").pop()).run();
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
      if (path.startsWith("/api/grooming/") && method === "DELETE") {
        await db.prepare("DELETE FROM grooming WHERE id = ?").bind(path.split("/").pop()).run();
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
 
 
      // ── PUSH: Scheduled checks (called by Cloudflare Cron) ───
      if (path === "/api/push/check" && method === "POST") {
        const now   = new Date();
        const today = now.toISOString().slice(0,10);
        const hour  = now.getUTCHours(); // adjust for BST: UTC+1
        const bstHour = (hour + 1) % 24; // approximate BST
 
        const food  = await db.prepare("SELECT * FROM food_stock WHERE id=1").first();
        const flea  = await db.prepare("SELECT * FROM treatments WHERE type='flea' ORDER BY treated_at DESC LIMIT 1").first();
        const worm  = await db.prepare("SELECT * FROM treatments WHERE type='worm' ORDER BY treated_at DESC LIMIT 1").first();
        const lastWalk = await db.prepare("SELECT * FROM walks ORDER BY created_at DESC LIMIT 1").first();
 
        // Feeds today
        const todayFeeds = await db.prepare(
          "SELECT * FROM feeding WHERE created_at >= ? AND amount != 'Water' ORDER BY created_at ASC"
        ).bind(today + "T00:00:00.000Z").all();
        const feedCount = todayFeeds.results?.length || 0;
 
        // Walks today (including daycare)
        const todayWalks = await db.prepare(
          "SELECT * FROM walks WHERE created_at >= ?"
        ).bind(today + "T00:00:00.000Z").all();
        const walkedToday = (todayWalks.results?.length || 0) > 0;
 
        const notifications = [];
 
        // Food low
        if (food && food.pouches <= food.alert_at) {
          notifications.push({ title:"🥫 Barney's food is running low", body:`Only ${food.pouches} pouches left — time to restock!`, tag:"food-low" });
        }
 
        // Flea due
        if (flea) {
          const days = Math.floor((Date.now() - new Date(flea.treated_at)) / 86400000);
          if (days >= 28) notifications.push({ title:"🐛 Flea treatment is due", body:"It's been " + days + " days since the last treatment", tag:"flea-due" });
        }
 
        // Worming due
        if (worm) {
          const days = Math.floor((Date.now() - new Date(worm.treated_at)) / 86400000);
          if (days >= 90) notifications.push({ title:"🪱 Worming treatment is due", body:"It's been " + days + " days since the last treatment", tag:"worm-due" });
        }
 
        // Not walked before 4pm — fire check at 4pm BST (15:00 UTC)
        if (hour === 15 && !walkedToday) {
          notifications.push({ title:"🦮 Barney hasn't been walked yet", body:"It's past 4pm and no walk has been logged today", tag:"walk-due" });
        }
 
        // Not fed morning meal before 12pm — fire check at 12pm BST (11:00 UTC)
        if (hour === 11 && feedCount === 0) {
          notifications.push({ title:"🍽️ Barney hasn't had breakfast", body:"No meals logged yet today — it's almost midday!", tag:"feed-morning" });
        }
 
        // Not fed afternoon/evening meal before 6pm — fire check at 6pm BST (17:00 UTC)
        if (hour === 17 && feedCount < 2) {
          notifications.push({ title:"🍽️ Barney needs his evening meal", body:"Only " + feedCount + " meal" + (feedCount === 1 ? "" : "s") + " logged today — it's nearly 6pm", tag:"feed-evening" });
        }
 
        for (const n of notifications) {
          await notifyAll(db, n);
        }
        return json({ ok: true, sent: notifications.length });
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
 
