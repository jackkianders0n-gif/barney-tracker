// Barney's Tracker — notifications Edge Function
//
// POST {"action":"vapid"}            → the public key phones subscribe with (members)
// POST {"action":"test"}             → a test notification to your own phones (members)
// POST {"action":"log","id":"<id>"}  → tell everyone else about a new log (database trigger),
//                                      on the phones that chose to hear about that kind
// POST {"action":"check"}            → the 8am / 12pm / 4pm / 6pm reminders (hourly cron job)
//
// Needs "Verify JWT" turned OFF: the database can't sign in. Calls from the
// database carry the private fn_key in an x-bt-key header; calls from the app
// are checked against bt_members.
//
// The push keys are made on first use and kept in bt_secrets, so there are no
// secrets to add. Optional secret: PUSH_SUBJECT (defaults to the app's address).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = "https://jackkianders0n-gif.github.io/barney-tracker/";
const TZ = "Europe/London";
// Flea and worming: how often unless changed in the app (bt_settings.treatments).
// The same rules as treatmentPlan() in app.jsx, also repeated in bt-calendar.
const TREATMENTS = [
  { kind: "flea", label: "flea treatment", every: 4, unit: "weeks" },
  { kind: "worm", label: "worming tablet", every: 3, unit: "months" },
];
const LOG_DELAY_MS = 12000; // wait before sending, so an Undo in the app cancels it

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bt-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Admin = ReturnType<typeof createClient>;
// group: which of a phone's notification choices (bt_push_subscriptions.notify) it belongs to.
// null notify = everything.
type Message = { title: string; body: string; tag: string; url?: string; group?: string };
const LOG_GROUP: Record<string, string> = { fed: "fed", water: "water", wee: "toilet", poo: "toilet", walk: "walk", daycare: "walk" };
const wants = (s: any, group?: string) => !group || !Array.isArray(s.notify) || s.notify.includes(group);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Use POST", { status: 405, headers: CORS });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const fromDatabase = await keyMatches(admin, req.headers.get("x-bt-key"));
  const me = fromDatabase ? null : await memberFromRequest(req);
  if (!fromDatabase && !me) return json({ error: "This account isn't set up for Barney's Tracker." }, 403);

  try {
    switch (body?.action) {
      case "vapid":
        return json({ publicKey: (await vapidKeys(admin)).publicKey });

      case "test": {
        if (!me) return json({ error: "Sign in to send a test" }, 403);
        const { data: subs } = await admin.from("bt_push_subscriptions").select("*").eq("user_id", me.id);
        if (!subs?.length) return json({ error: "This account has no phones with notifications turned on." }, 400);
        const result = await sendToAll(admin, subs, { title: "Barney's Tracker", body: "Notifications are working on this phone.", tag: "test" });
        return json(result);
      }

      case "log": {
        if (!fromDatabase) return json({ error: "Not allowed" }, 403);
        if (typeof body.id !== "string") return json({ error: "Missing id" }, 400);
        const work = sendLog(admin, body.id);
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          EdgeRuntime.waitUntil(work);
          return json({ ok: true }, 202);
        }
        return json(await work);
      }

      case "check": {
        if (!fromDatabase) return json({ error: "Not allowed" }, 403);
        return json(await runReminders(admin, typeof body.hour === "number" ? body.hour : null));
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong sending notifications." }, 500);
  }
});

// ---------------------------------------------------------------------
// Who's calling

async function keyMatches(admin: Admin, key: string | null): Promise<boolean> {
  if (!key) return false;
  const { data } = await admin.from("bt_secrets").select("value").eq("key", "fn_key").maybeSingle();
  return typeof data?.value === "string" && sameText(data.value, key);
}

async function memberFromRequest(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: isMember, error } = await client.rpc("bt_is_member");
  if (error || isMember !== true) return null;
  const { data: user } = await client.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  return user?.user ? { id: user.user.id } : null;
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------
// New logs

async function sendLog(admin: Admin, id: string) {
  await new Promise((r) => setTimeout(r, LOG_DELAY_MS));
  const { data: log } = await admin.from("bt_log").select("*").eq("id", id).maybeSingle();
  if (!log) return { sent: 0, skipped: "undone" };
  const name = log.created_by ? await memberName(admin, log.created_by) : null;
  const msg = logMessage(log, name);
  if (!msg) return { sent: 0 };
  const { data: subs } = await admin.from("bt_push_subscriptions").select("*");
  // Everyone except the person who logged it
  const group = LOG_GROUP[log.kind];
  const targets = (subs ?? []).filter((s: any) => (!log.created_by || s.user_id !== log.created_by) && wants(s, group));
  return await sendToAll(admin, targets, msg);
}

async function memberName(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin.from("bt_members").select("display_name").eq("user_id", userId).maybeSingle();
  return data?.display_name ?? null;
}

const PORTION: Record<string, string> = { full: "Full portion", half: "Half portion", treat: "Treat only" };

function logMessage(log: any, name: string | null): Message | null {
  const d = log.details ?? {};
  const late = Date.now() - new Date(log.at).getTime() > 20 * 60 * 1000 ? ` at ${clock(new Date(log.at))}` : "";
  const by = name ? `Logged by ${name}${late}.` : `Logged${late}.`;
  switch (log.kind) {
    case "fed": {
      const eaten = typeof d.eaten === "number" ? (d.eaten >= 100 ? "ate it all" : d.eaten <= 0 ? "didn't eat it" : `ate ${d.eaten}%`) : null;
      const what = [PORTION[d.portion] ?? "A meal", eaten].filter(Boolean).join(", ");
      return { title: "Barney's been fed", body: `${what}. ${by}`, tag: "fed" };
    }
    case "water": return { title: "Barney's water is topped up", body: by, tag: "water" };
    case "wee": return { title: "Barney's had a wee", body: by, tag: "toilet" };
    case "poo": return { title: "Barney's done a poo", body: by, tag: "toilet" };
    case "walk": {
      const mins = d.mins ? `${d.mins} minutes` : "A walk";
      return { title: "Barney's been for a walk", body: `${mins}${name ? ` with ${name}` : ""}${late}.`, tag: "walk" };
    }
    case "daycare": return { title: "Barney's at doggy daycare", body: by, tag: "walk" };
    default: return null;
  }
}

// ---------------------------------------------------------------------
// Reminders

async function runReminders(admin: Admin, forceHour: number | null) {
  const now = new Date();
  const local = londonParts(now);
  const hour = forceHour ?? local.hour;
  if (![8, 12, 16, 18].includes(hour)) return { hour, sent: 0 };

  const dayStart = londonMidnight(local.date).toISOString();
  const messages: Message[] = [];

  if (hour === 8) {
    // Kibble left is estimated from the meals logged since the last bag or check
    const { data: food } = await admin.rpc("bt_food_status");
    if (food?.counted_at) {
      const left = Number(food.left_g ?? 0);
      const days = food.days_left == null ? null : Number(food.days_left);
      if (left <= 0) messages.push({ title: "Time to buy Barney's food", body: "By the meals logged, his kibble has run out.", tag: "food", group: "care" });
      else if (days != null && days <= Number(food.alert_days ?? 5)) {
        messages.push({
          title: "Time to buy Barney's food",
          body: `About ${weight(left)} of kibble left, roughly ${days} ${days === 1 ? "day" : "days"}.`,
          tag: "food", group: "care",
        });
      }
    }

    for (const t of await treatmentDates(admin)) {
      if (!t.due || t.due > local.date) continue;
      const late = daysFrom(t.due, local.date);
      const lastText = t.last ? `Last done ${Math.floor((now.getTime() - new Date(t.last).getTime()) / 86400000)} days ago.` : "";
      messages.push({
        title: late > 0 ? `Barney's ${t.label} is overdue` : `Barney's ${t.label} is due today`,
        body: [late > 0 ? `${late} ${late === 1 ? "day" : "days"} late.` : "", lastText].filter(Boolean).join(" ") || "It's due today.",
        tag: t.kind,
        group: "care",
      });
    }

    const { data: appts } = await admin.from("bt_appointments").select("*").eq("day", local.date).order("at_time");
    for (const a of appts ?? []) {
      const what = a.kind === "vet" ? "vet" : "grooming";
      const when = a.at_time ? `At ${clock(new Date(`${a.day}T${a.at_time.slice(0, 5)}:00Z`), "UTC")}` : "Today";
      messages.push({ title: `Barney's ${what} appointment is today`, body: `${when}${a.title ? `: ${a.title}` : ""}.`, tag: `appt-${a.id}`, group: "care" });
    }
  }

  if (hour === 12 || hour === 18) {
    const { count } = await admin.from("bt_log").select("id", { count: "exact", head: true }).eq("kind", "fed").gte("at", dayStart);
    const meals = count ?? 0;
    if (hour === 12 && meals === 0) messages.push({ title: "Has Barney had breakfast?", body: "No meal logged yet today.", tag: "fed-reminder", group: "nudges" });
    if (hour === 18 && meals < 2) messages.push({ title: "Time for Barney's dinner?", body: meals === 0 ? "No meals logged today." : "Only one meal logged today.", tag: "fed-reminder", group: "nudges" });
  }

  if (hour === 16) {
    // A walk or daycare logged today, or a daycare plan for today, counts
    const [{ count }, { count: daycarePlans }] = await Promise.all([
      admin.from("bt_log").select("id", { count: "exact", head: true }).in("kind", ["walk", "daycare"]).gte("at", dayStart),
      admin.from("bt_plans").select("id", { count: "exact", head: true }).eq("day", local.date).eq("place", "daycare"),
    ]);
    if (!count && !daycarePlans) messages.push({ title: "Has Barney been walked?", body: "No walk logged yet today.", tag: "walk-reminder", group: "nudges" });
  }

  if (!messages.length) return { hour, sent: 0 };
  const { data: subs } = await admin.from("bt_push_subscriptions").select("*");
  let sent = 0;
  for (const m of messages) sent += (await sendToAll(admin, (subs ?? []).filter((s: any) => wants(s, m.group)), m)).sent;
  return { hour, sent, messages: messages.map((m) => m.title) };
}

// When each treatment is next due (UK date): the date set in the app until the
// next dose is logged, otherwise the last dose plus how often it's given
async function treatmentDates(admin: Admin) {
  const [setting, ...lasts] = await Promise.all([
    admin.from("bt_settings").select("value").eq("key", "treatments").maybeSingle(),
    ...TREATMENTS.map((t) => admin.from("bt_log").select("at").eq("kind", t.kind).order("at", { ascending: false }).limit(1).maybeSingle()),
  ]);
  return TREATMENTS.map((t, i) => {
    const cfg = (setting.data?.value as any)?.[t.kind] ?? {};
    const every = Math.max(1, Math.round(Number(cfg.every)) || t.every);
    const unit = ["days", "weeks", "months"].includes(cfg.unit) ? cfg.unit : t.unit;
    const last: string | null = (lasts[i].data as any)?.at ?? null;
    const custom = typeof cfg.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfg.due) &&
      (!last || new Date(last) < new Date(cfg.due_set_at ?? 0));
    const due: string | null = custom ? cfg.due : last ? addInterval(londonParts(new Date(last)).date, every, unit) : null;
    return { ...t, every, unit, last, due, custom };
  });
}
function addInterval(date: string, n: number, unit: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (unit === "months") {
    const lastDay = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + n, Math.min(d, lastDay))).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, m - 1, d + (unit === "weeks" ? n * 7 : n))).toISOString().slice(0, 10);
}
// 1.4kg, or 350g under a kilo
function weight(g: number): string {
  return g >= 1000 ? `${Math.round(g / 100) / 10}kg` : `${Math.max(10, Math.round(g / 10) * 10)}g`;
}
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function londonParts(d: Date) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    asUtc: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)),
  };
}
// UK midnight at the start of a date, as a real instant
function londonMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offset = londonParts(new Date(guess)).asUtc - guess;
  return new Date(guess - offset);
}
function clock(d: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d).replace(/\s/g, "").replace(":00", "").toLowerCase();
}

// ---------------------------------------------------------------------
// Web push (RFC 8030 / 8291 / 8292), with Web Crypto only

type Vapid = { publicKey: string; privateJwk: JsonWebKey };

async function vapidKeys(admin: Admin): Promise<Vapid> {
  const { data } = await admin.from("bt_secrets").select("value").eq("key", "vapid").maybeSingle();
  if (data?.value?.publicKey && data?.value?.privateJwk) return data.value as Vapid;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const fresh: Vapid = {
    publicKey: toB64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  await admin.from("bt_secrets").upsert({ key: "vapid", value: fresh }, { onConflict: "key", ignoreDuplicates: true });
  // If two phones asked at once, use whichever pair was saved first
  const { data: saved } = await admin.from("bt_secrets").select("value").eq("key", "vapid").maybeSingle();
  return (saved?.value as Vapid) ?? fresh;
}

async function sendToAll(admin: Admin, subs: any[], msg: Message) {
  if (!subs.length) return { sent: 0, failed: 0 };
  const vapid = await vapidKeys(admin);
  const payload = new TextEncoder().encode(JSON.stringify({ ...msg, url: msg.url ?? APP_URL }));
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const res = await sendOne(s.subscription, payload, vapid);
      if (res.ok) { sent++; return; }
      failed++;
      if (res.status === 404 || res.status === 410) {
        await admin.from("bt_push_subscriptions").delete().eq("id", s.id); // phone unsubscribed
      } else {
        console.error("push failed", res.status, await res.text().catch(() => ""));
      }
    } catch (e) {
      failed++;
      console.error("push error", e);
    }
  }));
  return { sent, failed };
}

async function sendOne(sub: any, payload: Uint8Array, vapid: Vapid): Promise<Response> {
  const body = await encrypt(sub, payload);
  return await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
}

async function vapidHeader(endpoint: string, vapid: Vapid): Promise<string> {
  const enc = new TextEncoder();
  const subject = Deno.env.get("PUSH_SUBJECT") || APP_URL;
  const head = toB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const key = await crypto.subtle.importKey("jwk", { ...vapid.privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${toB64url(sig)}, k=${vapid.publicKey}`;
}

// aes128gcm content encoding (RFC 8291)
async function encrypt(sub: any, payload: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);

  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}
