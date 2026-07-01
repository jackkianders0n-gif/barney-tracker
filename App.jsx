import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// !! IMPORTANT: After deploying the worker, replace this with your worker URL !!
// e.g. https://barney-tracker-api.YOUR-SUBDOMAIN.workers.dev
const WORKER_URL = "https://barney-tracker-api.YOUR-SUBDOMAIN.workers.dev";

const api = {
  get: (path) => fetch(`${WORKER_URL}${path}`).then(r => r.json()),
  post: (path, body) => fetch(`${WORKER_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  put: (path, body) => fetch(`${WORKER_URL}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  del: (path) => fetch(`${WORKER_URL}${path}`, { method: "DELETE" }).then(r => r.json()),
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

const USERS = ["Jack", "Jakey", "Mum"];

const LOCATIONS = [
  { id: "home",    label: "Home",             icon: "🏠", color: "#7C9E87" },
  { id: "mum",     label: "Mum's house",      icon: "👵", color: "#C4845A" },
  { id: "jakey",   label: "Jakey's flat",     icon: "👨", color: "#5A7EC4" },
  { id: "daycare", label: "Doggy daycare",    icon: "🐾", color: "#A05AC4" },
  { id: "walk",    label: "On a walk",        icon: "🦮", color: "#C4A85A" },
];
const LOC_MAP = Object.fromEntries(LOCATIONS.map(l => [l.id, l]));

const BEHAVIOUR_TYPES = ["Limping","Not eating","Scratching","Vomiting","Lethargy","Unusual behaviour","Other"];
const GROOMING_TYPES  = ["Bath","Brush","Nail clip","Ear clean","Other"];
const EXPENSE_CATS    = ["Food","Vet","Daycare","Grooming","Toys","Insurance","Other"];
const MOODS           = [{ v:"happy", l:"Happy 😄" },{ v:"calm", l:"Calm 😌" },{ v:"anxious", l:"Anxious 😟" },{ v:"tired", l:"Tired 😴" },{ v:"hyper", l:"Hyper 🤪" }];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso), today = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const days = Math.floor((today - d) / 86400000);
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + time;
}
function formatDate(s) { if (!s) return "—"; return new Date(s + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); }
function daysSince(iso) { if (!iso) return null; return Math.floor((Date.now() - new Date(iso)) / 86400000); }
function getWeekDates(anchor) {
  const d = new Date(anchor), day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return x; });
}
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export default function BarneyApp() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("home");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Data state
  const [feeding, setFeeding] = useState([]);
  const [toilet, setToilet] = useState([]);
  const [food, setFood] = useState({ pouches: 0, alert_at: 5 });
  const [treatments, setTreatments] = useState({ flea: null, worm: null });
  const [calEvents, setCalEvents] = useState([]);
  const [weight, setWeight] = useState([]);
  const [walks, setWalks] = useState([]);
  const [meds, setMeds] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [vetAppts, setVetAppts] = useState([]);
  const [info, setInfo] = useState({});
  const [photos, setPhotos] = useState([]);
  const [grooming, setGrooming] = useState([]);
  const [training, setTraining] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [mood, setMood] = useState([]);

  // Calendar UI
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(todayStr());
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newLoc, setNewLoc] = useState("home");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [newEventNote, setNewEventNote] = useState("");
  const [allDay, setAllDay] = useState(false);

  // Form state
  const [feedNote, setFeedNote] = useState(""); const [feedAmount, setFeedAmount] = useState("Full portion");
  const [walkDuration, setWalkDuration] = useState("30"); const [walkDistance, setWalkDistance] = useState(""); const [walkNote, setWalkNote] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [medName, setMedName] = useState(""); const [medDose, setMedDose] = useState(""); const [medNote, setMedNote] = useState("");
  const [behavType, setBehavType] = useState(BEHAVIOUR_TYPES[0]); const [behavNote, setBehavNote] = useState("");
  const [vetDate, setVetDate] = useState(""); const [vetReason, setVetReason] = useState(""); const [vetNotes, setVetNotes] = useState(""); const [vetIsUpcoming, setVetIsUpcoming] = useState(true);
  const [editingInfo, setEditingInfo] = useState(false); const [infoEdit, setInfoEdit] = useState({});
  const [photoCaption, setPhotoCaption] = useState(""); const [photoData, setPhotoData] = useState(null);
  const [groomType, setGroomType] = useState(GROOMING_TYPES[0]); const [groomNote, setGroomNote] = useState("");
  const [trainCommands, setTrainCommands] = useState(""); const [trainRating, setTrainRating] = useState("Good"); const [trainNote, setTrainNote] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState(""); const [milestoneNote, setMilestoneNote] = useState(""); const [milestoneDate, setMilestoneDate] = useState(todayStr());
  const [expDate, setExpDate] = useState(todayStr()); const [expCat, setExpCat] = useState(EXPENSE_CATS[0]); const [expAmount, setExpAmount] = useState(""); const [expDesc, setExpDesc] = useState("");
  const [selectedMood, setSelectedMood] = useState("happy"); const [moodNote, setMoodNote] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [f, t, fo, tr, cal, w, wk, m, b, v, inf, ph, gr, tr2, mi, ex, mo] = await Promise.all([
          api.get("/api/feeding"), api.get("/api/toilet"), api.get("/api/food"),
          api.get("/api/treatments"), api.get("/api/calendar"), api.get("/api/weight"),
          api.get("/api/walks"), api.get("/api/medications"), api.get("/api/behaviour"),
          api.get("/api/vet"), api.get("/api/info"), api.get("/api/photos"),
          api.get("/api/grooming"), api.get("/api/training"), api.get("/api/milestones"),
          api.get("/api/expenses"), api.get("/api/mood"),
        ]);
        setFeeding(f || []); setToilet(t || []); setFood(fo || { pouches: 0, alert_at: 5 });
        setTreatments(tr || { flea: null, worm: null }); setCalEvents(cal || []); setWeight(w || []);
        setWalks(wk || []); setMeds(m || []); setBehaviour(b || []); setVetAppts(v || []);
        setInfo(inf || {}); setPhotos(ph || []); setGrooming(gr || []); setTraining(tr2 || []);
        setMilestones(mi || []); setExpenses(ex || []); setMood(mo || []);
      } catch (e) { console.error("Load error", e); }
      setLoading(false);
    }
    load();
  }, []);

  const s = async (fn) => { setSaving(true); try { await fn(); } finally { setSaving(false); } };

  // Actions
  const logFeed = () => s(async () => {
    await api.post("/api/feeding", { logged_by: user, amount: feedAmount, note: feedNote });
    setFeeding(await api.get("/api/feeding")); setFeedNote("");
  });
  const logToilet = (type) => s(async () => {
    await api.post("/api/toilet", { logged_by: user, type });
    setToilet(await api.get("/api/toilet"));
  });
  const updateFood = (pouches, alert_at) => s(async () => {
    const updated = { pouches: Math.max(0, pouches), alert_at: alert_at ?? food.alert_at, updated_by: user };
    await api.put("/api/food", updated); setFood({ ...food, ...updated });
  });
  const logTreatment = (type) => s(async () => {
    await api.post("/api/treatments", { type, logged_by: user });
    setTreatments(await api.get("/api/treatments"));
  });
  const addEvent = () => s(async () => {
    const id = uid();
    await api.post("/api/calendar", { id, event_date: selectedDay, location_id: newLoc, start_time: allDay ? null : newStart, end_time: allDay ? null : newEnd, all_day: allDay, note: newEventNote, added_by: user });
    const from = getWeekDates(weekAnchor)[0].toISOString().slice(0,10);
    const to   = getWeekDates(weekAnchor)[6].toISOString().slice(0,10);
    setCalEvents(await api.get(`/api/calendar?from=${from}&to=${to}`));
    setShowAddEvent(false); setNewEventNote(""); setAllDay(false);
  });
  const deleteEvent = (id) => s(async () => {
    await api.del(`/api/calendar/${id}`);
    setCalEvents(prev => prev.filter(e => e.id !== id));
  });
  const logWalk = () => s(async () => {
    await api.post("/api/walks", { logged_by: user, duration_mins: parseInt(walkDuration), distance: walkDistance, note: walkNote });
    setWalks(await api.get("/api/walks")); setWalkNote(""); setWalkDistance("");
  });
  const logWeight = () => s(async () => {
    if (!newWeight) return;
    await api.post("/api/weight", { weight_kg: parseFloat(newWeight), logged_by: user });
    setWeight(await api.get("/api/weight")); setNewWeight("");
  });
  const logMed = () => s(async () => {
    if (!medName) return;
    await api.post("/api/medications", { logged_by: user, name: medName, dose: medDose, note: medNote });
    setMeds(await api.get("/api/medications")); setMedName(""); setMedDose(""); setMedNote("");
  });
  const logBehaviour = () => s(async () => {
    await api.post("/api/behaviour", { logged_by: user, type: behavType, note: behavNote });
    setBehaviour(await api.get("/api/behaviour")); setBehavNote("");
  });
  const addVetAppt = () => s(async () => {
    if (!vetDate || !vetReason) return;
    await api.post("/api/vet", { id: uid(), appt_date: vetDate, reason: vetReason, notes: vetNotes, upcoming: vetIsUpcoming, added_by: user });
    setVetAppts(await api.get("/api/vet")); setVetDate(""); setVetReason(""); setVetNotes("");
  });
  const deleteVetAppt = (id) => s(async () => {
    await api.del(`/api/vet/${id}`); setVetAppts(prev => prev.filter(a => a.id !== id));
  });
  const saveInfo = () => s(async () => {
    await api.put("/api/info", infoEdit); setInfo(infoEdit); setEditingInfo(false);
  });
  const savePhoto = () => s(async () => {
    if (!photoData) return;
    await api.post("/api/photos", { id: uid(), photo_date: todayStr(), caption: photoCaption, data: photoData, added_by: user });
    setPhotos(await api.get("/api/photos")); setPhotoData(null); setPhotoCaption("");
  });
  const deletePhoto = (id) => s(async () => {
    await api.del(`/api/photos/${id}`); setPhotos(prev => prev.filter(p => p.id !== id));
  });
  const logGrooming = () => s(async () => {
    await api.post("/api/grooming", { logged_by: user, type: groomType, note: groomNote });
    setGrooming(await api.get("/api/grooming")); setGroomNote("");
  });
  const logTraining = () => s(async () => {
    if (!trainCommands) return;
    await api.post("/api/training", { logged_by: user, commands: trainCommands, rating: trainRating, note: trainNote });
    setTraining(await api.get("/api/training")); setTrainCommands(""); setTrainNote("");
  });
  const addMilestone = () => s(async () => {
    if (!milestoneTitle) return;
    await api.post("/api/milestones", { id: uid(), milestone_date: milestoneDate, title: milestoneTitle, note: milestoneNote, added_by: user });
    setMilestones(await api.get("/api/milestones")); setMilestoneTitle(""); setMilestoneNote("");
  });
  const deleteMilestone = (id) => s(async () => {
    await api.del(`/api/milestones/${id}`); setMilestones(prev => prev.filter(m => m.id !== id));
  });
  const addExpense = () => s(async () => {
    if (!expAmount) return;
    await api.post("/api/expenses", { id: uid(), expense_date: expDate, category: expCat, amount: parseFloat(expAmount), description: expDesc, added_by: user });
    setExpenses(await api.get("/api/expenses")); setExpAmount(""); setExpDesc("");
  });
  const deleteExpense = (id) => s(async () => {
    await api.del(`/api/expenses/${id}`); setExpenses(prev => prev.filter(e => e.id !== id));
  });
  const logMood = () => s(async () => {
    await api.post("/api/mood", { mood: selectedMood, logged_by: user, note: moodNote });
    setMood(await api.get("/api/mood")); setMoodNote("");
  });

  // Load calendar when week changes
  useEffect(() => {
    if (!user) return;
    const from = getWeekDates(weekAnchor)[0].toISOString().slice(0,10);
    const to   = getWeekDates(weekAnchor)[6].toISOString().slice(0,10);
    api.get(`/api/calendar?from=${from}&to=${to}`).then(r => setCalEvents(r || []));
  }, [weekAnchor, user]);

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

  // Computed
  const today = todayStr();
  const nowTime = new Date().toTimeString().slice(0,5);
  const lastFeed = feeding[0];
  const lastWee  = toilet.find(t => t.type === "wee");
  const lastPoo  = toilet.find(t => t.type === "poo");
  const fleaDays = daysSince(treatments.flea?.treated_at);
  const wormDays = daysSince(treatments.worm?.treated_at);
  const weekDates = getWeekDates(weekAnchor);
  const todayCalEvents = calEvents.filter(e => e.event_date === selectedDay).sort((a,b)=>(a.start_time||"").localeCompare(b.start_time||""));
  const currentEvents = calEvents.filter(e => e.event_date === today && (e.all_day || (e.start_time <= nowTime && nowTime <= (e.end_time||"23:59"))));
  const currentLoc = currentEvents.length > 0 ? LOC_MAP[currentEvents[currentEvents.length-1].location_id] : null;
  const upcomingVet = vetAppts.filter(a => a.upcoming && a.appt_date >= today).sort((a,b)=>a.appt_date.localeCompare(b.appt_date));
  const latestWeight = weight.length > 0 ? weight[weight.length-1] : null;
  const todayWalks = walks.filter(w => w.created_at?.slice(0,10) === today);
  const todayWalkMins = todayWalks.reduce((s,w) => s + (w.duration_mins||0), 0);
  const thisMonthExp = expenses.filter(e => e.expense_date?.slice(0,7) === today.slice(0,7)).reduce((s,e) => s + (e.amount||0), 0);
  const showAlert = food.pouches <= food.alert_at || fleaDays >= 28 || wormDays >= 90 || upcomingVet.length > 0;

  const tabs = [
    { id:"home",      label:"Home",     icon:"🏠" },
    { id:"calendar",  label:"Where",    icon:"📅" },
    { id:"feed",      label:"Feeding",  icon:"🍽️" },
    { id:"toilet",    label:"Toilet",   icon:"🌿" },
    { id:"walks",     label:"Walks",    icon:"🦮" },
    { id:"health",    label:"Health",   icon:"💊" },
    { id:"vet",       label:"Vet",      icon:"🏥" },
    { id:"grooming",  label:"Grooming", icon:"✂️" },
    { id:"training",  label:"Training", icon:"🎓" },
    { id:"milestones",label:"Moments",  icon:"⭐" },
    { id:"expenses",  label:"Costs",    icon:"💰" },
    { id:"info",      label:"Info",     icon:"📋" },
    { id:"photos",    label:"Photos",   icon:"📸" },
  ];

  return (
    <div style={S.app}>
      <div style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:32}}>🐕</span>
          <div>
            <div style={{fontSize:19,fontWeight:"bold"}}>Barney</div>
            {currentLoc
              ? <div style={{fontSize:11,opacity:0.85}}>{currentLoc.icon} {currentLoc.label} right now</div>
              : <div style={{fontSize:11,opacity:0.7}}>Hi {user}! 👋</div>}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {saving && <span style={{fontSize:11,opacity:0.7}}>Saving…</span>}
          <button style={S.switchBtn} onClick={()=>setUser(null)}>Switch</button>
        </div>
      </div>

      {showAlert && (
        <div style={S.alertBar}>
          {food.pouches <= food.alert_at && <span>🥫 Food low!</span>}
          {fleaDays >= 28 && <span>🐛 Flea due!</span>}
          {wormDays >= 90 && <span>🪱 Worming due!</span>}
          {upcomingVet.length > 0 && <span>🏥 Vet: {upcomingVet[0].reason} – {formatDate(upcomingVet[0].appt_date)}</span>}
        </div>
      )}

      <div style={S.tabBar}>
        {tabs.map(t => (
          <button key={t.id} style={{...S.tabBtn,...(tab===t.id?S.tabActive:{})}} onClick={()=>setTab(t.id)}>
            <span>{t.icon}</span>
            <span style={{fontSize:8,fontWeight:"bold",letterSpacing:0.3,textTransform:"uppercase"}}>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={S.content}>

        {/* HOME */}
        {tab==="home" && (
          <div>
            <div style={{...S.card,background:"#3D2B1F",color:"#FDF8F3"}}>
              <div style={{fontSize:12,opacity:0.7,marginBottom:4}}>Barney is currently</div>
              {currentLoc
                ? <div style={{fontSize:20,fontWeight:"bold"}}>{currentLoc.icon} {currentLoc.label}</div>
                : <div style={{fontSize:16,opacity:0.6}}>📍 No location set for now</div>}
              <div style={{fontSize:11,opacity:0.5,marginTop:4}}>{new Date().toLocaleDateString([],{weekday:"long",day:"numeric",month:"long"})}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {[
                {icon:"🍽️",label:"Last fed",      val:lastFeed?formatTime(lastFeed.created_at):"Not logged", sub:lastFeed?.amount},
                {icon:"💧",label:"Last wee",       val:lastWee ?formatTime(lastWee.created_at) :"Not logged"},
                {icon:"🥫",label:"Food stock",     val:`${food.pouches} pouches`, sub:food.pouches<=food.alert_at?"⚠️ Running low!":null, subColor:"#e74c3c"},
                {icon:"🦮",label:"Walked today",   val:todayWalkMins>0?`${todayWalkMins} mins`:"Not yet"},
              ].map((s,i)=>(
                <div key={i} style={{...S.card,marginBottom:0,padding:"12px 14px"}}>
                  <div style={{fontSize:20,marginBottom:3}}>{s.icon}</div>
                  <div style={{fontSize:10,color:"#8B6A55",fontWeight:"bold",textTransform:"uppercase"}}>{s.label}</div>
                  <div style={{fontSize:12,fontWeight:"bold",color:"#3D2B1F",marginTop:2}}>{s.val}</div>
                  {s.sub&&<div style={{fontSize:10,color:s.subColor||"#8B6A55"}}>{s.sub}</div>}
                </div>
              ))}
            </div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Treatment countdown</h3>
              {[{label:"Flea",days:fleaDays,cycle:28},{label:"Worming",days:wormDays,cycle:90}].map(({label,days,cycle})=>(
                <div key={label} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontSize:12,color:"#3D2B1F",fontWeight:"bold"}}>{label}</span>
                    <span style={{fontSize:12,fontWeight:"bold",color:days===null?"#ccc":days>=cycle?"#e74c3c":days>=cycle*0.75?"#f39c12":"#27ae60"}}>
                      {days===null?"Not logged":days>=cycle?"Due now!":`${cycle-days} days left`}
                    </span>
                  </div>
                  <div style={{height:5,background:"#EDE0D4",borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:3,width:`${days===null?0:Math.min(100,(days/cycle)*100)}%`,background:days>=cycle?"#e74c3c":days>=cycle*0.75?"#f39c12":"#27ae60"}} />
                  </div>
                </div>
              ))}
            </div>
            {mood.length > 0 && (
              <div style={{...S.card,marginBottom:12}}>
                <h3 style={S.cardTitle}>Today's mood</h3>
                <div style={{fontSize:28}}>{MOODS.find(m=>m.v===mood[0]?.mood)?.l || mood[0]?.mood}</div>
                <div style={{fontSize:11,color:"#8B6A55"}}>logged by {mood[0]?.logged_by}</div>
              </div>
            )}
            {latestWeight && (
              <div style={{...S.card,marginBottom:12}}>
                <h3 style={S.cardTitle}>Latest weight</h3>
                <div style={{fontSize:28,fontWeight:"bold",color:"#3D2B1F"}}>{latestWeight.weight_kg} <span style={{fontSize:14,color:"#8B6A55"}}>kg</span></div>
                <div style={{fontSize:11,color:"#8B6A55"}}>logged {formatDate(latestWeight.logged_date)} by {latestWeight.logged_by}</div>
              </div>
            )}
            {thisMonthExp > 0 && (
              <div style={{...S.card,marginBottom:0}}>
                <h3 style={S.cardTitle}>This month's costs</h3>
                <div style={{fontSize:28,fontWeight:"bold",color:"#3D2B1F"}}>£{thisMonthExp.toFixed(2)}</div>
              </div>
            )}
          </div>
        )}

        {/* CALENDAR */}
        {tab==="calendar" && (
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <button style={S.navBtn} onClick={()=>setWeekAnchor(d=>{const x=new Date(d);x.setDate(x.getDate()-7);return x;})}>‹</button>
              <span style={{fontWeight:"bold",color:"#3D2B1F",fontSize:12}}>
                {weekDates[0].toLocaleDateString([],{day:"numeric",month:"short"})} – {weekDates[6].toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"})}
              </span>
              <button style={S.navBtn} onClick={()=>setWeekAnchor(d=>{const x=new Date(d);x.setDate(x.getDate()+7);return x;})}>›</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:12}}>
              {weekDates.map((d,i)=>{
                const ds=d.toISOString().slice(0,10), isToday=ds===today, isSel=ds===selectedDay;
                const evs=calEvents.filter(e=>e.event_date===ds);
                const topLoc=evs.length>0?LOC_MAP[evs[evs.length-1].location_id]:null;
                return (
                  <button key={ds} style={{...S.dayCell,...(isSel?S.dayCellSel:{}),...(isToday&&!isSel?S.dayCellToday:{})}} onClick={()=>setSelectedDay(ds)}>
                    <span style={{fontSize:9,color:isSel?"#fff":"#8B6A55",fontWeight:"bold"}}>{DAY_LABELS[i]}</span>
                    <span style={{fontSize:13,fontWeight:"bold",color:isSel?"#fff":"#3D2B1F"}}>{d.getDate()}</span>
                    <span style={{fontSize:11}}>{topLoc?topLoc.icon:"·"}</span>
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:12}}>
              {LOCATIONS.map(l=>(
                <div key={l.id} style={{display:"flex",alignItems:"center",gap:3,background:l.color+"22",border:`1px solid ${l.color}66`,borderRadius:20,padding:"2px 7px",fontSize:10,color:l.color,fontWeight:"bold"}}>
                  {l.icon} {l.label}
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <h3 style={{margin:0,color:"#3D2B1F",fontSize:13,fontWeight:"bold"}}>
                {new Date(selectedDay+"T12:00:00").toLocaleDateString([],{weekday:"long",day:"numeric",month:"long"})}
              </h3>
              <button style={S.addBtn} onClick={()=>setShowAddEvent(true)}>+ Add</button>
            </div>
            {todayCalEvents.length===0&&<div style={S.empty}>Nothing planned — tap + Add</div>}
            {todayCalEvents.map(ev=>{
              const loc=LOC_MAP[ev.location_id]||{icon:"📍",label:ev.location_id,color:"#ccc"};
              return (
                <div key={ev.id} style={{...S.eventCard,borderLeft:`4px solid ${loc.color}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                    <span style={{fontSize:20}}>{loc.icon}</span>
                    <div>
                      <div style={{fontWeight:"bold",color:"#3D2B1F",fontSize:12}}>{loc.label}</div>
                      <div style={{fontSize:10,color:"#8B6A55"}}>{ev.all_day?"All day":`${ev.start_time} – ${ev.end_time}`} · {ev.added_by}</div>
                      {ev.note&&<div style={{fontSize:10,color:"#6B4F3A",marginTop:1}}>📝 {ev.note}</div>}
                    </div>
                  </div>
                  <button style={S.delBtn} onClick={()=>deleteEvent(ev.id)}>✕</button>
                </div>
              );
            })}
            {showAddEvent&&(
              <div style={S.modalOverlay} onClick={()=>setShowAddEvent(false)}>
                <div style={S.modal} onClick={e=>e.stopPropagation()}>
                  <h3 style={{margin:"0 0 14px",color:"#3D2B1F",fontSize:15}}>Add event</h3>
                  <div style={{fontSize:11,color:"#8B6A55",marginBottom:6,fontWeight:"bold"}}>Where is Barney?</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:12}}>
                    {LOCATIONS.map(l=>(
                      <button key={l.id} style={{...S.locBtn,...(newLoc===l.id?{background:l.color,color:"#fff",borderColor:l.color}:{})}} onClick={()=>setNewLoc(l.id)}>
                        <span style={{fontSize:16}}>{l.icon}</span><span style={{fontSize:10}}>{l.label}</span>
                      </button>
                    ))}
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#3D2B1F",marginBottom:10,cursor:"pointer"}}>
                    <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All day
                  </label>
                  {!allDay&&(
                    <div style={{display:"flex",gap:8,marginBottom:10}}>
                      <div style={{flex:1}}><div style={{fontSize:10,color:"#8B6A55",marginBottom:3}}>From</div><input type="time" style={S.timeInput} value={newStart} onChange={e=>setNewStart(e.target.value)} /></div>
                      <div style={{flex:1}}><div style={{fontSize:10,color:"#8B6A55",marginBottom:3}}>Until</div><input type="time" style={S.timeInput} value={newEnd} onChange={e=>setNewEnd(e.target.value)} /></div>
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

        {/* FEEDING */}
        {tab==="feed" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Log a meal</h3>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {["Full portion","Half portion","Treat only"].map(a=>(
                  <button key={a} style={{...S.chipBtn,...(feedAmount===a?S.chipActive:{})}} onClick={()=>setFeedAmount(a)}>{a}</button>
                ))}
              </div>
              <input style={S.input} placeholder="Notes? (e.g. ate slowly)" value={feedNote} onChange={e=>setFeedNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logFeed}>🍽️ Log meal</button>
            </div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Food cupboard</h3>
              <div style={{textAlign:"center",padding:"8px 0 14px"}}>
                <div style={{fontSize:52,fontWeight:"bold",color:food.pouches<=food.alert_at?"#e74c3c":food.pouches<=food.alert_at*2?"#f39c12":"#27ae60"}}>{food.pouches}</div>
                <div style={{color:"#8B6A55",fontSize:13}}>pouches remaining</div>
                {food.pouches<=food.alert_at&&<div style={{color:"#e74c3c",fontWeight:"bold",marginTop:5,fontSize:12}}>⚠️ Running low!</div>}
              </div>
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                {[[-1,"−1"],[-3,"−3"]].map(([d,l])=><button key={l} style={S.countBtn} onClick={()=>updateFood(food.pouches+d)}>{l}</button>)}
                {[[12,"+12"],[24,"+24"]].map(([d,l])=><button key={l} style={{...S.countBtn,background:"#27ae60",color:"#fff"}} onClick={()=>updateFood(food.pouches+d)}>{l}</button>)}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{color:"#888",fontSize:11}}>Set exact:</span>
                <input type="number" style={{...S.input,width:60,marginBottom:0,padding:"7px 8px"}} value={food.pouches} onChange={e=>updateFood(parseInt(e.target.value)||0)} />
                <span style={{color:"#888",fontSize:11}}>Alert below:</span>
                <input type="number" style={{...S.input,width:50,marginBottom:0,padding:"7px 8px"}} value={food.alert_at} onChange={e=>updateFood(food.pouches, parseInt(e.target.value)||0)} />
              </div>
            </div>
            <h3 style={S.sectionTitle}>Recent meals</h3>
            {feeding.length===0&&<div style={S.empty}>No meals logged yet</div>}
            {feeding.slice(0,15).map((f,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:18}}>🍽️</span>
                  <div><div style={S.logPrimary}>{f.amount}</div>{f.note&&<div style={S.logNote}>{f.note}</div>}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(f.created_at)}</div><div style={S.logUser}>by {f.logged_by}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* TOILET */}
        {tab==="toilet" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Log toilet trip</h3>
              <div style={{display:"flex",gap:10,marginBottom:10}}>
                <button style={{...S.bigBtn,background:"#3D7EA6"}} onClick={()=>logToilet("wee")}><span style={{fontSize:28}}>💧</span>Wee</button>
                <button style={{...S.bigBtn,background:"#6B4F3A"}} onClick={()=>logToilet("poo")}><span style={{fontSize:28}}>💩</span>Poo</button>
              </div>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1,background:"#F0F7FF",borderRadius:10,padding:"10px 12px",fontSize:12}}>
                  <div style={{color:"#8B6A55"}}>Last wee</div>
                  <div style={{fontWeight:"bold",color:"#3D2B1F",marginTop:2}}>{lastWee?formatTime(lastWee.created_at):"Not logged"}</div>
                </div>
                <div style={{flex:1,background:"#FDF5F0",borderRadius:10,padding:"10px 12px",fontSize:12}}>
                  <div style={{color:"#8B6A55"}}>Last poo</div>
                  <div style={{fontWeight:"bold",color:"#3D2B1F",marginTop:2}}>{lastPoo?formatTime(lastPoo.created_at):"Not logged"}</div>
                </div>
              </div>
            </div>
            <h3 style={S.sectionTitle}>Recent trips</h3>
            {toilet.length===0&&<div style={S.empty}>No trips logged yet</div>}
            {toilet.slice(0,20).map((t,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:18}}>{t.type==="wee"?"💧":"💩"}</span>
                  <div style={S.logPrimary}>{t.type==="wee"?"Wee":"Poo"}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(t.created_at)}</div><div style={S.logUser}>by {t.logged_by}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* WALKS */}
        {tab==="walks" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Log a walk</h3>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {["15","20","30","45","60","90"].map(m=>(
                  <button key={m} style={{...S.chipBtn,...(walkDuration===m?S.chipActive:{})}} onClick={()=>setWalkDuration(m)}>{m} min</button>
                ))}
              </div>
              <input style={S.input} placeholder="Distance (e.g. 2km) — optional" value={walkDistance} onChange={e=>setWalkDistance(e.target.value)} />
              <input style={S.input} placeholder="Notes (e.g. off lead in park)" value={walkNote} onChange={e=>setWalkNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logWalk}>🦮 Log walk</button>
            </div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Today</h3>
              {todayWalks.length===0
                ? <div style={{color:"#8B6A55",fontSize:13}}>No walks yet today</div>
                : <><div style={{fontSize:26,fontWeight:"bold",color:"#3D2B1F"}}>{todayWalkMins} <span style={{fontSize:13,color:"#8B6A55"}}>mins</span></div>
                  {todayWalks.map((w,i)=><div key={i} style={{fontSize:12,color:"#6B4F3A",marginTop:3}}>· {w.duration_mins} min{w.distance?` · ${w.distance}`:""} by {w.logged_by}{w.note?` — ${w.note}`:""}</div>)}
                </>}
            </div>
            <h3 style={S.sectionTitle}>Recent walks</h3>
            {walks.slice(0,15).map((w,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:18}}>🦮</span>
                  <div><div style={S.logPrimary}>{w.duration_mins} min{w.distance?` · ${w.distance}`:""}</div>{w.note&&<div style={S.logNote}>{w.note}</div>}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(w.created_at)}</div><div style={S.logUser}>by {w.logged_by}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* HEALTH */}
        {tab==="health" && (
          <div>
            {[{key:"flea",label:"Flea treatment",icon:"🐛",days:fleaDays,cycle:28},{key:"worm",label:"Worming",icon:"🪱",days:wormDays,cycle:90}].map(({key,label,icon,days,cycle})=>(
              <div key={key} style={S.card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div><h3 style={S.cardTitle}>{icon} {label}</h3>
                    <div style={{color:"#8B6A55",fontSize:11}}>{treatments[key]?`Last done ${days===0?"today":`${days}d ago`} by ${treatments[key].logged_by}`:"Not yet logged"}</div>
                  </div>
                  <div style={{borderRadius:20,padding:"4px 10px",color:"#fff",fontWeight:"bold",fontSize:11,background:days===null?"#ccc":days>=cycle?"#e74c3c":days>=cycle*0.75?"#f39c12":"#27ae60"}}>
                    {days===null?"?":days>=cycle?"Due!":`${cycle-days}d`}
                  </div>
                </div>
                {days!==null&&days<cycle&&<div style={{height:5,background:"#EDE0D4",borderRadius:3,marginBottom:10,overflow:"hidden"}}><div style={{height:"100%",borderRadius:3,width:`${Math.min(100,(days/cycle)*100)}%`,background:days>=cycle*0.75?"#f39c12":"#27ae60"}} /></div>}
                <button style={S.primaryBtn} onClick={()=>logTreatment(key)}>✅ Mark {key} done</button>
              </div>
            ))}
            <div style={S.card}>
              <h3 style={S.cardTitle}>😄 Mood log</h3>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {MOODS.map(m=>(
                  <button key={m.v} style={{...S.chipBtn,fontSize:11,...(selectedMood===m.v?S.chipActive:{})}} onClick={()=>setSelectedMood(m.v)}>{m.l}</button>
                ))}
              </div>
              <input style={S.input} placeholder="Any notes?" value={moodNote} onChange={e=>setMoodNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logMood}>Log mood</button>
              {mood.slice(0,3).map((m,i)=>(
                <div key={i} style={{...S.logItem,marginTop:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>{MOODS.find(x=>x.v===m.mood)?.l.split(" ")[1]||"😐"}</span>
                    <div><div style={S.logPrimary}>{MOODS.find(x=>x.v===m.mood)?.l||m.mood}</div>{m.note&&<div style={S.logNote}>{m.note}</div>}</div>
                  </div>
                  <div style={{textAlign:"right"}}><div style={S.logTime}>{formatDate(m.logged_date)}</div><div style={S.logUser}>by {m.logged_by}</div></div>
                </div>
              ))}
            </div>
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
                  <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(m.created_at)}</div><div style={S.logUser}>by {m.logged_by}</div></div>
                </div>
              ))}
            </div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>⚖️ Weight tracker</h3>
              <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
                <input type="number" step="0.1" style={{...S.input,flex:1,marginBottom:0}} placeholder="Weight in kg" value={newWeight} onChange={e=>setNewWeight(e.target.value)} />
                <button style={{...S.primaryBtn,width:"auto",padding:"9px 14px"}} onClick={logWeight}>Log</button>
              </div>
              {weight.length > 1 && (
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={weight}>
                    <XAxis dataKey="logged_date" tick={{fontSize:8}} tickFormatter={d=>d.slice(5)} />
                    <YAxis tick={{fontSize:8}} domain={["auto","auto"]} width={28} />
                    <Tooltip formatter={v=>[`${v}kg`,"Weight"]} contentStyle={{fontSize:10}} />
                    <Line type="monotone" dataKey="weight_kg" stroke="#3D2B1F" strokeWidth={2} dot={{r:2}} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {weight.slice(-5).reverse().map((w,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#6B4F3A",padding:"3px 0",borderBottom:"1px solid #EDE0D4"}}>
                  <span>{formatDate(w.logged_date)}</span><span style={{fontWeight:"bold"}}>{w.weight_kg} kg</span><span>{w.logged_by}</span>
                </div>
              ))}
            </div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>🔍 Behaviour notes</h3>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                {BEHAVIOUR_TYPES.map(b=>(
                  <button key={b} style={{...S.chipBtn,fontSize:10,padding:"4px 8px",...(behavType===b?S.chipActive:{})}} onClick={()=>setBehavType(b)}>{b}</button>
                ))}
              </div>
              <input style={S.input} placeholder="More details..." value={behavNote} onChange={e=>setBehavNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logBehaviour}>+ Log note</button>
              {behaviour.slice(0,5).map((b,i)=>(
                <div key={i} style={{...S.logItem,marginTop:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                    <span style={{fontSize:18}}>🔍</span>
                    <div><div style={S.logPrimary}>{b.type}</div>{b.note&&<div style={S.logNote}>{b.note}</div>}</div>
                  </div>
                  <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(b.created_at)}</div><div style={S.logUser}>by {b.logged_by}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VET */}
        {tab==="vet" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>Add appointment</h3>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <button style={{...S.chipBtn,...(vetIsUpcoming?S.chipActive:{})}} onClick={()=>setVetIsUpcoming(true)}>Upcoming</button>
                <button style={{...S.chipBtn,...(!vetIsUpcoming?S.chipActive:{})}} onClick={()=>setVetIsUpcoming(false)}>Past visit</button>
              </div>
              <input type="date" style={S.input} value={vetDate} onChange={e=>setVetDate(e.target.value)} />
              <input style={S.input} placeholder="Reason (e.g. annual checkup)" value={vetReason} onChange={e=>setVetReason(e.target.value)} />
              <input style={S.input} placeholder="Notes (e.g. what vet said)" value={vetNotes} onChange={e=>setVetNotes(e.target.value)} />
              <button style={S.primaryBtn} onClick={addVetAppt}>🏥 Save appointment</button>
            </div>
            {upcomingVet.length>0&&<><h3 style={S.sectionTitle}>Upcoming</h3>
              {upcomingVet.map(a=>(
                <div key={a.id} style={{...S.eventCard,borderLeft:"4px solid #27ae60",marginBottom:8}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:"bold",color:"#3D2B1F",fontSize:12}}>🏥 {a.reason}</div>
                    <div style={{fontSize:10,color:"#8B6A55"}}>{formatDate(a.appt_date)} · {a.added_by}</div>
                    {a.notes&&<div style={{fontSize:10,color:"#6B4F3A",marginTop:1}}>📝 {a.notes}</div>}
                  </div>
                  <button style={S.delBtn} onClick={()=>deleteVetAppt(a.id)}>✕</button>
                </div>
              ))}</>}
            <h3 style={S.sectionTitle}>All appointments</h3>
            {vetAppts.length===0&&<div style={S.empty}>No appointments logged yet</div>}
            {vetAppts.filter(a=>!a.upcoming||a.appt_date<today).map(a=>(
              <div key={a.id} style={{...S.eventCard,borderLeft:"4px solid #8B6A55",marginBottom:8}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:"bold",color:"#3D2B1F",fontSize:12}}>🏥 {a.reason}</div>
                  <div style={{fontSize:10,color:"#8B6A55"}}>{formatDate(a.appt_date)} · {a.added_by}</div>
                  {a.notes&&<div style={{fontSize:10,color:"#6B4F3A",marginTop:1}}>📝 {a.notes}</div>}
                </div>
                <button style={S.delBtn} onClick={()=>deleteVetAppt(a.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* GROOMING */}
        {tab==="grooming" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>✂️ Log grooming</h3>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {GROOMING_TYPES.map(g=>(
                  <button key={g} style={{...S.chipBtn,...(groomType===g?S.chipActive:{})}} onClick={()=>setGroomType(g)}>{g}</button>
                ))}
              </div>
              <input style={S.input} placeholder="Notes (optional)" value={groomNote} onChange={e=>setGroomNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logGrooming}>✂️ Log grooming</button>
            </div>
            <h3 style={S.sectionTitle}>Recent grooming</h3>
            {grooming.length===0&&<div style={S.empty}>No grooming logged yet</div>}
            {grooming.slice(0,15).map((g,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:18}}>✂️</span>
                  <div><div style={S.logPrimary}>{g.type}</div>{g.note&&<div style={S.logNote}>{g.note}</div>}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(g.created_at)}</div><div style={S.logUser}>by {g.logged_by}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* TRAINING */}
        {tab==="training" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>🎓 Log training session</h3>
              <input style={S.input} placeholder="Commands practised (e.g. sit, stay, recall)" value={trainCommands} onChange={e=>setTrainCommands(e.target.value)} />
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {["Excellent","Good","Okay","Struggling"].map(r=>(
                  <button key={r} style={{...S.chipBtn,...(trainRating===r?S.chipActive:{})}} onClick={()=>setTrainRating(r)}>{r}</button>
                ))}
              </div>
              <input style={S.input} placeholder="Notes (e.g. great focus today!)" value={trainNote} onChange={e=>setTrainNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={logTraining}>🎓 Log session</button>
            </div>
            <h3 style={S.sectionTitle}>Recent sessions</h3>
            {training.length===0&&<div style={S.empty}>No training logged yet</div>}
            {training.slice(0,15).map((t,i)=>(
              <div key={i} style={S.logItem}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                  <span style={{fontSize:18}}>🎓</span>
                  <div><div style={S.logPrimary}>{t.commands}</div><div style={S.logNote}>{t.rating}{t.note?` · ${t.note}`:""}</div></div>
                </div>
                <div style={{textAlign:"right"}}><div style={S.logTime}>{formatTime(t.created_at)}</div><div style={S.logUser}>by {t.logged_by}</div></div>
              </div>
            ))}
          </div>
        )}

        {/* MILESTONES */}
        {tab==="milestones" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>⭐ Add a milestone</h3>
              <input type="date" style={S.input} value={milestoneDate} onChange={e=>setMilestoneDate(e.target.value)} />
              <input style={S.input} placeholder="What happened? (e.g. first swim!)" value={milestoneTitle} onChange={e=>setMilestoneTitle(e.target.value)} />
              <input style={S.input} placeholder="More details (optional)" value={milestoneNote} onChange={e=>setMilestoneNote(e.target.value)} />
              <button style={S.primaryBtn} onClick={addMilestone}>⭐ Save milestone</button>
            </div>
            <h3 style={S.sectionTitle}>Barney's moments</h3>
            {milestones.length===0&&<div style={S.empty}>No milestones yet — add Barney's first one! 🐾</div>}
            {milestones.map((m,i)=>(
              <div key={i} style={{...S.eventCard,borderLeft:"4px solid #C4A85A",marginBottom:8}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:"bold",color:"#3D2B1F",fontSize:13}}>⭐ {m.title}</div>
                  <div style={{fontSize:10,color:"#8B6A55"}}>{formatDate(m.milestone_date)} · {m.added_by}</div>
                  {m.note&&<div style={{fontSize:10,color:"#6B4F3A",marginTop:1}}>📝 {m.note}</div>}
                </div>
                <button style={S.delBtn} onClick={()=>deleteMilestone(m.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* EXPENSES */}
        {tab==="expenses" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>💰 Log an expense</h3>
              <input type="date" style={S.input} value={expDate} onChange={e=>setExpDate(e.target.value)} />
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
                {EXPENSE_CATS.map(c=>(
                  <button key={c} style={{...S.chipBtn,fontSize:11,padding:"4px 10px",...(expCat===c?S.chipActive:{})}} onClick={()=>setExpCat(c)}>{c}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <div style={{position:"relative",flex:1}}>
                  <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#8B6A55",fontSize:14}}>£</span>
                  <input type="number" step="0.01" style={{...S.input,marginBottom:0,paddingLeft:24}} placeholder="0.00" value={expAmount} onChange={e=>setExpAmount(e.target.value)} />
                </div>
              </div>
              <input style={S.input} placeholder="Description (optional)" value={expDesc} onChange={e=>setExpDesc(e.target.value)} />
              <button style={S.primaryBtn} onClick={addExpense}>💰 Save expense</button>
            </div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>This month</h3>
              <div style={{fontSize:28,fontWeight:"bold",color:"#3D2B1F"}}>£{thisMonthExp.toFixed(2)}</div>
              <div style={{marginTop:8}}>
                {EXPENSE_CATS.map(cat=>{
                  const total = expenses.filter(e=>e.expense_date?.slice(0,7)===today.slice(0,7)&&e.category===cat).reduce((s,e)=>s+e.amount,0);
                  if (!total) return null;
                  return <div key={cat} style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#6B4F3A",padding:"2px 0"}}><span>{cat}</span><span>£{total.toFixed(2)}</span></div>;
                })}
              </div>
            </div>
            <h3 style={S.sectionTitle}>All expenses</h3>
            {expenses.length===0&&<div style={S.empty}>No expenses logged yet</div>}
            {expenses.map((e,i)=>(
              <div key={i} style={{...S.logItem,marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
                  <span style={{fontSize:18}}>💰</span>
                  <div><div style={S.logPrimary}>{e.category} · £{parseFloat(e.amount).toFixed(2)}</div>{e.description&&<div style={S.logNote}>{e.description}</div>}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                  <div style={S.logTime}>{formatDate(e.expense_date)}</div>
                  <div style={S.logUser}>{e.added_by}</div>
                  <button style={S.delBtn} onClick={()=>deleteExpense(e.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* INFO */}
        {tab==="info" && (
          <div>
            {!editingInfo ? (
              <div style={S.card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <h3 style={{...S.cardTitle,margin:0}}>📋 Barney's Info</h3>
                  <button style={S.addBtn} onClick={()=>{setInfoEdit({...info});setEditingInfo(true);}}>Edit</button>
                </div>
                {[
                  {label:"Microchip",icon:"🔖",val:info.microchip},
                  {label:"Vet practice",icon:"🏥",val:info.vet},
                  {label:"Vet phone",icon:"📞",val:info.vet_phone},
                  {label:"Insurance",icon:"📄",val:info.insurance},
                  {label:"Emergency contact",icon:"🚨",val:info.emergency_name},
                  {label:"Emergency phone",icon:"📞",val:info.emergency_phone},
                ].map(({label,icon,val})=>(
                  <div key={label} style={{padding:"8px 0",borderBottom:"1px solid #EDE0D4"}}>
                    <div style={{fontSize:10,color:"#8B6A55",marginBottom:1}}>{icon} {label}</div>
                    <div style={{fontSize:13,color:val?"#3D2B1F":"#ccc",fontWeight:val?"bold":"normal"}}>{val||"Not set"}</div>
                  </div>
                ))}
                {info.notes&&<div style={{marginTop:10}}><div style={{fontSize:10,color:"#8B6A55",marginBottom:3}}>📝 Notes</div><div style={{fontSize:12,color:"#3D2B1F"}}>{info.notes}</div></div>}
              </div>
            ) : (
              <div style={S.card}>
                <h3 style={S.cardTitle}>Edit Info</h3>
                {[
                  {key:"microchip",label:"Microchip number"},
                  {key:"vet",label:"Vet practice name"},
                  {key:"vet_phone",label:"Vet phone number"},
                  {key:"insurance",label:"Insurance provider / policy"},
                  {key:"emergency_name",label:"Emergency contact name"},
                  {key:"emergency_phone",label:"Emergency contact phone"},
                ].map(({key,label})=>(
                  <div key={key}>
                    <div style={{fontSize:10,color:"#8B6A55",marginBottom:2}}>{label}</div>
                    <input style={S.input} value={infoEdit[key]||""} onChange={e=>setInfoEdit(p=>({...p,[key]:e.target.value}))} />
                  </div>
                ))}
                <div style={{fontSize:10,color:"#8B6A55",marginBottom:2}}>Notes</div>
                <textarea style={{...S.input,height:70,resize:"vertical"}} value={infoEdit.notes||""} onChange={e=>setInfoEdit(p=>({...p,notes:e.target.value}))} />
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.primaryBtn,flex:1}} onClick={saveInfo}>Save</button>
                  <button style={{...S.primaryBtn,flex:1,background:"#EDE0D4",color:"#3D2B1F"}} onClick={()=>setEditingInfo(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PHOTOS */}
        {tab==="photos" && (
          <div>
            <div style={S.card}>
              <h3 style={S.cardTitle}>📸 Add a photo</h3>
              <label style={{display:"block",background:"#EDE0D4",borderRadius:10,padding:"18px",textAlign:"center",cursor:"pointer",marginBottom:10,border:"2px dashed #D4A574"}}>
                <div style={{fontSize:28}}>📷</div>
                <div style={{fontSize:12,color:"#6B4F3A",marginTop:3}}>Tap to choose a photo</div>
                <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setPhotoData(ev.target.result);r.readAsDataURL(f);}} />
              </label>
              {photoData&&<img src={photoData} style={{width:"100%",borderRadius:10,marginBottom:10,maxHeight:180,objectFit:"cover"}} />}
              <input style={S.input} placeholder="Caption (e.g. first day at daycare!)" value={photoCaption} onChange={e=>setPhotoCaption(e.target.value)} />
              <button style={{...S.primaryBtn,opacity:photoData?1:0.5}} onClick={savePhoto}>Save photo</button>
            </div>
            {photos.length===0&&<div style={S.empty}>No photos yet — add one! 🐶</div>}
            {photos.map(p=>(
              <div key={p.id} style={{...S.card,padding:0,overflow:"hidden",marginBottom:12}}>
                {p.data&&<img src={p.data} style={{width:"100%",maxHeight:200,objectFit:"cover",display:"block"}} />}
                <div style={{padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>{p.caption&&<div style={{fontSize:12,fontWeight:"bold",color:"#3D2B1F"}}>{p.caption}</div>}<div style={{fontSize:10,color:"#8B6A55"}}>{formatDate(p.photo_date)} · {p.added_by}</div></div>
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
  userBtn:     { background:"#fff", border:"2px solid #D4A574", borderRadius:14, padding:"16px 22px", cursor:"pointer", fontSize:14, display:"flex", flexDirection:"column", alignItems:"center", gap:7, color:"#3D2B1F", fontWeight:"bold", boxShadow:"0 2px 8px rgba(0,0,0,0.08)" },
  header:      { background:"#3D2B1F", color:"#FDF8F3", padding:"11px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  switchBtn:   { background:"rgba(255,255,255,0.15)", border:"none", color:"#FDF8F3", padding:"4px 11px", borderRadius:20, cursor:"pointer", fontSize:11 },
  alertBar:    { background:"#e74c3c", color:"#fff", padding:"6px 14px", fontSize:11, fontWeight:"bold", display:"flex", gap:12, flexWrap:"wrap", flexShrink:0 },
  tabBar:      { display:"flex", background:"#fff", borderBottom:"2px solid #EDE0D4", overflowX:"auto", flexShrink:0 },
  tabBtn:      { minWidth:48, padding:"8px 4px", border:"none", background:"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:1, color:"#8B6A55", fontSize:14, flexShrink:0 },
  tabActive:   { color:"#3D2B1F", borderBottom:"3px solid #D4A574" },
  content:     { flex:1, padding:12, overflowY:"auto" },
  card:        { background:"#fff", borderRadius:12, padding:16, marginBottom:12, boxShadow:"0 2px 8px rgba(0,0,0,0.05)", border:"1px solid #EDE0D4" },
  cardTitle:   { margin:"0 0 10px", color:"#3D2B1F", fontSize:14, fontWeight:"bold" },
  sectionTitle:{ color:"#6B4F3A", fontSize:11, fontWeight:"bold", textTransform:"uppercase", letterSpacing:1, margin:"12px 0 6px" },
  input:       { width:"100%", padding:"8px 11px", borderRadius:8, border:"1px solid #D4A574", fontSize:13, color:"#3D2B1F", background:"#FDF8F3", marginBottom:9, boxSizing:"border-box", outline:"none", fontFamily:"inherit" },
  timeInput:   { width:"100%", padding:"8px 11px", borderRadius:8, border:"1px solid #D4A574", fontSize:13, color:"#3D2B1F", background:"#FDF8F3", boxSizing:"border-box", outline:"none" },
  primaryBtn:  { width:"100%", padding:11, background:"#3D2B1F", color:"#FDF8F3", border:"none", borderRadius:9, cursor:"pointer", fontSize:13, fontWeight:"bold", fontFamily:"inherit" },
  chipBtn:     { padding:"5px 11px", borderRadius:20, border:"2px solid #D4A574", background:"#fff", color:"#6B4F3A", cursor:"pointer", fontSize:12, fontWeight:"bold" },
  chipActive:  { background:"#D4A574", color:"#fff" },
  bigBtn:      { flex:1, padding:"16px 8px", color:"#fff", border:"none", borderRadius:11, cursor:"pointer", fontSize:14, fontWeight:"bold", display:"flex", flexDirection:"column", alignItems:"center", gap:5 },
  logItem:     { background:"#fff", borderRadius:9, padding:"9px 12px", marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.05)", border:"1px solid #EDE0D4" },
  logPrimary:  { fontWeight:"bold", color:"#3D2B1F", fontSize:12 },
  logNote:     { color:"#8B6A55", fontSize:10, marginTop:1 },
  logTime:     { fontSize:10, color:"#6B4F3A", fontWeight:"bold" },
  logUser:     { fontSize:9, color:"#8B6A55" },
  empty:       { color:"#8B6A55", textAlign:"center", padding:"18px 0", fontSize:13 },
  countBtn:    { flex:1, padding:9, background:"#EDE0D4", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:"bold", color:"#3D2B1F" },
  navBtn:      { background:"#EDE0D4", border:"none", borderRadius:7, padding:"4px 11px", cursor:"pointer", fontSize:17, color:"#3D2B1F", fontWeight:"bold" },
  dayCell:     { display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:"6px 2px", borderRadius:9, border:"2px solid transparent", background:"#fff", cursor:"pointer", boxShadow:"0 1px 3px rgba(0,0,0,0.05)" },
  dayCellSel:  { background:"#3D2B1F", border:"2px solid #3D2B1F" },
  dayCellToday:{ border:"2px solid #D4A574" },
  addBtn:      { background:"#3D2B1F", color:"#fff", border:"none", borderRadius:20, padding:"4px 12px", cursor:"pointer", fontWeight:"bold", fontSize:11 },
  eventCard:   { background:"#fff", borderRadius:9, padding:"9px 11px", marginBottom:7, display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 1px 4px rgba(0,0,0,0.05)", border:"1px solid #EDE0D4" },
  delBtn:      { background:"#EDE0D4", border:"none", borderRadius:20, padding:"3px 8px", cursor:"pointer", color:"#6B4F3A", fontSize:10, fontWeight:"bold", flexShrink:0 },
  modalOverlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:100 },
  modal:       { background:"#FDF8F3", borderRadius:"16px 16px 0 0", padding:20, width:"100%", maxWidth:480, maxHeight:"88vh", overflowY:"auto" },
  locBtn:      { display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"9px 5px", borderRadius:9, border:"2px solid #D4A574", background:"#fff", cursor:"pointer", color:"#6B4F3A", fontWeight:"bold" },
};
