/* Barney's Tracker — app.jsx
   Compiled in the browser by Babel (no build step), like the gym tracker and House Hunt.
   Data lives in the gym tracker's Supabase project, in the bt_ tables. */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ---------------------------------------------------------------------------
// Config — the same two values the gym tracker and House Hunt use.
// URL must be the bare project URL: no trailing slash and no /rest/v1/.
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://wvedhcuebfdfkhfvphlb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bkeGnvruQEz3MsVDZiJ03g_bhXXDjgC";
const APP_VERSION = "2.2.0";
// The old Cloudflare app, read once by Barney → Settings → Bring over data from the old app
const OLD_API = "https://barney-tracker-api.barneythebigdog.workers.dev";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "bt-auth" },
});

// ---------------------------------------------------------------------------
// What can be logged
// ---------------------------------------------------------------------------
const KIND = {
  fed:       { label: "Fed",            title: "Meal",           icon: "bowl",     group: "meals" },
  water:     { label: "Water",          title: "Water",          icon: "water",    group: "meals" },
  wee:       { label: "Wee",            title: "Wee",            icon: "hydrant",  group: "toilet" },
  poo:       { label: "Poo",            title: "Poo",            icon: "poo",      group: "toilet" },
  walk:      { label: "Walk",           title: "Walk",           icon: "lead",     group: "walks" },
  daycare:   { label: "Daycare",        title: "Daycare day",    icon: "daycare",  group: "walks" },
  flea:      { label: "Flea treatment", title: "Flea treatment", icon: "pipette",  group: "health" },
  worm:      { label: "Worming",        title: "Worming tablet", icon: "tablet",   group: "health" },
  weight:    { label: "Weight",         title: "Weight",         icon: "scale",    group: "health" },
  med:       { label: "Medication",     title: "Medication",     icon: "bottle",   group: "health" },
  behaviour: { label: "Behaviour note", title: "Behaviour note", icon: "note",     group: "health" },
  grooming:  { label: "Grooming",       title: "Grooming",       icon: "scissors", group: "grooming" },
};
const ADD_ORDER = ["fed", "water", "wee", "poo", "walk", "daycare", "med", "weight", "grooming", "behaviour", "flea", "worm"];

const DIARY_FILTERS = [
  { key: "all", label: "Everything" },
  { key: "meals", label: "Meals" },
  { key: "toilet", label: "Toilet" },
  { key: "walks", label: "Walks" },
  { key: "health", label: "Health" },
  { key: "grooming", label: "Grooming" },
];

// How often unless changed in Health → a treatment → Due date and how often
// (bt_settings.treatments: { flea: { every, unit, due?, due_set_at? }, worm: … }).
// The same rules are repeated in bt-push and bt-calendar.
const TREATMENTS = [
  { kind: "flea", label: "Flea treatment", every: 4, unit: "weeks", warn: 3 },
  { kind: "worm", label: "Worming tablet", every: 3, unit: "months", warn: 7 },
];
const UNITS = [{ key: "days", label: "Days" }, { key: "weeks", label: "Weeks" }, { key: "months", label: "Months" }];

const PLACES = [
  { key: "home",    label: "Home",          now: "At home",           icon: "home",       color: "#1B2340" },
  { key: "mum",     label: "Mum's house",   now: "At Mum's house",    icon: "heartHouse", color: "#C98A4B" },
  { key: "jakey",   label: "Jakey's flat",  now: "At Jakey's flat",   icon: "flat",       color: "#5E70A8" },
  { key: "daycare", label: "Doggy daycare", now: "At doggy daycare",  icon: "daycare",    color: "#3D7A4F" },
  { key: "walk",    label: "Out on a walk", now: "Out on a walk",     icon: "lead",       color: "#A2652A" },
];
const PLACE = Object.fromEntries(PLACES.map((p) => [p.key, p]));
// For weekly plans: 1 = Monday … 7 = Sunday, as the database counts them
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ key: i + 1, label }));

const PORTIONS = [
  { key: "full", label: "Full portion" },
  { key: "half", label: "Half portion" },
  { key: "treat", label: "Treat only" },
];
const PORTION_LABEL = Object.fromEntries(PORTIONS.map((p) => [p.key, p.label]));
const EATEN = [
  { key: 100, label: "All of it" },
  { key: 75, label: "Most" },
  { key: 50, label: "Half" },
  { key: 25, label: "A little" },
  { key: 0, label: "None" },
];
const WALK_MINS = [15, 20, 30, 45, 60, 90];
const BEHAVIOURS = ["Limping", "Not eating", "Scratching", "Vomiting", "Lethargy", "Unusual behaviour", "Other"];
const GROOMING_TYPES = ["Bath", "Brush", "Nail clip", "Ear clean", "Other"];
// What each phone can choose to hear about (bt_push_subscriptions.notify; null = all)
const NOTIFY_GROUPS = [
  { key: "fed", label: "Meals", sub: "When someone else feeds him" },
  { key: "water", label: "Water" },
  { key: "toilet", label: "Wees and poos" },
  { key: "walk", label: "Walks and daycare" },
  { key: "nudges", label: "Meal and walk reminders", sub: "12pm, 4pm and 6pm, if nothing's logged" },
  { key: "care", label: "Treatments, food and appointments", sub: "8am, when something's due" },
];
const ALL_NOTIFY = NOTIFY_GROUPS.map((g) => g.key);

const INFO_FIELDS = [
  { key: "microchip", label: "Microchip number" },
  { key: "vet", label: "Vet practice" },
  { key: "vet_phone", label: "Vet phone", tel: true },
  { key: "insurance", label: "Insurance" },
  { key: "emergency_name", label: "Emergency contact" },
  { key: "emergency_phone", label: "Emergency phone", tel: true },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dayKey(new Date());
const parseDay = (key) => new Date(`${key}T12:00:00`);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const byAtDesc = (a, b) => new Date(b.at) - new Date(a.at);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const fmtKg = (kg) => String(Math.round(Number(kg) * 10) / 10);

// Whole calendar days from a to b
function daysBetween(a, b) {
  const A = new Date(a); A.setHours(12, 0, 0, 0);
  const B = new Date(b); B.setHours(12, 0, 0, 0);
  return Math.round((B - A) / 86400000);
}
function clock(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return m ? `${h}:${pad(m)}${ap}` : `${h}${ap}`;
}
const clockOf = (t) => (t ? clock(new Date(`2000-01-01T${t.slice(0, 5)}:00`)) : "");
const shortDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const weekday = (d) => d.toLocaleDateString("en-GB", { weekday: "long" });

function dayHeading(key) {
  const diff = daysBetween(parseDay(key), new Date());
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = parseDay(key);
  const opts = { weekday: "long", day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}
// "today", "tomorrow", "on Thursday", "on 18 Nov"
function relDay(key) {
  const diff = daysBetween(new Date(), parseDay(key));
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 7) return `on ${weekday(parseDay(key))}`;
  return `on ${shortDate(parseDay(key))}`;
}
function ago(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const days = daysBetween(d, new Date());
  if (days === 0) {
    const h = Math.floor(mins / 60);
    return h === 1 ? "An hour ago" : `${h} hours ago`;
  }
  if (days === 1) return `Yesterday, ${clock(d)}`;
  if (days < 7) return `${weekday(d)}, ${clock(d)}`;
  return shortDate(d);
}
// "yesterday, 6pm" / "an hour ago" for use mid-sentence
const lowerAgo = (iso) => (ago(iso) || "").replace(/^(Just|Yesterday|An)\b/, (w) => w.toLowerCase());
const toLocalInput = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function eatenText(e) {
  if (typeof e !== "number") return null;
  if (e >= 100) return "Ate it all";
  if (e >= 75) return "Ate most of it";
  if (e >= 50) return "Ate half";
  if (e > 0) return "Ate a little";
  return "Didn't eat it";
}

// What a log says in a list
function describe(log) {
  const d = log.details || {};
  switch (log.kind) {
    case "fed": return { title: PORTION_LABEL[d.portion] || "Meal", sub: eatenText(d.eaten) };
    case "water": return { title: "Water topped up" };
    case "wee": return { title: "Wee" };
    case "poo": return { title: "Poo" };
    case "walk": return { title: d.mins ? `${d.mins} minute walk` : "Walk", sub: d.distance || null };
    case "daycare": return { title: "Day at doggy daycare" };
    case "flea": return { title: "Flea treatment" };
    case "worm": return { title: "Worming tablet" };
    case "weight": return { title: `Weighed ${fmtKg(d.kg)} kg` };
    case "med": return { title: d.name || "Medication", sub: d.dose || null };
    case "behaviour": return { title: d.type || "Behaviour note" };
    case "grooming": return { title: d.type || "Grooming" };
    default: return { title: log.kind };
  }
}

const uuid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ } }
const isNetworkError = (e) => !navigator.onLine || /fetch|network|load failed|timed? ?out/i.test(String((e && e.message) || e));

// Re-render every minute so "2 hours ago" stays true
function useNow(ms = 60000) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

// ---------------------------------------------------------------------------
// Icons — drawn for this app, 24px grid, round line ends
// ---------------------------------------------------------------------------
const ICONS = {
  bowl: <><path d="M3.5 12.5h17l-1.6 5.6a2 2 0 0 1-1.9 1.4H7a2 2 0 0 1-1.9-1.4z" /><circle cx="8.5" cy="9.3" r="1.4" /><circle cx="12" cy="7.6" r="1.4" /><circle cx="15.5" cy="9.3" r="1.4" /></>,
  water: <><path d="M3.5 14h17l-1.3 4.6a2 2 0 0 1-1.9 1.4H6.7a2 2 0 0 1-1.9-1.4z" /><path d="M12 3.5c-1.9 2.4-2.9 4-2.9 5.3a2.9 2.9 0 0 0 5.8 0c0-1.3-1-2.9-2.9-5.3z" /></>,
  hydrant: <><path d="M8.5 9.5a3.5 3.5 0 0 1 7 0" /><path d="M12 6V4.5" /><path d="M7 9.5h10" /><path d="M8.5 9.5V20M15.5 9.5V20" /><path d="M6.5 20h11" /><path d="M8.5 12.5h-2v3h2M15.5 12.5h2v3h-2" /><circle cx="12" cy="14" r="1.3" /></>,
  poo: <><rect x="4" y="15" width="16" height="5" rx="2.5" /><rect x="6.5" y="10.5" width="11" height="4.5" rx="2.25" /><path d="M9 10.5a2 2 0 0 1 0-4h3.5c1 0 1.7-.6 1.9-1.6 1.1.6 1.6 1.6 1.6 2.9a2.7 2.7 0 0 1-2.7 2.7" /></>,
  lead: <><path d="M9.5 8.5C6.8 9.5 3 7.7 3.6 4.9c.5-2.4 4.5-2.4 5.9 3.6z" /><path d="M9.5 8.5c2.5 1.2 3.5 3.8 5.6 6.2" /><path d="M14.3 14.4l2.5-1.2 2.8 3.7-1.9 1.9z" /><circle cx="19.4" cy="19.9" r="1.4" /></>,
  daycare: <><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><circle cx="9.7" cy="13.1" r=".9" /><circle cx="12" cy="12.1" r=".9" /><circle cx="14.3" cy="13.1" r=".9" /><path d="M12 15c-1.4 0-2.6 1.3-2.6 2.4 0 .8.6 1.2 1.3 1.2.5 0 .8-.2 1.3-.2s.8.2 1.3.2c.7 0 1.3-.4 1.3-1.2 0-1.1-1.2-2.4-2.6-2.4z" /></>,
  paw: <><ellipse cx="5.9" cy="10.6" rx="1.7" ry="2.2" transform="rotate(-22 5.9 10.6)" /><ellipse cx="9.5" cy="6.5" rx="1.8" ry="2.3" /><ellipse cx="14.5" cy="6.5" rx="1.8" ry="2.3" /><ellipse cx="18.1" cy="10.6" rx="1.7" ry="2.2" transform="rotate(22 18.1 10.6)" /><path d="M12 11.6c-2.8 0-5.3 3-5.3 5.3 0 1.6 1.2 2.6 2.7 2.6 1 0 1.6-.5 2.6-.5s1.6.5 2.6.5c1.5 0 2.7-1 2.7-2.6 0-2.3-2.5-5.3-5.3-5.3z" /></>,
  pipette: <><path d="M14 3.5l6.5 6.5" /><path d="M16.2 5.7 9 12.9l-1.3 3.4 3.4-1.3 7.2-7.2" /><path d="M11.2 9.7l3.1 3.1" /><path d="M5.5 16.5c-1 1.3-1.5 2.1-1.5 2.7a1.5 1.5 0 0 0 3 0c0-.6-.5-1.4-1.5-2.7z" /></>,
  tablet: <g transform="rotate(-45 12 12)"><rect x="4" y="8.5" width="16" height="7" rx="3.5" /><path d="M12 8.5v7" /></g>,
  bottle: <><rect x="6" y="8" width="12" height="12.5" rx="2" /><path d="M7.5 4h9v4h-9z" /><path d="M12 11.5v5M9.5 14h5" /></>,
  scale: <><rect x="3.5" y="4" width="17" height="16.5" rx="4" /><path d="M7.8 10a5.5 5.5 0 0 1 8.4 0" /><path d="M12 10.5l1.6-2.2" /></>,
  scissors: <><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="17.5" r="2.5" /><path d="M8.6 8 20 18.5M8.6 16 20 5.5" /></>,
  note: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>,
  stethoscope: <><path d="M5.5 3.5H7M11.5 3.5H13" /><path d="M6.2 3.5v4.8a3.5 3.5 0 0 0 7 0V3.5" /><path d="M9.7 11.8v2.7a4.5 4.5 0 0 0 9 0v-2" /><circle cx="18.7" cy="10.5" r="2" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="15" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  home: <><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5h4v5" /></>,
  heartHouse: <><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M12 17.6s-3-1.8-3-3.8a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 2-3 3.8-3 3.8z" /></>,
  flat: <><rect x="6" y="3.5" width="12" height="17" rx="1.5" /><path d="M9.5 7.5h1M13.5 7.5h1M9.5 11h1M13.5 11h1M9.5 14.5h1M13.5 14.5h1M11 20.5V18h2v2.5" /></>,
  phone: <path d="M6.5 3.5h2.8l1.4 3.8-1.9 1.3a10.5 10.5 0 0 0 5.6 5.6l1.3-1.9 3.8 1.4v2.8a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />,
  pouch: <><path d="M6 4.5h12l-1 15.5a1.5 1.5 0 0 1-1.5 1.4h-7A1.5 1.5 0 0 1 7 20z" /><path d="M6.2 7.5h11.6" /><path d="M12 12c-1.2 0-2.2 1.1-2.2 2.1 0 .7.5 1 1.1 1 .4 0 .7-.2 1.1-.2s.7.2 1.1.2c.6 0 1.1-.3 1.1-1 0-1-1-2.1-2.2-2.1z" /></>,
  book: <><path d="M5 5.5a2 2 0 0 1 2-2h12v14H7a2 2 0 0 0-2 2z" /><path d="M5 19.5a2 2 0 0 0 2 2h12v-4" /><path d="M9 8h6" /></>,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" />,
  dog: <><path d="M8 5.8C9.2 5 10.5 4.6 12 4.6s2.8.4 4 1.2" /><path d="M8 5.8C5.6 4.8 3.5 6.3 3.5 9.4c0 2 .9 3.6 2.3 4.2.8-1.1 1.3-2.6 1.4-4.4" /><path d="M16 5.8c2.4-1 4.5.5 4.5 3.6 0 2-.9 3.6-2.3 4.2-.8-1.1-1.3-2.6-1.4-4.4" /><path d="M7.2 9.2c-.1 3.4.4 6.3 2 8.3.9 1.2 1.8 1.9 2.8 1.9s1.9-.7 2.8-1.9c1.6-2 2.1-4.9 2-8.3" /><circle cx="9.9" cy="10.7" r=".7" fill="currentColor" stroke="none" /><circle cx="14.1" cy="10.7" r=".7" fill="currentColor" stroke="none" /><path d="M10.8 13.6h2.4L12 15z" fill="currentColor" /><path d="M12 15v1.3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  pencil: <path d="M15.5 4.5l4 4L9 19l-5 1 1-5z" />,
  camera: <><path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.5" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  alert: <><path d="M12 4 21 19.5H3z" /><path d="M12 10v4M12 17v.01" /></>,
};
function Icon({ name, size = 24, stroke = 1.8, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name] || null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const toastListeners = new Set();
function toast(text, tone = "info") {
  const t = { id: Math.random(), text, tone };
  toastListeners.forEach((fn) => fn(t));
}
function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 3200);
    };
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data: loads everything, keeps a copy on the phone, live updates, and an
// outbox so logging works with no signal
// ---------------------------------------------------------------------------
const CACHE_KEY = "bt-cache-v1";
const QUEUE_KEY = "bt-queue-v1";
const LIVE_TABLES = ["bt_log", "bt_plans", "bt_plan_repeats", "bt_appointments", "bt_settings", "bt_push_subscriptions"];
const EMPTY = { logs: [], plans: [], repeats: [], appts: [], settings: {}, subs: [], names: {} };

// Apply one outbox entry to a copy of the data
function applyOp(state, q) {
  let logs = state.logs;
  let settings = state.settings;
  if (q.op === "insert") logs = [...logs.filter((l) => l.id !== q.row.id), q.row];
  if (q.op === "update") logs = logs.map((l) => (l.id === q.id ? { ...l, ...q.patch } : l));
  if (q.op === "delete") logs = logs.filter((l) => l.id !== q.id);
  if (q.op === "food2") {
    const a = q.args;
    let food = { ...(settings.food || {}) };
    if (a.p_add != null || a.p_set != null) {
      const left = foodStatus({ logs, settings }, new Date(a.p_at)).left;
      food = { ...food, grams: Math.round(Math.max(0, a.p_set != null ? a.p_set : left + a.p_add)), counted_at: a.p_at };
    }
    if (a.p_meal_g != null) food.meal_g = a.p_meal_g;
    if (a.p_bag_g != null) food.bag_g = a.p_bag_g;
    if (a.p_alert_days != null) food.alert_days = a.p_alert_days;
    settings = { ...settings, food };
  }
  return { ...state, logs: logs === state.logs ? logs : [...logs].sort(byAtDesc), settings };
}

async function runOp(q) {
  switch (q.op) {
    case "insert": {
      const { created_by, ...row } = q.row; // the database fills in who
      return sb.from("bt_log").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    }
    case "update": return sb.from("bt_log").update(q.patch).eq("id", q.id);
    case "delete": return sb.from("bt_log").delete().eq("id", q.id);
    case "food2": return sb.rpc("bt_food_update", q.args);
    // "food" (the old pouch counter) is dropped: the database no longer takes it
    default: return { error: null };
  }
}

function useBarney(userId) {
  const [base, setBase] = useState(() => readJSON(CACHE_KEY) || EMPTY);
  const [loaded, setLoaded] = useState(() => !!readJSON(CACHE_KEY));
  const [offline, setOffline] = useState(!navigator.onLine);
  const [loadError, setLoadError] = useState(null);
  const [queue, setQueue] = useState(() => readJSON(QUEUE_KEY) || []);
  const [days, setDays] = useState(60);
  const queueRef = useRef(queue);
  const daysRef = useRef(60);
  const flushing = useRef(false);

  const setQ = useCallback((q) => { queueRef.current = q; setQueue(q); writeJSON(QUEUE_KEY, q); }, []);

  const refresh = useCallback(async () => {
    const since = addDays(new Date(), -daysRef.current);
    since.setHours(0, 0, 0, 0);
    let res;
    try {
      res = await Promise.all([
        sb.from("bt_log").select("*").gte("at", since.toISOString()).order("at", { ascending: false }).limit(5000),
        sb.from("bt_log").select("*").eq("kind", "weight").order("at", { ascending: true }),
        sb.from("bt_log").select("*").in("kind", ["flea", "worm"]).order("at", { ascending: false }).limit(20),
        sb.from("bt_plans").select("*").gte("day", dayKey(addDays(new Date(), -28))).order("day"),
        sb.from("bt_appointments").select("*").order("day"),
        sb.from("bt_settings").select("key, value"),
        sb.from("bt_push_subscriptions").select("id, endpoint, device_name, user_id, created_at, notify").order("created_at"),
        sb.rpc("bt_member_names"),
        sb.from("bt_plan_repeats").select("*").order("created_at"),
      ]);
    } catch (e) {
      if (isNetworkError(e)) setOffline(true); else console.error(e);
      return;
    }
    const failed = res.find((r) => r.error);
    if (failed) {
      if (isNetworkError(failed.error)) setOffline(true);
      else { console.error(failed.error); setLoadError(failed.error.message || String(failed.error)); }
      return;
    }
    const [logs, weights, treats, plans, appts, settings, subs, names, repeats] = res.map((r) => r.data || []);
    const byId = new Map();
    [...logs, ...weights, ...treats].forEach((l) => byId.set(l.id, l));
    const next = {
      logs: [...byId.values()].sort(byAtDesc),
      plans,
      repeats,
      appts,
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      subs,
      names: Object.fromEntries(names.map((n) => [n.user_id, n.display_name])),
    };
    setBase(next);
    writeJSON(CACHE_KEY, next);
    setLoaded(true);
    setLoadError(null);
    setOffline(false);
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || !queueRef.current.length) return;
    flushing.current = true;
    let sent = false;
    try {
      while (queueRef.current.length) {
        const entry = queueRef.current[0];
        let res;
        try { res = await runOp(entry); } catch (e) { res = { error: e }; }
        if (res.error && isNetworkError(res.error)) { setOffline(true); break; }
        if (res.error) {
          console.error(res.error);
          toast("A change couldn't be saved", "error");
        } else {
          setBase((b) => {
            if (entry.op === "food2" && res.data) return { ...b, settings: { ...b.settings, food: res.data } };
            return applyOp(b, entry);
          });
          sent = true;
        }
        setQ(queueRef.current.filter((x) => x.qid !== entry.qid));
      }
    } finally {
      flushing.current = false;
    }
    if (sent && !queueRef.current.length) setOffline(false);
  }, [setQ]);

  // Save now if there's signal; otherwise keep it on the phone and send it later
  const commit = useCallback((entry) => {
    entry = { ...entry, qid: uuid() };
    const q = queueRef.current;
    const pendingInsert = (id) => q.find((x) => x.op === "insert" && x.row.id === id && !(flushing.current && q[0] === x));
    if (entry.op === "delete" && pendingInsert(entry.id)) {
      // Never reached the server: just forget it
      setQ(q.filter((x) => !((x.row && x.row.id === entry.id) || x.id === entry.id)));
      return;
    }
    if (entry.op === "update" && pendingInsert(entry.id)) {
      const ins = pendingInsert(entry.id);
      setQ(q.map((x) => (x === ins ? { ...x, row: { ...x.row, ...entry.patch } } : x)));
      flush();
      return;
    }
    setQ([...q, entry]);
    flush();
  }, [flush, setQ]);

  useEffect(() => {
    refresh();
    flush();
    const onVisible = () => { if (document.visibilityState === "visible") { refresh(); flush(); } };
    const onOnline = () => { setOffline(false); flush(); refresh(); };
    const onOffline = () => setOffline(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = setInterval(() => { if (queueRef.current.length) flush(); }, 20000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, [refresh, flush]);

  // Live updates: when another phone changes something, reload
  useEffect(() => {
    if (!sb.channel) return undefined;
    let timer = null;
    const channel = sb.channel("bt-live");
    LIVE_TABLES.forEach((table) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 400);
      }));
    channel.subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(channel); };
  }, [refresh]);

  // Things that need signal (plans, appointments, settings)
  const online = useCallback(async (fn, okText) => {
    try {
      const { data, error } = await fn();
      if (error) throw error;
      if (okText) toast(okText);
      refresh();
      return data || true;
    } catch (e) {
      if (isNetworkError(e)) toast("No signal. Try again when you're back online.", "error");
      else { console.error(e); toast("That didn't save. Try again.", "error"); refresh(); }
      return null;
    }
  }, [refresh]);

  const data = useMemo(() => queue.reduce(applyOp, base), [base, queue]);

  const addLog = useCallback((kind, details = {}, opts = {}) => {
    const row = { id: uuid(), kind, at: opts.at || new Date().toISOString(), details, note: opts.note || "", created_by: userId };
    commit({ op: "insert", row });
    return row;
  }, [commit, userId]);

  const setSetting = useCallback((key, value) => {
    setBase((b) => ({ ...b, settings: { ...b.settings, [key]: value } }));
    return online(() => sb.from("bt_settings").upsert({ key, value }));
  }, [online]);

  return {
    ...data,
    loaded,
    loadError,
    offline,
    pending: queue.length,
    userId,
    myName: data.names[userId] || "",
    days,
    refresh,
    addLog,
    updateLog: (id, patch) => commit({ op: "update", id, patch }),
    deleteLog: (id) => commit({ op: "delete", id }),
    food: (args) => commit({ op: "food2", args: { p_at: new Date().toISOString(), ...args } }),
    setNotify: (id, notify) => {
      setBase((b) => ({ ...b, subs: b.subs.map((x) => (x.id === id ? { ...x, notify } : x)) }));
      return online(() => sb.from("bt_push_subscriptions").update({ notify }).eq("id", id));
    },
    savePlan: (id, row) => online(() => (id ? sb.from("bt_plans").update(row).eq("id", id) : sb.from("bt_plans").insert(row)), "Plan saved"),
    deletePlan: (id) => online(() => sb.from("bt_plans").delete().eq("id", id), "Plan removed"),
    saveRepeat: (id, row) => online(() => (id ? sb.from("bt_plan_repeats").update(row).eq("id", id) : sb.from("bt_plan_repeats").insert(row)), "Weekly plan saved"),
    deleteRepeat: (id) => online(() => sb.from("bt_plan_repeats").delete().eq("id", id), "Weekly plan stopped"),
    saveAppt: (id, row) => online(() => (id ? sb.from("bt_appointments").update(row).eq("id", id) : sb.from("bt_appointments").insert(row)), "Appointment saved"),
    deleteAppt: (id) => online(() => sb.from("bt_appointments").delete().eq("id", id), "Appointment removed"),
    setSetting,
    saveSubscription: (sub, deviceName) => online(() => sb.from("bt_push_subscriptions").upsert(
      { endpoint: sub.endpoint, subscription: sub, device_name: deviceName, user_id: userId }, { onConflict: "endpoint" })),
    removeSubscription: (id) => online(() => sb.from("bt_push_subscriptions").delete().eq("id", id), "Phone removed"),
    showEarlier: () => { daysRef.current += 60; setDays(daysRef.current); refresh(); },
  };
}

// ---------------------------------------------------------------------------
// Working things out from the data
// ---------------------------------------------------------------------------
const latestOf = (logs, kinds) => logs.find((l) => kinds.includes(l.kind)) || null;

// Kibble left: the grams there were at counted_at, less the meals logged since
// (full portion = meal_g, half = half that, treat only = 0). The same sums as
// bt_food_status() in schema.sql, which bt-push and bt-alexa use.
const PORTION_SHARE = { half: 0.5, treat: 0 };
const shareOf = (l) => { const p = l.details && l.details.portion; return p in PORTION_SHARE ? PORTION_SHARE[p] : 1; };
function foodStatus(data, at = new Date()) {
  const f = (data.settings && data.settings.food) || {};
  const mealG = Number(f.meal_g) || 90;
  const bagG = Number(f.bag_g) || 6000;
  const alertDays = f.alert_days != null ? Number(f.alert_days) : 5;
  const known = !!f.counted_at;
  const fed = data.logs.filter((l) => l.kind === "fed" && new Date(l.at) <= at);
  const since = known ? new Date(f.counted_at) : null;
  const used = known ? fed.filter((l) => new Date(l.at) > since).reduce((n, l) => n + shareOf(l), 0) * mealG : 0;
  const left = Math.max(0, (Number(f.grams) || 0) - used);
  // Grams a day over the last fortnight, or two meals a day until there's enough to go on
  const recent = fed.filter((l) => new Date(l.at) > addDays(at, -14));
  let perDay = 2 * mealG;
  if (recent.length >= 4) {
    const first = Math.min(...recent.map((l) => new Date(l.at).getTime()));
    perDay = (recent.reduce((n, l) => n + shareOf(l), 0) * mealG) / Math.max(1, Math.min(14, (at - first) / 86400000));
  }
  const daysLeft = perDay > 0 ? Math.floor(left / perDay) : null;
  return { known, left, perDay, daysLeft, mealG, bagG, alertDays, low: known && (left <= 0 || (daysLeft != null && daysLeft <= alertDays)) };
}
// 1.4kg, or 350g under a kilo
const weight = (g) => (g >= 1000 ? `${Math.round(g / 100) / 10}kg` : `${Math.max(10, Math.round(g / 10) * 10)}g`);
const whoOf = (store, log) => {
  if (log.created_by && store.names[log.created_by]) return store.names[log.created_by];
  const by = log.details && log.details.by;
  return by && by !== "App" ? by : null;
};

function planSpan(p) {
  if (p.all_day || !p.start_time) return [new Date(`${p.day}T00:00:00`), new Date(`${p.day}T23:59:59`)];
  const s = new Date(`${p.day}T${p.start_time.slice(0, 5)}:00`);
  let e = p.end_time ? new Date(`${p.day}T${p.end_time.slice(0, 5)}:00`) : new Date(s.getTime() + 3600000);
  if (e <= s) e = new Date(s.getTime() + 3600000);
  return [s, e];
}
const planOrder = (a, b) => (a.all_day === b.all_day ? (a.start_time || "").localeCompare(b.start_time || "") : a.all_day ? -1 : 1);
const planTimes = (p) => (p.all_day || !p.start_time ? "All day" : `${clockOf(p.start_time)} to ${clockOf(p.end_time) || clock(planSpan({ day: todayKey(), ...p })[1])}`);
const isoDay = (d) => ((d.getDay() + 6) % 7) + 1;
const listText = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
function repeatDays(r) {
  const w = [...r.weekdays].sort((a, b) => a - b);
  if (w.length === 7) return "Every day";
  if (w.join() === "1,2,3,4,5") return "Every weekday";
  if (w.join() === "6,7") return "Every weekend";
  return `Every ${listText(w.map((n) => WEEKDAYS[n - 1].label))}`;
}
const repeatOf = (store, plan) => (plan && plan.repeat_id && (store.repeats || []).find((r) => r.id === plan.repeat_id)) || null;

// Where Barney is, from today's plans
function whereNow(plans) {
  const now = new Date();
  const todays = plans.filter((p) => p.day === todayKey());
  const current = todays.filter((p) => { const [s, e] = planSpan(p); return s <= now && now <= e; })
    .sort((a, b) => (a.all_day === b.all_day ? 0 : a.all_day ? 1 : -1))[0];
  if (current) {
    const pl = PLACE[current.place];
    return { place: pl, text: current.all_day ? `${pl.now} today` : `${pl.now} until ${clock(planSpan(current)[1])}` };
  }
  const next = todays.filter((p) => !p.all_day && planSpan(p)[0] > now).sort(planOrder)[0];
  if (next) return { place: PLACE[next.place], text: `${PLACE[next.place].label} from ${clockOf(next.start_time)}` };
  return null;
}

// A date plus some days, weeks or months (31 Jan + 1 month = 28 or 29 Feb)
function addInterval(d, n, unit) {
  if (unit !== "months") return addDays(d, unit === "weeks" ? n * 7 : n);
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x;
}
const cadenceText = (n, unit) => (n === 1 ? `Every ${unit.slice(0, -1)}` : `Every ${n} ${unit}`);

// When a treatment is next due: the date someone set, until the next dose is
// logged; otherwise the last dose plus how often it's given.
function treatmentPlan(store, t) {
  const cfg = (store.settings.treatments || {})[t.kind] || {};
  const every = Math.max(1, Math.round(Number(cfg.every)) || t.every);
  const unit = UNITS.some((u) => u.key === cfg.unit) ? cfg.unit : t.unit;
  const last = latestOf(store.logs, [t.kind]);
  const custom = !!cfg.due && (!last || new Date(last.at) < new Date(cfg.due_set_at || 0));
  const scheduled = last ? addInterval(parseDay(dayKey(new Date(last.at))), every, unit) : null;
  const due = custom ? parseDay(cfg.due) : scheduled;
  const left = due ? daysBetween(new Date(), due) : null;
  const from = custom ? new Date(cfg.due_set_at) : last ? new Date(last.at) : null;
  const span = due && from ? Math.max(1, daysBetween(from, due)) : 1;
  const pct = left == null ? 0 : Math.min(100, Math.max(0, (1 - left / span) * 100));
  return { ...t, every, unit, cadence: cadenceText(every, unit), last, scheduled, due, left, custom, pct };
}

function careItems(store) {
  const items = [];
  for (const t of TREATMENTS) {
    const p = treatmentPlan(store, t);
    if (!p.due) {
      items.push({ key: t.kind, icon: KIND[t.kind].icon, title: `${t.label} not logged yet`, sub: "Add when it was last done", action: "set", kind: t.kind });
      continue;
    }
    const dueIn = p.left;
    if (dueIn > t.warn) continue;
    const lastText = p.last ? `Last done ${shortDate(new Date(p.last.at))}` : null;
    items.push({
      key: t.kind,
      icon: KIND[t.kind].icon,
      urgent: dueIn <= 0,
      title: dueIn < 0 ? `${t.label} is overdue` : dueIn === 0 ? `${t.label} is due today` : `${t.label} due in ${plural(dueIn, "day")}`,
      sub: dueIn < 0 ? [`${plural(-dueIn, "day")} late`, lastText].filter(Boolean).join(". ") : lastText,
      action: "done",
      kind: t.kind,
    });
  }
  const soon = store.appts.filter((a) => { const d = daysBetween(new Date(), parseDay(a.day)); return d >= 0 && d <= 7; })
    .sort((a, b) => (a.day + (a.at_time || "")).localeCompare(b.day + (b.at_time || "")));
  for (const a of soon) {
    const who = a.kind === "vet" ? "Vet" : "Groomer";
    items.push({
      key: a.id,
      icon: a.kind === "vet" ? "stethoscope" : "scissors",
      title: `${who} ${relDay(a.day)}${a.at_time ? ` at ${clockOf(a.at_time)}` : ""}`,
      sub: a.title || null,
      action: a.kind === "vet" && store.settings.info && store.settings.info.vet_phone ? "call" : "open",
      appt: a,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
function Sheet({ title, onClose, children }) {
  const panel = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("sheet-open");
    if (panel.current) panel.current.focus({ preventScroll: true });
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("sheet-open"); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, id, hint, children }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function Choices({ label, options, value, onChange, wrap = true }) {
  const labelId = `lbl-${slug(label)}`;
  return (
    <div className="field">
      <span className="field-label" id={labelId}>{label}</span>
      <div className={`choices ${wrap ? "" : "choices-row"}`} role="radiogroup" aria-labelledby={labelId}>
        {options.map((o) => {
          const key = typeof o === "object" ? o.key : o;
          const text = typeof o === "object" ? o.label : o;
          return (
            <button key={key} type="button" role="radio" aria-checked={value === key}
              className={`choice ${value === key ? "is-on" : ""}`} onClick={() => onChange(key)}>{text}</button>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button type="button" className={`btn btn-danger btn-block ${armed ? "is-armed" : ""}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmLabel : label}
    </button>
  );
}

function LogRow({ store, log, onOpen, showDay }) {
  const k = KIND[log.kind] || { icon: "paw", label: log.kind };
  const d = describe(log);
  const who = whoOf(store, log);
  const at = new Date(log.at);
  const sub = [d.sub, log.note].filter(Boolean).join(". ");
  return (
    <li>
      <button type="button" className="log-row" onClick={() => onOpen(log)}>
        <span className={`log-icon log-icon-${k.group}`}><Icon name={k.icon} size={22} /></span>
        <span className="log-main">
          <span className="log-title">{d.title}</span>
          {sub && <span className="log-sub">{sub}</span>}
        </span>
        <span className="log-meta">
          <span>{showDay ? `${shortDate(at)}, ${clock(at)}` : clock(at)}</span>
          {who && <span className="log-who">{who}</span>}
        </span>
      </button>
    </li>
  );
}

function ScreenHead({ title, action }) {
  return (
    <header className="collar collar-slim">
      <div className="collar-inner">
        <h1>{title}</h1>
        {action}
      </div>
    </header>
  );
}

function Empty({ children }) {
  return <p className="empty"><Icon name="paw" size={20} />{children}</p>;
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------
function TodayScreen({ store, open, onLogged, photo }) {
  useNow();
  const [flash, setFlash] = useState(null);
  const logs = store.logs;
  const today = todayKey();
  const hour = new Date().getHours();
  const todays = logs.filter((l) => dayKey(new Date(l.at)) === today);
  const meals = todays.filter((l) => l.kind === "fed").length;
  const walkMins = todays.filter((l) => l.kind === "walk").reduce((n, l) => n + (Number(l.details && l.details.mins) || 0), 0);
  const daycare = todays.some((l) => l.kind === "daycare");
  const where = whereNow(store.plans);
  const items = careItems(store);
  const food = foodStatus(store);
  const daycarePlan = store.plans.some((p) => p.day === today && p.place === "daycare");

  const quick = (kind, details = {}) => {
    const row = store.addLog(kind, details);
    setFlash(kind);
    setTimeout(() => setFlash((f) => (f === kind ? null : f)), 1400);
    onLogged(row);
  };
  const last = (kinds) => latestOf(logs, kinds);
  const sinceText = (kinds) => ago(last(kinds) && last(kinds).at) || "Not logged yet";

  let fedNote = null, fedUrgent = false;
  if (meals) fedNote = `${plural(meals, "meal")} today`;
  else if (hour >= 12) { fedNote = "No meals yet today"; fedUrgent = true; }

  let walkLine, walkUrgent = false;
  if ((daycare || daycarePlan) && !walkMins) walkLine = "At daycare today";
  else if (walkMins) walkLine = `${walkMins} minutes today${daycare || daycarePlan ? ", plus daycare" : ""}`;
  else if (hour >= 16) { walkLine = "Not walked yet today"; walkUrgent = true; }
  else walkLine = last(["walk", "daycare"]) ? `Last walk ${lowerAgo(last(["walk", "daycare"]).at)}` : "No walks logged yet";

  const tiles = [
    { kind: "fed", label: "Fed", line: sinceText(["fed"]), note: fedNote, urgent: fedUrgent, onClick: () => quick("fed", { portion: "full", eaten: 100 }) },
    { kind: "water", label: "Water", line: sinceText(["water"]), onClick: () => quick("water") },
    { kind: "wee", label: "Wee", line: sinceText(["wee"]), onClick: () => quick("wee") },
    { kind: "poo", label: "Poo", line: sinceText(["poo"]), onClick: () => quick("poo") },
  ];

  return (
    <main className="screen screen-today">
      <header className="collar collar-tall">
        <div className="tag">
          <span className="tag-ring" aria-hidden="true" />
          <img className="tag-photo" src={photo} alt="Barney" width="120" height="120" />
        </div>
      </header>
      <div className="today-name">
        <h1>Barney</h1>
        <button type="button" className="where" onClick={() => { location.hash = "#/barney/plans"; }}>
          <Icon name={where ? where.place.icon : "calendar"} size={18} />
          <span>{where ? where.text : "No plan for right now"}</span>
        </button>
      </div>

      <section className="tiles" aria-label="Log in one tap">
        {tiles.map((t) => (
          <button key={t.kind} type="button" className={`tile ${flash === t.kind ? "is-logged" : ""} ${t.urgent ? "is-urgent" : ""}`} onClick={t.onClick}
            aria-label={`Log ${t.label.toLowerCase()}. Last: ${t.line}`}>
            <span className="tile-icon"><Icon name={flash === t.kind ? "check" : KIND[t.kind].icon} size={30} stroke={1.9} /></span>
            <span className="tile-label">{t.label}</span>
            <span className="tile-line">{t.line}</span>
            {t.note && <span className="tile-note">{t.note}</span>}
          </button>
        ))}
        <button type="button" className={`tile tile-wide ${flash === "walk" ? "is-logged" : ""} ${walkUrgent ? "is-urgent" : ""}`}
          onClick={() => open({ type: "walk", onDone: () => { setFlash("walk"); setTimeout(() => setFlash(null), 1400); } })}
          aria-label={`Log a walk. ${walkLine}`}>
          <span className="tile-icon"><Icon name={flash === "walk" ? "check" : "lead"} size={30} stroke={1.9} /></span>
          <span className="tile-text">
            <span className="tile-label">Walk</span>
            <span className="tile-line">{walkLine}</span>
          </span>
          <Icon name="chevronRight" size={22} className="tile-chevron" />
        </button>
      </section>

      <button type="button" className="btn btn-quiet btn-block" onClick={() => open({ type: "add" })}>
        <Icon name="plus" size={20} /> Log something else
      </button>

      {items.length > 0 && (
        <section className="block">
          <h2>Needs doing</h2>
          <ul className="list">
            {items.map((it) => (
              <li key={it.key} className={`care ${it.urgent ? "is-urgent" : ""}`}>
                <span className="care-icon"><Icon name={it.icon} size={22} /></span>
                <span className="care-text">
                  <span className="care-title">{it.title}</span>
                  {it.sub && <span className="care-sub">{it.sub}</span>}
                </span>
                {it.action === "done" && (
                  <button type="button" className="btn btn-small" onClick={() => onLogged(store.addLog(it.kind, {}))}>Done</button>
                )}
                {it.action === "set" && <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "log", kind: it.kind })}>Add date</button>}
                {it.action === "call" && <a className="btn btn-small btn-outline" href={`tel:${store.settings.info.vet_phone}`}><Icon name="phone" size={18} /> Call</a>}
                {it.action === "open" && <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "appt", appt: it.appt })}>View</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`block cupboard ${food.low ? "is-low" : ""}`} aria-label="Food cupboard">
        <button type="button" className="cupboard-count" onClick={() => open({ type: "food" })}>
          <Icon name="pouch" size={26} />
          <span>
            <span className="cupboard-num">{!food.known ? "His kibble" : food.left <= 0 ? "Out of kibble" : food.low ? "Buy food soon" : `About ${weight(food.left)} left`}</span>
            <span className="cupboard-sub">
              {!food.known ? "Tap to say how full the bag is"
                : food.left <= 0 ? "By the meals logged"
                : food.low ? `About ${weight(food.left)}, ${plural(food.daysLeft, "day")}`
                : `Roughly ${plural(food.daysLeft, "day")} of food`}
            </span>
          </span>
        </button>
        <button type="button" className="btn btn-small" onClick={() => open({ type: "food", buy: true })}>Bought food</button>
      </section>

      <section className="block">
        <h2>Today so far</h2>
        {todays.length === 0
          ? <Empty>Nothing logged yet today.</Empty>
          : (
            <ul className="list">
              {todays.slice(0, 8).map((l) => <LogRow key={l.id} store={store} log={l} onOpen={(log) => open({ type: "log", kind: log.kind, log })} />)}
            </ul>
          )}
        {todays.length > 8 && <a className="link-more" href="#/diary">See all {todays.length} in the diary</a>}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Diary
// ---------------------------------------------------------------------------
function DiaryScreen({ store, open }) {
  useNow();
  const [filter, setFilter] = useState(() => { try { return sessionStorage.getItem("bt-diary") || "all"; } catch (e) { return "all"; } });
  useEffect(() => { try { sessionStorage.setItem("bt-diary", filter); } catch (e) { /* ignore */ } }, [filter]);
  const list = store.logs.filter((l) => filter === "all" || (KIND[l.kind] && KIND[l.kind].group === filter));
  const groups = [];
  for (const l of list) {
    const key = dayKey(new Date(l.at));
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
    groups[groups.length - 1].items.push(l);
  }
  return (
    <main className="screen">
      <ScreenHead title="Diary" action={<button type="button" className="collar-action" onClick={() => open({ type: "add" })}><Icon name="plus" size={20} /> Add</button>} />
      <div className="filters" role="tablist" aria-label="Show">
        {DIARY_FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`choice ${filter === f.key ? "is-on" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      {groups.length === 0 && <Empty>Nothing here yet. Things you log show up in the diary.</Empty>}
      {groups.map((g) => (
        <section key={g.key} className="block day">
          <h2>{dayHeading(g.key)}</h2>
          <ul className="list">
            {g.items.map((l) => <LogRow key={l.id} store={store} log={l} onOpen={(log) => open({ type: "log", kind: log.kind, log })} />)}
          </ul>
        </section>
      ))}
      <button type="button" className="btn btn-quiet btn-block" onClick={store.showEarlier}>Show earlier days</button>
      <p className="fineprint">Showing the last {store.days} days.</p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
function WeightChart({ points }) {
  if (points.length < 2) return null;
  const W = 320, H = 120, P = { l: 34, r: 10, t: 12, b: 22 };
  const xs = points.map((p) => new Date(p.at).getTime());
  const ys = points.map((p) => Number(p.kg));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1) { y0 -= 0.5; y1 += 0.5; }
  const sx = (x) => P.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - P.l - P.r);
  const sy = (y) => P.t + (1 - (y - y0) / (y1 - y0)) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight from ${fmtKg(ys[0])} kg to ${fmtKg(ys[ys.length - 1])} kg`}>
      <line x1={P.l} x2={W - P.r} y1={sy(y1)} y2={sy(y1)} className="chart-grid" />
      <line x1={P.l} x2={W - P.r} y1={sy(y0)} y2={sy(y0)} className="chart-grid" />
      <text x={P.l - 6} y={sy(y1) + 4} className="chart-label" textAnchor="end">{fmtKg(y1)}</text>
      <text x={P.l - 6} y={sy(y0) + 4} className="chart-label" textAnchor="end">{fmtKg(y0)}</text>
      <path d={d} className="chart-line" />
      {points.map((p, i) => <circle key={p.id} cx={sx(xs[i])} cy={sy(ys[i])} r={i === points.length - 1 ? 4.5 : 3} className="chart-dot" />)}
      <text x={P.l} y={H - 4} className="chart-label">{shortDate(new Date(x0))}</text>
      <text x={W - P.r} y={H - 4} className="chart-label" textAnchor="end">{shortDate(new Date(x1))}</text>
    </svg>
  );
}

function HistoryList({ store, logs, open, empty, limit = 5 }) {
  const [all, setAll] = useState(false);
  if (!logs.length) return <Empty>{empty}</Empty>;
  return (
    <>
      <ul className="list">
        {(all ? logs : logs.slice(0, limit)).map((l) => <LogRow key={l.id} store={store} log={l} showDay onOpen={(log) => open({ type: "log", kind: log.kind, log })} />)}
      </ul>
      {logs.length > limit && <button type="button" className="link-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${logs.length}`}</button>}
    </>
  );
}

function HealthScreen({ store, open, onLogged }) {
  useNow();
  const logs = store.logs;
  const weights = logs.filter((l) => l.kind === "weight").sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((l) => ({ id: l.id, at: l.at, kg: l.details && l.details.kg, log: l })).filter((p) => Number(p.kg) > 0);
  const latestW = weights[weights.length - 1];
  const prevW = weights[weights.length - 2];
  const today = todayKey();
  const upcoming = store.appts.filter((a) => a.day >= today).sort((a, b) => (a.day + (a.at_time || "")).localeCompare(b.day + (b.at_time || "")));
  const past = store.appts.filter((a) => a.day < today).sort((a, b) => b.day.localeCompare(a.day));
  const [showPast, setShowPast] = useState(false);
  const info = store.settings.info || {};
  const lastGroom = latestOf(logs, ["grooming"]);

  return (
    <main className="screen">
      <ScreenHead title="Health" />

      <section className="block">
        <h2>Treatments</h2>
        <div className="treatments">
          {TREATMENTS.map((t) => {
            const { last, due, left, pct, cadence, custom } = treatmentPlan(store, t);
            const tone = left == null ? "" : left <= 0 ? "is-urgent" : left <= t.warn ? "is-soon" : "is-ok";
            return (
              <div key={t.kind} className={`treatment ${tone}`}>
                <div className="treatment-top">
                  <span className="treatment-icon"><Icon name={KIND[t.kind].icon} size={24} /></span>
                  <span className="treatment-name">{t.label}<span className="treatment-cadence">{cadence}</span></span>
                </div>
                <p className="treatment-due">
                  {left == null ? "Not logged yet" : left < 0 ? `${plural(-left, "day")} overdue` : left === 0 ? "Due today" : `Due in ${plural(left, "day")}`}
                </p>
                <div className="bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
                {due && <p className="treatment-next">{`Due ${shortDate(due)}`}{custom && " (date set)"}</p>}
                <p className="treatment-last">{last ? `Last done ${shortDate(new Date(last.at))}` : "Add when it was last done"}</p>
                <div className="treatment-actions">
                  <button type="button" className="btn btn-small" onClick={() => onLogged(store.addLog(t.kind, {}))}>Done today</button>
                  <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "log", kind: t.kind })}>Other date</button>
                  <button type="button" className="btn btn-small btn-quiet" onClick={() => open({ type: "treatment", kind: t.kind })}><Icon name="calendar" size={18} /> Due date</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Vet and groomer</h2>
          <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "appt" })}><Icon name="plus" size={18} /> Add</button>
        </div>
        {info.vet_phone && (
          <a className="call-card" href={`tel:${info.vet_phone}`}>
            <Icon name="stethoscope" size={24} />
            <span><span className="call-name">{info.vet || "Vet"}</span><span className="call-num">{info.vet_phone}</span></span>
            <span className="call-btn"><Icon name="phone" size={18} /> Call</span>
          </a>
        )}
        {upcoming.length === 0 ? <Empty>No appointments booked.</Empty> : (
          <ul className="list">
            {upcoming.map((a) => <ApptRow key={a.id} appt={a} onOpen={() => open({ type: "appt", appt: a })} />)}
          </ul>
        )}
        {past.length > 0 && <button type="button" className="link-more" onClick={() => setShowPast(!showPast)}>{showPast ? "Hide past visits" : `Past visits (${past.length})`}</button>}
        {showPast && <ul className="list">{past.map((a) => <ApptRow key={a.id} appt={a} past onOpen={() => open({ type: "appt", appt: a })} />)}</ul>}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Weight</h2>
          <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "log", kind: "weight" })}><Icon name="plus" size={18} /> Add</button>
        </div>
        {latestW ? (
          <div className="weight">
            <p className="weight-now">{fmtKg(latestW.kg)}<span> kg</span></p>
            <p className="weight-sub">
              {shortDate(new Date(latestW.at))}
              {prevW && Number(prevW.kg) !== Number(latestW.kg) ? `, ${Number(latestW.kg) > Number(prevW.kg) ? "up" : "down"} ${fmtKg(Math.abs(latestW.kg - prevW.kg))} kg since ${shortDate(new Date(prevW.at))}` : ""}
            </p>
            <WeightChart points={weights.slice(-24)} />
          </div>
        ) : <Empty>Weigh Barney to start his chart.</Empty>}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Medication</h2>
          <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "log", kind: "med" })}><Icon name="plus" size={18} /> Log</button>
        </div>
        <HistoryList store={store} open={open} logs={logs.filter((l) => l.kind === "med")} empty="No medicine logged." />
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Grooming</h2>
          <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "log", kind: "grooming" })}><Icon name="plus" size={18} /> Log</button>
        </div>
        {lastGroom && <p className="block-note">Last groomed {relDayPast(lastGroom.at)}: {(lastGroom.details && lastGroom.details.type) || "Grooming"}.</p>}
        <HistoryList store={store} open={open} logs={logs.filter((l) => l.kind === "grooming")} empty="No grooming logged." />
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Behaviour notes</h2>
          <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "log", kind: "behaviour" })}><Icon name="plus" size={18} /> Add</button>
        </div>
        <HistoryList store={store} open={open} logs={logs.filter((l) => l.kind === "behaviour")} empty="Nothing noted. Add anything unusual, like limping or not eating." />
      </section>
    </main>
  );
}
function relDayPast(iso) {
  const days = daysBetween(new Date(iso), new Date());
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `on ${shortDate(new Date(iso))}`;
}

function ApptRow({ appt, past, onOpen }) {
  const d = parseDay(appt.day);
  return (
    <li>
      <button type="button" className={`log-row appt ${past ? "is-past" : ""}`} onClick={onOpen}>
        <span className="date-chip"><span>{d.toLocaleDateString("en-GB", { month: "short" })}</span><b>{d.getDate()}</b></span>
        <span className="log-main">
          <span className="log-title">{appt.kind === "vet" ? "Vet" : "Groomer"}{appt.title ? `: ${appt.title}` : ""}</span>
          <span className="log-sub">{[past ? (appt.at_time ? clockOf(appt.at_time) : null) : `${cap(relDay(appt.day))}${appt.at_time ? ` at ${clockOf(appt.at_time)}` : ""}`, appt.notes || null].filter(Boolean).join(". ")}</span>
        </span>
        <Icon name="chevronRight" size={20} className="row-chevron" />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Barney: where he'll be, his details, notifications, settings
// ---------------------------------------------------------------------------
function weekStart(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }

function PlansWeek({ store, open }) {
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [selected, setSelected] = useState(todayKey());
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const dayPlans = store.plans.filter((p) => p.day === selected).sort(planOrder);
  const move = (n) => { const a = addDays(anchor, n * 7); setAnchor(a); setSelected(dayKey(n > 0 ? a : addDays(a, 6))); };
  return (
    <>
      <div className="week-nav">
        <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <span>{shortDate(days[0])} to {shortDate(days[6])}</span>
        <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week" role="tablist" aria-label="Day">
        {days.map((d) => {
          const key = dayKey(d);
          const places = [...new Set(store.plans.filter((p) => p.day === key).map((p) => p.place))];
          return (
            <button key={key} type="button" role="tab" aria-selected={selected === key}
              className={`week-day ${selected === key ? "is-on" : ""} ${key === todayKey() ? "is-today" : ""}`} onClick={() => setSelected(key)}>
              <span className="week-dow">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
              <span className="week-num">{d.getDate()}</span>
              <span className="week-dots">{places.slice(0, 3).map((p) => <i key={p} style={{ background: PLACE[p] ? PLACE[p].color : "#999" }} />)}</span>
            </button>
          );
        })}
      </div>
      <div className="block-head">
        <h3>{cap(dayHeading(selected))}</h3>
        <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "plan", day: selected })}><Icon name="plus" size={18} /> Add</button>
      </div>
      {dayPlans.length === 0 ? <Empty>No plans for this day.</Empty> : (
        <ul className="list">
          {dayPlans.map((p) => {
            const pl = PLACE[p.place] || PLACES[0];
            return (
              <li key={p.id}>
                <button type="button" className="log-row" onClick={() => open({ type: "plan", plan: p })}>
                  <span className="place-icon" style={{ color: pl.color }}><Icon name={pl.icon} size={22} /></span>
                  <span className="log-main">
                    <span className="log-title">{pl.label}</span>
                    <span className="log-sub">{[planTimes(p), repeatOf(store, p) && "Every week", p.note].filter(Boolean).join(". ")}</span>
                  </span>
                  <Icon name="chevronRight" size={20} className="row-chevron" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function urlB64ToBytes(s) {
  const b = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

function Notifications({ store }) {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [endpoint, setEndpoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setEndpoint(s ? s.endpoint : false)).catch(() => setEndpoint(false));
  }, [supported]);
  useEffect(() => { if (!name && store.myName) setName(`${store.myName}'s iPhone`); }, [store.myName]);
  const mine = endpoint ? store.subs.find((s) => s.endpoint === endpoint) : null;
  const on = !!mine;
  const chosen = mine && Array.isArray(mine.notify) ? mine.notify : ALL_NOTIFY;
  const choose = (key, yes) => {
    const next = ALL_NOTIFY.filter((k) => (k === key ? yes : chosen.includes(k)));
    store.setNotify(mine.id, next.length === ALL_NOTIFY.length ? null : next);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission(); // must come first, straight from the tap
      if (permission !== "granted") { toast("Notifications are blocked. Allow them in Settings → Notifications → Barney.", "error"); return; }
      const { data, error } = await sb.functions.invoke("bt-push", { body: { action: "vapid" } });
      if (error || !data || !data.publicKey) throw error || new Error("No key");
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(data.publicKey) });
      const ok = await store.saveSubscription(sub.toJSON(), name.trim() || "iPhone");
      if (ok) { setEndpoint(sub.endpoint); toast("Notifications are on for this phone"); }
    } catch (e) {
      console.error(e);
      toast(isNetworkError(e) ? "No signal. Try again when you're back online." : "Couldn't turn on notifications. Is the bt-push function deployed?", "error");
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    const { data, error } = await sb.functions.invoke("bt-push", { body: { action: "test" } });
    setBusy(false);
    if (error) toast("The test didn't send. Check the bt-push function.", "error");
    else toast(data && data.sent ? "Test sent. It should arrive in a few seconds." : "No phones to send to.");
  };
  const remove = async (s) => {
    const ok = await store.removeSubscription(s.id);
    if (ok && s.endpoint === endpoint) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      setEndpoint(false);
    }
  };

  return (
    <>
      {!supported ? (
        <p className="block-note">Notifications need Barney on your Home Screen. In Safari, tap Share, then Add to Home Screen, and open it from there.</p>
      ) : on ? (
        <div className="notice notice-ok"><Icon name="check" size={20} /> Notifications are on for this phone.</div>
      ) : (
        <div className="stack">
          <Field label="Name this phone" id="device-name"><input id="device-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <button type="button" className="btn btn-primary btn-block" onClick={turnOn} disabled={busy}><Icon name="bell" size={20} /> {busy ? "Turning on…" : "Turn on notifications"}</button>
        </div>
      )}
      {on && <button type="button" className="btn btn-outline btn-block" onClick={test} disabled={busy}>Send a test notification</button>}
      {on ? (
        <>
          <h3 className="sub-head">This phone hears about</h3>
          <ul className="list notify-list">
            {NOTIFY_GROUPS.map((g) => (
              <li key={g.key}>
                <label className="toggle notify-toggle">
                  <input type="checkbox" checked={chosen.includes(g.key)} onChange={(e) => choose(g.key, e.target.checked)} />
                  <span className="toggle-ui" aria-hidden="true" />
                  <span className="log-main"><span className="log-title">{g.label}</span>{g.sub && <span className="log-sub">{g.sub}</span>}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="fineprint">You don't get told about things you log yourself.</p>
        </>
      ) : (
        <>
          <h3 className="sub-head">You'll hear about</h3>
          <ul className="plain-list">
            <li>Meals, water, wees, poos, walks and daycare days when someone else logs them</li>
            <li>8am: flea or worming due or overdue, food to buy, appointments that day</li>
            <li>12pm: if no meal has been logged</li>
            <li>4pm: if he hasn't been walked or gone to daycare</li>
            <li>6pm: if fewer than two meals have been logged</li>
          </ul>
          <p className="fineprint">Once they're on, you can choose which of these this phone gets.</p>
        </>
      )}
      {store.subs.length > 0 && (
        <>
          <h3 className="sub-head">Phones with notifications on</h3>
          <ul className="list">
            {store.subs.map((s) => (
              <li key={s.id} className="device">
                <span className="log-main">
                  <span className="log-title">{s.device_name || "Phone"}{s.endpoint === endpoint ? " (this phone)" : ""}</span>
                  <span className="log-sub">{store.names[s.user_id] ? `${store.names[s.user_id]}, ` : ""}added {shortDate(new Date(s.created_at))}</span>
                </span>
                <button type="button" className="btn btn-small btn-outline" onClick={() => remove(s)}>Remove</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

async function squareJpeg(file, size = 480) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    // Portrait photos: crop a little above the middle, where faces usually are
    canvas.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) * 0.35, s, s, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function BarneyScreen({ store, open, photo, sub, session }) {
  useNow();
  const info = store.settings.info || {};
  const fileInput = useRef(null);
  const [importState, setImportState] = useState(null);
  const status = store.settings.icloud_status;
  const alexaKey = store.settings.alexa_key;
  const alexaUrl = alexaKey ? `${SUPABASE_URL}/functions/v1/bt-alexa?key=${alexaKey}` : null;
  useEffect(() => {
    if (sub) { const el = document.getElementById(sub); if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
  }, [sub]);

  const changePhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await squareJpeg(file);
      const ok = await store.setSetting("photo", dataUrl);
      if (ok) toast("Photo updated");
    } catch (err) {
      console.error(err);
      toast("That photo couldn't be read. Try another.", "error");
    }
  };
  const syncCalendar = async () => {
    toast("Syncing the calendar…");
    const { error } = await sb.functions.invoke("bt-calendar", { body: { all: true } });
    store.refresh();
    if (error) toast("The calendar didn't sync. See the message below.", "error");
    else toast("Calendar synced");
  };
  const copyAlexa = async () => {
    try { await navigator.clipboard.writeText(alexaUrl); toast("Alexa link copied"); } catch (e) { toast("Couldn't copy. Press and hold the link instead.", "error"); }
  };
  const runImport = async () => {
    setImportState({ busy: true, step: "Starting…" });
    try {
      const result = await importFromOldApp((step) => setImportState({ busy: true, step }));
      setImportState({ busy: false, result });
      store.refresh();
    } catch (e) {
      console.error(e);
      setImportState({ busy: false, error: isNetworkError(e) ? "Couldn't reach the old app. Check you have signal and that it's still running." : "Something went wrong bringing the data over. Try again." });
    }
  };

  return (
    <main className="screen">
      <ScreenHead title="Barney" />

      <section className="profile">
        <img className="profile-photo" src={photo} alt="Barney" width="96" height="96" />
        <div>
          <p className="profile-name">Barney</p>
          <button type="button" className="btn btn-small btn-outline" onClick={() => fileInput.current && fileInput.current.click()}><Icon name="camera" size={18} /> Change photo</button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={changePhoto} />
        </div>
      </section>

      <section className="block" id="plans">
        <h2>Where he'll be</h2>
        <p className="block-note">Plans go into the shared Barney calendar in iCloud too.</p>
        <PlansWeek store={store} open={open} />
        <div className="block-head repeats-head">
          <h3>Every week</h3>
          <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "plan", weekly: true })}><Icon name="plus" size={18} /> Add</button>
        </div>
        {(store.repeats || []).length === 0 ? <Empty>Nothing repeats yet. Add daycare days once and they fill in every week.</Empty> : (
          <ul className="list">
            {store.repeats.map((r) => {
              const pl = PLACE[r.place] || PLACES[0];
              return (
                <li key={r.id}>
                  <button type="button" className="log-row" onClick={() => open({ type: "plan", repeat: r })}>
                    <span className="place-icon" style={{ color: pl.color }}><Icon name={pl.icon} size={22} /></span>
                    <span className="log-main">
                      <span className="log-title">{pl.label}</span>
                      <span className="log-sub">{[repeatDays(r), planTimes(r), r.ends_on && `until ${shortDate(parseDay(r.ends_on))}`, r.note].filter(Boolean).join(". ")}</span>
                    </span>
                    <Icon name="chevronRight" size={20} className="row-chevron" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="block" id="details">
        <div className="block-head">
          <h2>His details</h2>
          <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "info" })}><Icon name="pencil" size={18} /> Edit</button>
        </div>
        <dl className="details">
          {INFO_FIELDS.map((f) => (
            <div key={f.key} className="detail">
              <dt>{f.label}</dt>
              <dd>
                {info[f.key] ? (f.tel ? <a href={`tel:${info[f.key]}`} className="tel"><Icon name="phone" size={16} /> {info[f.key]}</a> : info[f.key]) : <span className="muted">Not added</span>}
              </dd>
            </div>
          ))}
          {info.notes && <div className="detail detail-notes"><dt>Notes</dt><dd>{info.notes}</dd></div>}
        </dl>
      </section>

      <section className="block" id="notifications">
        <h2>Notifications</h2>
        <Notifications store={store} />
      </section>

      <section className="block" id="settings">
        <h2>Settings</h2>
        <ul className="list settings">
          <li className="setting">
            <span className="log-main"><span className="log-title">Food</span><span className="log-sub">{(() => { const f = foodStatus(store); return `${f.mealG}g a meal, ${weight(f.bagG)} bags. Reminds you with ${plural(f.alertDays, "day")} left`; })()}</span></span>
            <button type="button" className="btn btn-small btn-outline" onClick={() => open({ type: "food", settings: true })}>Change</button>
          </li>
          <li className="setting">
            <span className="log-main">
              <span className="log-title">iCloud calendar</span>
              <span className={`log-sub ${status && !status.ok ? "is-error" : ""}`}>
                {!status ? "Not synced yet" : status.ok ? `Last synced ${lowerAgo(status.at)}` : status.error}
              </span>
            </span>
            <button type="button" className="btn btn-small btn-outline" onClick={syncCalendar}><Icon name="refresh" size={18} /> Sync</button>
          </li>
          {alexaUrl && (
            <li className="setting">
              <span className="log-main"><span className="log-title">Alexa link</span><span className="log-sub mono-break">{alexaUrl}</span></span>
              <button type="button" className="btn btn-small btn-outline" onClick={copyAlexa}><Icon name="copy" size={18} /> Copy</button>
            </li>
          )}
          <li className="setting setting-stack">
            <span className="log-main">
              <span className="log-title">Data from the old app</span>
              <span className="log-sub">
                {store.settings.imported_at ? `Brought over ${shortDate(new Date(store.settings.imported_at))}. Running it again only adds anything new.` : "Copies meals, toilet trips, walks, health logs, vet visits, his details and Google Calendar plans from the old version."}
              </span>
            </span>
            <button type="button" className="btn btn-small btn-outline" onClick={runImport} disabled={importState && importState.busy}>
              {importState && importState.busy ? "Bringing over…" : "Bring over data"}
            </button>
            {importState && importState.busy && <p className="setting-status">{importState.step}</p>}
            {importState && importState.error && <p className="setting-status is-error">{importState.error}</p>}
            {importState && importState.result && <p className="setting-status">{importSummary(importState.result)}</p>}
          </li>
          <li className="setting">
            <span className="log-main"><span className="log-title">Signed in as {store.myName || session.user.email}</span><span className="log-sub">Version {APP_VERSION}</span></span>
            <button type="button" className="btn btn-small btn-outline" onClick={() => sb.auth.signOut()}>Sign out</button>
          </li>
        </ul>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// One-off import from the old Cloudflare app
// ---------------------------------------------------------------------------
function isoFrom(s) {
  if (!s) return new Date().toISOString();
  let t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += "T12:00:00";
  else if (/^\d{4}-\d{2}-\d{2} \d/.test(t)) t = t.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? "" : "Z");
  const d = new Date(t);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
}

async function importFromOldApp(onStep) {
  const get = async (path) => {
    const r = await fetch(OLD_API + path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path} answered ${r.status}`);
    return r.json();
  };
  const logs = [], plans = [], appts = [];
  const skipped = [];
  const step = async (label, fn) => {
    onStep(`Reading ${label}…`);
    try { await fn(); } catch (e) { console.warn(label, e); skipped.push(label); }
  };
  const legacy = (kind, src, id, details = {}, note) => ({
    kind,
    at: isoFrom(src.created_at || src.treated_at || src.logged_date),
    details: { ...details, by: src.logged_by || src.added_by || null },
    note: note != null ? note : src.note || "",
    legacy_id: id,
    created_by: null,
  });
  const list = (x) => (Array.isArray(x) ? x : []);

  await step("meals", async () => {
    for (const f of list(await get("/api/feeding"))) {
      if (f.amount === "Water") { logs.push(legacy("water", f, `feeding:${f.id}`, {}, "")); continue; }
      const portion = /half/i.test(f.amount) ? "half" : /treat/i.test(f.amount) ? "treat" : "full";
      const m = String(f.note || "").match(/ate (\d+)%/i);
      const note = String(f.note || "").replace(/\s*·?\s*ate \d+%/i, "").trim();
      logs.push(legacy("fed", f, `feeding:${f.id}`, { portion, eaten: m ? Number(m[1]) : null }, note));
    }
  });
  await step("toilet trips", async () => {
    for (const t of list(await get("/api/toilet"))) logs.push(legacy(t.type === "poo" ? "poo" : "wee", t, `toilet:${t.id}`, {}, ""));
  });
  await step("walks", async () => {
    for (const w of list(await get("/api/walks"))) {
      if (w.distance === "daycare") logs.push(legacy("daycare", w, `walks:${w.id}`));
      else logs.push(legacy("walk", w, `walks:${w.id}`, { mins: Number(w.duration_mins) || 0, distance: w.distance || "" }));
    }
  });
  await step("weights", async () => {
    for (const w of list(await get("/api/weight"))) logs.push(legacy("weight", w, `weight:${w.id}`, { kg: Number(w.weight_kg) }, ""));
  });
  await step("medication", async () => {
    for (const m of list(await get("/api/medications"))) logs.push(legacy("med", m, `medications:${m.id}`, { name: m.name, dose: m.dose || "" }));
  });
  await step("behaviour notes", async () => {
    for (const b of list(await get("/api/behaviour"))) logs.push(legacy("behaviour", b, `behaviour:${b.id}`, { type: b.type }));
  });
  await step("grooming", async () => {
    for (const g of list(await get("/api/grooming"))) logs.push(legacy("grooming", g, `grooming:${g.id}`, { type: g.type }));
  });
  await step("treatments", async () => {
    const t = await get("/api/treatments");
    for (const k of ["flea", "worm"]) if (t && t[k]) logs.push(legacy(k, t[k], `treatments:${t[k].id}`, {}, ""));
  });
  await step("vet visits", async () => {
    for (const v of list(await get("/api/vet"))) {
      if (!v.appt_date) continue;
      appts.push({ kind: "vet", day: String(v.appt_date).slice(0, 10), title: v.reason || "", notes: v.notes || "", legacy_id: `vet:${v.id}`, created_by: null });
    }
  });
  await step("plans", async () => {
    for (const c of list(await get("/api/calendar"))) {
      if (!PLACE[c.location_id] || !c.event_date) continue;
      const allDay = !!c.all_day || !c.start_time;
      plans.push({ place: c.location_id, day: String(c.event_date).slice(0, 10), all_day: allDay, start_time: allDay ? null : c.start_time, end_time: allDay ? null : c.end_time || null, note: c.note || "", legacy_id: `cal:${c.id}`, created_by: null });
    }
  });
  await step("Google Calendar", async () => {
    const from = addDays(new Date(), -60).toISOString();
    const to = addDays(new Date(), 365).toISOString();
    for (const e of list(await get(`/api/gcal/events?timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`))) {
      const label = String(e.summary || "").split("— ")[1];
      const place = PLACES.find((p) => p.label === label || (p.key === "walk" && label === "On a walk"));
      if (!place || !e.start) continue;
      const allDay = !!e.start.date;
      const day = allDay ? e.start.date : String(e.start.dateTime).slice(0, 10);
      plans.push({
        place: place.key, day, all_day: allDay,
        start_time: allDay ? null : String(e.start.dateTime).slice(11, 16),
        end_time: allDay || !e.end || !e.end.dateTime ? null : String(e.end.dateTime).slice(11, 16),
        note: e.description || "", legacy_id: `gcal:${e.id}`, created_by: null,
      });
    }
  });

  const upsert = async (table, rows, label) => {
    for (let i = 0; i < rows.length; i += 200) {
      onStep(`Saving ${label} (${Math.min(i + 200, rows.length)} of ${rows.length})…`);
      const { error } = await sb.from(table).upsert(rows.slice(i, i + 200), { onConflict: "legacy_id", ignoreDuplicates: true });
      if (error) throw error;
    }
  };
  await upsert("bt_log", logs, "logs");
  await upsert("bt_plans", plans, "plans");
  await upsert("bt_appointments", appts, "appointments");

  await step("his details", async () => {
    const info = await get("/api/info");
    const { data: current } = await sb.from("bt_settings").select("key, value").in("key", ["info"]);
    const now = (current && current[0] && current[0].value) || {};
    const merged = { ...now };
    for (const f of [...INFO_FIELDS.map((x) => x.key), "notes"]) if (!merged[f] && info && info[f]) merged[f] = info[f];
    await sb.from("bt_settings").upsert({ key: "info", value: merged });
    // The old app counted pouches; Barney's on kibble now, so that count isn't brought over
  });
  await sb.from("bt_settings").upsert({ key: "imported_at", value: new Date().toISOString() });

  onStep("Sending plans to the iCloud calendar…");
  const cal = await sb.functions.invoke("bt-calendar", { body: { all: true } }).catch((e) => ({ error: e }));

  const count = (kinds) => logs.filter((l) => kinds.includes(l.kind)).length;
  return {
    meals: count(["fed", "water"]),
    toilet: count(["wee", "poo"]),
    walks: count(["walk", "daycare"]),
    health: count(["weight", "med", "behaviour", "grooming", "flea", "worm"]),
    plans: plans.length,
    appts: appts.length,
    skipped,
    calendar: !cal.error,
  };
}
function importSummary(r) {
  const parts = [
    plural(r.meals, "meal"), plural(r.toilet, "toilet trip"), plural(r.walks, "walk"),
    plural(r.health, "health log"), plural(r.plans, "plan"), plural(r.appts, "vet visit"),
  ];
  let s = `Done: ${parts.join(", ")}.`;
  if (r.skipped.length) s += ` Couldn't read: ${r.skipped.join(", ")}.`;
  if (!r.calendar) s += " The iCloud calendar didn't sync yet; use Sync once it's set up.";
  return s;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
function defaultsFor(kind) {
  switch (kind) {
    case "fed": return { portion: "full", eaten: 100 };
    case "walk": return { mins: 30, distance: "" };
    case "med": return { name: "", dose: "" };
    case "weight": return { kg: "" };
    case "behaviour": return { type: BEHAVIOURS[0] };
    case "grooming": return { type: GROOMING_TYPES[0] };
    default: return {};
  }
}

function LogSheet({ store, kind, log, onClose }) {
  const k = KIND[kind];
  const editing = !!log;
  const dateOnly = ["flea", "worm", "weight"].includes(kind);
  const initial = log ? new Date(log.at) : new Date();
  const [when, setWhen] = useState(dateOnly ? dayKey(initial) : toLocalInput(initial));
  const [d, setD] = useState(() => ({ ...defaultsFor(kind), ...((log && log.details) || {}) }));
  const [note, setNote] = useState((log && log.note) || "");
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const medNames = useMemo(() => [...new Set(store.logs.filter((l) => l.kind === "med" && l.details && l.details.name).map((l) => l.details.name))], [store.logs]);
  const latestKg = (latestOf(store.logs, ["weight"]) || {}).details;

  const valid = kind === "weight" ? Number(d.kg) > 0 : kind === "med" ? !!String(d.name || "").trim() : kind === "walk" ? Number(d.mins) > 0 : true;
  const atISO = () => {
    if (dateOnly) {
      if (editing && when === dayKey(initial)) return log.at;
      if (!editing && when === todayKey()) return new Date().toISOString();
      return new Date(`${when}T12:00:00`).toISOString();
    }
    const t = new Date(when);
    return isNaN(t) ? new Date().toISOString() : t.toISOString();
  };
  const clean = () => {
    const out = { ...d };
    if (kind === "weight") out.kg = Number(d.kg);
    if (kind === "walk") { out.mins = Number(d.mins); out.distance = String(d.distance || "").trim(); }
    if (kind === "med") { out.name = String(d.name).trim(); out.dose = String(d.dose || "").trim(); }
    return out;
  };
  const save = (e) => {
    e.preventDefault();
    if (!valid) return;
    if (editing) {
      store.updateLog(log.id, { at: atISO(), details: clean(), note: note.trim() });
      toast("Changes saved");
    } else {
      store.addLog(kind, clean(), { at: atISO(), note: note.trim() });
      toast(`${k.title} logged`);
    }
    onClose();
  };
  const remove = () => { store.deleteLog(log.id); toast("Entry deleted"); onClose(); };

  return (
    <Sheet title={editing ? k.title : `Log ${k.title.toLowerCase()}`} onClose={onClose}>
      <form className="sheet-body" onSubmit={save}>
        {kind === "fed" && (
          <>
            <Choices label="Portion" options={PORTIONS} value={d.portion} onChange={(v) => set({ portion: v })} />
            <Choices label="How much did he eat?" options={EATEN} value={d.eaten} onChange={(v) => set({ eaten: v })} />
          </>
        )}
        {kind === "walk" && (
          <>
            <Choices label="How long" options={WALK_MINS.map((m) => ({ key: m, label: `${m} min` }))} value={Number(d.mins)} onChange={(v) => set({ mins: v })} />
            <Field label="Or minutes" id="walk-mins"><input id="walk-mins" className="input input-short" type="number" inputMode="numeric" min="1" value={d.mins} onChange={(e) => set({ mins: e.target.value })} /></Field>
            <Field label="Distance (optional)" id="walk-dist"><input id="walk-dist" className="input" placeholder="For example, 3 km round the park" value={d.distance || ""} onChange={(e) => set({ distance: e.target.value })} /></Field>
          </>
        )}
        {kind === "weight" && (
          <Field label="Weight in kg" id="kg">
            <input id="kg" className="input input-short" type="number" inputMode="decimal" step="0.1" min="0" placeholder={latestKg ? fmtKg(latestKg.kg) : "12.5"} value={d.kg} onChange={(e) => set({ kg: e.target.value })} required />
          </Field>
        )}
        {kind === "med" && (
          <>
            <Field label="Medicine" id="med-name">
              <input id="med-name" className="input" list="med-names" value={d.name} onChange={(e) => set({ name: e.target.value })} required />
              <datalist id="med-names">{medNames.map((n) => <option key={n} value={n} />)}</datalist>
            </Field>
            <Field label="Dose (optional)" id="med-dose"><input id="med-dose" className="input" placeholder="For example, 1 tablet or 5 ml" value={d.dose || ""} onChange={(e) => set({ dose: e.target.value })} /></Field>
          </>
        )}
        {kind === "behaviour" && <Choices label="What did you notice?" options={BEHAVIOURS} value={d.type} onChange={(v) => set({ type: v })} />}
        {kind === "grooming" && <Choices label="What was done?" options={GROOMING_TYPES} value={d.type} onChange={(v) => set({ type: v })} />}

        <Field label={dateOnly ? "Date" : "When"} id="when">
          <input id="when" className="input" type={dateOnly ? "date" : "datetime-local"} value={when} max={dateOnly ? todayKey() : undefined} onChange={(e) => setWhen(e.target.value)} required />
        </Field>
        {kind !== "weight" && (
          <Field label="Note (optional)" id="note">
            <textarea id="note" className="input textarea" rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "behaviour" ? "What happened, and when it started" : ""} />
          </Field>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!valid}>{editing ? "Save changes" : `Log ${k.title.toLowerCase()}`}</button>
        {editing && <ConfirmButton label="Delete entry" confirmLabel="Tap again to delete" onConfirm={remove} />}
        {editing && whoOf(store, log) && <p className="fineprint">Logged by {whoOf(store, log)}</p>}
      </form>
    </Sheet>
  );
}

function WalkSheet({ store, onClose, onLogged, openDetails, onDone }) {
  const log = (kind, details) => {
    const row = store.addLog(kind, details);
    onLogged(row);
    if (onDone) onDone();
    onClose();
  };
  return (
    <Sheet title="How long was the walk?" onClose={onClose}>
      <div className="sheet-body">
        <div className="minutes">
          {WALK_MINS.map((m) => (
            <button key={m} type="button" className="minute" onClick={() => log("walk", { mins: m, distance: "" })}>
              <b>{m}</b><span>minutes</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-outline btn-block" onClick={() => log("daycare", {})}><Icon name="daycare" size={20} /> He's at daycare today</button>
        <button type="button" className="link-more" onClick={openDetails}>Add a distance, note or earlier time</button>
      </div>
    </Sheet>
  );
}

function AddSheet({ onClose, pick }) {
  return (
    <Sheet title="What do you want to log?" onClose={onClose}>
      <div className="sheet-body">
        <div className="add-grid">
          {ADD_ORDER.map((kind) => (
            <button key={kind} type="button" className="add-kind" onClick={() => pick(kind)}>
              <Icon name={KIND[kind].icon} size={26} />
              <span>{KIND[kind].title}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function PlanSheet({ store, plan, repeat, day, weekly, onClose, openRepeat }) {
  const src = repeat || plan;
  const linked = repeatOf(store, plan);
  const [place, setPlace] = useState((src && src.place) || "home");
  const [date, setDate] = useState((plan && plan.day) || (repeat && repeat.starts_on) || day || todayKey());
  const [allDay, setAllDay] = useState(src ? !!src.all_day : false);
  const [start, setStart] = useState((src && src.start_time && src.start_time.slice(0, 5)) || "09:00");
  const [end, setEnd] = useState((src && src.end_time && src.end_time.slice(0, 5)) || "17:00");
  const [note, setNote] = useState((src && src.note) || "");
  const [repeating, setRepeating] = useState(!!repeat || !!weekly);
  const [weekdays, setWeekdays] = useState(() => (repeat ? [...repeat.weekdays] : weekly ? [isoDay(parseDay(day || todayKey()))] : []));
  const [until, setUntil] = useState((repeat && repeat.ends_on) || "");
  const [busy, setBusy] = useState(false);

  const turnRepeat = (on) => {
    setRepeating(on);
    if (on && !weekdays.length) setWeekdays([isoDay(parseDay(date))]);
  };
  const toggleDay = (n) => setWeekdays((w) => (w.includes(n) ? w.filter((x) => x !== n) : [...w, n].sort((a, b) => a - b)));

  const save = async (e) => {
    e.preventDefault();
    if (!allDay && end <= start) { toast("The end time needs to be after the start.", "error"); return; }
    const times = { all_day: allDay, start_time: allDay ? null : start, end_time: allDay ? null : end, note: note.trim() };
    setBusy(true);
    let ok;
    if (repeating) {
      if (!weekdays.length) { setBusy(false); toast("Pick at least one day of the week.", "error"); return; }
      if (until && until < date) { setBusy(false); toast("The last day needs to be after the first.", "error"); return; }
      ok = await store.saveRepeat(repeat && repeat.id, { place, weekdays, starts_on: date, ends_on: until || null, ...times });
    } else {
      ok = await store.savePlan(plan && plan.id, { place, day: date, ...times });
    }
    setBusy(false);
    if (ok) onClose();
  };
  const remove = async () => {
    setBusy(true);
    const ok = repeat ? await store.deleteRepeat(repeat.id) : await store.deletePlan(plan.id);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet title={repeat ? "Weekly plan" : plan ? "Change plan" : "Where will Barney be?"} onClose={onClose}>
      <form className="sheet-body" onSubmit={save}>
        {linked && (
          <div className="repeat-note">
            <p>Part of {PLACE[linked.place] ? PLACE[linked.place].label : "a weekly plan"}, e{repeatDays(linked).slice(1)}. Changes here are just for this day.</p>
            <button type="button" className="btn btn-small btn-outline" onClick={() => openRepeat(linked)}>Change every week</button>
          </div>
        )}
        <div className="field">
          <span className="field-label" id="lbl-place">Place</span>
          <div className="places" role="radiogroup" aria-labelledby="lbl-place">
            {PLACES.map((p) => (
              <button key={p.key} type="button" role="radio" aria-checked={place === p.key} className={`place ${place === p.key ? "is-on" : ""}`} onClick={() => setPlace(p.key)} style={{ "--place": p.color }}>
                <Icon name={p.icon} size={24} /><span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>
        {!plan && !repeat && (
          <label className="toggle">
            <input type="checkbox" checked={repeating} onChange={(e) => turnRepeat(e.target.checked)} />
            <span className="toggle-ui" aria-hidden="true" />
            <span>Every week</span>
          </label>
        )}
        {repeating && (
          <div className="field">
            <span className="field-label" id="lbl-weekdays">On</span>
            <div className="choices weekdays" role="group" aria-labelledby="lbl-weekdays">
              {WEEKDAYS.map((w) => (
                <button key={w.key} type="button" aria-pressed={weekdays.includes(w.key)} className={`choice ${weekdays.includes(w.key) ? "is-on" : ""}`} onClick={() => toggleDay(w.key)}>{w.label}</button>
              ))}
            </div>
          </div>
        )}
        {repeating ? (
          <div className="two">
            <Field label="Starting" id="plan-day"><input id="plan-day" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
            <Field label="Until (optional)" id="plan-until"><input id="plan-until" className="input" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} /></Field>
          </div>
        ) : (
          <Field label="Day" id="plan-day"><input id="plan-day" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        )}
        <label className="toggle">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span className="toggle-ui" aria-hidden="true" />
          <span>All day</span>
        </label>
        {!allDay && (
          <div className="two">
            <Field label="From" id="plan-from"><input id="plan-from" className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
            <Field label="Until" id="plan-to"><input id="plan-to" className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
          </div>
        )}
        <Field label="Note (optional)" id="plan-note"><input id="plan-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example, Jakey dropping him off" /></Field>
        {repeating && <p className="field-hint">Each day is added to the plans and the calendar, 8 weeks ahead. Delete a single day (a bank holiday, say) and it stays off.</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{plan || repeat ? "Save changes" : repeating ? "Save weekly plan" : "Save plan"}</button>
        {plan && <ConfirmButton label={linked ? "Delete this day only" : "Delete plan"} confirmLabel="Tap again to delete" onConfirm={remove} />}
        {repeat && <ConfirmButton label="Stop this weekly plan" confirmLabel="Tap again: removes the days ahead" onConfirm={remove} />}
      </form>
    </Sheet>
  );
}

function ApptSheet({ store, appt, onClose }) {
  const [kind, setKind] = useState((appt && appt.kind) || "vet");
  const [date, setDate] = useState((appt && appt.day) || todayKey());
  const [time, setTime] = useState((appt && appt.at_time && appt.at_time.slice(0, 5)) || "");
  const [title, setTitle] = useState((appt && appt.title) || "");
  const [notes, setNotes] = useState((appt && appt.notes) || "");
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await store.saveAppt(appt && appt.id, { kind, day: date, at_time: time || null, title: title.trim(), notes: notes.trim() });
    setBusy(false);
    if (ok) onClose();
  };
  const remove = async () => { setBusy(true); const ok = await store.deleteAppt(appt.id); setBusy(false); if (ok) onClose(); };
  return (
    <Sheet title={appt ? "Appointment" : "Add an appointment"} onClose={onClose}>
      <form className="sheet-body" onSubmit={save}>
        <Choices label="With" options={[{ key: "vet", label: "Vet" }, { key: "grooming", label: "Groomer" }]} value={kind} onChange={setKind} />
        <div className="two">
          <Field label="Date" id="appt-day"><input id="appt-day" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Time (optional)" id="appt-time"><input id="appt-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <Field label="What for" id="appt-title"><input id="appt-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "vet" ? "For example, booster jab" : "For example, full groom"} /></Field>
        <Field label="Notes (optional)" id="appt-notes"><textarea id="appt-notes" className="input textarea" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === "vet" ? "What the vet said, anything to remember" : ""} /></Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{appt ? "Save changes" : "Save appointment"}</button>
        {appt && <ConfirmButton label="Delete appointment" confirmLabel="Tap again to delete" onConfirm={remove} />}
      </form>
    </Sheet>
  );
}

function InfoSheet({ store, onClose }) {
  const [info, setInfo] = useState(() => ({ ...(store.settings.info || {}) }));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const trimmed = Object.fromEntries(Object.entries(info).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    const ok = await store.setSetting("info", trimmed);
    setBusy(false);
    if (ok) { toast("Details saved"); onClose(); }
  };
  return (
    <Sheet title="His details" onClose={onClose}>
      <form className="sheet-body" onSubmit={save}>
        {INFO_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} id={`info-${f.key}`}>
            <input id={`info-${f.key}`} className="input" type={f.tel ? "tel" : "text"} value={info[f.key] || ""} onChange={(e) => setInfo({ ...info, [f.key]: e.target.value })} />
          </Field>
        ))}
        <Field label="Notes" id="info-notes"><textarea id="info-notes" className="input textarea" rows="3" value={info.notes || ""} onChange={(e) => setInfo({ ...info, notes: e.target.value })} placeholder="Allergies, food he can't have, how he likes to be handled" /></Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>Save details</button>
      </form>
    </Sheet>
  );
}

function TreatmentSheet({ store, kind, onClose }) {
  const t = TREATMENTS.find((x) => x.kind === kind);
  const p = treatmentPlan(store, t);
  const all = store.settings.treatments || {};
  const cfg = all[kind] || {};
  const [every, setEvery] = useState(String(p.every));
  const [unit, setUnit] = useState(p.unit);
  const [due, setDue] = useState(null); // null until someone changes the date
  const [busy, setBusy] = useState(false);
  const n = Math.round(Number(every));
  // The date from the last dose and how often, as the form stands
  const scheduled = p.last && n >= 1 ? dayKey(addInterval(parseDay(dayKey(new Date(p.last.at))), n, unit)) : "";
  const shown = due != null ? due : p.custom ? cfg.due : scheduled;

  const save = async (e) => {
    e.preventDefault();
    if (!(n >= 1)) { toast("How often needs to be at least 1", "error"); return; }
    const next = { every: n, unit };
    if (due != null) {
      if (due && due !== scheduled) { next.due = due; next.due_set_at = new Date().toISOString(); }
    } else if (p.custom) {
      next.due = cfg.due;
      next.due_set_at = cfg.due_set_at;
    }
    setBusy(true);
    const ok = await store.setSetting("treatments", { ...all, [kind]: next });
    setBusy(false);
    if (ok) { toast(`${t.label} saved`); onClose(); }
  };
  const useSchedule = async () => {
    setBusy(true);
    const ok = await store.setSetting("treatments", { ...all, [kind]: { every: p.every, unit: p.unit } });
    setBusy(false);
    if (ok) { toast(p.scheduled ? `Back to due ${shortDate(p.scheduled)}` : "Due date cleared"); onClose(); }
  };

  return (
    <Sheet title={t.label} onClose={onClose}>
      <form className="sheet-body" onSubmit={save}>
        <Field label="Next due" id="treat-due"
          hint={p.last ? "Change this if he's due on a different day. Once the next dose is logged, it goes back to the usual schedule." : "Not logged yet. Set when he's due, or log when it was last done."}>
          <input id="treat-due" className="input" type="date" value={shown || ""} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Given every" id="treat-every">
          <input id="treat-every" className="input input-short" type="number" inputMode="numeric" min="1" value={every} onChange={(e) => setEvery(e.target.value)} />
        </Field>
        <Choices label="Days, weeks or months" options={UNITS} value={unit} onChange={setUnit} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>Save</button>
        {p.custom && (
          <button type="button" className="btn btn-outline btn-block" onClick={useSchedule} disabled={busy}>
            {p.scheduled ? `Use the usual schedule (${shortDate(p.scheduled)})` : "Clear the due date"}
          </button>
        )}
      </form>
    </Sheet>
  );
}

// How full the bag looks, for correcting the estimate without scales
const BAG_FILL = [
  { share: 1, label: "Full" },
  { share: 0.75, label: "Three-quarters" },
  { share: 0.5, label: "Half" },
  { share: 0.25, label: "A quarter" },
  { share: 0.1, label: "Nearly empty" },
];
function FoodSheet({ store, buy, settings, onClose }) {
  const food = foodStatus(store);
  const [mode, setMode] = useState(buy ? "buy" : settings ? "settings" : "check");
  const [kg, setKg] = useState("");
  const [fill, setFill] = useState(null);
  const [spare, setSpare] = useState(0);
  const [mealG, setMealG] = useState(String(food.mealG));
  const [bagKg, setBagKg] = useState(String(food.bagG / 1000));
  const [alertDays, setAlertDays] = useState(String(food.alertDays));

  const add = (g) => {
    store.food({ p_add: g });
    toast(`${weight(g)} added`);
    onClose();
  };
  const check = () => {
    store.food({ p_set: Math.round((fill + spare) * food.bagG) });
    toast("Food updated");
    onClose();
  };
  const saveSettings = (e) => {
    e.preventDefault();
    const m = Math.round(Number(mealG)), b = Math.round(Number(bagKg) * 1000), d = Math.round(Number(alertDays));
    if (!(m > 0) || !(b > 0) || !(d >= 0)) { toast("Check the numbers", "error"); return; }
    store.food({ p_meal_g: m, p_bag_g: b, p_alert_days: d });
    toast("Food settings saved");
    onClose();
  };

  return (
    <Sheet title={mode === "buy" ? "Bought food" : mode === "settings" ? "Food settings" : "How full is his bag?"} onClose={onClose}>
      {mode === "buy" && (
        <form className="sheet-body" onSubmit={(e) => { e.preventDefault(); const g = Math.round(Number(kg) * 1000); if (g > 0) add(g); }}>
          <p className="block-note">{food.known && food.left > 0 ? `Added to the ${weight(food.left)} he's got.` : "How much did you buy?"}</p>
          <div className="minutes">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className="minute" onClick={() => add(n * food.bagG)}>
                <b>{n}</b><span>{n === 1 ? "bag" : "bags"}, {weight(n * food.bagG)}</span>
              </button>
            ))}
          </div>
          <Field label="Or how many kg" id="bought-kg">
            <input id="bought-kg" className="input input-short" type="number" inputMode="decimal" step="0.1" min="0" value={kg} onChange={(e) => setKg(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={!(Number(kg) > 0)}>Add</button>
          <button type="button" className="link-more" onClick={() => setMode("check")}>Say how full the bag is instead</button>
        </form>
      )}
      {mode === "check" && (
        <div className="sheet-body">
          <p className="block-note">
            {food.known
              ? `Going by the meals logged, there's about ${weight(food.left)} left (${food.mealG}g a meal). If that looks wrong, pick how full the open bag is.`
              : "Pick how full the open bag is, and the app works out the rest from the meals logged."}
          </p>
          <Choices label="The open bag" options={BAG_FILL.map((b) => ({ key: b.share, label: b.label }))} value={fill} onChange={setFill} />
          <Choices label="Unopened bags as well" options={[0, 1, 2, 3].map((n) => ({ key: n, label: n === 0 ? "None" : String(n) }))} value={spare} onChange={setSpare} />
          <button type="button" className="btn btn-primary btn-block" disabled={fill == null} onClick={check}>
            {fill == null ? "Save" : `Save: about ${weight((fill + spare) * food.bagG)}`}
          </button>
          <div className="sheet-links">
            <button type="button" className="link-more" onClick={() => setMode("buy")}>Bought food</button>
            <button type="button" className="link-more" onClick={() => setMode("settings")}>Meal size, bag size and reminder</button>
          </div>
        </div>
      )}
      {mode === "settings" && (
        <form className="sheet-body" onSubmit={saveSettings}>
          <Field label="Kibble per meal (g)" id="meal-g">
            <input id="meal-g" className="input input-short" type="number" inputMode="numeric" min="1" value={mealG} onChange={(e) => setMealG(e.target.value)} />
          </Field>
          <Field label="Bag size (kg)" id="bag-kg">
            <input id="bag-kg" className="input input-short" type="number" inputMode="decimal" step="0.1" min="0.1" value={bagKg} onChange={(e) => setBagKg(e.target.value)} />
          </Field>
          <Field label="Remind me to buy more with this many days left" id="alert-days">
            <input id="alert-days" className="input input-short" type="number" inputMode="numeric" min="0" value={alertDays} onChange={(e) => setAlertDays(e.target.value)} />
          </Field>
          <p className="field-hint">Half portions count as half a meal, and treats as none.</p>
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Shell: sign in, tabs, update and sync bars, undo
// ---------------------------------------------------------------------------
function useUpdateReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return undefined;
    let hadController = !!sw.controller;
    const onChange = async () => {
      if (!hadController) { hadController = true; return; }
      try {
        const text = await (await fetch("app.jsx", { cache: "no-cache" })).text();
        const latest = (text.match(/const APP_VERSION = "([^"]+)"/) || [])[1];
        if (latest && latest !== APP_VERSION) setReady(true);
      } catch (e) { /* offline: try again next time */ }
    };
    const check = () => { if (document.visibilityState === "visible") sw.getRegistration().then((r) => r && r.update()).catch(() => {}); };
    sw.addEventListener("controllerchange", onChange);
    document.addEventListener("visibilitychange", check);
    return () => { sw.removeEventListener("controllerchange", onChange); document.removeEventListener("visibilitychange", check); };
  }, []);
  return ready;
}
function TopBars({ store }) {
  const update = useUpdateReady();
  if (update) return <button type="button" className="topbar topbar-update" onClick={() => window.location.reload()}>A new version is ready. Tap to reload.</button>;
  if (store.pending && store.offline) return <div className="topbar" role="status">No signal. {plural(store.pending, "change")} saved on this phone, sending when you're back online.</div>;
  if (store.offline) return <div className="topbar" role="status">Offline. Showing the last saved copy.</div>;
  return null;
}

function UndoBar({ undo, onUndo, onChange }) {
  if (!undo) return null;
  return (
    <div className="undo" role="status">
      <span>{undo.text}</span>
      <button type="button" onClick={onChange}>Change</button>
      <button type="button" onClick={onUndo}>Undo</button>
    </div>
  );
}

const TABS = [
  { key: "today", label: "Today", icon: "paw" },
  { key: "diary", label: "Diary", icon: "book" },
  { key: "health", label: "Health", icon: "heart" },
  { key: "barney", label: "Barney", icon: "dog" },
];
function TabBar({ tab }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((t) => (
        <a key={t.key} href={`#/${t.key}`} className={`tab ${tab === t.key ? "is-on" : ""}`} aria-current={tab === t.key ? "page" : undefined}>
          <span className="tab-icon"><Icon name={t.icon} size={24} /></span>
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

function useRoute() {
  const read = () => {
    const [tab, sub] = window.location.hash.replace(/^#\/?/, "").split("/");
    return { tab: TABS.some((t) => t.key === tab) ? tab : "today", sub: sub || null };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError(err.message === "Invalid login credentials" ? "That email and password don't match." : err.message);
    setBusy(false);
  };
  return (
    <main className="signin">
      <header className="collar collar-tall">
        <div className="tag">
          <span className="tag-ring" aria-hidden="true" />
          <img className="tag-photo" src="barney.jpg" alt="Barney" width="120" height="120" />
        </div>
      </header>
      <form className="signin-form" onSubmit={submit}>
        <h1>Barney's Tracker</h1>
        <p className="block-note">Sign in with the same login as the gym tracker.</p>
        <Field label="Email" id="email"><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" id="password"><input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}

function Main({ session }) {
  const store = useBarney(session.user.id);
  const route = useRoute();
  const [sheet, setSheet] = useState(null);
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);
  const memberKey = "bt-member-" + session.user.id;
  const [member, setMember] = useState(() => (localStorage.getItem(memberKey) === "yes" ? true : null));

  useEffect(() => {
    sb.rpc("bt_is_member").then(({ data, error }) => {
      if (error) return; // offline: trust the last answer
      setMember(data === true);
      localStorage.setItem(memberKey, data === true ? "yes" : "no");
    });
  }, [memberKey]);

  const close = useCallback(() => setSheet(null), []);
  const onLogged = useCallback((row) => {
    clearTimeout(undoTimer.current);
    setUndo({ row, text: `${KIND[row.kind].title} logged` });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, []);
  const photo = store.settings.photo || "barney.jpg";

  if (member === false) {
    return (
      <main className="center-msg">
        <Icon name="alert" size={40} stroke={1.6} />
        <p>This account isn't set up for Barney yet. Add it to <code>bt_members</code> in Supabase.</p>
        <button type="button" className="btn btn-outline" onClick={() => sb.auth.signOut()}>Sign out</button>
      </main>
    );
  }
  if (!store.loaded) {
    if (store.loadError) return <main className="center-msg"><Icon name="alert" size={40} stroke={1.6} /><p>Barney's data couldn't load: {store.loadError}</p><p className="fineprint">If this is a new setup, run supabase/schema.sql in the Supabase SQL Editor.</p><button type="button" className="btn btn-outline" onClick={store.refresh}>Try again</button></main>;
    if (store.offline) return <main className="center-msg"><Icon name="paw" size={40} stroke={1.6} /><p>No signal. Barney's Tracker needs signal the first time it opens on a phone.</p><button type="button" className="btn btn-outline" onClick={store.refresh}>Try again</button></main>;
    return <div className="boot">Fetching Barney…</div>;
  }

  let screen;
  if (route.tab === "diary") screen = <DiaryScreen store={store} open={setSheet} />;
  else if (route.tab === "health") screen = <HealthScreen store={store} open={setSheet} onLogged={onLogged} />;
  else if (route.tab === "barney") screen = <BarneyScreen store={store} open={setSheet} photo={photo} sub={route.sub} session={session} />;
  else screen = <TodayScreen store={store} open={setSheet} onLogged={onLogged} photo={photo} />;

  let sheetEl = null;
  if (sheet) {
    switch (sheet.type) {
      case "log": {
        const live = sheet.log ? store.logs.find((l) => l.id === sheet.log.id) : null;
        sheetEl = sheet.log && !live ? null : <LogSheet key={(sheet.log && sheet.log.id) || sheet.kind} store={store} kind={sheet.kind} log={live} onClose={close} />;
        break;
      }
      case "walk":
        sheetEl = <WalkSheet store={store} onClose={close} onLogged={onLogged} onDone={sheet.onDone} openDetails={() => setSheet({ type: "log", kind: "walk" })} />;
        break;
      case "add":
        sheetEl = <AddSheet onClose={close} pick={(kind) => setSheet({ type: "log", kind })} />;
        break;
      case "plan":
        sheetEl = <PlanSheet key={sheet.repeat ? `r-${sheet.repeat.id}` : (sheet.plan && sheet.plan.id) || "new"} store={store} plan={sheet.plan} repeat={sheet.repeat} day={sheet.day} weekly={sheet.weekly}
          onClose={close} openRepeat={(r) => setSheet({ type: "plan", repeat: r })} />;
        break;
      case "appt":
        sheetEl = <ApptSheet store={store} appt={sheet.appt} onClose={close} />;
        break;
      case "info":
        sheetEl = <InfoSheet store={store} onClose={close} />;
        break;
      case "food":
        sheetEl = <FoodSheet store={store} buy={sheet.buy} settings={sheet.settings} onClose={close} />;
        break;
      case "treatment":
        sheetEl = <TreatmentSheet store={store} kind={sheet.kind} onClose={close} />;
        break;
      default:
        sheetEl = null;
    }
  }

  return (
    <div className="app">
      <TopBars store={store} />
      {screen}
      <UndoBar
        undo={undo}
        onUndo={() => { store.deleteLog(undo.row.id); setUndo(null); toast("Removed"); }}
        onChange={() => { setSheet({ type: "log", kind: undo.row.kind, log: undo.row }); setUndo(null); }}
      />
      <TabBar tab={route.tab} />
      {sheetEl}
      <Toasts />
    </div>
  );
}

function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="boot">Fetching Barney…</div>;
  if (!session) return <><SignIn /><Toasts /></>;
  return <Main key={session.user.id} session={session} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
