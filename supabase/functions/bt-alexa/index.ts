// Barney's Tracker — Alexa summary Edge Function
//
// GET ?key=<alexa key> → Barney's latest meal, wee, poo, food stock, today's
// walking, next vet visit and treatments, in the same shape the old
// /api/alexa/summary returned, so only the address changes on the Alexa side.
// The key is in the app: Barney → Settings → Alexa link.
//
// Needs "Verify JWT" turned OFF (Alexa can't sign in); the key protects it.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

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

  const [feed, wee, poo, food, walks, vet, flea, worm, members] = await Promise.all([
    latest(["fed", "water"]),
    latest(["wee"]),
    latest(["poo"]),
    admin.rpc("bt_food_status"),
    admin.from("bt_log").select("details").eq("kind", "walk").gte("at", dayStart),
    admin.from("bt_appointments").select("*").eq("kind", "vet").gte("day", today).order("day").order("at_time").limit(1).maybeSingle(),
    latest(["flea"]),
    latest(["worm"]),
    admin.from("bt_members").select("user_id, display_name"),
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
  });
});

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
