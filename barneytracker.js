import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const USERS = ["Jack", "Jakey", "Mum"];
const STORAGE_KEYS = {
  feeding: "barney_feeding_log",
  toilet: "barney_toilet_log",
  food: "barney_food_stock",
  treatments: "barney_treatments",
  calendar: "barney_calendar_v2",
  weight: "barney_weight_log",
  walks: "barney_walks_log",
  meds: "barney_meds_log",
  behaviour: "barney_behaviour_log",
  vetAppts: "barney_vet_appts",
  info: "barney_info_card",
  photos: "barney_photos",
  foodAlert: "barney_food_alert",
};

const LOCATIONS = [
  { id: "home",      label: "Home",            icon: "🏠", color: "#7C9E87" },
  { id: "mum",       label: "Mum's house",     icon: "👵", color: "#C4845A" },
  { id: "jakey",     label: "Jakey's flat",    icon: "👨", color: "#5A7EC4" },
  { id: "daycare",   label: "Doggy daycare",   icon: "🐾", color: "#A05AC4" },
  { id: "walk",      label: "On a walk",       icon: "🦮", color: "#C4A85A" },
];
const LOC_MAP = Object.fromEntries(LOCATIONS.map(l => [l.id, l]));

const BEHAVIOUR_TYPES = ["Limping","Not eating","Scratching","Vomiting","Lethargy","Unusual behaviour","Other"];

async function storageGet(key) {
  try { const r = await window.storage.get(key, true); return r ? JSON.parse(r.value) : null; } catch { return null; }
}
async function storageSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value), true); } catch {}
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function dateStr(d) { return d.toISOString().slice(0, 10); }
function formatTime(iso) {
  const d = new Date(iso), today = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const days = Math.floor((today - d) / 86400000);
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + time;
}
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}
function daysSince(iso) { if (!iso) return null; return Math.floor((Date.now() - new Date(iso)) / 86400000); }
function getWeekDates(anchor) {
  const d = new Date(anchor), day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x; });
}
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function BarneyApp() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("home");
  const [loading, setLoading] = useState(true);

  // Data
  const [feeding, setFeeding] = useState([]);
  const [toilet, setToilet] = useState([]);
  const [food, setFood] = useState({ pouches: 0 });
  const [foodAlert, setFoodAlert] = useState(5);
  const [treatments, setTreatments] = useState({ flea: null, worm: null });
  const [calendar, setCalendar] = useState({});
  const [weight, setWeight] = useState([]);
  const [walks, setWalks] = useState([]);
  const [meds, setMeds] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [vetAppts, setVetAppts] = useState([]);
  const [info, setInfo] = useState({ microchip:"", vet:"", vetPhone:"", insurance:"", emergencyName:"", emergencyPhone:"", notes:"" });
  const [photos, setPhotos] = useState([]);

  // UI state - calendar
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(todayStr());
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newLoc, setNewLoc] = useState("home");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [newEventNote, setNewEventNote] = useState("");
  const [allDay, setAllDay] = useState(false);

  // UI state - feeding
  const [feedNote, setFeedNote] = useState("");
  const [feedAmount, setFeedAmount] = useState("Full portion");

  // UI state - walks
  const [walkDuration, setWalkDuration] = useState("30");
  const [walkDistance, setWalkDistance] = useState("");
  const [walkNote, setWalkNote] = useState("");

  // UI state - weight
  const [newWeight, setNewWeight] = useState("");

  // UI state - meds
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  const [medNote, setMedNote] = useState("");

  // UI state - behaviour
  const [behavType, setBehavType] = useState(BEHAVIOUR_TYPES[0]);
  const [behavNote, setBehavNote] = useState("");

  // UI state - vet
  const [vetDate, setVetDate] = useState("");
  const [vetReason, setVetReason] = useState("");
  const [vetNotes, setVetNotes] = useState("");
  const [vetIsUpcoming, setVetIsUpcoming] = useState(true);

  // UI state - info editing
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoEdit, setInfoEdit] = useState({});

  // UI state - photo
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoData, setPhotoData] = useState(null);

  useEffect(() => {
    async function load() {
      const results = await Promise.all(Object.values(STORAGE_KEYS).map(k => storageGet(k)));
      const keys = Object.keys(STORAGE_KEYS);
      const map = {};
      keys.forEach((k, i) => { map[k] = results[i]; });
      if (map.feeding) setFeeding(map.feeding);
      if (map.toilet) setToilet(map.toilet);
      if (map.food) setFood(map.food);
      if (map.foodAlert) setFoodAlert(map.foodAlert);
      if (map.treatments) setTreatments(map.treatments);
      if (map.calendar) setCalendar(map.calendar);
      if (map.weight) setWeight(map.weight);
      if (map.walks) setWalks(map.walks);
      if (map.meds) setMeds(map.meds);
      if (map.behaviour) setBehaviour(map.behaviour);
      if (map.vetAppts) setVetAppts(map.vetAppts);
      if (map.info) setInfo(map.info);
      if (map.photos) setPhotos(map.photos);
      setLoading(false);
    }
    load();
  }, []);

  // ── ACTIONS ──
  const saveCal = async (u) => { setCalendar(u); await storageSet(STORAGE_KEYS.calendar, u); };

  const addEvent = async () => {
    const entry = { id: Date.now().toString(), locationId: newLoc, startTime: allDay ? null : newStart, endTime: allDay ? null : newEnd, allDay, note: newEventNote, addedBy: user };
    const updated = { ...calendar, [selectedDay]: [...(calendar[selectedDay] || []), entry] };
    await saveCal(updated); setShowAddEvent(false); setNewEventNote(""); setAllDay(false);
  };
  const deleteEvent = async (day, id) => {
    const updated = { ...calendar, [day]: (calendar[day] || []).filter(e => e.id !== id) };
    await saveCal(updated);
  };

  const logFeed = async () => {
    const entry = { time: new Date().toISOString(), user, amount: feedAmount, note: feedNote };
    const updated = [entry, ...feeding].slice(0, 100);
    setFeeding(updated); setFeedNote(""); await storageSet(STORAGE_KEYS.feeding, updated);
  };
  const logToilet = async (type) => {
    const entry = { time: new Date().toISOString(), user, type };
    const updated = [entry, ...toilet].slice(0, 200);
    setToilet(updated); await storageSet(STORAGE_KEYS.toilet, updated);
  };
  const updateFood = async (delta) => {
    const updated = { ...food, pouches: Math.max(0, food.pouches + delta) };
    setFood(updated); await storageSet(STORAGE_KEYS.food, updated);
  };
  const setFoodManually = async (val) => {
    const updated = { ...food, pouches: Math.max(0, parseInt(val) || 0) };
    setFood(updated); await storageSet(STORAGE_KEYS.food, updated);
  };
  const logTreatment = async (type) => {
    const updated = { ...treatments, [type]: { date: new Date().toISOString(), user } };
    setTreatments(updated); await storageSet(STORAGE_KEYS.treatments, updated);
  };
  const logWalk = async () => {
    const entry = { time: new Date().toISOString(), user, duration: walkDuration, distance: walkDistance, note: walkNote };
    const updated = [entry, ...walks].slice(0, 100);
    setWalks(updated); setWalkNote(""); setWalkDistance(""); await storageSet(STORAGE_KEYS.walks, updated);
  };
  const logWeight = async () => {
    if (!newWeight) return;
    const entry = { date: todayStr(), weight: parseFloat(newWeight), user };
    const updated = [...weight, entry].slice(-50);
    setWeight(updated); setNewWeight(""); await storageSet(STORAGE_KEYS.weight, updated);
  };
  const logMed = async () => {
    if (!medName) return;
    const entry = { time: new Date().toISOString(), user, name: medName, dose: medDose, note: medNote };
    const updated = [entry, ...meds].slice(0, 100);
    setMeds(updated); setMedName(""); setMedDose(""); setMedNote(""); await storageSet(STORAGE_KEYS.meds, updated);
  };
  const logBehaviour = async () => {
    const entry = { time: new Date().toISOString(), user, type: behavType, note: behavNote };
    const updated = [entry, ...behaviour].slice(0, 100);
    setBehaviour(updated); setBehavNote(""); await storageSet(STORAGE_KEYS.behaviour, updated);
  };
  const addVetAppt = async () => {
    if (!vetDate || !vetReason) return;
    const entry = { id: Date.now().toString(), date: vetDate, reason: vetReason, notes: vetNotes, upcoming: vetIsUpcoming, addedBy: user };
    const updated = [entry, ...vetAppts].slice(0, 50);
    setVetAppts(updated); setVetDate(""); setVetReason(""); setVetNotes(""); await storageSet(STORAGE_KEYS.vetAppts, updated);
  };
  const deleteVetAppt = async (id) => {
    const updated = vetAppts.filter(a => a.id !== id);
    setVetAppts(updated); await storageSet(STORAGE_KEYS.vetAppts, updated);
  };
  const saveInfo = async () => {
    setInfo(infoEdit); setEditingInfo(false); await storageSet(STORAGE_KEYS.info, infoEdit);
  };
  const handlePhotoUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoData(ev.target.result);
    reader.readAsDataURL(file);
  };
  const savePhoto = async () => {
    if (!photoData) return;
    const entry = { id: Date.now().toString(), date: todayStr(), data: photoData, caption: photoCaption, addedBy: user };
    const updated = [entry, ...photos].slice(0, 30);
    setPhotos(updated); setPhotoData(null); setPhotoCaption(""); await storageSet(STORAGE_KEYS.photos, updated);
  };
  const deletePhoto = async (id) => {
    const updated = photos.filter(p => p.id !== id);
    setPhotos(updated); await storageSet(STORAGE_KEYS.photos, updated);
  };

  // ── LOADING / LOGIN ──
  if (loading) return <div style={S.splash}><div style={{fontSize:64}}>🐕</div><div style={{color:"#8B6A55"}}>Loading Barney's tracker...</div></div>;

  if (!user) return (
    <div style={S.splash}>
      <div style={{fontSize:72}}>🐾</div>
      <h1 style={{fontSize:32,fontWeight:"bold",color:"#3D2B1F",margin:0}}>Barney's Tracker</h1>
      <p style={{color:"#8B6A55",fontSize:17,margin:0}}>Who are you?</p>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center",marginTop:8}}>
        {USERS.map(u => (
          <button key={u} style={S.userBtn} onClick={() => setUser(u)}>
            <span style={{fontSize:38}}>{u==="Jack"?"👩":u==="Jakey"?"👨":"👵"}</span>
            <span>{u}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // Computed values
  const lastFeed = feeding[0];
  const lastWee = toilet.find(t => t.type === "wee");
  const fleaDays = daysSince(treatments.flea?.date);
  const wormDays = daysSince(treatments.worm?.date);
  const weekDates = getWeekDates(weekAnchor);
  const todayKey = todayStr();
  const nowTime = new Date().toTimeString().slice(0,5);
  const currentEvents = (calendar[todayKey]||[]).filter(e => e.allDay || (e.startTime <= nowTime && nowTime <= (e.endTime||"23:59")));
  const currentLoc = currentEvents.length > 0 ? LOC_MAP[currentEvents[currentEvents.length-1].locationId] : null;
  const todayEvents = (calendar[selectedDay]||[]).sort((a,b)=>(a.startTime||"00:00").localeCompare(b.startTime||"00:00"));
  const upcomingVet = vetAppts.filter(a => a.upcoming && a.date >= todayKey).sort((a,b)=>a.date.localeCompare(b.date));
  const latestWeight = weight.length > 0 ? weight[weight.length-1] : null;
  const todayWalks = walks.filter(w => w.time.slice(0,10) === todayKey);
  const todayWalkMins = todayWalks.reduce((sum,w) => sum + (parseInt(w.duration)||0), 0);

  const tabs = [
    { id:"home",     label:"Home",    icon:"🏠" },
    { id:"calendar", label:"Where",   icon:"📅" },
    { id:"feed",     label:"Feeding", icon:"🍽️" },
    { id:"toilet",   label:"Toilet",  icon:"🌿" },
    { id:"walks",    label:"Walks",   icon:"🦮" },
    { id:"health",   label:"Health",  icon:"💊" },
    { id:"vet",      label:"Vet",     icon:"🏥" },
    { id:"info",     label:"Info",    icon:"📋" },
    { id:"photos",   label:"Photos",  icon:"📸" },
  ];

  return (
    <div style={S.app}>
      {/* Header */}
      <div style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:34}}>🐕</span>
          <div>
            <div style={{fontSize:20,fontWeight:"bold"}}>Barney</div>
            {currentLoc
              ? <div style={{fontSize:11,opacity:0.85}}>{currentLoc.icon} {currentLoc.label} right now</div>
              : <div style={{fontSize:11,opacity:0.7}}>Hi {user}! 👋</div>}
          </div>
        </div>
        <button style={S.switchBtn} onClick={()=>setUser(null)}>Switch</button>
      </div>

      {/* Alert banner */}
      {(food.pouches <= foodAlert || fleaDays >= 28 || wormDays >= 90 || upcomingVet.length > 0) && (
        <div style={S.alertBar}>
          {food.pouches <= foodAlert && <span>🥫 Food running low!</span>}
          {fleaDays >= 28 && <span>🐛 Flea treatment due!</span>}
          {wormDays >= 90 && <span>🪱 Worming due!</span>}
          {upcomingVet.length > 0 && <span>🏥 Vet: {upcomingVet[0].reason} on {formatDate(upcomingVet[0].date)}</span>}
        </div>
      )}

      {/* Tab bar — scrollable */}
      <div style={S.tabBar}>
        {tabs.map(t => (
          <button key={t.id} style={{...S.tabBtn,...(tab===t.id?S.tabActive:{})}} onClick={()=>setTab(t.id)}>
            <span>{t.icon}</span>
            <span style={{fontSize:8,fontWeight:"bold",letterSpacing:0.3,textTransform:"uppercase"}}>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={S.content}>

        {/* ── HOME TAB ── */}
        {tab === "home" && (
          <div>
            <div style={{...S.card, background:"#3D2B1F", color:"#FDF8F3"}}>
              <div style={{fontSize:13,opacity:0.7,marginBottom:4}}>Barney is currently</div>
              {currentLoc
                ? <div style={{fontSize:22,fontWeight:"bold"}}>{currentLoc.icon} {currentLoc.label}</div>
                : <div style={{fontSize:18,opacity:0.7}}>📍 No location set for now</div>}
              <div style={{fontSize:12,opacity:0.6,marginTop:4}}>{new Date().toLocaleDateString([],{weekday:"long",day:"numeric",month:"long"})}</div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              {[
                { icon:"🍽️", label:"Last fed", val: lastFeed ? formatTime(lastFeed.time) : "Not logged", sub: lastFeed?.amount },
                { icon:"💧", label:"Last wee",  val: lastWee  ? formatTime(lastWee.time)  : "Not logged" },
                { icon:"🥫", label:"Food stock", val: `${food.pouches} pouches`, sub: food.pouches <= foodAlert ? "⚠️ Running low!" : null, subColor:"#e74c3c" },
                { icon:"🦮", label:"Walked today", val: todayWalkMins > 0 ? `${todayWalkMins} mins` : "Not yet", sub: todayWalks.length > 0 ? `${todayWalks.length} walk${todayWalks.length>1?"s":""}` : null },
              ].map((s,i)=>(
                <div key={i} style={{...S.card,marginBottom:0,padding:"14px 16px"}}>
                  <div style={{fontSize:22,marginBottom:4}}>{s.icon}</div>
                  <div style={{fontSize:11,color:"#8B6A55",fontWeight:"bold",textTransform:"uppercase",letterSpacing:0.5}}>{s.label}</div>
                  <div style={{fontSize:13,fontWeight:"bold",color:"#3D2B1F",marginTop:2}}>{s.val}</div>
                  {s.sub && <div style={{fontSize:11,color:s.subColor||"#8B6A55",marginTop:1}}>{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* Treatment countdowns */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Treatment countdown</h3>
              {[{key:"flea",label:"Flea",days:fleaDays,cycle:28},{key:"worm",label:"Worming",days:wormDays,cycle:90}].map(({key,label,days,cycle})=>(
                <div key={key} style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:13,color:"#3D2B1F",fontWeight:"bold"}}>{label} treatment</span>
                    <span style={{fontSize:13,fontWeight:"bold",color:days===null?"#ccc":days>=cycle?"#e74c3c":days>=cycle*0.75?"#f39c12":"#27ae60"}}>
                      {days===null?"Not logged":days>=cycle?"Due now!": `${cycle-days} days left`}
                    </span>
                  </div>
                  <div style={{height:6,background:"#EDE0D4",borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:3,width:`${days===null?0:Math.min(100,(days/cycle)*100)}%`,background:days>=cycle?"#e74c3c":days>=cycle*0.75?"#f39c12":"#27ae60"}} />
                  </div>
                </div>
              ))}
            </div>

            {latestWeight && (
              <div style={{...S.card,marginBottom:12}}>
                <h3 style={S.cardTitle}>Latest weight</h3>
                <div style={{fontSize:32,fontWeight:"bold",color:"#3D2B1F"}}>{latestWeight.weight} <span style={{fontSize:16,color:"#8B6A55"}}>kg</span></div>
                <div style={{fontSize:12,color:"#8B6A55"}}>logged {formatDate(latestWeight.date)} by {latestWeight.user}</div>
              </div>
            )}
          </div>
        )}

        {/* ── CALENDAR TAB ── */}
        {tab === "calendar" && (
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <button style={S.navBtn} onClick={()=>setWeekAnchor(d=>{const x=new Date(d);x.setDate(x.getDate()-7);return x;})}>‹</button>
              <span style={{fontWeight:"bold",color:"#3D2B1F",fontSize:13}}>
                {weekDates[0].toLocaleDateString([],{day:"numeric",month:"short"})} – {weekDates[6].toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"})}
              </span>
              <button style={S.navBtn} onClick={()=>setWeekAnchor(d=>{const x=new Date(d);x.setDate(x.getDate()+7);return x;})}>›</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:14}}>
              {weekDates.map((d,i)=>{
                const ds=dateStr(d), isToday=ds===todayStr(), isSel=ds===selectedDay;
                const events=calendar[ds]||[];
                const topLoc=events.length>0?LOC_MAP[events[events.length-1].locationId]:null;
                return (
                  <button key={ds} style={{...S.dayCell,...(isSel?S.dayCellSel:{}),...(isToday&&!isSel?S.dayCellToday:{})}} onClick={()=>setSelectedDay(ds)}>
                    <span style={{fontSize:9,color:isSel?"#fff":"#8B6A55",fontWeight:"bold"}}>{DAY_LABELS[i]}</span>
                    <span style={{fontSize:14,fontWeight:"bold",color:isSel?"#fff":"#3D2B1F"}}>{d.getDate()}</span>
                    <span style={{fontSize:12}}>{topLoc?topLoc.icon:"·"}</span>
                  </button>
                );
              })}
            </div>

            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
              {LOCATIONS.map(l=>(
                <div key={l.id} style={{display:"flex",alignItems:"center",gap:3,background:l.color+"22",border:`1px solid ${l.color}66`,borderRadius:20,padding:"2px 8px",fontSize:10,color:l.color,fontWeight:"bold"}}>
                  {l.icon} {l.label}
                </div>
              ))}
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <h3 style={{margin:0,color:"#3D2B1F",fontSize:14,fontWeight:"bold"}}>
                {new Date(selectedDay+"T12:00:00").toLocaleDateString([],{weekday:"long",day:"numeric",month:"long"})}
              </h3>
              <button style={S.addBtn} onClick={()=>setShowAddEvent(true)}>+ Add</button>
            </div>

            {todayEvents.length===0&&<div style={S.empty}>Nothing planned — tap + Add</div>}
            {todayEvents.map(ev=>{
              const loc=LOC_MAP[ev.locationId];
              return (
                <div key={ev.id} style={{...S.eventCard,borderLeft:`4px solid ${loc.color}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                    <span style={{fontSize:22}}>{loc.icon}</span>
                    <div>
                      <div style={{fontWeight:"bold",color:"#3D2B1F",fontSize:13}}>{loc.label}</div>
                      <div style={{fontSize:11,color:"#8B6A55"}}>{ev.allDay?"All day":`${ev.startTime} – ${ev.endTime}`} · by {ev.addedBy}</div>
                      {ev.note&&<div style={{fontSize:11,color:"#6B4F3A",marginTop:2}}>📝 {ev.note}</div>}
                    </div>
                  </div>
                  <button style={S.delBtn} onClick={()=>deleteEvent(selectedDay,ev.id)}>✕</button>
                </div>
              );
            })}

            {showAddEvent&&(
              <div style={S.modalOverlay} onClick={()=>setShowAddEvent(false)}>
                <div style={S.modal} onClick={e=>e.stopPropagation()}>
                  <h3 style={{margin:"0 0 14px",color:"#3D2B1F",fontSize:16}}>Add event</h3>
                  <div style={{fontSize:12,color:"#8B6A55",marginBottom:6,fontWeight:"bold"}}>Where is Barney?</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                    {LOCATIONS.map(l=>(
                      <button key={l.id} style={{...S.locBtn,...(newLoc===l.id?{background:l.color,color:"#fff",borderColor:l.color}:{})}} onClick={()=>setNewLoc(l.id)}>
                        <span style={{fontSize:18}}>{l.icon}</span><span style={{fontSize:11}}>{l.label}</span>
                      </button>
                    ))}
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#3D2B1F",marginBottom:12,cursor:"pointer"}}>
                    <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All day
                  </label>
                  {!allDay&&(
                    <div style={{display:"flex",gap:10,marginBottom:12}}>
                      <div style={{flex:1}}><div style={{fontSize:11,color:"#8B6A55",marginBottom:4}}>From</div><input type="time" style={S.timeInput} value={newStart} onChange={e=>setNewStart(e.target.value)} /></div>
                      <div style={{flex:1}}><div style={{fontSize:11,color:"#8B6A55",marginBottom:4}}>Until</div><input type="time" style={S.timeInput} value={newEnd} onChange={e=>setNewEnd(e.target.value)} /></div>
                    </div>
                  )}
                  <input style={S.input} placeholder="Notes (optional)" value={newEventNote} onChange={e=>setNewEventNote(e.target.value)} />
                  <div style={{display:"flex",gap:8}}>
                    <button style={{...S.primaryBtn,flex:1}} onClick={addEvent}>Save</button>
                    <button style={{...S.primaryBtn,flex:1,background:"#EDE0D4",color:"#3D2B1F"}} onClick={()=>setShowAddEvent(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FEEDING TAB ── */}
        {tab === "feed" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Log a meal</h3>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                {["Full portion","Half portion","Treat only"].map(a=>(
                  <button key={a} style={{...S.chipBtn,...(feedAmount===a?S.chipActive:{})}} onClick={()=>setFeedAmount(a)}>{a}</button>
                ))}
              </div>
              <input style={S.input} placeholder="Notes? (e.g. ate slowly)" value={feedNote} onChange={e=>setFeedNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logFeed}>🍽️ Log meal</button>
            </div>

            <div style={S.card}>
              <h3 style={S.cardTitle}>Food cupboard</h3>
              <div style={{textAlign:"center",padding:"8px 0 16px"}}>
                <div style={{fontSize:56,fontWeight:"bold",color:food.pouches<=foodAlert?"#e74c3c":food.pouches<=foodAlert*2?"#f39c12":"#27ae60"}}>{food.pouches}</div>
                <div style={{color:"#8B6A55",fontSize:14}}>pouches remaining</div>
                {food.pouches<=foodAlert&&<div style={{color:"#e74c3c",fontWeight:"bold",marginTop:6,fontSize:13}}>⚠️ Running low — time to restock!</div>}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                {[[-1,"−1"],[-3,"−3"]].map(([d,l])=><button key={l} style={S.countBtn} onClick={()=>updateFood(d)}>{l}</button>)}
                {[[12,"+12"],[24,"+24"]].map(([d,l])=><button key={l} style={{...S.countBtn,background:"#27ae60",color:"#fff"}} onClick={()=>updateFood(d)}>{l}</button>)}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{color:"#888",fontSize:12}}>Set exact:</span>
                <input type="number" style={{...S.input,width:70,marginBottom:0,padding:"8px 10px"}} value={food.pouches} onChange={e=>setFoodManually(e.target.value)} />
                <span style={{color:"#888",fontSize:12,marginLeft:8}}>Alert at:</span>
                <input type="number" style={{...S.input,width:50,marginBottom:0,padding:"8px 10px"}} value={foodAlert} onChange={e=>{const v=parseInt(e.target.value)||0;setFoodAlert(v);storageSet(STORAGE_KEYS.foodAlert,v);}} />
              </div>
            </div>

            <h3 style={S.sectionTitle}>Recent meals</h3>
            {feeding.length===0&&<div style={S.empty}>No meals logged yet</div>}
            {feeding.slice(0,15).map((f,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20}}>🍽️</span>
                  <div><div style={S.logPrimary}>{f.amount}</div>{f.note&&<div style={S.logNote}>{f.note}</div>}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(f.time)}</div><div style={S.logUser}>by {f.user}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* ── TOILET TAB ── */}
        {tab === "toilet" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Log toilet trip</h3>
              <div style={{display:"flex",gap:12,marginBottom:12}}>
                <button style={{...S.bigBtn,background:"#3D7EA6"}} onClick={()=>logToilet("wee")}><span style={{fontSize:30}}>💧</span>Wee</button>
                <button style={{...S.bigBtn,background:"#6B4F3A"}} onClick={()=>logToilet("poo")}><span style={{fontSize:30}}>💩</span>Poo</button>
              </div>
            </div>
            <h3 style={S.sectionTitle}>Recent trips</h3>
            {toilet.length===0&&<div style={S.empty}>No trips logged yet</div>}
            {toilet.slice(0,20).map((t,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20}}>{t.type==="wee"?"💧":"💩"}</span>
                  <div style={S.logPrimary}>{t.type==="wee"?"Wee":"Poo"}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(t.time)}</div><div style={S.logUser}>by {t.user}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* ── WALKS TAB ── */}
        {tab === "walks" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Log a walk</h3>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                {["15","20","30","45","60","90"].map(m=>(
                  <button key={m} style={{...S.chipBtn,...(walkDuration===m?S.chipActive:{})}} onClick={()=>setWalkDuration(m)}>{m} min</button>
                ))}
              </div>
              <input style={S.input} placeholder="Distance (e.g. 2km) — optional" value={walkDistance} onChange={e=>setWalkDistance(e.target.value)} />
              <input style={S.input} placeholder="Notes (e.g. ran off lead in the park)" value={walkNote} onChange={e=>setWalkNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logWalk}>🦮 Log walk</button>
            </div>
            <div style={{...S.card,marginTop:0}}>
              <h3 style={S.cardTitle}>Today's walks</h3>
              {todayWalks.length===0
                ? <div style={S.empty}>No walks yet today</div>
                : <><div style={{fontSize:28,fontWeight:"bold",color:"#3D2B1F"}}>{todayWalkMins} <span style={{fontSize:14,color:"#8B6A55"}}>mins total</span></div>
                  {todayWalks.map((w,i)=><div key={i} style={{fontSize:13,color:"#6B4F3A",marginTop:4}}>· {w.duration} min{w.distance?` · ${w.distance}`:""} by {w.user}{w.note?` — ${w.note}`:""}</div>)}
                </>}
            </div>
            <h3 style={S.sectionTitle}>Recent walks</h3>
            {walks.length===0&&<div style={S.empty}>No walks logged yet</div>}
            {walks.slice(0,15).map((w,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20}}>🦮</span>
                  <div><div style={S.logPrimary}>{w.duration} min{w.distance?` · ${w.distance}`:""}</div>{w.note&&<div style={S.logNote}>{w.note}</div>}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(w.time)}</div><div style={S.logUser}>by {w.user}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* ── HEALTH TAB ── */}
        {tab === "health" && (
          <div>
            {/* Treatments */}
            {[{key:"flea",label:"Flea treatment",icon:"🐛",days:fleaDays,cycle:28},{key:"worm",label:"Worming",icon:"🪱",days:wormDays,cycle:90}].map(({key,label,icon,days,cycle})=>(
              <div key={key} style={S.card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div><h3 style={S.cardTitle}>{icon} {label}</h3>
                    <div style={{color:"#8B6A55",fontSize:12}}>{treatments[key]?`Last done ${days===0?"today":`${days} day${days!==1?"s":""} ago`} by ${treatments[key].user}`:"Not yet logged"}</div>
                  </div>
                  <div style={{borderRadius:20,padding:"5px 12px",color:"#fff",fontWeight:"bold",fontSize:12,background:days===null?"#ccc":days>=cycle?"#e74c3c":days>=cycle*0.75?"#f39c12":"#27ae60"}}>
                    {days===null?"?":days>=cycle?"Due!": `${cycle-days}d`}
                  </div>
                </div>
                {days!==null&&days<cycle&&<div style={{height:6,background:"#EDE0D4",borderRadius:3,marginBottom:12,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,width:`${Math.min(100,(days/cycle)*100)}%`,background:days>=cycle*0.75?"#f39c12":"#27ae60"}} /></div>}
                <button style={S.primaryBtn} onClick={()=>logTreatment(key)}>✅ Mark {key} treatment done</button>
              </div>
            ))}

            {/* Medication log */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>💊 Medication log</h3>
              <input style={S.input} placeholder="Medicine name" value={medName} onChange={e=>setMedName(e.target.value)} />
              <input style={S.input} placeholder="Dose (e.g. 1 tablet, 5ml)" value={medDose} onChange={e=>setMedDose(e.target.value)} />
              <input style={S.input} placeholder="Notes (optional)" value={medNote} onChange={e=>setMedNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logMed}>+ Log medication</button>
              {meds.slice(0,5).map((m,i)=>(
                <div key={i} style={{...S.logItem,marginTop:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>💊</span>
                    <div><div style={S.logPrimary}>{m.name}{m.dose?` · ${m.dose}`:""}</div>{m.note&&<div style={S.logNote}>{m.note}</div>}</div>
                  </div>
                  <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(m.time)}</div><div style={S.logUser}>by {m.user}</div></div>
                </div>
              ))}
            </div>

            {/* Weight tracker */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>⚖️ Weight tracker</h3>
              <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
                <input type="number" step="0.1" style={{...S.input,flex:1,marginBottom:0}} placeholder="Weight in kg" value={newWeight} onChange={e=>setNewWeight(e.target.value)} />
                <button style={{...S.primaryBtn,width:"auto",padding:"10px 16px",whiteSpace:"nowrap"}} onClick={logWeight}>Log</button>
              </div>
              {weight.length > 1 && (
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={weight}>
                    <XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={d=>d.slice(5)} />
                    <YAxis tick={{fontSize:9}} domain={["auto","auto"]} width={30} />
                    <Tooltip formatter={(v)=>[`${v}kg`,"Weight"]} labelStyle={{fontSize:11}} contentStyle={{fontSize:11}} />
                    <Line type="monotone" dataKey="weight" stroke="#3D2B1F" strokeWidth={2} dot={{r:3}} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {weight.slice(-5).reverse().map((w,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6B4F3A",padding:"4px 0",borderBottom:"1px solid #EDE0D4"}}>
                  <span>{formatDate(w.date)}</span><span style={{fontWeight:"bold"}}>{w.weight} kg</span><span>{w.user}</span>
                </div>
              ))}
            </div>

            {/* Behaviour log */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>🔍 Behaviour notes</h3>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {BEHAVIOUR_TYPES.map(b=>(
                  <button key={b} style={{...S.chipBtn,fontSize:11,padding:"5px 10px",...(behavType===b?S.chipActive:{})}} onClick={()=>setBehavType(b)}>{b}</button>
                ))}
              </div>
              <input style={S.input} placeholder="More details..." value={behavNote} onChange={e=>setBehavNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logBehaviour}>+ Log behaviour note</button>
              {behaviour.slice(0,5).map((b,i)=>(
                <div key={i} style={{...S.logItem,marginTop:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                    <span style={{fontSize:18}}>🔍</span>
                    <div><div style={S.logPrimary}>{b.type}</div>{b.note&&<div style={S.logNote}>{b.note}</div>}</div>
                  </div>
                  <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(b.time)}</div><div style={S.logUser}>by {b.user}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── VET TAB ── */}
        {tab === "vet" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Add vet appointment</h3>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <button style={{...S.chipBtn,...(vetIsUpcoming?S.chipActive:{})}} onClick={()=>setVetIsUpcoming(true)}>Upcoming</button>
                <button style={{...S.chipBtn,...(!vetIsUpcoming?S.chipActive:{})}} onClick={()=>setVetIsUpcoming(false)}>Past visit</button>
              </div>
              <input type="date" style={S.input} value={vetDate} onChange={e=>setVetDate(e.target.value)} />
              <input style={S.input} placeholder="Reason (e.g. annual checkup, vaccination)" value={vetReason} onChange={e=>setVetReason(e.target.value)} />
              <input style={S.input} placeholder="Notes (e.g. what vet said, next steps)" value={vetNotes} onChange={e=>setVetNotes(e.target.value)} />
              <button style={S.primaryBtn} onClick={addVetAppt}>🏥 Save appointment</button>
            </div>

            {upcomingVet.length > 0 && (
              <>
                <h3 style={S.sectionTitle}>Upcoming</h3>
                {upcomingVet.map(a=>(
                  <div key={a.id} style={{...S.eventCard,borderLeft:"4px solid #27ae60",marginBottom:10}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:"bold",color:"#3D2B1F",fontSize:13}}>🏥 {a.reason}</div>
                      <div style={{fontSize:11,color:"#8B6A55"}}>{formatDate(a.date)} · added by {a.addedBy}</div>
                      {a.notes&&<div style={{fontSize:11,color:"#6B4F3A",marginTop:2}}>📝 {a.notes}</div>}
                    </div>
                    <button style={S.delBtn} onClick={()=>deleteVetAppt(a.id)}>✕</button>
                  </div>
                ))}
              </>
            )}

            <h3 style={S.sectionTitle}>All appointments</h3>
            {vetAppts.length===0&&<div style={S.empty}>No vet appointments logged yet</div>}
            {vetAppts.filter(a=>!a.upcoming||a.date<todayKey).map(a=>(
              <div key={a.id} style={{...S.eventCard,borderLeft:"4px solid #8B6A55",marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:"bold",color:"#3D2B1F",fontSize:13}}>🏥 {a.reason}</div>
                  <div style={{fontSize:11,color:"#8B6A55"}}>{formatDate(a.date)} · added by {a.addedBy}</div>
                  {a.notes&&<div style={{fontSize:11,color:"#6B4F3A",marginTop:2}}>📝 {a.notes}</div>}
                </div>
                <button style={S.delBtn} onClick={()=>deleteVetAppt(a.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* ── INFO TAB ── */}
        {tab === "info" && (
          <div>
            {!editingInfo ? (
              <div style={S.card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <h3 style={{...S.cardTitle,margin:0}}>📋 Barney's Info Card</h3>
                  <button style={S.addBtn} onClick={()=>{setInfoEdit({...info});setEditingInfo(true);}}>Edit</button>
                </div>
                {[
                  {label:"Microchip number", val:info.microchip, icon:"🔖"},
                  {label:"Vet practice", val:info.vet, icon:"🏥"},
                  {label:"Vet phone", val:info.vetPhone, icon:"📞"},
                  {label:"Insurance", val:info.insurance, icon:"📄"},
                  {label:"Emergency contact", val:info.emergencyName, icon:"🚨"},
                  {label:"Emergency phone", val:info.emergencyPhone, icon:"📞"},
                ].map(({label,val,icon})=>(
                  <div key={label} style={{padding:"10px 0",borderBottom:"1px solid #EDE0D4"}}>
                    <div style={{fontSize:11,color:"#8B6A55",marginBottom:2}}>{icon} {label}</div>
                    <div style={{fontSize:14,color:val?"#3D2B1F":"#ccc",fontWeight:val?"bold":"normal"}}>{val||"Not set"}</div>
                  </div>
                ))}
                {info.notes&&<div style={{marginTop:12}}><div style={{fontSize:11,color:"#8B6A55",marginBottom:4}}>📝 Notes</div><div style={{fontSize:13,color:"#3D2B1F"}}>{info.notes}</div></div>}
              </div>
            ) : (
              <div style={S.card}>
                <h3 style={S.cardTitle}>Edit Info Card</h3>
                {[
                  {key:"microchip",label:"Microchip number"},
                  {key:"vet",label:"Vet practice name"},
                  {key:"vetPhone",label:"Vet phone number"},
                  {key:"insurance",label:"Insurance provider / policy"},
                  {key:"emergencyName",label:"Emergency contact name"},
                  {key:"emergencyPhone",label:"Emergency contact phone"},
                ].map(({key,label})=>(
                  <div key={key}>
                    <div style={{fontSize:11,color:"#8B6A55",marginBottom:3}}>{label}</div>
                    <input style={S.input} value={infoEdit[key]||""} onChange={e=>setInfoEdit(p=>({...p,[key]:e.target.value}))} />
                  </div>
                ))}
                <div style={{fontSize:11,color:"#8B6A55",marginBottom:3}}>Notes</div>
                <textarea style={{...S.input,height:80,resize:"vertical"}} value={infoEdit.notes||""} onChange={e=>setInfoEdit(p=>({...p,notes:e.target.value}))} />
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.primaryBtn,flex:1}} onClick={saveInfo}>Save</button>
                  <button style={{...S.primaryBtn,flex:1,background:"#EDE0D4",color:"#3D2B1F"}} onClick={()=>setEditingInfo(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PHOTOS TAB ── */}
        {tab === "photos" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>📸 Add a photo</h3>
              <label style={{display:"block",background:"#EDE0D4",borderRadius:12,padding:"20px",textAlign:"center",cursor:"pointer",marginBottom:12,border:"2px dashed #D4A574"}}>
                <div style={{fontSize:32}}>📷</div>
                <div style={{fontSize:13,color:"#6B4F3A",marginTop:4}}>Tap to choose a photo</div>
                <input type="file" accept="image/*" style={{display:"none"}} onChange={handlePhotoUpload} />
              </label>
              {photoData && <img src={photoData} style={{width:"100%",borderRadius:12,marginBottom:12,maxHeight:200,objectFit:"cover"}} />}
              <input style={S.input} placeholder="Caption (e.g. first day at daycare!)" value={photoCaption} onChange={e=>setPhotoCaption(e.target.value)} />
              <button style={S.primaryBtn} onClick={savePhoto} disabled={!photoData}>Save photo</button>
            </div>

            <h3 style={S.sectionTitle}>Barney's photos</h3>
            {photos.length===0&&<div style={S.empty}>No photos yet — add one above! 🐶</div>}
            {photos.map(p=>(
              <div key={p.id} style={{...S.card,padding:0,overflow:"hidden",marginBottom:12}}>
                <img src={p.data} style={{width:"100%",maxHeight:220,objectFit:"cover",display:"block"}} />
                <div style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    {p.caption&&<div style={{fontSize:13,fontWeight:"bold",color:"#3D2B1F"}}>{p.caption}</div>}
                    <div style={{fontSize:11,color:"#8B6A55"}}>{formatDate(p.date)} · by {p.addedBy}</div>
                  </div>
                  <button style={S.delBtn} onClick={()=>deletePhoto(p.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

const S = {
  app:         { fontFamily:"'Georgia',serif", background:"#FDF8F3", minHeight:"100vh", maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column" },
  splash:      { minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#FDF8F3", gap:16, padding:24 },
  userBtn:     { background:"#fff", border:"2px solid #D4A574", borderRadius:16, padding:"18px 24px", cursor:"pointer", fontSize:15, display:"flex", flexDirection:"column", alignItems:"center", gap:8, color:"#3D2B1F", fontWeight:"bold", boxShadow:"0 2px 8px rgba(0,0,0,0.08)" },
  header:      { background:"#3D2B1F", color:"#FDF8F3", padding:"12px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  switchBtn:   { background:"rgba(255,255,255,0.15)", border:"none", color:"#FDF8F3", padding:"5px 12px", borderRadius:20, cursor:"pointer", fontSize:12 },
  alertBar:    { background:"#e74c3c", color:"#fff", padding:"7px 16px", fontSize:12, fontWeight:"bold", display:"flex", gap:14, flexWrap:"wrap", flexShrink:0 },
  tabBar:      { display:"flex", background:"#fff", borderBottom:"2px solid #EDE0D4", overflowX:"auto", flexShrink:0 },
  tabBtn:      { minWidth:52, padding:"9px 6px", border:"none", background:"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1, color:"#8B6A55", fontSize:15, flexShrink:0 },
  tabActive:   { color:"#3D2B1F", borderBottom:"3px solid #D4A574" },
  content:     { flex:1, padding:14, overflowY:"auto" },
  card:        { background:"#fff", borderRadius:14, padding:18, marginBottom:14, boxShadow:"0 2px 10px rgba(0,0,0,0.06)", border:"1px solid #EDE0D4" },
  cardTitle:   { margin:"0 0 12px", color:"#3D2B1F", fontSize:15, fontWeight:"bold" },
  sectionTitle:{ color:"#6B4F3A", fontSize:12, fontWeight:"bold", textTransform:"uppercase", letterSpacing:1, margin:"14px 0 7px" },
  input:       { width:"100%", padding:"9px 12px", borderRadius:9, border:"1px solid #D4A574", fontSize:13, color:"#3D2B1F", background:"#FDF8F3", marginBottom:10, boxSizing:"border-box", outline:"none", fontFamily:"inherit" },
  timeInput:   { width:"100%", padding:"9px 12px", borderRadius:9, border:"1px solid #D4A574", fontSize:13, color:"#3D2B1F", background:"#FDF8F3", boxSizing:"border-box", outline:"none" },
  primaryBtn:  { width:"100%", padding:12, background:"#3D2B1F", color:"#FDF8F3", border:"none", borderRadius:10, cursor:"pointer", fontSize:14, fontWeight:"bold", fontFamily:"inherit" },
  chipBtn:     { padding:"6px 13px", borderRadius:20, border:"2px solid #D4A574", background:"#fff", color:"#6B4F3A", cursor:"pointer", fontSize:12, fontWeight:"bold" },
  chipActive:  { background:"#D4A574", color:"#fff" },
  bigBtn:      { flex:1, padding:"18px 10px", color:"#fff", border:"none", borderRadius:12, cursor:"pointer", fontSize:15, fontWeight:"bold", display:"flex", flexDirection:"column", alignItems:"center", gap:6 },
  logItem:     { background:"#fff", borderRadius:10, padding:"10px 14px", marginBottom:7, display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 5px rgba(0,0,0,0.05)", border:"1px solid #EDE0D4" },
  logPrimary:  { fontWeight:"bold", color:"#3D2B1F", fontSize:13 },
  logNote:     { color:"#8B6A55", fontSize:11, marginTop:2 },
  logTime:     { fontSize:11, color:"#6B4F3A", fontWeight:"bold" },
  logUser:     { fontSize:10, color:"#8B6A55" },
  empty:       { color:"#8B6A55", textAlign:"center", padding:"20px 0", fontSize:13 },
  countBtn:    { flex:1, padding:10, background:"#EDE0D4", border:"none", borderRadius:9, cursor:"pointer", fontSize:14, fontWeight:"bold", color:"#3D2B1F" },
  navBtn:      { background:"#EDE0D4", border:"none", borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:18, color:"#3D2B1F", fontWeight:"bold" },
  dayCell:     { display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:"7px 3px", borderRadius:10, border:"2px solid transparent", background:"#fff", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.05)" },
  dayCellSel:  { background:"#3D2B1F", border:"2px solid #3D2B1F" },
  dayCellToday:{ border:"2px solid #D4A574" },
  addBtn:      { background:"#3D2B1F", color:"#fff", border:"none", borderRadius:20, padding:"5px 14px", cursor:"pointer", fontWeight:"bold", fontSize:12 },
  eventCard:   { background:"#fff", borderRadius:10, padding:"10px 12px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 1px 5px rgba(0,0,0,0.05)", border:"1px solid #EDE0D4" },
  delBtn:      { background:"#EDE0D4", border:"none", borderRadius:20, padding:"3px 9px", cursor:"pointer", color:"#6B4F3A", fontSize:11, fontWeight:"bold", flexShrink:0 },
  modalOverlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100 },
  modal:       { background:"#FDF8F3", borderRadius:"18px 18px 0 0", padding:22, width:"100%", maxWidth:480, maxHeight:"88vh", overflowY:"auto" },
  locBtn:      { display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"10px 6px", borderRadius:10, border:"2px solid #D4A574", background:"#fff", cursor:"pointer", color:"#6B4F3A", fontWeight:"bold" },
};
