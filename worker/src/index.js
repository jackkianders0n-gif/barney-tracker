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
  const authInfo  = new TextEncoder().encode('Content-Encoding: auth
