import { useState, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const WORKER_URL = "https://barney-tracker-api.barneythebigdog.workers.dev";

const api = {
  get:  (path)       => fetch(`${WORKER_URL}${path}`).then(r => r.json()),
  post: (path, body) => fetch(`${WORKER_URL}${path}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }).then(r => r.json()),
  put:  (path, body) => fetch(`${WORKER_URL}${path}`, { method:"PUT",  headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }).then(r => r.json()),
  del:  (path)       => fetch(`${WORKER_URL}${path}`, { method:"DELETE" }).then(r => r.json()),
};

const gcal = {
  events: (timeMin, timeMax) => api.get(`/api/gcal/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`),
  create: (body)             => api.post("/api/gcal/events", body),
  delete: (id)               => api.del(`/api/gcal/events/${id}`),
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

const LOCATIONS = [
  { id:"home",    label:"Home",          icon:"🏠", color:"#10b981" },
  { id:"mum",     label:"Mum's house",   icon:"👵", color:"#f59e0b" },
  { id:"jakey",   label:"Jakey's flat",  icon:"👨", color:"#3b82f6" },
  { id:"daycare", label:"Doggy daycare", icon:"🐾", color:"#8b5cf6" },
  { id:"walk",    label:"On a walk",     icon:"🦮", color:"#06b6d4" },
];
const LOC_MAP = Object.fromEntries(LOCATIONS.map(l => [l.id, l]));
const BEHAVIOUR_TYPES = ["Limping","Not eating","Scratching","Vomiting","Lethargy","Unusual behaviour","Other"];
const GROOMING_TYPES  = ["Bath","Brush","Nail clip","Ear clean","Other"];
const MOODS = [
  { v:"happy",   l:"Happy",   e:"😄" },
  { v:"calm",    l:"Calm",    e:"😌" },
  { v:"anxious", l:"Anxious", e:"😟" },
  { v:"tired",   l:"Tired",   e:"😴" },
  { v:"hyper",   l:"Hyper",   e:"🤪" },
];
const VAPID_PUBLIC_KEY = "BDL-4Qg2xdz5eWGweQaOm9mtrLP6-uxnr5S-eJ7e0TW9au_jHzQwOfnloaPRabQhr7GLQaWBkIYJvRvVEgVgeMY";

const NAV = [
  { id:"home",          label:"Home",          icon:"🏠" },
  { id:"calendar",      label:"Calendar",      icon:"📅" },
  { id:"feed",          label:"Feeding",       icon:"🍽️" },
  { id:"toilet",        label:"Toilet",        icon:"🌿" },
  { id:"walks",         label:"Walks",         icon:"🦮" },
  { id:"health",        label:"Health",        icon:"💊" },
  { id:"vet",           label:"Vet",           icon:"🏥" },
  { id:"grooming",      label:"Grooming",      icon:"✂️" },
  { id:"info",          label:"Info",          icon:"📋" },
  { id:"notifications", label:"Alerts",        icon:"🔔" },
];

function todayStr() { return new Date().toISOString().slice(0,10); }
function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso), today = new Date();
  const time = d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const days = Math.floor((today - d) / 86400000);
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day:"numeric", month:"short" }) + " " + time;
}
function formatDate(s) { if (!s) return "—"; return new Date(s+"T12:00:00").toLocaleDateString([],{ day:"numeric", month:"short", year:"numeric" }); }
function daysSince(iso) { if (!iso) return null; return Math.floor((Date.now() - new Date(iso)) / 86400000); }
function hoursSince(iso) { if (!iso) return null; return Math.floor((Date.now() - new Date(iso)) / 3600000); }
function getWeekDates(anchor) {
  const d = new Date(anchor), day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - ((day+6)%7));
  return Array.from({length:7}, (_,i) => { const x = new Date(mon); x.setDate(mon.getDate()+i); return x; });
}
const DAY_LABELS = ["M","T","W","T","F","S","S"];

function buildGCalEvent(locationId, date, startTime, endTime, allDay, note) {
  const loc = LOC_MAP[locationId];
  const title = `🐾 Barney — ${loc.label}`;
  if (allDay) return { summary:title, description:note||"", start:{ date }, end:{ date } };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { summary:title, description:note||"", start:{ dateTime:`${date}T${startTime}:00`, timeZone:tz }, end:{ dateTime:`${date}T${endTime}:00`, timeZone:tz } };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

// ── SHARED COMPONENTS ────────────────────────────────────────────────────────

function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background:"#fff", borderRadius:16, padding:16, marginBottom:12, boxShadow:"0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)", cursor:onClick?"pointer":undefined, ...style }}>{children}</div>;
}

function Btn({ children, onClick, variant="primary", style, disabled }) {
  const variants = {
    primary:   { background:"#1a1a2e", color:"#fff" },
    secondary: { background:"#f1f5f9", color:"#334155" },
    danger:    { background:"#fef2f2", color:"#ef4444" },
    google:    { background:"#4285F4", color:"#fff" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      border:"none", borderRadius:12, cursor:"pointer", fontSize:14, fontWeight:600,
      padding:"12px 16px", width:"100%", fontFamily:"inherit",
      opacity:disabled?0.5:1, transition:"opacity 0.15s",
      ...variants[variant], ...style,
    }}>{children}</button>
  );
}

function Chip({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      padding:"6px 14px", borderRadius:20, border:"none", cursor:"pointer",
      fontSize:12, fontWeight:600, transition:"all 0.15s",
      background:active?(color||"#1a1a2e"):"#f1f5f9",
      color:active?"#fff":"#64748b",
    }}>{label}</button>
  );
}

function Input({ placeholder, value, onChange, type="text", style }) {
  return (
    <input type={type} placeholder={placeholder} value={value} onChange={onChange}
      onFocus={e=>e.target.style.borderColor="#1a1a2e"}
      onBlur={e=>e.target.style.borderColor="#e2e8f0"}
      style={{ width:"100%", padding:"10px 14px", borderRadius:10, border:"1.5px solid #e2e8f0", fontSize:13, color:"#1e293b", background:"#f8fafc", marginBottom:10, boxSizing:"border-box", outline:"none", fontFamily:"inherit", transition:"border-color 0.15s", ...style }}
    />
  );
}

function LogItem({ icon, primary, secondary, time, by, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid #f1f5f9" }}>
      <div style={{ fontSize:22, width:36, textAlign:"center", flexShrink:0 }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>{primary}</div>
        {secondary && <div style={{ fontSize:11, color:"#94a3b8", marginTop:1 }}>{secondary}</div>}
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontSize:11, color:"#64748b", fontWeight:500 }}>{time}</div>
        <div style={{ fontSize:10, color:"#94a3b8" }}>{by}</div>
      </div>
      {onDelete && (
        confirming
          ? <div style={{ display:"flex", gap:4, flexShrink:0 }}>
              <button onClick={()=>{ onDelete(); setConfirming(false); }} style={{ background:"#ef4444", border:"none", borderRadius:6, padding:"3px 8px", cursor:"pointer", color:"#fff", fontSize:11, fontWeight:700 }}>Delete</button>
              <button onClick={()=>setConfirming(false)} style={{ background:"#f1f5f9", border:"none", borderRadius:6, padding:"3px 8px", cursor:"pointer", color:"#64748b", fontSize:11 }}>Cancel</button>
            </div>
          : <button onClick={()=>setConfirming(true)} style={{ background:"none", border:"none", cursor:"pointer", color:"#cbd5e1", fontSize:18, padding:"0 0 0 4px", flexShrink:0 }}>×</button>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub, subColor, onClick, urgent }) {
  return (
    <div onClick={onClick} style={{
      background: urgent ? "#fef2f2" : "#fff",
      borderRadius:16, padding:"14px 16px",
      boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
      cursor:onClick?"pointer":undefined,
      border: urgent ? "1.5px solid #fecaca" : "none",
      transition:"transform 0.1s",
    }}
    onTouchStart={e=>{ if(onClick) e.currentTarget.style.transform="scale(0.97)"; }}
    onTouchEnd={e=>{ e.currentTarget.style.transform="scale(1)"; }}>
      <div style={{ fontSize:22, marginBottom:6 }}>{icon}</div>
      <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8 }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:700, color: urgent ? "#ef4444" : "#1e293b", marginTop:3 }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:subColor||"#94a3b8", marginTop:2, fontWeight:500 }}>{sub}</div>}
      {onClick && <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>tap to view →</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize:11, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:1, margin:"18px 0 8px" }}>{children}</div>;
}

function Badge({ children, color }) {
  return <span style={{ background:color+"18", color, fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20 }}>{children}</span>;
}

// Save feedback toast
function SaveToast({ state }) {
  if (state === "idle") return null;
  return (
    <div style={{
      position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
      background: state === "saved" ? "#1a1a2e" : "#ef4444",
      color:"#fff", padding:"8px 20px", borderRadius:20, fontSize:13, fontWeight:600,
      zIndex:400, boxShadow:"0 4px 12px rgba(0,0,0,0.2)",
      animation:"fadeInUp 0.2s ease",
    }}>
      {state === "saving" ? "Saving…" : state === "saved" ? "✓ Saved" : "Error saving"}
    </div>
  );
}

// Delete confirmation modal
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:24, width:"100%", maxWidth:320, textAlign:"center" }}>
        <div style={{ fontSize:32, marginBottom:12 }}>🗑️</div>
        <div style={{ fontSize:14, fontWeight:600, color:"#1e293b", marginBottom:20 }}>{message}</div>
        <div style={{ display:"flex", gap:8 }}>
          <Btn variant="secondary" onClick={onCancel} style={{ flex:1 }}>Cancel</Btn>
          <Btn variant="danger" onClick={onConfirm} style={{ flex:1, background:"#ef4444", color:"#fff" }}>Delete</Btn>
        </div>
      </div>
    </div>
  );
}

// ── SIDEBAR ──────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose, tab, setTab, alerts }) {
  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:200, opacity:open?1:0, pointerEvents:open?"all":"none", transition:"opacity 0.25s" }} />
      <div style={{ position:"fixed", top:0, left:0, bottom:0, width:260, background:"#1a1a2e", zIndex:201, display:"flex", flexDirection:"column", transform:open?"translateX(0)":"translateX(-100%)", transition:"transform 0.28s cubic-bezier(0.4,0,0.2,1)", boxShadow:"4px 0 24px rgba(0,0,0,0.3)" }}>
        <div style={{ padding:"24px 20px 16px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:12, width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>🐕</div>
            <div><div style={{ fontSize:20, fontWeight:700, color:"#fff" }}>Barney</div><div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Tracker</div></div>
          </div>
        </div>
        {alerts.length > 0 && (
          <div style={{ margin:"12px 12px 0", background:"rgba(239,68,68,0.15)", borderRadius:10, padding:"10px 12px" }}>
            {alerts.map((a,i) => <div key={i} style={{ fontSize:11, color:"#fca5a5", fontWeight:600, marginBottom:i<alerts.length-1?4:0 }}>{a}</div>)}
          </div>
        )}
        <div style={{ flex:1, overflowY:"auto", padding:"8px 0" }}>
          {NAV.map(item => {
            const active = tab === item.id;
            return (
              <button key={item.id} onClick={()=>{ setTab(item.id); onClose(); }} style={{ width:"100%", display:"flex", alignItems:"center", gap:14, padding:"12px 20px", border:"none", cursor:"pointer", background:active?"rgba(255,255,255,0.1)":"transparent", borderLeft:active?"3px solid #fff":"3px solid transparent", transition:"all 0.15s" }}>
                <span style={{ fontSize:18, width:24, textAlign:"center" }}>{item.icon}</span>
                <span style={{ fontSize:14, fontWeight:active?700:500, color:active?"#fff":"rgba(255,255,255,0.55)" }}>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div style={{ padding:"16px 20px", borderTop:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", textAlign:"center" }}>Barney's Tracker 🐾</div>
        </div>
      </div>
    </>
  );
}

// ── MAIN APP ─────────────────────────────────────────────────────────────────

export default function BarneyApp() {
  const [tab, setTab]               = useState("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saveState, setSaveState]   = useState("idle"); // idle | saving | saved | error
  const [confirm, setConfirm]       = useState(null); // { message, onConfirm }
  const saveTimer = useRef(null);

  // Google Calendar
  const [calConnected, setCalConnected] = useState(false);
  const [gCalEvents, setGCalEvents]     = useState([]);
  const [calLoading, setCalLoading]     = useState(false);

  // Push notifications
  const [pushStatus, setPushStatus]       = useState("idle"); // idle | requesting | granted | denied
  const [pushSubs, setPushSubs]           = useState([]);
  const [deviceName, setDeviceName]       = useState("My iPhone");
  const [swReg, setSwReg]                 = useState(null);

  // Data
  const [feeding, setFeeding]       = useState([]);
  const [toilet, setToilet]         = useState([]);
  const [food, setFood]             = useState({ pouches:0, alert_at:5 });
  const [treatments, setTreatments] = useState({ flea:null, worm:null });
  const [weight, setWeight]         = useState([]);
  const [walks, setWalks]           = useState([]);
  const [meds, setMeds]             = useState([]);
  const [behaviour, setBehaviour]   = useState([]);
  const [vetAppts, setVetAppts]     = useState([]);
  const [info, setInfo]             = useState({});
  const [grooming, setGrooming]     = useState([]);
  const [mood, setMood]             = useState([]);

  // Calendar UI
  const [weekAnchor, setWeekAnchor]     = useState(new Date());
  const [selectedDay, setSelectedDay]   = useState(todayStr());
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newLoc, setNewLoc]             = useState("home");
  const [newStart, setNewStart]         = useState("09:00");
  const [newEnd, setNewEnd]             = useState("17:00");
  const [newEventNote, setNewEventNote] = useState("");
  const [allDay, setAllDay]             = useState(false);

  // Forms
  const [feedNote, setFeedNote]     = useState(""); const [feedAmount, setFeedAmount] = useState("Full portion"); const [feedEaten, setFeedEaten] = useState(100);
  const [walkDur, setWalkDur]       = useState("30"); const [walkDist, setWalkDist] = useState(""); const [walkNote, setWalkNote] = useState("");
  const [newWeight, setNewWeight]   = useState("");
  const [medName, setMedName]       = useState(""); const [medDose, setMedDose] = useState(""); const [medNote, setMedNote] = useState("");
  const [behavType, setBehavType]   = useState(BEHAVIOUR_TYPES[0]); const [behavNote, setBehavNote] = useState("");
  const [vetDate, setVetDate]       = useState(""); const [vetReason, setVetReason] = useState(""); const [vetNotes, setVetNotes] = useState(""); const [vetUpcoming, setVetUpcoming] = useState(true);
  const [editingInfo, setEditingInfo] = useState(false); const [infoEdit, setInfoEdit] = useState({});
  const [groomType, setGroomType]   = useState(GROOMING_TYPES[0]); const [groomNote, setGroomNote] = useState(""); const [groomNextAppt, setGroomNextAppt] = useState("");
  const [selMood, setSelMood]       = useState("happy"); const [moodNote, setMoodNote] = useState("");
  const [treatmentDates, setTreatmentDates] = useState({ fleaDate:"", wormDate:"" });

  // Save feedback helper
  const showSaved = () => {
    setSaveState("saved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveState("idle"), 1800);
  };

  const s = async (fn) => {
    setSaveState("saving");
    try { await fn(); showSaved(); }
    catch(e) { console.error(e); setSaveState("error"); setTimeout(()=>setSaveState("idle"), 2000); }
  };

  // Delete with confirmation
  const confirmDelete = (message, onConfirm) => setConfirm({ message, onConfirm });

  // Load all data
  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [f,t,fo,tr,w,wk,m,b,v,inf,gr,mo] = await Promise.all([
        api.get("/api/feeding"), api.get("/api/toilet"), api.get("/api/food"),
        api.get("/api/treatments"), api.get("/api/weight"), api.get("/api/walks"),
        api.get("/api/medications"), api.get("/api/behaviour"), api.get("/api/vet"),
        api.get("/api/info"), api.get("/api/grooming"), api.get("/api/mood"),
      ]);
      setFeeding(Array.isArray(f)?f:[]); setToilet(Array.isArray(t)?t:[]);
      setFood(fo||{pouches:0,alert_at:5}); setTreatments(tr||{flea:null,worm:null});
      setWeight(Array.isArray(w)?w:[]); setWalks(Array.isArray(wk)?wk:[]);
      setMeds(Array.isArray(m)?m:[]); setBehaviour(Array.isArray(b)?b:[]);
      setVetAppts(Array.isArray(v)?v:[]); setInfo(inf||{});
      setGrooming(Array.isArray(gr)?gr:[]); setMood(Array.isArray(mo)?mo:[]);
    } catch(e) { console.error(e); }
    if (!silent) setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    loadAll();
    // Check Google Calendar connection
    api.get("/api/auth/status").then(r => setCalConnected(!!r.connected)).catch(()=>{});
    // Handle OAuth redirect back
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") { setCalConnected(true); window.history.replaceState({}, "", window.location.pathname); }
    // Register service worker and wait until ready
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(reg => {
          setSwReg(reg);
          return reg.pushManager.getSubscription();
        })
        .then(sub => { if (sub) setPushStatus("granted"); })
        .catch(e => console.error("SW failed:", e));
    }
    // Load push subscriptions list
    api.get("/api/push/subscriptions").then(r => setPushSubs(Array.isArray(r)?r:[])).catch(()=>{});
    // Check notification permission
    if ("Notification" in window) {
      if (Notification.permission === "granted") setPushStatus("granted");
      if (Notification.permission === "denied")  setPushStatus("denied");
    }
  }, [loadAll]);

  // Real-time polling every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => loadAll(true), 30000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // Load Google Calendar
  const loadGCal = useCallback(async (anchor) => {
    if (!calConnected) return;
    setCalLoading(true);
    try {
      const dates = getWeekDates(anchor);
      const timeMin = new Date(dates[0].getTime() - 28*86400000).toISOString();
      const timeMax = new Date(dates[6].getTime() + 28*86400000).toISOString();
      const events = await gcal.events(timeMin, timeMax);
      setGCalEvents(Array.isArray(events) ? events : []);
    } catch(e) { console.error(e); }
    setCalLoading(false);
  }, [calConnected]);

  useEffect(() => { if (calConnected) loadGCal(weekAnchor); }, [calConnected, weekAnchor, loadGCal]);

  // Actions
  const logFeed = () => s(async () => {
    const eatenNote = feedNote ? `${feedNote} · ate ${feedEaten}%` : `Ate ${feedEaten}%`;
    await api.post("/api/feeding", { logged_by:"App", amount:feedAmount, note:eatenNote });
    setFeeding(await api.get("/api/feeding")); setFeedNote(""); setFeedEaten(100);
  });
  const logWater = () => s(async () => {
    await api.post("/api/feeding", { logged_by:"App", amount:"Water", note:"Bowl topped up 💧" });
    setFeeding(await api.get("/api/feeding"));
  });
  const deleteFeed = (id) => s(async () => { await api.del(`/api/feeding/${id}`); setFeeding(await api.get("/api/feeding")); });

  const logToilet = (type) => s(async () => {
    await api.post("/api/toilet", { logged_by:"App", type });
    setToilet(await api.get("/api/toilet"));
  });
  const deleteToilet = (id) => s(async () => { await api.del(`/api/toilet/${id}`); setToilet(await api.get("/api/toilet")); });

  const updateFood = (pouches, alert_at) => s(async () => {
    const u = { pouches:Math.max(0,pouches), alert_at:alert_at??food.alert_at, updated_by:"App" };
    await api.put("/api/food", u); setFood({...food,...u});
  });

  const logTreatment  = (type) => s(async () => { await api.post("/api/treatments", { type, logged_by:"App" }); setTreatments(await api.get("/api/treatments")); });

  const logWalk = () => s(async () => {
    const isDaycare = walkDur==="daycare";
    await api.post("/api/walks", { logged_by:"App", duration_mins:isDaycare?0:parseInt(walkDur), distance:isDaycare?"daycare":walkDist, note:walkNote });
    setWalks(await api.get("/api/walks")); setWalkNote(""); setWalkDist("");
  });
  const deleteWalk = (id) => s(async () => { await api.del(`/api/walks/${id}`); setWalks(await api.get("/api/walks")); });

  const logWeight = () => s(async () => {
    if (!newWeight) return;
    await api.post("/api/weight", { weight_kg:parseFloat(newWeight), logged_by:"App" });
    setWeight(await api.get("/api/weight")); setNewWeight("");
  });

  const logMed = () => s(async () => {
    if (!medName) return;
    await api.post("/api/medications", { logged_by:"App", name:medName, dose:medDose, note:medNote });
    setMeds(await api.get("/api/medications")); setMedName(""); setMedDose(""); setMedNote("");
  });
  const deleteMed = (id) => s(async () => { await api.del(`/api/medications/${id}`); setMeds(await api.get("/api/medications")); });

  const logBehaviour = () => s(async () => {
    await api.post("/api/behaviour", { logged_by:"App", type:behavType, note:behavNote });
    setBehaviour(await api.get("/api/behaviour")); setBehavNote("");
  });
  const deleteBehaviour = (id) => s(async () => { await api.del(`/api/behaviour/${id}`); setBehaviour(await api.get("/api/behaviour")); });

  const addVetAppt = () => s(async () => {
    if (!vetDate||!vetReason) return;
    await api.post("/api/vet", { id:uid(), appt_date:vetDate, reason:vetReason, notes:vetNotes, upcoming:vetUpcoming, added_by:"App" });
    setVetAppts(await api.get("/api/vet")); setVetDate(""); setVetReason(""); setVetNotes("");
  });
  const deleteVetAppt = (id) => s(async () => { await api.del(`/api/vet/${id}`); setVetAppts(p=>p.filter(a=>a.id!==id)); });

  const saveInfo = () => s(async () => { await api.put("/api/info", infoEdit); setInfo(infoEdit); setEditingInfo(false); });

  const logGrooming = () => s(async () => {
    await api.post("/api/grooming", { logged_by:"App", type:groomType, note:groomNote });
    setGrooming(await api.get("/api/grooming")); setGroomNote("");
  });
  const deleteGrooming = (id) => s(async () => { await api.del(`/api/grooming/${id}`); setGrooming(await api.get("/api/grooming")); });

  const logMood = () => s(async () => {
    await api.post("/api/mood", { mood:selMood, logged_by:"App", note:moodNote });
    setMood(await api.get("/api/mood")); setMoodNote("");
  });

  const subscribePush = async () => {
    if (!("serviceWorker" in navigator)) {
      alert("Your browser does not support push notifications. Make sure you have added the app to your home screen and are opening it from there.");
      return;
    }
    setPushStatus("requesting");
    try {
      // Always get the registration fresh — don't rely on state
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;

      // Request permission
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setPushStatus("denied"); return; }

      // Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      setSwReg(reg);
      await api.post("/api/push/subscribe", { subscription: sub.toJSON(), deviceName });
      const subs = await api.get("/api/push/subscriptions");
      setPushSubs(Array.isArray(subs)?subs:[]);
      setPushStatus("granted");
      showSaved();
    } catch(e) {
      console.error("Push subscribe error:", e);
      setPushStatus("idle");
      alert("Could not enable notifications: " + e.message + "

Make sure you opened the app from your home screen icon, not Safari.");
    }
  };

  const testPush = () => s(async () => {
    await api.post("/api/push/test", {});
  });

  const deleteSub = (id) => s(async () => {
    await api.del(`/api/push/subscribe/${id}`);
    setPushSubs(p => p.filter(s => s.id !== id));
  });

  const addGCalEvent = () => s(async () => {
    if (!calConnected) { alert("Connect Google Calendar first"); return; }
    await gcal.create(buildGCalEvent(newLoc, selectedDay, newStart, newEnd, allDay, newEventNote));
    await loadGCal(weekAnchor);
    setShowAddEvent(false); setNewEventNote(""); setAllDay(false);
  });
  const deleteGCalEvent = (id) => s(async () => {
    await gcal.delete(id); setGCalEvents(p=>p.filter(e=>e.id!==id));
  });
  const disconnectGCal = () => s(async () => {
    await api.post("/api/auth/disconnect", {}); setCalConnected(false); setGCalEvents([]);
  });

  // ── COMPUTED ──
  const today     = todayStr();
  const nowTime   = new Date().toTimeString().slice(0,5);
  const lastFeed  = feeding[0];
  const lastWee   = toilet.find(t=>t.type==="wee");
  const lastPoo   = toilet.find(t=>t.type==="poo");
  const fleaDays  = daysSince(treatments.flea?.treated_at);
  const wormDays  = daysSince(treatments.worm?.treated_at);
  const weekDates = getWeekDates(weekAnchor);
  const latestWeight  = weight.length>0?weight[weight.length-1]:null;
  const todayWalks    = walks.filter(w=>w.created_at?.slice(0,10)===today);
  const todayWalkMins = todayWalks.reduce((s,w)=>s+(w.duration_mins||0),0);
  const upcomingVet   = vetAppts.filter(a=>a.upcoming&&a.appt_date>=today).sort((a,b)=>a.appt_date.localeCompare(b.appt_date));
  const daysWithEvents = new Set(gCalEvents.map(e=>e.start?.date||e.start?.dateTime?.slice(0,10)));
  const selectedDayEvents = gCalEvents.filter(e=>(e.start?.date||e.start?.dateTime?.slice(0,10))===selectedDay).sort((a,b)=>(a.start?.dateTime||"").localeCompare(b.start?.dateTime||""));
  const currentEvent = calConnected ? gCalEvents.find(e => {
    const d = e.start?.date||e.start?.dateTime?.slice(0,10);
    if (d!==today) return false;
    if (e.start?.date) return true;
    return e.start?.dateTime?.slice(11,16)<=nowTime && nowTime<=(e.end?.dateTime?.slice(11,16)||"23:59");
  }) : null;
  const lastKnownEvent = !currentEvent ? [...gCalEvents].filter(e=>{
    const start = e.start?.dateTime ? new Date(e.start.dateTime) : new Date((e.start?.date||"")+"T00:00:00");
    return start <= new Date();
  }).sort((a,b)=>new Date(b.start?.dateTime||b.start?.date+"T00:00:00")-new Date(a.start?.dateTime||a.start?.date+"T00:00:00"))[0] : null;
  const activeEvent = currentEvent || lastKnownEvent;
  const activeLocLabel = activeEvent?.summary?.split("— ")[1];
  const activeLoc = LOCATIONS.find(l=>l.label===activeLocLabel);
  const isLive = !!currentEvent;

  // Walk urgency — hours since last walk
  const lastWalkHours = walks.length>0 ? hoursSince(walks[0].created_at) : null;
  const walkUrgent = lastWalkHours !== null && lastWalkHours > 8;

  // Food urgency
  const foodUrgent = food.pouches === 0;

  const alerts = [
    food.pouches<=food.alert_at && "🥫 Food running low",
    fleaDays>=28 && "🐛 Flea treatment due",
    wormDays>=90 && "🪱 Worming due",
    upcomingVet.length>0 && `🏥 Vet: ${upcomingVet[0].reason} — ${formatDate(upcomingVet[0].appt_date)}`,
  ].filter(Boolean);

  const currentTabLabel = NAV.find(n=>n.id===tab)?.label||"Home";
  const weeList = toilet.filter(t=>t.type==="wee");
  const pooList = toilet.filter(t=>t.type==="poo");

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#f8fafc", gap:12 }}>
      <div style={{ fontSize:56 }}>🐾</div>
      <div style={{ fontSize:15, color:"#94a3b8", fontWeight:500 }}>Loading Barney's tracker…</div>
    </div>
  );

  return (
    <div style={{ fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background:"#f8fafc", minHeight:"100vh", maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column" }}>
      <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>

      <Sidebar open={sidebarOpen} onClose={()=>setSidebarOpen(false)} tab={tab} setTab={setTab} alerts={alerts} />
      <SaveToast state={saveState} />
      {confirm && <ConfirmModal message={confirm.message} onConfirm={()=>{ confirm.onConfirm(); setConfirm(null); }} onCancel={()=>setConfirm(null)} />}

      {/* Header */}
      <div style={{ background:"#1a1a2e", padding:"14px 18px", display:"flex", alignItems:"center", gap:14, flexShrink:0, position:"sticky", top:0, zIndex:100 }}>
        <button onClick={()=>setSidebarOpen(true)} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.8)", cursor:"pointer", fontSize:22, padding:0, lineHeight:1, flexShrink:0 }}>≡</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:16, fontWeight:700, color:"#fff", letterSpacing:-0.2 }}>{currentTabLabel}</div>
          {tab==="home" && activeLoc && <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:1 }}>{activeLoc.icon} {activeLoc.label} {isLive?"· right now":"· last known"}</div>}
        </div>
        {alerts.length>0 && <div style={{ background:"#ef4444", borderRadius:20, width:8, height:8, flexShrink:0 }} />}
      </div>

      {/* Alert bar */}
      {alerts.length>0 && (
        <div style={{ background:"#ef4444", padding:"8px 18px", display:"flex", gap:16, overflowX:"auto", flexShrink:0 }}>
          {alerts.map((a,i)=><span key={i} style={{ fontSize:11, color:"#fff", fontWeight:600, whiteSpace:"nowrap" }}>{a}</span>)}
        </div>
      )}

      <div style={{ flex:1, padding:"14px 14px 32px", overflowY:"auto" }}>

        {/* ── HOME ── */}
        {tab==="home" && (
          <div>
            {/* Location hero */}
            <div style={{ borderRadius:20, padding:"22px 20px", marginBottom:14, position:"relative", overflow:"hidden", background:activeLoc?`linear-gradient(135deg, ${activeLoc.color}dd, ${activeLoc.color}99)`:"linear-gradient(135deg, #1e293b, #334155)" }}>
              <div style={{ position:"absolute", right:-8, top:-8, fontSize:90, opacity:0.12, lineHeight:1 }}>🐕</div>
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>{isLive?"Right now":"Last known location"}</div>
              {activeLoc ? (
                <>
                  <div style={{ fontSize:32, fontWeight:800, color:"#fff", marginBottom:6, lineHeight:1.1 }}>{activeLoc.icon} {activeLoc.label}</div>
                  {activeEvent && <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", fontWeight:500 }}>{activeEvent.start?.date?"All day":`${activeEvent.start?.dateTime?.slice(11,16)} – ${activeEvent.end?.dateTime?.slice(11,16)}`}{activeEvent.description?` · ${activeEvent.description}`:""}</div>}
                  {!isLive && <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginTop:4 }}>{activeEvent?.start?.date?formatDate(activeEvent.start.date):formatTime(activeEvent?.start?.dateTime)}</div>}
                </>
              ) : <div style={{ fontSize:16, color:"rgba(255,255,255,0.6)", fontWeight:500 }}>{calConnected?"No calendar events found":"Connect Google Calendar to see location →"}</div>}
            </div>

            {/* Today's plan */}
            {calConnected && gCalEvents.filter(e=>(e.start?.date||e.start?.dateTime?.slice(0,10))===today).length>0 && (
              <Card style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#1e293b", marginBottom:10 }}>📅 Today's plan</div>
                {gCalEvents.filter(e=>(e.start?.date||e.start?.dateTime?.slice(0,10))===today).sort((a,b)=>(a.start?.dateTime||"").localeCompare(b.start?.dateTime||"")).map(ev=>{
                  const locLabel=ev.summary?.split("— ")[1];
                  const loc=LOCATIONS.find(l=>l.label===locLabel)||{ icon:"📅", color:"#94a3b8", label:locLabel };
                  const isPast = ev.end?.dateTime && ev.end.dateTime < new Date().toISOString();
                  return (
                    <div key={ev.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid #f1f5f9", opacity:isPast?0.45:1 }}>
                      <div style={{ width:4, height:32, borderRadius:2, background:loc.color, flexShrink:0 }} />
                      <span style={{ fontSize:18 }}>{loc.icon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:"#1e293b" }}>{loc.label}</div>
                        <div style={{ fontSize:10, color:"#94a3b8" }}>{ev.start?.date?"All day":`${ev.start?.dateTime?.slice(11,16)} – ${ev.end?.dateTime?.slice(11,16)}`}</div>
                      </div>
                      {!isPast && <Badge color={loc.color}>upcoming</Badge>}
                    </div>
                  );
                })}
              </Card>
            )}

            {/* Stat cards — all tappable */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
              <StatCard icon="🍽️" label="Last fed" value={lastFeed?formatTime(lastFeed.created_at):"Not logged"} sub={lastFeed?.amount} onClick={()=>setTab("feed")} />
              <StatCard icon="💧" label="Last wee"  value={lastWee?formatTime(lastWee.created_at):"Not logged"} onClick={()=>setTab("toilet")} />
              <StatCard icon="🥫" label="Food stock" value={foodUrgent?"⚠️ OUT OF FOOD":`${food.pouches} pouches`} sub={!foodUrgent&&food.pouches<=food.alert_at?"Running low":null} subColor="#ef4444" onClick={()=>setTab("feed")} urgent={foodUrgent} />
              <StatCard icon="🦮" label="Walked today" value={todayWalkMins>0?`${todayWalkMins} mins`:"Not yet"} sub={!todayWalkMins&&lastWalkHours!==null?`Last walk ${lastWalkHours}h ago`:null} subColor={walkUrgent?"#ef4444":"#94a3b8"} onClick={()=>setTab("walks")} urgent={walkUrgent&&!todayWalkMins} />
            </div>

            {/* Treatment countdown */}
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>Treatment countdown</div>
              {[{label:"Flea",days:fleaDays,cycle:28},{label:"Worming",days:wormDays,cycle:90}].map(({label,days,cycle})=>(
                <div key={label} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:"#334155" }}>{label} treatment</span>
                    <Badge color={days===null?"#94a3b8":days>=cycle?"#ef4444":days>=cycle*0.75?"#f59e0b":"#10b981"}>
                      {days===null?"Not logged":days>=cycle?"Due now!":`${cycle-days}d left`}
                    </Badge>
                  </div>
                  <div style={{ height:6, background:"#f1f5f9", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:3, width:`${days===null?0:Math.min(100,(days/cycle)*100)}%`, background:days>=cycle?"#ef4444":days>=cycle*0.75?"#f59e0b":"#10b981", transition:"width 0.5s" }} />
                  </div>
                </div>
              ))}
            </Card>

            {/* Weight + mood row */}
            {(latestWeight||mood.length>0) && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {latestWeight&&<Card style={{ marginBottom:0 }}><div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Weight</div><div style={{ fontSize:24, fontWeight:700, color:"#1e293b" }}>{latestWeight.weight_kg}<span style={{ fontSize:13, color:"#94a3b8", fontWeight:500 }}>kg</span></div><div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>{formatDate(latestWeight.logged_date)}</div></Card>}
                {mood.length>0&&<Card style={{ marginBottom:0 }}><div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Mood</div><div style={{ fontSize:28 }}>{MOODS.find(m=>m.v===mood[0]?.mood)?.e||"😐"}</div><div style={{ fontSize:12, fontWeight:600, color:"#1e293b", marginTop:2 }}>{MOODS.find(m=>m.v===mood[0]?.mood)?.l||mood[0]?.mood}</div></Card>}
              </div>
            )}

            {/* Vet quick link */}
            {info.vet_phone && (
              <Card style={{ marginTop:12, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div><div style={{ fontSize:12, fontWeight:700, color:"#1e293b" }}>🏥 {info.vet||"Vet"}</div><div style={{ fontSize:11, color:"#94a3b8" }}>{info.vet_phone}</div></div>
                <a href={`tel:${info.vet_phone}`} style={{ background:"#10b981", color:"#fff", padding:"8px 16px", borderRadius:20, fontSize:12, fontWeight:700, textDecoration:"none" }}>Call</a>
              </Card>
            )}
          </div>
        )}

        {/* ── CALENDAR ── */}
        {tab==="calendar" && (
          <div>
            {!calConnected ? (
              <Card style={{ textAlign:"center", padding:"32px 20px" }}>
                <div style={{ fontSize:48, marginBottom:12 }}>📅</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#1e293b", marginBottom:8 }}>Connect Google Calendar</div>
                <div style={{ fontSize:13, color:"#94a3b8", marginBottom:20, lineHeight:1.5 }}>Sign in once with the shared Barney Google account — you'll never need to sign in again.</div>
                <Btn variant="google" onClick={()=>{ window.location.href=`${WORKER_URL}/api/auth/google`; }}>🔗 Connect Google Calendar</Btn>
              </Card>
            ) : (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <span style={{ fontSize:12, color:"#10b981", fontWeight:600 }}>✅ Calendar connected</span>
                  <button onClick={disconnectGCal} style={{ background:"none", border:"none", fontSize:12, color:"#94a3b8", cursor:"pointer", fontWeight:500 }}>Disconnect</button>
                </div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                  <button onClick={()=>setWeekAnchor(d=>{const x=new Date(d);x.setDate(x.getDate()-7);return x;})} style={{ background:"#f1f5f9", border:"none", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:16, color:"#334155", fontWeight:700 }}>‹</button>
                  <span style={{ fontSize:13, fontWeight:700, color:"#1e293b" }}>{weekDates[0].toLocaleDateString([],{day:"numeric",month:"short"})} – {weekDates[6].toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"})}</span>
                  <button onClick={()=>setWeekAnchor(d=>{const x=new Date(d);x.setDate(x.getDate()+7);return x;})} style={{ background:"#f1f5f9", border:"none", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:16, color:"#334155", fontWeight:700 }}>›</button>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:14 }}>
                  {weekDates.map((d,i)=>{
                    const ds=d.toISOString().slice(0,10), isToday=ds===today, isSel=ds===selectedDay;
                    return (
                      <button key={ds} onClick={()=>setSelectedDay(ds)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, padding:"8px 2px", borderRadius:12, border:"none", cursor:"pointer", transition:"all 0.15s", background:isSel?"#1a1a2e":isToday?"#f0f9ff":"#fff", boxShadow:isSel?"0 2px 8px rgba(26,26,46,0.25)":"0 1px 3px rgba(0,0,0,0.06)", outline:isToday&&!isSel?"2px solid #3b82f6":"none", outlineOffset:"-2px" }}>
                        <span style={{ fontSize:9, color:isSel?"rgba(255,255,255,0.55)":"#94a3b8", fontWeight:700 }}>{DAY_LABELS[i]}</span>
                        <span style={{ fontSize:14, fontWeight:700, color:isSel?"#fff":"#1e293b" }}>{d.getDate()}</span>
                        <span style={{ fontSize:11, opacity:daysWithEvents.has(ds)?1:0.15 }}>🐾</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:14 }}>
                  {LOCATIONS.map(l=><div key={l.id} style={{ display:"flex", alignItems:"center", gap:4, background:l.color+"15", borderRadius:20, padding:"3px 10px", fontSize:11, color:l.color, fontWeight:600 }}>{l.icon} {l.label}</div>)}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:"#1e293b" }}>{new Date(selectedDay+"T12:00:00").toLocaleDateString([],{weekday:"long",day:"numeric",month:"long"})}</div>
                  <Btn onClick={()=>setShowAddEvent(true)} style={{ width:"auto", padding:"7px 14px", borderRadius:20, fontSize:12 }}>+ Add</Btn>
                </div>
                {calLoading&&<div style={{ textAlign:"center", padding:20, color:"#94a3b8", fontSize:13 }}>Loading…</div>}
                {!calLoading&&selectedDayEvents.length===0&&<div style={{ textAlign:"center", padding:24, color:"#94a3b8", fontSize:13 }}>Nothing planned — tap + Add</div>}
                {selectedDayEvents.map(ev=>{
                  const locLabel=ev.summary?.split("— ")[1];
                  const loc=LOCATIONS.find(l=>l.label===locLabel)||{ icon:"📅", color:"#94a3b8", label:locLabel||ev.summary };
                  return (
                    <div key={ev.id} style={{ background:"#fff", borderRadius:14, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:12, boxShadow:"0 1px 3px rgba(0,0,0,0.06)", borderLeft:`4px solid ${loc.color}` }}>
                      <span style={{ fontSize:22 }}>{loc.icon}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>{loc.label}</div>
                        <div style={{ fontSize:11, color:"#94a3b8", marginTop:1 }}>{ev.start?.date?"All day":`${ev.start?.dateTime?.slice(11,16)} – ${ev.end?.dateTime?.slice(11,16)}`}</div>
                        {ev.description&&<div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>📝 {ev.description}</div>}
                      </div>
                      <button onClick={()=>confirmDelete("Delete this calendar event?", ()=>deleteGCalEvent(ev.id))} style={{ background:"#fef2f2", border:"none", borderRadius:8, padding:"5px 9px", cursor:"pointer", color:"#ef4444", fontSize:12, fontWeight:700 }}>✕</button>
                    </div>
                  );
                })}
                {showAddEvent&&(
                  <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:300 }} onClick={()=>setShowAddEvent(false)}>
                    <div style={{ background:"#f8fafc", borderRadius:"20px 20px 0 0", padding:22, width:"100%", maxWidth:480, maxHeight:"88vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
                      <div style={{ width:36, height:4, background:"#e2e8f0", borderRadius:2, margin:"0 auto 16px" }} />
                      <div style={{ fontSize:16, fontWeight:700, color:"#1e293b", marginBottom:14 }}>Add to calendar</div>
                      <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Where is Barney?</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
                        {LOCATIONS.map(l=><button key={l.id} onClick={()=>setNewLoc(l.id)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"12px 8px", borderRadius:12, border:`2px solid ${newLoc===l.id?l.color:"#e2e8f0"}`, background:newLoc===l.id?l.color+"15":"#fff", cursor:"pointer", color:newLoc===l.id?l.color:"#64748b", fontWeight:600, fontSize:11 }}><span style={{ fontSize:20 }}>{l.icon}</span>{l.label}</button>)}
                      </div>
                      <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#334155", marginBottom:12, cursor:"pointer", fontWeight:500 }}>
                        <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All day
                      </label>
                      {!allDay&&<div style={{ display:"flex", gap:10, marginBottom:10 }}><div style={{ flex:1 }}><div style={{ fontSize:11, color:"#94a3b8", marginBottom:4 }}>From</div><input type="time" value={newStart} onChange={e=>setNewStart(e.target.value)} style={{ width:"100%", padding:"9px 12px", borderRadius:9, border:"1.5px solid #e2e8f0", fontSize:13, background:"#f8fafc", outline:"none", boxSizing:"border-box" }} /></div><div style={{ flex:1 }}><div style={{ fontSize:11, color:"#94a3b8", marginBottom:4 }}>Until</div><input type="time" value={newEnd} onChange={e=>setNewEnd(e.target.value)} style={{ width:"100%", padding:"9px 12px", borderRadius:9, border:"1.5px solid #e2e8f0", fontSize:13, background:"#f8fafc", outline:"none", boxSizing:"border-box" }} /></div></div>}
                      <Input placeholder="Notes (optional)" value={newEventNote} onChange={e=>setNewEventNote(e.target.value)} />
                      <div style={{ display:"flex", gap:8 }}><Btn onClick={addGCalEvent} style={{ flex:1 }}>Save to Google Calendar</Btn><Btn variant="secondary" onClick={()=>setShowAddEvent(false)} style={{ flex:1 }}>Cancel</Btn></div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── FEEDING ── */}
        {tab==="feed" && (
          <div>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>Log a meal</div>
              <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Portion size</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
                {["Full portion","Half portion","Treat only"].map(a=><Chip key={a} label={a} active={feedAmount===a} onClick={()=>setFeedAmount(a)} />)}
              </div>
              <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>How much did he eat?</div>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
                <div style={{ flex:1, height:6, background:"#f1f5f9", borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:3, width:`${feedEaten}%`, background:feedEaten>=75?"#10b981":feedEaten>=40?"#f59e0b":"#ef4444", transition:"width 0.2s" }} />
                </div>
                <div style={{ fontSize:20, fontWeight:800, color:"#1e293b", minWidth:48, textAlign:"right" }}>{feedEaten}%</div>
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:14 }}>
                {[0,25,50,75,100].map(p=><button key={p} onClick={()=>setFeedEaten(p)} style={{ flex:1, padding:"7px 4px", borderRadius:9, border:`2px solid ${feedEaten===p?"#1a1a2e":"#e2e8f0"}`, background:feedEaten===p?"#1a1a2e":"#fff", color:feedEaten===p?"#fff":"#64748b", cursor:"pointer", fontSize:12, fontWeight:700 }}>{p}%</button>)}
              </div>
              <Input placeholder="Notes? (e.g. ate slowly, left the meat)" value={feedNote} onChange={e=>setFeedNote(e.target.value)} />
              <div style={{ display:"flex", gap:8 }}>
                <Btn onClick={logFeed} style={{ flex:2 }}>🍽️ Log meal</Btn>
                <Btn onClick={logWater} variant="secondary" style={{ flex:1 }}>💧 Water</Btn>
              </div>
            </Card>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>Food cupboard</div>
              <div style={{ textAlign:"center", padding:"8px 0 16px" }}>
                <div style={{ fontSize:56, fontWeight:800, lineHeight:1, color:food.pouches===0?"#ef4444":food.pouches<=food.alert_at?"#f59e0b":"#10b981" }}>{food.pouches===0?"0 😱":food.pouches}</div>
                <div style={{ color:"#94a3b8", fontSize:13, fontWeight:500, marginTop:4 }}>pouches remaining</div>
                {food.pouches===0&&<div style={{ color:"#ef4444", fontSize:13, fontWeight:700, marginTop:8, background:"#fef2f2", padding:"8px 16px", borderRadius:10 }}>🚨 No food left — buy more now!</div>}
                {food.pouches>0&&food.pouches<=food.alert_at&&<div style={{ color:"#f59e0b", fontSize:12, fontWeight:600, marginTop:6 }}>⚠️ Running low — time to restock!</div>}
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                {[[-1,"−1"],[-3,"−3"]].map(([d,l])=><button key={l} onClick={()=>updateFood(food.pouches+d)} style={{ flex:1, padding:10, background:"#fef2f2", border:"none", borderRadius:10, cursor:"pointer", fontSize:14, fontWeight:700, color:"#ef4444" }}>{l}</button>)}
                {[[12,"+12"],[24,"+24"]].map(([d,l])=><button key={l} onClick={()=>updateFood(food.pouches+d)} style={{ flex:1, padding:10, background:"#f0fdf4", border:"none", borderRadius:10, cursor:"pointer", fontSize:14, fontWeight:700, color:"#10b981" }}>{l}</button>)}
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ fontSize:11, color:"#94a3b8", whiteSpace:"nowrap" }}>Set exact:</span>
                <input type="number" value={food.pouches} onChange={e=>updateFood(parseInt(e.target.value)||0)} style={{ width:60, padding:"7px 10px", borderRadius:8, border:"1.5px solid #e2e8f0", fontSize:13, background:"#f8fafc", outline:"none", textAlign:"center" }} />
                <span style={{ fontSize:11, color:"#94a3b8", whiteSpace:"nowrap" }}>Alert at:</span>
                <input type="number" value={food.alert_at} onChange={e=>updateFood(food.pouches,parseInt(e.target.value)||0)} style={{ width:50, padding:"7px 10px", borderRadius:8, border:"1.5px solid #e2e8f0", fontSize:13, background:"#f8fafc", outline:"none", textAlign:"center" }} />
              </div>
            </Card>
            <SectionTitle>Recent meals</SectionTitle>
            <Card>
              {feeding.length===0&&<div style={{ textAlign:"center", padding:"16px 0", color:"#94a3b8", fontSize:13 }}>No meals logged yet</div>}
              {feeding.slice(0,15).map((f,i)=><LogItem key={f.id||i} icon={f.amount==="Water"?"💧":"🍽️"} primary={f.amount} secondary={f.note} time={formatTime(f.created_at)} by={`by ${f.logged_by}`} onDelete={()=>confirmDelete("Delete this meal log?", ()=>deleteFeed(f.id))} />)}
            </Card>
          </div>
        )}

        {/* ── TOILET ── */}
        {tab==="toilet" && (
          <div>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>Log toilet trip</div>
              <div style={{ display:"flex", gap:10, marginBottom:14 }}>
                <button onClick={()=>logToilet("wee")} style={{ flex:1, padding:"18px 10px", background:"linear-gradient(135deg,#3b82f6,#2563eb)", color:"#fff", border:"none", borderRadius:14, cursor:"pointer", fontSize:15, fontWeight:700, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}><span style={{ fontSize:28 }}>💧</span>Wee</button>
                <button onClick={()=>logToilet("poo")} style={{ flex:1, padding:"18px 10px", background:"linear-gradient(135deg,#92400e,#78350f)", color:"#fff", border:"none", borderRadius:14, cursor:"pointer", fontSize:15, fontWeight:700, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}><span style={{ fontSize:28 }}>💩</span>Poo</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[{l:"Last wee",v:lastWee},{l:"Last poo",v:lastPoo}].map(({l,v})=>(
                  <div key={l} style={{ background:"#f8fafc", borderRadius:10, padding:"10px 12px" }}>
                    <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>{l}</div>
                    <div style={{ fontSize:12, fontWeight:700, color:"#1e293b", marginTop:3 }}>{v?formatTime(v.created_at):"Not logged"}</div>
                  </div>
                ))}
              </div>
            </Card>
            <SectionTitle>Wees 💧</SectionTitle>
            <Card>
              {weeList.length===0&&<div style={{ textAlign:"center", padding:"16px 0", color:"#94a3b8", fontSize:13 }}>No wees logged yet</div>}
              {weeList.slice(0,10).map((t,i)=><LogItem key={t.id||i} icon="💧" primary="Wee" time={formatTime(t.created_at)} by={`by ${t.logged_by}`} onDelete={()=>confirmDelete("Delete this log?", ()=>deleteToilet(t.id))} />)}
            </Card>
            <SectionTitle>Poos 💩</SectionTitle>
            <Card>
              {pooList.length===0&&<div style={{ textAlign:"center", padding:"16px 0", color:"#94a3b8", fontSize:13 }}>No poos logged yet</div>}
              {pooList.slice(0,10).map((t,i)=><LogItem key={t.id||i} icon="💩" primary="Poo" time={formatTime(t.created_at)} by={`by ${t.logged_by}`} onDelete={()=>confirmDelete("Delete this log?", ()=>deleteToilet(t.id))} />)}
            </Card>
          </div>
        )}

        {/* ── WALKS ── */}
        {tab==="walks" && (
          <div>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>Log activity</div>
              <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Duration</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
                {["15","20","30","45","60","90"].map(m=><Chip key={m} label={`${m} min`} active={walkDur===m&&walkDur!=="daycare"} onClick={()=>setWalkDur(m)} />)}
                <Chip label="🐾 Daycare day" active={walkDur==="daycare"} onClick={()=>setWalkDur("daycare")} color="#8b5cf6" />
              </div>
              {walkDur!=="daycare"&&<Input placeholder="Distance (e.g. 2km) — optional" value={walkDist} onChange={e=>setWalkDist(e.target.value)} />}
              <Input placeholder={walkDur==="daycare"?"Notes (e.g. had a great time!)":"Notes (e.g. off lead in park)"} value={walkNote} onChange={e=>setWalkNote(e.target.value)} />
              <Btn onClick={logWalk}>{walkDur==="daycare"?"🐾 Log daycare day":"🦮 Log walk"}</Btn>
            </Card>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:8 }}>Today</div>
              {todayWalks.length===0
                ? <div style={{ color:"#94a3b8", fontSize:13 }}>{lastWalkHours!==null?`No walks yet today — last walk was ${lastWalkHours} hours ago`:"No walks yet today"}</div>
                : <><div style={{ fontSize:28, fontWeight:800, color:"#1e293b" }}>{todayWalkMins>0?<>{todayWalkMins}<span style={{ fontSize:14, color:"#94a3b8", fontWeight:500 }}> mins</span></>:"Daycare day 🐾"}</div>{todayWalks.map((w,i)=><div key={i} style={{ fontSize:12, color:"#64748b", marginTop:4 }}>{w.distance==="daycare"?"🐾 Daycare day":`🦮 ${w.duration_mins} min${w.distance?` · ${w.distance}`:""}`}{w.note?` — ${w.note}`:""}</div>)}</>}
            </Card>
            <SectionTitle>Recent activity</SectionTitle>
            <Card>
              {walks.length===0&&<div style={{ textAlign:"center", padding:"16px 0", color:"#94a3b8", fontSize:13 }}>No activity logged yet</div>}
              {walks.slice(0,15).map((w,i)=><LogItem key={w.id||i} icon={w.distance==="daycare"?"🐾":"🦮"} primary={w.distance==="daycare"?"Doggy daycare day":`${w.duration_mins} min${w.distance?` · ${w.distance}`:""}`} secondary={w.note} time={formatTime(w.created_at)} by={`by ${w.logged_by}`} onDelete={()=>confirmDelete("Delete this walk log?", ()=>deleteWalk(w.id))} />)}
            </Card>
          </div>
        )}

        {/* ── HEALTH ── */}
        {tab==="health" && (
          <div>
            {[{key:"flea",label:"Flea treatment",icon:"🐛",days:fleaDays,cycle:28,interval:"Every 28 days"},{key:"worm",label:"Worming",icon:"🪱",days:wormDays,cycle:90,interval:"Every 90 days"}].map(({key,label,icon,days,cycle,interval})=>{
              const lastDate = treatments[key]?.treated_at;
              const nextDate = lastDate ? new Date(new Date(lastDate).getTime()+cycle*86400000) : null;
              return (
                <Card key={key}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:"#1e293b" }}>{icon} {label}</div>
                    <Badge color={days===null?"#94a3b8":days>=cycle?"#ef4444":days>=cycle*0.75?"#f59e0b":"#10b981"}>{days===null?"Not logged":days>=cycle?"Due now!":`${cycle-days}d left`}</Badge>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5, marginBottom:3 }}>Last done</div>
                      <div style={{ fontSize:12, fontWeight:700, color:"#1e293b" }}>{lastDate?formatDate(lastDate.slice(0,10)):"Not logged"}</div>
                      {lastDate&&<div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{days===0?"today":`${days} days ago`}</div>}
                    </div>
                    <div style={{ background:"#f8fafc", borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5, marginBottom:3 }}>Next due</div>
                      <div style={{ fontSize:12, fontWeight:700, color:days>=cycle?"#ef4444":"#1e293b" }}>{nextDate?formatDate(nextDate.toISOString().slice(0,10)):"—"}</div>
                      {nextDate&&<div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{interval}</div>}
                    </div>
                  </div>
                  {days!==null&&days<cycle&&<div style={{ height:6, background:"#f1f5f9", borderRadius:3, marginBottom:12, overflow:"hidden" }}><div style={{ height:"100%", borderRadius:3, width:`${Math.min(100,(days/cycle)*100)}%`, background:days>=cycle*0.75?"#f59e0b":"#10b981", transition:"width 0.5s" }} /></div>}
                  <div style={{ display:"flex", gap:8 }}>
                    <Btn onClick={()=>logTreatment(key)} style={{ flex:1 }}>✅ Mark as done today</Btn>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:3 }}>Or set a date</div>
                      <input type="date" value={key==="flea"?treatmentDates.fleaDate:treatmentDates.wormDate} onChange={e=>setTreatmentDates(p=>({...p,[key==="flea"?"fleaDate":"wormDate"]:e.target.value}))} style={{ width:"100%", padding:"8px 10px", borderRadius:9, border:"1.5px solid #e2e8f0", fontSize:12, background:"#f8fafc", outline:"none", boxSizing:"border-box" }} />
                      <button onClick={async()=>{ const d=key==="flea"?treatmentDates.fleaDate:treatmentDates.wormDate; if(!d)return; await s(async()=>{ await api.post("/api/treatments",{type:key,logged_by:"App",treated_at:new Date(d+"T12:00:00").toISOString()}); setTreatments(await api.get("/api/treatments")); }); }} style={{ marginTop:4, width:"100%", padding:"7px", borderRadius:9, border:"none", background:"#f1f5f9", cursor:"pointer", fontSize:12, fontWeight:600, color:"#334155" }}>Set date</button>
                    </div>
                  </div>
                </Card>
              );
            })}
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>😄 Mood log</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                {MOODS.map(m=><button key={m.v} onClick={()=>setSelMood(m.v)} style={{ padding:"8px 12px", borderRadius:10, border:`2px solid ${selMood===m.v?"#1a1a2e":"#e2e8f0"}`, background:selMood===m.v?"#1a1a2e":"#fff", color:selMood===m.v?"#fff":"#64748b", cursor:"pointer", fontSize:12, fontWeight:600, display:"flex", alignItems:"center", gap:4 }}>{m.e} {m.l}</button>)}
              </div>
              <Input placeholder="Any notes?" value={moodNote} onChange={e=>setMoodNote(e.target.value)} />
              <Btn onClick={logMood}>Log mood</Btn>
            </Card>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>💊 Medication log</div>
              <Input placeholder="Medicine name" value={medName} onChange={e=>setMedName(e.target.value)} />
              <Input placeholder="Dose (e.g. 1 tablet, 5ml)" value={medDose} onChange={e=>setMedDose(e.target.value)} />
              <Input placeholder="Notes (optional)" value={medNote} onChange={e=>setMedNote(e.target.value)} />
              <Btn onClick={logMed}>+ Log medication</Btn>
              {meds.slice(0,5).map((m,i)=><LogItem key={m.id||i} icon="💊" primary={`${m.name}${m.dose?` · ${m.dose}`:""}`} secondary={m.note} time={formatTime(m.created_at)} by={`by ${m.logged_by}`} onDelete={()=>confirmDelete("Delete this medication log?", ()=>deleteMed(m.id))} />)}
            </Card>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>⚖️ Weight tracker</div>
              <div style={{ display:"flex", gap:8, marginBottom:10, alignItems:"center" }}>
                <Input type="number" placeholder="Weight in kg" value={newWeight} onChange={e=>setNewWeight(e.target.value)} style={{ flex:1, marginBottom:0 }} />
                <Btn onClick={logWeight} style={{ width:"auto", padding:"10px 16px" }}>Log</Btn>
              </div>
              {weight.length>1&&<ResponsiveContainer width="100%" height={120}><LineChart data={weight}><XAxis dataKey="logged_date" tick={{fontSize:8,fill:"#94a3b8"}} tickFormatter={d=>d.slice(5)} axisLine={false} tickLine={false} /><YAxis tick={{fontSize:8,fill:"#94a3b8"}} domain={["auto","auto"]} width={28} axisLine={false} tickLine={false} /><Tooltip formatter={v=>[`${v}kg`,"Weight"]} contentStyle={{fontSize:11,borderRadius:8,border:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}} /><Line type="monotone" dataKey="weight_kg" stroke="#1a1a2e" strokeWidth={2} dot={{r:3,fill:"#1a1a2e"}} /></LineChart></ResponsiveContainer>}
              {weight.slice(-5).reverse().map((w,i)=><div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#64748b", padding:"5px 0", borderBottom:"1px solid #f1f5f9" }}><span>{formatDate(w.logged_date)}</span><span style={{ fontWeight:700, color:"#1e293b" }}>{w.weight_kg}kg</span><span>{w.logged_by}</span></div>)}
            </Card>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>🔍 Behaviour notes</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
                {BEHAVIOUR_TYPES.map(b=><Chip key={b} label={b} active={behavType===b} onClick={()=>setBehavType(b)} />)}
              </div>
              <Input placeholder="More details..." value={behavNote} onChange={e=>setBehavNote(e.target.value)} />
              <Btn onClick={logBehaviour}>+ Log note</Btn>
              {behaviour.slice(0,5).map((b,i)=><LogItem key={b.id||i} icon="🔍" primary={b.type} secondary={b.note} time={formatTime(b.created_at)} by={`by ${b.logged_by}`} onDelete={()=>confirmDelete("Delete this behaviour note?", ()=>deleteBehaviour(b.id))} />)}
            </Card>
          </div>
        )}

        {/* ── VET ── */}
        {tab==="vet" && (
          <div>
            {info.vet_phone&&(
              <Card style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                <div><div style={{ fontSize:13, fontWeight:700, color:"#1e293b" }}>🏥 {info.vet||"Vet"}</div><div style={{ fontSize:12, color:"#94a3b8" }}>{info.vet_phone}</div></div>
                <a href={`tel:${info.vet_phone}`} style={{ background:"#10b981", color:"#fff", padding:"9px 18px", borderRadius:20, fontSize:13, fontWeight:700, textDecoration:"none" }}>📞 Call</a>
              </Card>
            )}
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>Add appointment</div>
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                <Chip label="Upcoming" active={vetUpcoming} onClick={()=>setVetUpcoming(true)} />
                <Chip label="Past visit" active={!vetUpcoming} onClick={()=>setVetUpcoming(false)} />
              </div>
              <Input type="date" value={vetDate} onChange={e=>setVetDate(e.target.value)} />
              <Input placeholder="Reason (e.g. annual checkup)" value={vetReason} onChange={e=>setVetReason(e.target.value)} />
              <Input placeholder="Notes (e.g. what vet said)" value={vetNotes} onChange={e=>setVetNotes(e.target.value)} />
              <Btn onClick={addVetAppt}>🏥 Save appointment</Btn>
            </Card>
            {upcomingVet.length>0&&<><SectionTitle>Upcoming</SectionTitle>{upcomingVet.map(a=><div key={a.id} style={{ background:"#fff", borderRadius:14, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:12, boxShadow:"0 1px 3px rgba(0,0,0,0.06)", borderLeft:"4px solid #10b981" }}><div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>🏥 {a.reason}</div><div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{formatDate(a.appt_date)}</div>{a.notes&&<div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>📝 {a.notes}</div>}</div><button onClick={()=>confirmDelete("Delete this appointment?",()=>deleteVetAppt(a.id))} style={{ background:"#fef2f2", border:"none", borderRadius:8, padding:"5px 9px", cursor:"pointer", color:"#ef4444", fontSize:12, fontWeight:700 }}>✕</button></div>)}</>}
            <SectionTitle>Past visits</SectionTitle>
            {vetAppts.filter(a=>!a.upcoming||a.appt_date<today).length===0&&<Card><div style={{ textAlign:"center", color:"#94a3b8", fontSize:13 }}>No past visits logged yet</div></Card>}
            {vetAppts.filter(a=>!a.upcoming||a.appt_date<today).map(a=><div key={a.id} style={{ background:"#fff", borderRadius:14, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:12, boxShadow:"0 1px 3px rgba(0,0,0,0.06)", borderLeft:"4px solid #94a3b8" }}><div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>🏥 {a.reason}</div><div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{formatDate(a.appt_date)}</div>{a.notes&&<div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>📝 {a.notes}</div>}</div><button onClick={()=>confirmDelete("Delete this appointment?",()=>deleteVetAppt(a.id))} style={{ background:"#fef2f2", border:"none", borderRadius:8, padding:"5px 9px", cursor:"pointer", color:"#ef4444", fontSize:12, fontWeight:700 }}>✕</button></div>)}
          </div>
        )}

        {/* ── GROOMING ── */}
        {tab==="grooming" && (
          <div>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12 }}>✂️ Grooming summary</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
                <div style={{ background:"#f8fafc", borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5, marginBottom:3 }}>Last groomed</div>
                  {grooming.length>0?<><div style={{ fontSize:12, fontWeight:700, color:"#1e293b" }}>{formatDate(grooming[0].created_at.slice(0,10))}</div><div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{grooming[0].type}</div></>:<div style={{ fontSize:12, color:"#94a3b8" }}>Not logged</div>}
                </div>
                <div style={{ background:"#f8fafc", borderRadius:10, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5, marginBottom:3 }}>Next appointment</div>
                  {groomNextAppt?<><div style={{ fontSize:12, fontWeight:700, color:"#1e293b" }}>{formatDate(groomNextAppt)}</div><div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>booked</div></>:<div style={{ fontSize:12, color:"#94a3b8" }}>Not set</div>}
                </div>
              </div>
              <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, marginBottom:4 }}>Next appointment date</div>
              <div style={{ display:"flex", gap:8 }}>
                <input type="date" value={groomNextAppt} onChange={e=>setGroomNextAppt(e.target.value)} style={{ flex:1, padding:"8px 10px", borderRadius:9, border:"1.5px solid #e2e8f0", fontSize:13, background:"#f8fafc", outline:"none", boxSizing:"border-box" }} />
                {groomNextAppt&&<button onClick={()=>setGroomNextAppt("")} style={{ padding:"8px 12px", borderRadius:9, border:"none", background:"#fef2f2", cursor:"pointer", fontSize:12, fontWeight:600, color:"#ef4444" }}>Clear</button>}
              </div>
            </Card>
            <SectionTitle>Log grooming</SectionTitle>
            <Card>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                {GROOMING_TYPES.map(g=><Chip key={g} label={g} active={groomType===g} onClick={()=>setGroomType(g)} />)}
              </div>
              <Input placeholder="Notes (optional)" value={groomNote} onChange={e=>setGroomNote(e.target.value)} />
              <Btn onClick={logGrooming}>✂️ Log grooming session</Btn>
            </Card>
            <SectionTitle>Recent grooming</SectionTitle>
            <Card>
              {grooming.length===0&&<div style={{ textAlign:"center", padding:"16px 0", color:"#94a3b8", fontSize:13 }}>No grooming logged yet</div>}
              {grooming.slice(0,15).map((g,i)=><LogItem key={g.id||i} icon="✂️" primary={g.type} secondary={g.note} time={formatTime(g.created_at)} by={`by ${g.logged_by}`} onDelete={()=>confirmDelete("Delete this grooming log?", ()=>deleteGrooming(g.id))} />)}
            </Card>
          </div>
        )}

        {/* ── NOTIFICATIONS ── */}
        {tab==="notifications" && (
          <div>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:6 }}>🔔 Push notifications</div>
              <div style={{ fontSize:12, color:"#94a3b8", marginBottom:14, lineHeight:1.6 }}>
                Get notified when Barney is fed, walked, or when treatments are due — even when the app is closed. Each person needs to enable notifications on their own device.
              </div>
              {pushStatus === "denied" && (
                <div style={{ background:"#fef2f2", borderRadius:10, padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:"#ef4444" }}>⚠️ Notifications blocked</div>
                  <div style={{ fontSize:11, color:"#94a3b8", marginTop:4 }}>Go to iPhone Settings → Safari → Notifications and allow notifications for this site, then reload the app.</div>
                </div>
              )}
              {pushStatus === "granted" ? (
                <div style={{ background:"#f0fdf4", borderRadius:10, padding:"12px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20 }}>✅</span>
                  <div><div style={{ fontSize:12, fontWeight:600, color:"#10b981" }}>Notifications enabled on this device</div><div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>You'll receive alerts for this device</div></div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, marginBottom:4 }}>Your name (so others know it's your device)</div>
                  <Input placeholder="e.g. Jack's iPhone" value={deviceName} onChange={e=>setDeviceName(e.target.value)} />
                  <Btn onClick={subscribePush} disabled={pushStatus==="requesting"}>
                    {pushStatus==="requesting" ? "Requesting permission…" : "🔔 Enable notifications on this device"}
                  </Btn>
                </div>
              )}
              {pushStatus==="granted" && (
                <Btn onClick={testPush} variant="secondary" style={{ marginTop:8 }}>Send a test notification</Btn>
              )}
            </Card>

            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:4 }}>What you'll be notified about</div>
              <div style={{ fontSize:12, color:"#94a3b8", marginBottom:12 }}>Notifications fire automatically — no settings needed</div>
              {[
                { icon:"🍽️", title:"Barney has been fed",     desc:"Every time a meal is logged" },
                { icon:"💧", title:"Toilet trips",             desc:"Every wee and poo logged" },
                { icon:"🦮", title:"Walk logged",              desc:"Every walk or daycare day" },
                { icon:"🥫", title:"Food running low",         desc:"When stock drops below your alert level" },
                { icon:"🐛", title:"Flea treatment due",       desc:"When 28 days have passed" },
                { icon:"🪱", title:"Worming due",              desc:"When 90 days have passed" },
                { icon:"🍽️", title:"Not fed in 6 hours",      desc:"Checked automatically" },
                { icon:"🦮", title:"Not walked in 8 hours",   desc:"Checked automatically" },
              ].map((n,i)=>(
                <div key={i} style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:"1px solid #f1f5f9" }}>
                  <span style={{ fontSize:18, flexShrink:0 }}>{n.icon}</span>
                  <div><div style={{ fontSize:12, fontWeight:600, color:"#1e293b" }}>{n.title}</div><div style={{ fontSize:11, color:"#94a3b8" }}>{n.desc}</div></div>
                </div>
              ))}
            </Card>

            <SectionTitle>Devices with notifications enabled</SectionTitle>
            {pushSubs.length===0
              ? <Card><div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"8px 0" }}>No devices enabled yet</div></Card>
              : <Card>{pushSubs.map((s,i)=><LogItem key={s.id||i} icon="📱" primary={s.device_name} secondary={`Added ${formatDate(s.created_at?.slice(0,10))}`} time="" by="" onDelete={()=>confirmDelete(`Remove ${s.device_name}?`, ()=>deleteSub(s.id))} />)}</Card>
            }

            <Card style={{ background:"#f8fafc" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", marginBottom:6 }}>💡 Important</div>
              <div style={{ fontSize:12, color:"#64748b", lineHeight:1.6 }}>Notifications only work when the app is added to your home screen (not just opened in Safari). Each of the three of you needs to enable notifications separately on your own phone.</div>
            </Card>
          </div>
        )}

        {/* ── INFO ── */}
        {tab==="info" && (
          <div>
            {!editingInfo?(
              <Card>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#1e293b" }}>📋 Barney's Info</div>
                  <Btn onClick={()=>{setInfoEdit({...info});setEditingInfo(true);}} style={{ width:"auto", padding:"6px 14px", borderRadius:20, fontSize:12 }}>Edit</Btn>
                </div>
                {[{label:"Microchip",icon:"🔖",val:info.microchip},{label:"Vet practice",icon:"🏥",val:info.vet},{label:"Vet phone",icon:"📞",val:info.vet_phone,link:`tel:${info.vet_phone}`},{label:"Insurance",icon:"📄",val:info.insurance},{label:"Emergency contact",icon:"🚨",val:info.emergency_name},{label:"Emergency phone",icon:"📞",val:info.emergency_phone,link:`tel:${info.emergency_phone}`}].map(({label,icon,val,link})=>(
                  <div key={label} style={{ padding:"10px 0", borderBottom:"1px solid #f1f5f9", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5, marginBottom:2 }}>{icon} {label}</div>
                      <div style={{ fontSize:13, fontWeight:val?600:400, color:val?"#1e293b":"#cbd5e1" }}>{val||"Not set"}</div>
                    </div>
                    {val&&link&&<a href={link} style={{ background:"#1a1a2e", color:"#fff", padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, textDecoration:"none" }}>Call</a>}
                  </div>
                ))}
                {info.notes&&<div style={{ marginTop:12 }}><div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>📝 Notes</div><div style={{ fontSize:13, color:"#334155", lineHeight:1.5 }}>{info.notes}</div></div>}
              </Card>
            ):(
              <Card>
                <div style={{ fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:14 }}>Edit Info</div>
                {[{key:"microchip",label:"Microchip number"},{key:"vet",label:"Vet practice name"},{key:"vet_phone",label:"Vet phone number"},{key:"insurance",label:"Insurance provider"},{key:"emergency_name",label:"Emergency contact name"},{key:"emergency_phone",label:"Emergency contact phone"}].map(({key,label})=>(
                  <div key={key}><div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, marginBottom:3 }}>{label}</div><Input value={infoEdit[key]||""} onChange={e=>setInfoEdit(p=>({...p,[key]:e.target.value}))} /></div>
                ))}
                <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600, marginBottom:3 }}>Notes</div>
                <textarea value={infoEdit.notes||""} onChange={e=>setInfoEdit(p=>({...p,notes:e.target.value}))} style={{ width:"100%", padding:"10px 14px", borderRadius:10, border:"1.5px solid #e2e8f0", fontSize:13, background:"#f8fafc", marginBottom:10, boxSizing:"border-box", outline:"none", fontFamily:"inherit", height:80, resize:"vertical" }} />
                <div style={{ display:"flex", gap:8 }}>
                  <Btn onClick={saveInfo} style={{ flex:1 }}>Save</Btn>
                  <Btn variant="secondary" onClick={()=>setEditingInfo(false)} style={{ flex:1 }}>Cancel</Btn>
                </div>
              </Card>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
