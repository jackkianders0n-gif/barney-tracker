// Barney's Tracker — Alexa summary Edge Function
//
// GET ?key=<alexa key> → Barney's latest meal, wee, poo, food stock, today's
// walking, next vet visit and treatments, in the same shape the old
// /api/alexa/summary returned, so only the address changes on the Alexa side.
// The key is in the app: Barney → Settings → Alexa link.
// Also { speech: { summary, walk, care } }: what the Barney's Tracker Alexa skill
// (alexa/ in the repo) says, worked out here so the skill never needs changing.
//
// Needs "Verify JWT" turned OFF (Alexa can't sign in); the key protects it.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;

const TZ = "Europe/London";
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alexa-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const PORTION: Record<string, string> = { full: "Full portion", half: "Half portion", treat: "Treat only" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);

  const url = new URL(req.url);
  const key = req.headers.get("x-alexa-key") ?? url.searchParams.get("key") ?? "";
  if (!key) return json({ error: "Missing key" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: setting } = await admin.from("bt_settings").select("value").eq("key", "alexa_key").maybeSingle();
  if (typeof setting?.value !== "string" || !sameText(setting.value, key)) return json({ error: "Not allowed" }, 403);

  const today = londonDate(new Date());
  const dayStart = londonMidnight(today).toISOString();
  const latest = (kinds: string[]) =>
    admin.from("bt_log").select("*").in("kind", kinds).order("at", { ascending: false }).limit(1).maybeSingle();

  const [feed, wee, poo, food, walks, vet, flea, worm, members, speech] = await Promise.all([
    latest(["fed", "water"]),
    latest(["wee"]),
    latest(["poo"]),
    admin.rpc("bt_food_status"),
    admin.from("bt_log").select("details").eq("kind", "walk").gte("at", dayStart),
    admin.from("bt_appointments").select("*").eq("kind", "vet").gte("day", today).order("day").order("at_time").limit(1).maybeSingle(),
    latest(["flea"]),
    latest(["worm"]),
    admin.from("bt_members").select("user_id, display_name"),
    speak(admin, today, dayStart).catch((e) => { console.error(e); return null; }),
  ]);
  const names: Record<string, string> = Object.fromEntries((members.data ?? []).map((m: any) => [m.user_id, m.display_name]));
  const by = (row: any) => (row.created_by && names[row.created_by]) || row.details?.by || "App";

  const lastFeed = feed.data ? {
    id: feed.data.id,
    created_at: feed.data.at,
    logged_by: by(feed.data),
    amount: feed.data.kind === "water" ? "Water" : PORTION[feed.data.details?.portion] ?? "Meal",
    note: feed.data.kind === "water"
      ? "Bowl topped up"
      : [feed.data.note, typeof feed.data.details?.eaten === "number" ? `Ate ${feed.data.details.eaten}%` : null].filter(Boolean).join(" · "),
  } : null;
  const toilet = (row: any) => row ? { id: row.id, created_at: row.at, logged_by: by(row), type: row.kind } : null;
  const treatment = (row: any) => row ? { id: row.id, type: row.kind, treated_at: row.at, logged_by: by(row) } : null;

  return json({
    lastFeed,
    lastWee: toilet(wee.data),
    lastPoo: toilet(poo.data),
    // Kibble left, estimated from meals logged since the last bag or check.
    // The old { pouches, alert_at } keys are kept for the skill, as days of food left.
    food: food.data?.counted_at
      ? {
          kibble_g: Number(food.data.left_g ?? 0),
          days_left: food.data.days_left,
          pouches: Number(food.data.days_left ?? 0),
          alert_at: Number(food.data.alert_days ?? 5),
        }
      : { kibble_g: null, days_left: null, pouches: 0, alert_at: 5 },
    todayWalkMins: (walks.data ?? []).reduce((n: number, w: any) => n + (Number(w.details?.mins) || 0), 0),
    nextVet: vet.data ? {
      id: vet.data.id,
      appt_date: vet.data.day,
      appt_time: vet.data.at_time ? vet.data.at_time.slice(0, 5) : null,
      reason: vet.data.title,
      notes: vet.data.notes,
      upcoming: 1,
    } : null,
    flea: treatment(flea.data),
    worm: treatment(worm.data),
    speech: speech ?? { summary: "Sorry, I couldn't get Barney's news just now.", walk: "Sorry, I couldn't work out a walk just now.", care: "Sorry, I couldn't get his treatments just now." },
  });
});

// ---------------------------------------------------------------------
// What Alexa says

async function speak(admin: Admin, today: string, dayStart: string) {
  const settingsRows = await admin.from("bt_settings").select("key, value").in("key", ["walks", "walk_area", "tides", "treatments", "daycares"]);
  const set: Record<string, any> = Object.fromEntries((settingsRows.data ?? []).map((r: any) => [r.key, r.value]));
  const [summary, walk, care] = await Promise.all([summaryText(admin, today, dayStart, set), walkText(set), careText(admin, today, set)]);
  return { summary, walk, care };
}

const MEAL_EATEN = (e: unknown) =>
  typeof e !== "number" ? "nobody's said yet how much he ate"
    : e >= 100 ? "he ate all of it" : e >= 75 ? "he ate most of it" : e >= 50 ? "he ate half" : e > 0 ? "he ate a little" : "he didn't eat it";

async function summaryText(admin: Admin, today: string, dayStart: string, set: Record<string, any>) {
  const latest = (kind: string) => admin.from("bt_log").select("*").eq("kind", kind).order("at", { ascending: false }).limit(1).maybeSingle();
  const [meal, wee, poo, walks, plan] = await Promise.all([
    latest("fed"), latest("wee"), latest("poo"),
    admin.from("bt_log").select("kind, details").in("kind", ["walk", "daycare"]).gte("at", dayStart),
    admin.from("bt_plans").select("place, daycare").eq("day", today).eq("place", "daycare").limit(1).maybeSingle(),
  ]);
  const out: string[] = [];
  if (meal.data) {
    const at = new Date(meal.data.at);
    out.push(`His last meal was ${mealWord(at)}, ${when(at, today)}, and ${MEAL_EATEN(meal.data.details?.eaten)}.`);
  } else out.push("No meals are logged yet.");
  const toilet = [wee.data && `his last wee was ${when(new Date(wee.data.at), today)}`, poo.data && `his last poo was ${when(new Date(poo.data.at), today)}`].filter(Boolean);
  if (toilet.length) out.push(cap(toilet.join(", and ")) + ".");
  const mins = (walks.data ?? []).filter((w: any) => w.kind === "walk").reduce((n: number, w: any) => n + (Number(w.details?.mins) || 0), 0);
  const daycare = (walks.data ?? []).some((w: any) => w.kind === "daycare") || !!plan.data;
  const dcName = plan.data?.daycare && Array.isArray(set.daycares) ? set.daycares.find((d: any) => d.id === plan.data.daycare)?.name : null;
  if (mins) out.push(`He's had ${mins} minutes of walks today${daycare ? `, and he's at ${dcName ?? "daycare"}` : ""}.`);
  else if (daycare) out.push(`He's at ${dcName ?? "daycare"} today.`);
  else out.push("He hasn't been walked yet today.");
  return out.join(" ");
}

async function careText(admin: Admin, today: string, set: Record<string, any>) {
  const out: string[] = [];
  for (const t of await treatmentDates(admin, set.treatments)) {
    if (!t.due) { out.push(`His ${t.label} isn't logged yet.`); continue; }
    const days = daysFrom(today, t.due);
    out.push(days < 0 ? `His ${t.label} is overdue by ${days === -1 ? "a day" : `${-days} days`}.`
      : days === 0 ? `His ${t.label} is due today.`
      : `His ${t.label} is due ${dayWords(t.due, today)}.`);
  }
  const { data: appts } = await admin.from("bt_appointments").select("*").gte("day", today).order("day").order("at_time").limit(2);
  for (const a of appts ?? []) {
    const what = a.kind === "vet" ? "vet" : "groomer";
    const time = a.at_time ? ` at ${clock(new Date(`${a.day}T${a.at_time.slice(0, 5)}:00Z`), "UTC")}` : "";
    out.push(`He's at the ${what} ${dayWords(a.day, today)}${time}${a.title ? `, for ${a.title}` : ""}.`);
  }
  if (!(appts ?? []).length) out.push("There are no vet or groomer appointments booked.");
  return out.join(" ");
}

// The best walk now, judged the same way as the app's Walks tab (judgeWalk in app.jsx)
async function walkText(set: Record<string, any>) {
  const walks: any[] = Array.isArray(set.walks) ? set.walks : [];
  const area = set.walk_area;
  if (!walks.length || !area?.lat) return "There are no walks set up yet. Add them in the app's Walks tab.";
  const wx = await weather(area.lat, area.lon);
  const tides = set.tides ?? {};
  const eventsFor = (w: any) => tides.stations?.[tides.walk_station?.[w.id] ?? tides.area_station]?.events ?? [];
  const now = Date.now();
  const later: number[] = [];
  for (let t = Math.ceil(now / 1800000) * 1800000; t <= now + 12 * 3600000; t += 1800000) {
    const hr = Number(parts(new Date(t)).hour);
    if (t > now && hr >= 6 && hr <= 21) later.push(t);
  }
  const plan = walks.map((w) => {
    const nowJ = judge(w, now, wx, eventsFor(w));
    let best: { t: number; j: ReturnType<typeof judge> } | null = null;
    for (const t of later) { const j = judge(w, t, wx, eventsFor(w)); if (j.ok && (!best || j.score > best.j.score)) best = { t, j }; }
    return { w, now: nowJ, best };
  }).sort((a, b) => (Number(b.now.ok) - Number(a.now.ok)) || (b.now.score - a.now.score));
  const top = plan.find((p) => p.now.ok);
  if (top) {
    const why = [...top.now.plus, ...top.now.minus].slice(0, 2).join(", and ").toLowerCase();
    const second = plan.find((p) => p !== top && p.now.ok && p.now.score >= -10);
    return `The best walk right now is ${top.w.name}${why ? `: ${why}` : ""}.${second ? ` ${second.w.name} would be good too.` : ""}`;
  }
  const next = plan.filter((p) => p.best).sort((a, b) => a.best!.t - b.best!.t)[0];
  if (next) return `None of the walks are good right now. ${next.w.name} will be good at ${clock(new Date(next.best!.t))}.`;
  return "None of the walks look good for the next twelve hours.";
}

type Hour = { t: number; feels: number; rain: number; chance: number; gust: number };
type Wx = { hours: Hour[]; days: { day: string; sunrise: number; sunset: number }[] } | null;

async function weather(lat: number, lon: number): Promise<Wx> {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&hourly=apparent_temperature,precipitation,precipitation_probability,wind_gusts_10m&daily=sunrise,sunset" +
      "&past_days=2&forecast_days=2&timezone=GMT&wind_speed_unit=mph", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const h = j.hourly ?? {}, d = j.daily ?? {};
    const n = (a: any[], i: number) => Number(a?.[i]) || 0;
    return {
      hours: (h.time ?? []).map((t: string, i: number) => ({
        t: Date.parse(`${t}:00Z`), feels: n(h.apparent_temperature, i), rain: n(h.precipitation, i), chance: n(h.precipitation_probability, i), gust: n(h.wind_gusts_10m, i),
      })),
      days: (d.time ?? []).map((day: string, i: number) => ({ day, sunrise: Date.parse(`${d.sunrise[i]}:00Z`), sunset: Date.parse(`${d.sunset[i]}:00Z`) })),
    };
  } catch { return null; }
}

function tideAt(events: any[], t: number) {
  const i = events.findIndex((e) => Date.parse(e.at) > t);
  if (i <= 0) return null;
  const prev = events[i - 1], next = events[i];
  const a = Date.parse(prev.at), b = Date.parse(next.at);
  const p = Math.min(1, Math.max(0, (t - a) / (b - a)));
  const rising = prev.type === "low";
  return { level: rising ? (1 - Math.cos(Math.PI * p)) / 2 : (1 + Math.cos(Math.PI * p)) / 2, rising };
}
const tideWord = (x: { level: number; rising: boolean }) => (x.level < 0.35 ? "out" : x.level > 0.65 ? "in" : x.rising ? "coming in" : "going out");

function judge(walk: any, t: number, wx: Wx, events: any[]) {
  const mins = Number(walk.mins) || 30;
  const end = t + mins * 60000;
  const no: string[] = [], minus: string[] = [], plus: string[] = [];
  let score = 0;
  const day = wx?.days.find((d) => d.day === new Date(t).toISOString().slice(0, 10));
  if (walk.daylight && day && (t < day.sunrise || end > day.sunset)) no.push("dark");
  if (walk.tide === "low" || walk.tide === "high") {
    const a = tideAt(events, t), b = tideAt(events, end);
    if (a) {
      if (walk.tide === "low") { if (Math.max(a.level, b ? b.level : a.level) > 0.4) no.push(`the tide's ${tideWord(a)}`); else { plus.push("The tide's out"); score += 10; } }
      else if (Math.min(a.level, b ? b.level : a.level) < 0.6) no.push(`the tide's ${tideWord(a)}`); else { plus.push("The tide's in"); score += 10; }
    }
  }
  const i = wx ? wx.hours.findIndex((x) => x.t > t) : -1;
  const h = wx ? wx.hours[i > 0 ? i - 1 : 0] : null;
  if (h) {
    if (h.chance >= 60 || h.rain >= 1) { score -= 30; minus.push("Rain is likely"); }
    else if (h.chance >= 30) { score -= 10; minus.push("There might be showers"); }
    if (walk.exposed) { if (h.gust >= 35) { score -= 35; minus.push("It's very windy"); } else if (h.gust >= 25) { score -= 10; minus.push("It's breezy"); } }
    if (h.feels >= 24) { if (walk.shady) { score += 10; plus.push("It's shady"); } else { score -= 20; minus.push("It's hot"); } if (mins > 45) score -= 15; }
  }
  if (walk.muddy && wx) {
    const mm = wx.hours.filter((x) => x.t < t && x.t >= t - 48 * 3600000).reduce((n, x) => n + x.rain, 0);
    if (mm >= 15) { score -= 30; minus.push("It'll be muddy"); } else if (mm >= 6) { score -= 10; minus.push("It could be muddy"); }
  }
  return { ok: no.length === 0, score, no, minus, plus };
}

// Flea and worming: the same rules as treatmentPlan() in app.jsx
const TREATMENTS = [
  { kind: "flea", label: "flea treatment", every: 4, unit: "weeks" },
  { kind: "worm", label: "worming tablet", every: 3, unit: "months" },
];
async function treatmentDates(admin: Admin, setting: any) {
  const lasts = await Promise.all(TREATMENTS.map((t) => admin.from("bt_log").select("at").eq("kind", t.kind).order("at", { ascending: false }).limit(1).maybeSingle()));
  return TREATMENTS.map((t, i) => {
    const cfg = setting?.[t.kind] ?? {};
    const every = Math.max(1, Math.round(Number(cfg.every)) || t.every);
    const unit = ["days", "weeks", "months"].includes(cfg.unit) ? cfg.unit : t.unit;
    const last: string | null = (lasts[i].data as any)?.at ?? null;
    const custom = typeof cfg.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cfg.due) && (!last || new Date(last) < new Date(cfg.due_set_at ?? 0));
    const due: string | null = custom ? cfg.due : last ? addInterval(londonDate(new Date(last)), every, unit) : null;
    return { ...t, due };
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
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// Words for times and days, UK time
function clock(d: Date, timeZone = TZ): string {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s/g, "").toLowerCase();
  return s.replace(":00", "");
}
function when(d: Date, today: string): string {
  const day = londonDate(d);
  if (day === today) return `at ${clock(d)}`;
  if (daysFrom(day, today) === 1) return `yesterday at ${clock(d)}`;
  return `on ${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long" }).format(d)} at ${clock(d)}`;
}
function dayWords(day: string, today: string): string {
  const n = daysFrom(today, day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  const d = new Date(`${day}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(d);
  return n < 7 ? `on ${name.split(" ")[0]}` : `on ${name}`;
}
function mealWord(at: Date): string {
  const h = Number(parts(at).hour);
  return h < 11 ? "breakfast" : h >= 15 ? "dinner" : "lunch";
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function parts(d: Date) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) p[x.type] = x.value;
  return p;
}
function londonDate(d: Date): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}
function londonMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = parts(new Date(guess));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return new Date(guess - (asUtc - guess));
}
