// Load config
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helpers fecha
function todayStr(){
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off*60000);
  return local.toISOString().slice(0,10);
}
function weekStart(d){ // Lunes
  const date = new Date(d);
  const day = (date.getDay()+6)%7; // 0=Mon ... 6=Sun
  date.setDate(date.getDate() - day);
  date.setHours(0,0,0,0);
  return date;
}
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function toDate(str){ return new Date(str + "T00:00:00"); }
function weekKeyFromDateObj(d){ return weekStart(d).toISOString().slice(0,10); }
function weekKey(dateStr){ return weekKeyFromDateObj(toDate(dateStr)); }

// DOM
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
const loginBtn = document.getElementById('login-btn');
const loginMsg = document.getElementById('login-msg');
const logoutBtn = document.getElementById('logout-btn');
const navDashboard = document.getElementById('nav-dashboard');
const navHabits = document.getElementById('nav-habits');
const navFinance = document.getElementById('nav-finance');
const dashboardView = document.getElementById('dashboard-view');
const habitsView = document.getElementById('habits-view');
const financeView = document.getElementById('finance-view');
const couponsGrid = document.getElementById('coupons-grid');
const habitMsg = document.getElementById('habit-msg');
const habitsSummary = document.getElementById('habits-summary');
const habitIndicators = document.getElementById('habit-indicators');
const filterBtns = document.querySelectorAll('.filters .chip');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');
const resetHabitsBtn = document.getElementById('reset-habits');
const habitDateInput = document.getElementById('habit-date');

let COUPONS = [];
let sessionUser = null;

async function loadCoupons(){
  const res = await fetch('./data/coupons.json');
  COUPONS = await res.json();
}

// Supabase tables:
// habit_log: id uuid pk, user_id uuid, date date, diet text, exercise_sessions int, created_at
// coupon_state: id uuid pk, user_id uuid, coupon_id text, redeemed_count int, created_at, updated_at

async function signIn(username, password){
  const email = `${username}@local.test`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error){ throw error; }
  sessionUser = data.user;
  return data.user;
}
async function signOut(){
  await supabase.auth.signOut();
  sessionUser = null;
}

// Bootstrap coupon_state rows si faltan
async function bootstrapCouponState(){
  const { data: rows, error } = await supabase
   .from('coupon_state')
   .select('coupon_id')
   .eq('user_id', sessionUser.id);
  if(error){ console.error(error); return; }
  const existing = new Set((rows||[]).map(r=>r.coupon_id));
  const missing = COUPONS.filter(c=>!existing.has(c.id));
  if(missing.length>0){
    const inserts = missing.map(c=>({
      user_id: sessionUser.id,
      coupon_id: c.id,
      redeemed_count: 0
    }));
    const { error: insErr } = await supabase.from('coupon_state').insert(inserts);
    if(insErr) console.error(insErr);
  }
}

// UI helpers
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }
function openModal(html){ modalBody.innerHTML = html; show(modal); }
function closeModal(){ hide(modal); }

// --- RESET HÁBITOS ---
async function resetHabits(){
  if(!confirm('¿Seguro que quieres reiniciar todos los hábitos? Esta acción no se puede deshacer.')) return;
  const { error } = await supabase.from('habit_log').delete().eq('user_id', sessionUser.id);
  if(error){
    console.error(error);
    habitMsg.textContent = 'Error al reiniciar. Revisa que tengas la política DELETE en Supabase.';
    return;
  }
  habitMsg.textContent = 'Hábitos reiniciados ✔️';
  // Refrescar todo
  await renderDashboard(currentFilter);
  await renderHabitsSummary();
  await renderHabitIndicators();
}

// Reiniciar usos de un cupón (con clave)
async function resetCouponUses(couponId){
  const pass = prompt("Contraseña para reiniciar");
  if(pass !== "jv082000"){ alert("Contraseña incorrecta."); return; }
  const { data: row, error } = await supabase
    .from('coupon_state')
    .select('*').eq('user_id', sessionUser.id).eq('coupon_id', couponId).single();
  if(error){ console.error(error); return; }
  const { error: upErr } = await supabase.from('coupon_state')
    .update({ redeemed_count: 0, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if(upErr){ console.error(upErr); alert("No se pudo reiniciar."); return; }
  await renderDashboard(currentFilter);
  alert("Cupón reiniciado a 0 usos.");
}

// Ticket (sin texto extra)
async function showRedeemedTicket(coupon){
  const date = new Date().toLocaleString();
  const modalHtml = `
    <div class="ticket">
      <h3>${coupon.titulo}</h3>
      <p>Canjeado el: ${date}</p>
      <canvas id="ticket-canvas" width="720" height="400" style="width:100%;max-width:720px;"></canvas>
      <div class="share-actions">
        <button id="btn-share">Compartir por WhatsApp</button>
        <a id="btn-download" class="secondary" download="cupon-${coupon.id}.png">Descargar imagen</a>
      </div>
    </div>
  `;
  openModal(modalHtml);

  const canvas = document.getElementById('ticket-canvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FAF4E6'; ctx.fillRect(0,0,720,400);
  ctx.strokeStyle = '#C9A227'; ctx.lineWidth = 6; ctx.setLineDash([12,8]); ctx.strokeRect(10,10,700,380);
  ctx.setLineDash([]);
  ctx.fillStyle = '#6B4F3A';
  ctx.font = '28px system-ui';
  ctx.fillText('Cupón canjeado', 30, 60);
  ctx.font = 'bold 34px system-ui';
  ctx.fillText(coupon.titulo.substring(0,34), 30, 120);
  ctx.font = '22px system-ui';
  ctx.fillText(`Fecha: ${date}`, 30, 170);

  const dataURL = canvas.toDataURL('image/png');
  const dl = document.getElementById('btn-download');
  dl.href = dataURL;

  document.getElementById('btn-share').addEventListener('click', async ()=>{
    const text = `¡Canjeado! ${coupon.titulo} • ${date}`;
    try{
      const res = await fetch(dataURL);
      const blob = await res.blob();
      const file = new File([blob], `cupon-${coupon.id}.png`, { type: 'image/png' });
      if(navigator.canShare && navigator.canShare({ files: [file] })){
        await navigator.share({ files:[file], title:'Cupón canjeado', text });
        return;
      }
    }catch(e){}
    const url = 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank');
  });
}

// Fetch
async function fetchStates(){
  const { data, error } = await supabase
    .from('coupon_state')
    .select('*')
    .eq('user_id', sessionUser.id);
  if(error){ console.error(error); return []; }
  return data;
}
async function fetchHabits(lastNDays = 120){
  const fromDate = addDays(new Date(), -lastNDays);
  const { data, error } = await supabase
    .from('habit_log')
    .select('*')
    .eq('user_id', sessionUser.id)
    .gte('date', fromDate.toISOString().slice(0,10))
    .order('date', { ascending: true });
  if(error){ console.error(error); return []; }
  return data;
}

// Estado cupón
function computeStatus(coupon, stateRow, habits, allStates){
  if(coupon.tipo === 'sorpresa'){
    return { status: 'en_progreso', progress: 0, usesLeft: 0 };
  }
  const used = stateRow?.redeemed_count || 0;
  const usesLeft = Math.max(0, (coupon.max_uses||0) - used);
  if(coupon.tipo === 'directo'){
    const status = usesLeft>0 ? 'disponible' : 'canjeado';
    return { status, progress: (used/(coupon.max_uses||1))*100, usesLeft };
  }

  let progressPct = 0;
  const req = coupon.requirements || {};
  function countRedeemed(id){
    const r = allStates.find(s=>s.coupon_id===id);
    return r? (r.redeemed_count||0) : 0;
  }
  const byDate = new Map(habits.map(h=>[h.date, h]));
  const today = new Date();

  function lastConsecutiveHealthy(daysNeeded){
    let count=0;
    for(let i=0;i<200;i++){
      const d = addDays(today, -i);
      const key = d.toISOString().slice(0,10);
      const row = byDate.get(key);
      const healthy = row && row.diet==='healthy';
      if(healthy){ count++; if(count>=daysNeeded) return true; }
      else break;
    }
    return false;
  }
  function healthyDaysInLastN(n){
    const from = addDays(today, -n+1);
    let healthy=0;
    for(let d=new Date(from); d<=today; d=addDays(d,1)){
      const key = d.toISOString().slice(0,10);
      const row = byDate.get(key);
      if(row && row.diet==='healthy') healthy++;
    }
    return healthy;
  }
  function weeklyCheatOk(rangeDays, allowedPerWeek){
    const from = addDays(today, -rangeDays+1);
    let weekPtr = weekStart(from);
    while(weekPtr <= today){
      const weekEnd = addDays(weekPtr, 6);
      let junk=0;
      for(let d=new Date(weekPtr); d<=weekEnd && d<=today; d=addDays(d,1)){
        if(d<from) continue;
        const key = d.toISOString().slice(0,10);
        const row = byDate.get(key);
        if(row && row.diet==='junk') junk++;
      }
      if(junk > allowedPerWeek) return false;
      weekPtr = addDays(weekPtr, 7);
    }
    return true;
  }
  function exercisePerWeekOk(weeks, perWeek){
    const start = weekStart(addDays(today, -7*(weeks-1)));
    let w = new Date(start);
    for(let k=0;k<weeks;k++){
      const we = addDays(w, 6);
      let cnt=0;
      for(let d=new Date(w); d<=we && d<=today; d=addDays(d,1)){
        const key = d.toISOString().slice(0,10);
        const row = byDate.get(key);
        cnt += row ? (row.exercise_sessions||0) : 0;
      }
      if(cnt < perWeek) return false;
      w = addDays(w, 7);
    }
    return true;
  }

  function evalReq(r){
    if(!r) return true;
    if(r.type==='streak'){
      const ok = lastConsecutiveHealthy(r.days||1);
      progressPct = ok ? 100 : 0;
      return ok;
    }
    if(r.type==='checklist'){
      const n = r.days||30;
      const healthy = healthyDaysInLastN(n);
      const okCheat = weeklyCheatOk(n, r.weeklyCheat||0);
      progressPct = Math.min(100, (healthy/n)*100);
      return (healthy>=n) && okCheat;
    }
    if(r.type==='weeklyTarget'){
      const weeks = r.weeks||1;
      if(r.metric==='ejercicio'){
        const ok = exercisePerWeekOk(weeks, r.perWeek||3);
        progressPct = ok ? 100 : 50;
        return ok;
      }
      if(r.metric==='dieta_saludable'){
        const perWeek = r.perWeek||6;
        const start = weekStart(addDays(today, -7*(weeks-1)));
        let w = new Date(start);
        for(let k=0;k<weeks;k++){
          const we = addDays(w, 6);
          let healthy=0, junk=0;
          for(let d=new Date(w); d<=we && d<=today; d=addDays(d,1)){
            const key = d.toISOString().slice(0,10);
            const row = byDate.get(key);
            if(row && row.diet==='healthy') healthy++;
            if(row && row.diet==='junk') junk++;
          }
          if(healthy < perWeek) return false;
          if((r.weeklyCheat||0) < junk) return false;
          w = addDays(w, 7);
        }
        progressPct = 100;
        return true;
      }
    }
    if(r.type==='redeemed'){
      return countRedeemed(r.couponId) >= (r.count||1);
    }
    if(r.type==='allOf'){
      return (r.requirements||[]).every(evalReq);
    }
    return true;
  }

  const eligible = evalReq(req);
  const status = eligible ? (usesLeft>0 ? 'disponible' : 'canjeado') : 'en_progreso';
  return { status, progress: progressPct, usesLeft };
}

function statusLabel(s){
  if(s==='disponible') return 'Disponible';
  if(s==='en_progreso') return 'En curso';
  if(s==='canjeado') return 'Canjeado';
  return s;
}

async function renderDashboard(filter="all"){
  const states = await fetchStates();
  const habits = await fetchHabits(120);
  couponsGrid.innerHTML = "";
  for(const c of COUPONS){
    const row = states.find(r=>r.coupon_id===c.id) || { redeemed_count:0 };
    const comp = computeStatus(c, row, habits, states);
    if(filter==="available" && comp.status!=='disponible') continue;
    if(filter==="inprogress" && comp.status!=='en_progreso') continue;
    if(filter==="redeemed" && comp.status!=='canjeado') continue;

    const div = document.createElement('div');
    div.className = "coupon";
    div.innerHTML = `
      <button class="mini-reset" title="Reiniciar cupón" data-action="reset-coupon" data-id="${c.id}">R</button>
      <span class="badge ${comp.status.replace('_','')}">${statusLabel(comp.status)}</span>
      <h4>${c.titulo}</h4>
      <p>${c.descripcion||''}</p>
      <div class="progressbar"><div style="width:${Math.round(comp.progress)}%"></div></div>
      <div class="row">
        <button class="secondary" data-action="ver" data-id="${c.id}">Ver</button>
        ${ (c.tipo!=='sorpresa' && comp.status==='disponible' && comp.usesLeft>0) ? `<button data-action="canjear" data-id="${c.id}">Canjear</button>` : ''}
        ${ (c.tipo==='reto') ? `<button data-action="detalles" data-id="${c.id}">Progreso</button>` : ''}
      </div>
      <small>Usos restantes: ${comp.usesLeft}</small>
    `;
    couponsGrid.appendChild(div);
  }
}

// ----- LÓGICA DE HÁBITOS -----

// Marca en la fecha seleccionada (input date)
async function markForDate(kind, dateStr){
  const { data: existing } = await supabase
     .from('habit_log').select('*')
     .eq('user_id', sessionUser.id)
     .eq('date', dateStr)
     .maybeSingle();

  let patch = { user_id: sessionUser.id, date: dateStr };
  if(kind==='healthy'){ patch.diet = 'healthy'; }
  if(kind==='junk'){ patch.diet = 'junk'; }
  if(kind==='exercise'){ patch.exercise_sessions = (existing?.exercise_sessions||0) + 1; }

  if(existing){
    const { error } = await supabase.from('habit_log').update(patch).eq('id', existing.id);
    if(error){ console.error(error); habitMsg.textContent = "Error al guardar"; return; }
  }else{
    if(kind==='exercise'){ patch.exercise_sessions = 1; }
    const { error } = await supabase.from('habit_log').insert(patch);
    if(error){ console.error(error); habitMsg.textContent = "Error al guardar"; return; }
  }
  habitMsg.textContent = "Guardado ✔️";
  await renderDashboard(currentFilter);
  await renderHabitsSummary();
  await renderHabitIndicators();
}

// Resumen 4 semanas
async function renderHabitsSummary(){
  const logs = await fetchHabits(28);
  let byWeek = new Map();
  const keys = [];
  for(const row of logs){
    const ws = weekKey(row.date);
    if(!byWeek.has(ws)) keys.push(ws);
    const obj = byWeek.get(ws) || {healthy:0, junk:0, exercise:0};
    if(row.diet==='healthy') obj.healthy++;
    if(row.diet==='junk') obj.junk++;
    obj.exercise += (row.exercise_sessions||0);
    byWeek.set(ws, obj);
  }
  keys.sort();
  let html = `<table class="card" style="width:100%"><tr><th>Semana (Lun-Dom)</th><th>Saludable</th><th>Chatarra</th><th>Ejercicio (ses.)</th></tr>`;
  for(const k of keys){
    const v = byWeek.get(k);
    html += `<tr><td>${k}</td><td>${v.healthy}</td><td>${v.junk}</td><td>${v.exercise}</td></tr>`;
  }
  if(keys.length===0){
    html += `<tr><td colspan="4" style="text-align:center;color:#6a5e52">Sin datos. ¡Empieza hoy! ✨</td></tr>`;
  }
  html += `</table>`;
  habitsSummary.innerHTML = html;
}

// Indicadores (con “1 chatarra por semana no rompe racha saludable”)
async function renderHabitIndicators(){
  const logs = await fetchHabits(120);
  const byDate = new Map(logs.map(h=>[h.date, h]));
  const today = new Date();

  // Racha saludable con tolerancia semanal
  // Mientras vayamos hacia atrás:
  // - Día 'healthy' => cuenta
  // - Día 'junk' => permite SOLO si en esa semana aún no se superó 1 junk (contamos por semana hacia atrás)
  // - Día sin registro => rompe racha
  let healthyStreak = 0;
  const weekJunkSeen = new Map(); // weekKey -> junkCount encontrado en la racha
  for(let i=0;i<365;i++){
    const d = addDays(today, -i);
    const key = d.toISOString().slice(0,10);
    const row = byDate.get(key);
    if(!row){ break; }
    if(row.diet === 'healthy'){
      healthyStreak++;
      continue;
    }
    if(row.diet === 'junk'){
      const wk = weekKeyFromDateObj(d);
      const used = weekJunkSeen.get(wk) || 0;
      if(used < 1){
        weekJunkSeen.set(wk, used + 1);
        healthyStreak++; // no rompe racha
        continue;
      }else{
        break; // ya hay >1 junk en esa semana
      }
    }
    break;
  }

  // Racha ejercicio (días consecutivos con >=1 sesión)
  let exerciseStreak = 0;
  for(let i=0;i<365;i++){
    const d = addDays(today, -i);
    const key = d.toISOString().slice(0,10);
    const row = byDate.get(key);
    if(row && (row.exercise_sessions||0)>0){ exerciseStreak++; } else { break; }
  }

  // Últimos 30 días
  let healthy30 = 0, exercise30 = 0;
  for(let i=0;i<30;i++){
    const d = addDays(today, -i);
    const key = d.toISOString().slice(0,10);
    const row = byDate.get(key);
    if(row && row.diet==='healthy') healthy30++;
    if(row) exercise30 += (row.exercise_sessions||0);
  }

  // Ejercicio esta semana (Lun-Dom)
  const ws = weekStart(today);
  let exerciseThisWeek = 0;
  for(let d = new Date(ws); d <= addDays(ws,6); d = addDays(d,1)){
    const key = d.toISOString().slice(0,10);
    const row = byDate.get(key);
    if(row) exerciseThisWeek += (row.exercise_sessions||0);
  }

  // Semanas consecutivas cumpliendo meta (>=3 sesiones/sem)
  let weeksInARow = 0;
  for(let w=0; w<26; w++){
    const start = addDays(weekStart(today), -7*w);
    const end = addDays(start, 6);
    let cnt = 0;
    for(let d = new Date(start); d <= end; d = addDays(d,1)){
      const key = d.toISOString().slice(0,10);
      const row = byDate.get(key);
      if(row) cnt += (row.exercise_sessions||0);
    }
    if(cnt >= 3){ weeksInARow++; } else { break; }
  }

  habitIndicators.innerHTML = `
    <div class="indicator">
      <h4>Racha saludable</h4>
      <div class="big">${healthyStreak} días</div>
      <div class="sub">Tolera 1 chatarra/sem sin romper</div>
    </div>
    <div class="indicator">
      <h4>Racha de ejercicio</h4>
      <div class="big">${exerciseStreak} días</div>
      <div class="sub">Días seguidos con ≥1 sesión</div>
    </div>
    <div class="indicator">
      <h4>Últimos 30 días</h4>
      <div class="big">${healthy30} saludables · ${exercise30} ses.</div>
      <div class="sub">Balance del último mes</div>
    </div>
    <div class="indicator">
      <h4>Ejercicio esta semana</h4>
      <div class="big">${exerciseThisWeek} ses.</div>
      <div class="sub">Objetivo: 3 por semana</div>
    </div>
    <div class="indicator">
      <h4>Semanas seguidas cumpliendo</h4>
      <div class="big">${weeksInARow}</div>
      <div class="sub">≥3 sesiones/sem consecutivas</div>
    </div>
  `;
}

// Routing
function showDashboard(){ show(dashboardView); hide(habitsView); hide(financeView); }
function showHabits(){ hide(dashboardView); show(habitsView); hide(financeView); }
function showFinance(){ hide(dashboardView); hide(habitsView); show(financeView); }

let currentFilter = "all";
filterBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    filterBtns.forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    currentFilter = btn.getAttribute('data-filter');
    renderDashboard(currentFilter);
  });
});

// Eventos
loginBtn.addEventListener('click', async ()=>{
  loginMsg.textContent = "Conectando...";
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value.trim();
  try{
    await signIn(u, p);
    hide(loginSection); show(appSection);
    await loadCoupons();
    await bootstrapCouponState();
    if(habitDateInput) habitDateInput.value = todayStr();
    await renderDashboard(currentFilter);
    await renderHabitsSummary();
    await renderHabitIndicators();
    loginMsg.textContent = "";
  }catch(err){
    console.error(err);
    loginMsg.textContent = "Usuario o contraseña incorrectos.";
  }
});
logoutBtn.addEventListener('click', async ()=>{
  await signOut();
  show(loginSection); hide(appSection);
});
navDashboard.addEventListener('click', showDashboard);
navHabits.addEventListener('click', async ()=>{
  showHabits();
  await renderHabitsSummary();
  await renderHabitIndicators();
});
navFinance.addEventListener('click', showFinance);

// Clicks en cupones
couponsGrid.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button');
  if(!btn) return;
  const id = btn.getAttribute('data-id');
  const action = btn.getAttribute('data-action');
  if(action==='ver' || action==='detalles'){
    openCouponDetail(id);
  }
  if(action==='canjear'){
    await canjearCoupon(id);
  }
  if(action==='reset-coupon'){
    await resetCouponUses(id);
  }
});

modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', (e)=>{ if(e.target===modal) closeModal(); });

// Marcación usando la fecha seleccionada
document.getElementById('mark-healthy').addEventListener('click', ()=>{
  const dateStr = habitDateInput?.value || todayStr();
  markForDate('healthy', dateStr);
});
document.getElementById('mark-junk').addEventListener('click', ()=>{
  const dateStr = habitDateInput?.value || todayStr();
  markForDate('junk', dateStr);
});
document.getElementById('add-exercise').addEventListener('click', ()=>{
  const dateStr = habitDateInput?.value || todayStr();
  markForDate('exercise', dateStr);
});
resetHabitsBtn.addEventListener('click', resetHabits);

// Init
(async function init(){
  await loadCoupons();
  const { data: { user } } = await supabase.auth.getUser();
  if(user){
    sessionUser = user;
    hide(loginSection); show(appSection);
    await bootstrapCouponState();
    if(habitDateInput) habitDateInput.value = todayStr();
    await renderDashboard(currentFilter);
    await renderHabitsSummary();
    await renderHabitIndicators();
  }else{
    show(loginSection); hide(appSection);
  }
})();
