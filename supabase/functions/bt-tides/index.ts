// Barney's Tracker — tides Edge Function
//
// Official UK tide times from the UK Hydrographic Office (Admiralty UK Tidal
// API, Discovery tier), for the walk suggestions.
// POST {"action":"stations","lat":50.7,"lon":-1.9} → the nearest tide stations (members)
// POST {"action":"events"}                         → high and low waters for the next week at each
//                                                    station the walks need, kept in bt_settings.tides
//                                                    (members; refetched after 6 hours)
//
// Each walk that cares about the tide uses its own station: the one picked for
// it (station_id), else the one nearest the walk (lat/lon), else the area's.
//
// Needs "Verify JWT" turned OFF, like the others; calls are checked against bt_members.
//
// Secret: ADMIRALTY_API_KEY — the "Primary key" of a UK Tidal API Discovery
// subscription from https://admiraltyapi.portal.azure-api.net (free).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1";
const FRESH_MS = 6 * 3600 * 1000;
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

class FriendlyError extends Error {}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Use POST", { status: 405, headers: CORS });
  if (!(await isMember(req))) return json({ error: "This account isn't set up for Barney's Tracker." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    if (body?.action === "stations") {
      const lat = Number(body.lat), lon = Number(body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: "Missing lat or lon" }, 400);
      return json({ stations: await nearestStations(lat, lon) });
    }
    if (body?.action === "events") return json(await events(admin, !!body.force));
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    if (e instanceof FriendlyError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Couldn't get the tide times. Try again in a minute." }, 500);
  }
});

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

async function admiralty(path: string): Promise<any> {
  const key = Deno.env.get("ADMIRALTY_API_KEY")?.trim();
  if (!key) throw new FriendlyError("Tides aren't set up yet. Add the ADMIRALTY_API_KEY secret in Supabase.");
  const res = await fetch(`${API}${path}`, { headers: { "Ocp-Apim-Subscription-Key": key }, signal: AbortSignal.timeout(10000) });
  if (res.status === 401 || res.status === 403) throw new FriendlyError("The Admiralty tide service didn't accept the ADMIRALTY_API_KEY secret.");
  if (!res.ok) throw new FriendlyError(`The Admiralty tide service answered with error ${res.status}.`);
  return await res.json();
}

// The nearest stations, by straight-line distance
async function nearestStations(lat: number, lon: number) {
  const data = await admiralty("/Stations");
  const features: any[] = Array.isArray(data?.features) ? data.features : [];
  return features
    .map((f) => {
      const [sLon, sLat] = f?.geometry?.coordinates ?? [];
      return { id: String(f?.properties?.Id ?? ""), name: String(f?.properties?.Name ?? ""), km: distanceKm(lat, lon, Number(sLat), Number(sLon)) };
    })
    .filter((s) => s.id && s.name && Number.isFinite(s.km))
    .sort((a, b) => a.km - b.km)
    .slice(0, 6)
    .map((s) => ({ ...s, km: Math.round(s.km * 10) / 10 }));
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// High and low waters for the next week, kept in bt_settings.tides so every
// phone shares one fetch:
// { sig, fetched_at, area_station, walk_station: { walkId: stationId },
//   stations: { stationId: { name, events: [{ type: high|low, at, height }] } } }
// sig changes when the walks or the area's station change, so they're fetched again.
async function events(admin: ReturnType<typeof createClient>, force: boolean) {
  const [{ data: area }, { data: walksRow }, { data: cached }] = await Promise.all([
    admin.from("bt_settings").select("value").eq("key", "walk_area").maybeSingle(),
    admin.from("bt_settings").select("value").eq("key", "walks").maybeSingle(),
    admin.from("bt_settings").select("value").eq("key", "tides").maybeSingle(),
  ]);
  const a = (area?.value ?? {}) as any;
  const walks: any[] = Array.isArray(walksRow?.value) ? (walksRow!.value as any[]) : [];
  const tideWalks = walks.filter((w) => w && (w.tide === "low" || w.tide === "high"));
  const sig = tidesSig(a, walks);
  const c = cached?.value as any;
  if (!force && c?.sig === sig && Date.now() - new Date(c.fetched_at).getTime() < FRESH_MS) return c;
  if (!a.station_id && !tideWalks.length) throw new FriendlyError("Pick a tide station first (Walks → Area).");

  // Which station each tide walk uses
  let all: { id: string; name: string; lat: number; lon: number }[] | null = null;
  const stationList = async () => {
    if (!all) {
      const data = await admiralty("/Stations");
      all = (Array.isArray(data?.features) ? data.features : []).map((f: any) => ({
        id: String(f?.properties?.Id ?? ""), name: String(f?.properties?.Name ?? ""),
        lon: Number(f?.geometry?.coordinates?.[0]), lat: Number(f?.geometry?.coordinates?.[1]),
      })).filter((s: any) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    }
    return all!;
  };
  const names: Record<string, string> = {};
  if (a.station_id) names[a.station_id] = a.station_name || a.station_id;
  const walkStation: Record<string, string> = {};
  for (const w of tideWalks) {
    if (w.station_id) { walkStation[w.id] = w.station_id; names[w.station_id] ||= w.station_name || w.station_id; continue; }
    if (Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lon))) {
      const near = (await stationList())
        .map((s) => ({ ...s, km: distanceKm(Number(w.lat), Number(w.lon), s.lat, s.lon) }))
        .sort((x, y) => x.km - y.km)[0];
      if (near) { walkStation[w.id] = near.id; names[near.id] = near.name; continue; }
    }
    if (a.station_id) walkStation[w.id] = a.station_id;
  }

  const stations: Record<string, { name: string; events: any[] }> = {};
  for (const id of Object.keys(names)) {
    const raw = await admiralty(`/Stations/${encodeURIComponent(id)}/TidalEvents?duration=7`);
    stations[id] = {
      name: names[id],
      events: (Array.isArray(raw) ? raw : [])
        .filter((e: any) => e?.DateTime && (e.EventType === "HighWater" || e.EventType === "LowWater"))
        .map((e: any) => ({
          type: e.EventType === "HighWater" ? "high" : "low",
          // The times are UTC but come without a zone
          at: new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(e.DateTime) ? e.DateTime : `${e.DateTime}Z`).toISOString(),
          height: typeof e.Height === "number" ? Math.round(e.Height * 100) / 100 : null,
        }))
        .sort((x: any, y: any) => x.at.localeCompare(y.at)),
    };
  }
  const value = { sig, fetched_at: new Date().toISOString(), area_station: a.station_id ?? null, walk_station: walkStation, stations };
  const { error } = await admin.from("bt_settings").upsert({ key: "tides", value });
  if (error) console.error(error);
  return value;
}

// The same string as tidesSig() in app.jsx
function tidesSig(area: any, walks: any[]): string {
  const w = walks.filter((x) => x && (x.tide === "low" || x.tide === "high"))
    .map((x) => `${x.id}:${x.station_id || ""}:${x.lat ?? ""}:${x.lon ?? ""}`).join(",");
  return `${area?.station_id || ""}|${w}`;
}
