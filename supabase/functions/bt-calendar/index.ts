// Barney's Tracker — calendar Edge Function
//
// Puts Barney's plans (where he'll be) and his vet and grooming appointments
// into a shared iCloud calendar, default name "Barney":
// POST {"type":"plan"|"appt","id":"<id>"} → add, change or remove one event (database trigger)
// POST {"all": true}                      → bring the calendar in line with the app (Barney → Sync calendar now)
// Results go into bt_settings as icloud_status.
//
// Needs "Verify JWT" turned OFF: the database can't sign in. Calls from the
// database carry the private fn_key in an x-bt-key header; calls from the app
// are checked against bt_members.
//
// Secrets (already there if House Hunt's calendar is set up — they're shared):
//   ICLOUD_APPLE_ID         the Apple ID that owns the shared calendar
//   ICLOUD_APP_PASSWORD     an app-specific password for it
//   BT_ICLOUD_CALENDAR      optional, the calendar's name; defaults to "Barney"
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const TZ = "Europe/London";
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

const PLACES: Record<string, string> = {
  home: "at home",
  mum: "at Mum's house",
  jakey: "at Jakey's flat",
  daycare: "at doggy daycare",
  walk: "out on a walk",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Use POST", { status: 405, headers: CORS });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const fromDatabase = await keyMatches(admin, req.headers.get("x-bt-key"));
  if (!fromDatabase && !(await isMember(req))) return json({ error: "This account isn't set up for Barney's Tracker." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }

  if (body?.all) {
    const result = await syncAll(admin);
    return json(result, result.ok ? 200 : 400);
  }
  if (!["plan", "appt"].includes(body?.type) || typeof body?.id !== "string") return json({ error: "Missing type or id" }, 400);
  // The trigger doesn't wait, so reply at once and carry on in the background
  const work = syncOne(admin, body.type, body.id);
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
    return json({ ok: true }, 202);
  }
  return json(await work);
});

async function keyMatches(admin: Admin, key: string | null): Promise<boolean> {
  if (!key) return false;
  const { data } = await admin.from("bt_secrets").select("value").eq("key", "fn_key").maybeSingle();
  return typeof data?.value === "string" && sameText(data.value, key);
}
async function isMember(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return false;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc("bt_is_member");
  return !error && data === true;
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------
// Syncing

type Kind = "plan" | "appt";
const TABLE: Record<Kind, string> = { plan: "bt_plans", appt: "bt_appointments" };
const fileName = (kind: Kind, id: string) => `bt-${kind}-${id}.ics`;

class FriendlyError extends Error {}

async function syncOne(admin: Admin, kind: Kind, id: string) {
  try {
    const cal = await findCalendar();
    const { data: row, error } = await admin.from(TABLE[kind]).select("*").eq("id", id).maybeSingle();
    if (error) throw new FriendlyError("Couldn't load that from the database");
    if (row) await putEvent(cal, kind, row, await names(admin));
    else await deleteEvent(cal, `${cal.url}${fileName(kind, id)}`);
    return await saveStatus(admin, { ok: true });
  } catch (e) {
    return await saveStatus(admin, { ok: false, error: messageOf(e) });
  }
}

async function syncAll(admin: Admin) {
  try {
    const cal = await findCalendar();
    const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const [plans, appts, planIds, apptIds, who] = await Promise.all([
      admin.from("bt_plans").select("*").gte("day", from),
      admin.from("bt_appointments").select("*").gte("day", from),
      admin.from("bt_plans").select("id"),
      admin.from("bt_appointments").select("id"),
      names(admin),
    ]);
    if (plans.error || appts.error || planIds.error || apptIds.error) throw new FriendlyError("Couldn't load plans and appointments");
    for (const p of plans.data ?? []) await putEvent(cal, "plan", p, who);
    for (const a of appts.data ?? []) await putEvent(cal, "appt", a, who);

    // Remove events for plans and appointments that have been deleted. Only touches
    // events this app made (bt-plan-<id>.ics / bt-appt-<id>.ics), never your own.
    const exists = new Set([...(planIds.data ?? []).map((r: any) => `plan-${r.id}`), ...(apptIds.data ?? []).map((r: any) => `appt-${r.id}`)]);
    let removed = 0;
    for (const href of await listEvents(cal)) {
      const m = href.match(/\/bt-(plan|appt)-([0-9a-f-]{36})\.ics$/i);
      if (m && !exists.has(`${m[1].toLowerCase()}-${m[2].toLowerCase()}`)) {
        await deleteEvent(cal, new URL(href, cal.url).href);
        removed++;
      }
    }
    return await saveStatus(admin, { ok: true, count: (plans.data?.length ?? 0) + (appts.data?.length ?? 0), removed });
  } catch (e) {
    return await saveStatus(admin, { ok: false, error: messageOf(e) });
  }
}

async function names(admin: Admin): Promise<Record<string, string>> {
  const { data } = await admin.from("bt_members").select("user_id, display_name");
  return Object.fromEntries((data ?? []).map((m: any) => [m.user_id, m.display_name]));
}

function messageOf(e: unknown): string {
  cachedCalendar = null; // look the calendar up afresh next time
  if (e instanceof FriendlyError) return e.message;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "iCloud took too long to answer. Try again in a minute.";
  console.error(e);
  return "Couldn't reach iCloud. Try again in a minute.";
}

async function saveStatus(admin: Admin, status: Record<string, unknown>) {
  const value = { ...status, at: new Date().toISOString() };
  const { error } = await admin.from("bt_settings").upsert({ key: "icloud_status", value });
  if (error) console.error(error);
  return value as { ok: boolean; error?: string; count?: number; removed?: number; at: string };
}

// ---------------------------------------------------------------------
// iCloud (CalDAV) — same discovery as House Hunt's hh-calendar

type Calendar = { url: string; auth: string };
let cachedCalendar: Calendar | null = null;

async function dav(url: string, auth: string, method: string, opts: { body?: string; depth?: string; type?: string } = {}) {
  const headers: Record<string, string> = { Authorization: auth };
  if (opts.depth) headers.Depth = opts.depth;
  if (opts.body) headers["Content-Type"] = opts.type ?? "application/xml; charset=utf-8";
  const res = await fetch(url, { method, headers, body: opts.body, signal: AbortSignal.timeout(10000) });
  if (res.status === 401 || res.status === 403) {
    throw new FriendlyError("iCloud didn't accept the Apple ID and app-specific password. Check the ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD secrets.");
  }
  return res;
}

const tag = (name: string) => `(?:[\\w-]+:)?${name}`;
function hrefInside(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${tag(name)}[^>]*>\\s*<${tag("href")}[^>]*>([^<]+)</`, "i"));
  return m ? decodeXml(m[1].trim()) : null;
}
function responses(xml: string): string[] {
  return xml.split(new RegExp(`<${tag("response")}[\\s>]`, "i")).slice(1);
}
function firstHref(block: string): string | null {
  const m = block.match(new RegExp(`<${tag("href")}[^>]*>([^<]+)</`, "i"));
  return m ? decodeXml(m[1].trim()) : null;
}
function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function findCalendar(): Promise<Calendar> {
  if (cachedCalendar) return cachedCalendar;
  const appleId = Deno.env.get("ICLOUD_APPLE_ID")?.trim();
  const password = Deno.env.get("ICLOUD_APP_PASSWORD")?.trim();
  const name = (Deno.env.get("BT_ICLOUD_CALENDAR") || "Barney").trim();
  if (!appleId || !password) throw new FriendlyError("iCloud isn't set up yet. Add the ICLOUD_APPLE_ID and ICLOUD_APP_PASSWORD secrets in Supabase.");
  const auth = "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(`${appleId}:${password}`)));

  const root = "https://caldav.icloud.com/";
  const r1 = await dav(root, auth, "PROPFIND", { depth: "0", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
  const principal = hrefInside(await r1.text(), "current-user-principal");
  if (!principal) throw new FriendlyError("iCloud didn't say where your calendars are. Try again in a minute.");
  const principalUrl = new URL(principal, root).href;

  const r2 = await dav(principalUrl, auth, "PROPFIND", { depth: "0", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>' });
  const home = hrefInside(await r2.text(), "calendar-home-set");
  if (!home) throw new FriendlyError("iCloud didn't say where your calendars are. Try again in a minute.");
  const homeUrl = new URL(home, principalUrl).href;

  const r3 = await dav(homeUrl, auth, "PROPFIND", { depth: "1", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>' });
  const found: { name: string; url: string }[] = [];
  for (const block of responses(await r3.text())) {
    if (!new RegExp(`<${tag("calendar")}[\\s/>]`, "i").test(block)) continue;
    if (/name="VTODO"/i.test(block) && !/name="VEVENT"/i.test(block)) continue;
    const href = firstHref(block);
    const dn = block.match(new RegExp(`<${tag("displayname")}[^>]*>([^<]*)</`, "i"));
    if (href && dn) found.push({ name: decodeXml(dn[1].trim()), url: new URL(href, homeUrl).href });
  }
  const match = found.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const list = found.map((c) => `"${c.name}"`).join(", ");
    throw new FriendlyError(`There's no calendar called "${name}" in this iCloud account${list ? ` (found ${list})` : ""}. Make one, or set the BT_ICLOUD_CALENDAR secret to its name.`);
  }
  cachedCalendar = { url: match.url.endsWith("/") ? match.url : match.url + "/", auth };
  return cachedCalendar;
}

async function putEvent(cal: Calendar, kind: Kind, row: any, who: Record<string, string>) {
  const res = await dav(`${cal.url}${fileName(kind, row.id)}`, cal.auth, "PUT", {
    body: buildEvent(kind, row, who),
    type: "text/calendar; charset=utf-8",
  });
  if (!res.ok) throw new FriendlyError(`iCloud wouldn't save an event (error ${res.status}).`);
  await res.body?.cancel();
}

async function deleteEvent(cal: Calendar, url: string) {
  const res = await dav(url, cal.auth, "DELETE");
  if (!res.ok && res.status !== 404) throw new FriendlyError(`iCloud wouldn't remove an event (error ${res.status}).`);
  await res.body?.cancel();
}

async function listEvents(cal: Calendar): Promise<string[]> {
  const res = await dav(cal.url, cal.auth, "PROPFIND", { depth: "1", body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' });
  if (!res.ok) throw new FriendlyError(`iCloud wouldn't list the calendar (error ${res.status}).`);
  return responses(await res.text()).map(firstHref).filter((h): h is string => !!h && h.endsWith(".ics"));
}

// ---------------------------------------------------------------------
// Calendar files

function buildEvent(kind: Kind, row: any, who: Record<string, string>): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Barney's Tracker//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT"];
  lines.push(`UID:bt-${kind}-${row.id}@barney-tracker`, `DTSTAMP:${utc(new Date())}`, `LAST-MODIFIED:${utc(new Date(row.updated_at ?? Date.now()))}`);

  const time: string | null = kind === "plan" ? (row.all_day ? null : row.start_time) : row.at_time;
  if (time) {
    const start = londonToUtc(row.day, time);
    let end = kind === "plan" && row.end_time ? londonToUtc(row.day, row.end_time) : new Date(start.getTime() + 3600000);
    if (end <= start) end = new Date(start.getTime() + 3600000);
    lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${row.day.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(row.day)}`);
  }

  const by = row.created_by && who[row.created_by] ? `Added by ${who[row.created_by]}` : null;
  if (kind === "plan") {
    lines.push(`SUMMARY:${escapeText(`Barney ${PLACES[row.place] ?? row.place}`)}`);
    const desc = [row.note, by].filter(Boolean).join("\n");
    if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
  } else {
    const what = row.kind === "vet" ? "Barney at the vet" : "Barney at the groomer";
    lines.push(`SUMMARY:${escapeText(row.title ? `${what}: ${row.title}` : what)}`);
    const desc = [row.notes, by].filter(Boolean).join("\n");
    if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
    // Appointments get a reminder: an hour before, or 6pm the evening before for all-day ones
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(what)}`, time ? "TRIGGER:-PT1H" : "TRIGGER:-PT6H", "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// A UK wall-clock time on a date, as a real instant (handles summer time)
function londonToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetAt(guess);
  const second = offsetAt(t);
  if (guess - second !== t) t = guess - second;
  return new Date(t);
}
function offsetAt(ts: number): number {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ts))) p[x.type] = x.value;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - ts;
}
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, "");
}
function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "", size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(current); current = ""; size = 0; }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}
