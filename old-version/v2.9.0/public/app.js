let autoRefresh=null,leafletMap=null;
let currentLogDate=null; // ISO date string from stats, used for manual events
let activeLogFile=null; // currently active log filename (from /api/stats)
let activeIsLive=false; // true if data received in last 60s

// ── i18n ──────────────────────────────────────────
let T={};        // current translation dict
let curLang='en';
let currentView=null; // {type:'list'} or {type:'detail',fn:'...'}

async function loadLang(code){
  try{
    T=await api('/api/lang/'+code);
    curLang=code;
  }catch(e){console.error('Lang load:',e);T={};}
}

// Translation helper with fallback and {0},{1} replacement
function t(key,...args){
  let s=T[key]||key;
  args.forEach((a,i)=>{s=s.replace(`{${i}}`,a);});
  return s;
}

const WMO_ICONS={0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌧',55:'🌧',56:'🌧',57:'🌧',61:'🌧',63:'🌧',65:'🌧',66:'🌧',67:'🌧',71:'🌨',73:'🌨',75:'🌨',77:'🌨',80:'🌦',81:'🌧',82:'⛈',85:'🌨',86:'🌨',95:'⛈',96:'⛈',99:'⛈'};
function wmo(c){return [WMO_ICONS[c]||'❓', t('wmo'+c)||('Code '+c)];}

const EVT_ICONS={engine:'⚙️',course:'🧭',wind:'💨',battery:'🔋',hazard:'⚠️',sighting:'🐬',vhf:'📻',dsc:'📡',note:'📝',custom:'📌'};

// ── Helpers ───────────────────────────────────────
const API_BASE=window.location.origin; // e.g. http://openplotter.local:3033
async function api(e){
  const r=await fetch(API_BASE+e);
  if(!r.ok){const txt=await r.text().catch(()=>'');throw new Error(`${r.status}: ${txt.substring(0,120)}`);}
  const ct=r.headers.get('content-type')||'';
  if(!ct.includes('json')&&!ct.includes('octet')){const txt=await r.text().catch(()=>'');throw new Error(t('noJson')+': '+txt.substring(0,100));}
  return r.json();
}
const fmtSize=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB';
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/* ── Preferences ─────────────────────────────────── */
const PREF_DEFAULTS={
  lang:'en', tz:'local', tzCustom:'', theme:'dark',
  speedUnit:'kn', distUnit:'nm', depthUnit:'m', tempUnit:'C', windUnit:'kn', pressUnit:'hPa',
  seaMap:true, mapHeight:'45vh', logLines:50, autoRefreshSec:3, compact:false,
  gpxAis:false, gpxEvents:true
};
let P=Object.assign({},PREF_DEFAULTS);
function loadPrefs(){try{const s=localStorage.getItem('nmea-prefs');if(s)P=Object.assign({},PREF_DEFAULTS,JSON.parse(s));}catch(e){}}
function savePrefs(){try{localStorage.setItem('nmea-prefs',JSON.stringify(P));}catch(e){}}
loadPrefs();

/* ── Unit conversion ──────────────────────────────── */
function cvtSpeed(kn){
  if(kn===null||kn===undefined)return null;
  if(P.speedUnit==='kmh')return Math.round(kn*1.852*100)/100;
  if(P.speedUnit==='ms')return Math.round(kn*0.514444*100)/100;
  return kn;
}
function cvtDist(nm){
  if(nm===null||nm===undefined)return null;
  if(P.distUnit==='km')return Math.round(nm*1.852*100)/100;
  return nm;
}
function cvtDepth(m){
  if(m===null||m===undefined)return null;
  if(P.depthUnit==='ft')return Math.round(m*3.28084*10)/10;
  if(P.depthUnit==='fathom')return Math.round(m/1.8288*10)/10;
  return m;
}
function cvtTemp(c){
  if(c===null||c===undefined)return null;
  if(P.tempUnit==='F')return Math.round((c*9/5+32)*10)/10;
  return c;
}
function cvtWind(kn){
  if(kn===null||kn===undefined)return null;
  if(P.windUnit==='ms')return Math.round(kn*0.514444*10)/10;
  if(P.windUnit==='bft'){
    const b=[1,3,6,10,16,21,27,33,40,47,55,63];
    for(let i=b.length-1;i>=0;i--){if(kn>=b[i])return i+1;}
    return 0;
  }
  return kn;
}
function cvtPress(hpa){
  if(hpa===null||hpa===undefined)return null;
  if(P.pressUnit==='inHg')return Math.round(hpa/33.8639*100)/100;
  return hpa; // hPa and mbar are identical
}
function uSpeed(){return P.speedUnit==='kmh'?'km/h':P.speedUnit==='ms'?'m/s':'kn';}
function uDist(){return P.distUnit==='km'?'km':'nm';}
function uDepth(){return P.depthUnit==='ft'?'ft':P.depthUnit==='fathom'?'fm':'m';}
function uTemp(){return P.tempUnit==='F'?'°F':'°C';}
function uWind(){return P.windUnit==='ms'?'m/s':P.windUnit==='bft'?'Bft':'kn';}
function uPress(){return P.pressUnit==='inHg'?'inHg':'hPa';}

/* ── Time formatting ──────────────────────────────── */
function fmtTime(iso){
  if(!iso)return'—';
  if(P.tz==='utc') return iso.substring(0,10)+' '+iso.substring(11,16)+'Z';
  if(P.tz==='custom'&&P.tzCustom){
    try{return new Date(iso).toLocaleString([],{timeZone:P.tzCustom,hour:'2-digit',minute:'2-digit',year:'numeric',month:'short',day:'numeric'});}catch(e){}
  }
  const d=new Date(iso);return d.toLocaleDateString()+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function fmtHM(iso){
  if(!iso)return'—';
  if(P.tz==='utc') return iso.substring(11,16)+'Z';
  if(P.tz==='custom'&&P.tzCustom){
    try{return new Date(iso).toLocaleTimeString([],{timeZone:P.tzCustom,hour:'2-digit',minute:'2-digit'});}catch(e){}
  }
  return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function fmtDur(h){if(h===null||h===undefined)return'—';const hr=Math.floor(h),m=Math.round((h-hr)*60);return hr+t('durH')+'\u2009'+(m<10?'0':'')+m+t('durM');}

// Pre-compiled regex for colorize (avoid re-creating on every line)
const RE_TS=/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/;
const RE_AIS=/AIVD[MO]/;
const RE_GPS=/\$..(?:GGA|RMC|GLL|VTG)/;
const RE_DEPTH=/\$..DB[TKS]|\$..DPT/;
const RE_WIND=/\$..(?:MWV|MWD|VWR)/;
const RE_HDG=/\$..HD[GMT]/;
const RE_DSC=/\$CDDSC/;
const RE_TAG=/([!$][A-Z]{5})/;

function colorize(l){
  let h=esc(l);
  h=h.replace(RE_TS,'<span class="ts">$1</span>');
  if(RE_AIS.test(l))return h.replace(RE_TAG,'<span class="ais">$1</span>');
  if(RE_DSC.test(l))return h.replace(RE_TAG,'<span class="dsc-line">$1</span>');
  if(RE_GPS.test(l))return h.replace(RE_TAG,'<span class="gps">$1</span>');
  if(RE_DEPTH.test(l))return h.replace(RE_TAG,'<span class="depth">$1</span>');
  if(RE_WIND.test(l))return h.replace(RE_TAG,'<span class="wind">$1</span>');
  if(RE_HDG.test(l))return h.replace(RE_TAG,'<span class="hdg">$1</span>');
  return h;
}

// Debounce helper
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}

// Loading guard
let _loading=false;
async function guard(fn){if(_loading)return;_loading=true;try{await fn();}finally{_loading=false;}}

async function loadChips(){
  try{
    const s=await api('/api/stats');
    // Set configurable title
    if(s.displayTitle){document.getElementById('app-title').textContent=s.displayTitle;}
    activeLogFile=s.currentLogFile||null;
    activeIsLive=!!s.isLive;
    // Input source badge
    const badge=document.getElementById('input-badge');
    if(badge&&s.inputSource){
      if(s.inputSource==='signalk'){badge.textContent='SignalK';badge.className='input-badge sk';badge.style.display='';}
      else{badge.textContent='0183';badge.className='input-badge';badge.style.display='';}
    }
    const e=Object.entries(s.sentenceStats||{}).sort((a,b)=>b[1]-a[1]);
    const html=e.length?e.map(([k,c])=>`<span class="chip">${k} <b>${c.toLocaleString()}</b></span>`).join('')
      :`<span class="chip">${t('waitingData')}</span>`;
    // Top chips: visible in list view
    const top=document.getElementById('chips');
    top.innerHTML=html;
    top.style.display=currentView&&currentView.type==='detail'?'none':'';
    // Detail chips: above NMEA stream in detail view
    const det=document.getElementById('detail-chips');
    if(det) det.innerHTML=html;
  }catch(e){console.error(e);}
}

/* ════════════════════════════════════════════════════
   FILE LIST + VOYAGES (tabbed)
   ════════════════════════════════════════════════════ */
let activeTab='logs';

function renderTabs(){
  return `<div class="tabs">
    <div class="tab ${activeTab==='logs'?'active':''}" onclick="activeTab='logs';showList()">${t('logs')}</div>
    <div class="tab ${activeTab==='voyages'?'active':''}" onclick="activeTab='voyages';showList()">${t('voyages')}</div>
    <div class="tab ${activeTab==='engine'?'active':''}" onclick="activeTab='engine';showEngine()">${t('engineTab')}</div>
    <div class="tab ${activeTab==='power'?'active':''}" onclick="activeTab='power';showPower()">${t('powerTab')}</div>
    <div class="tab ${activeTab==='settings'?'active':''}" onclick="activeTab='settings';showSettings()">⚙</div>
  </div>`;
}

// View cache: stores rendered HTML for instant back-navigation
const viewCache={};

async function showList(){
  stopAuto();destroyMap();
  currentView={type:'list'};
  if(!_fromPop) history.pushState({type:'list',tab:activeTab},'','#list');
  const el=document.getElementById('app');
  const cacheKey='list:'+activeTab;

  // Show cached content instantly if available
  if(viewCache[cacheKey]){
    el.innerHTML=viewCache[cacheKey];
  } else {
    el.innerHTML=renderTabs()+`<div class="loading">${t('loading')}</div>`;
  }

  // Refresh in background
  try{
    let h;
    if(activeTab==='voyages'){
      const [voyages,files]=await Promise.all([api('/api/voyages'),api('/api/logs')]);
      h=renderTabs();
      if(voyages.length){
        for(const v of voyages){
          h+=`<div class="v-card" onclick="viewVoyage('${v.id}')">
            <div class="v-name">${esc(v.name)}</div>
            <div class="v-meta">${v.logs.length} ${t('voyageDays')} · ${v.logs.map(f=>f.replace('nmea0183_','').replace('.log','').replace(/_part\d+/,'')).join(', ')}</div>
          </div>`;
        }
      }
      h+=`<div class="btn-row">
        <span class="btn btn-blue" onclick="showCreateVoyage()">+ ${t('newVoyage')}</span>
        <span class="btn" onclick="autoDetectVoyages()">🔍 Auto-detect</span>
      </div>`;
    } else {
      const files=await api('/api/logs');
      h=renderTabs();
      if(!files.length){h+=`<div class="card"><div class="empty">${t('noLogs')}</div></div>`;}
      else{
        h+=`<div class="card"><table class="ftable"><tr><th>${t('date')}</th><th>${t('size')}</th><th></th></tr>`;
        for(const f of files){
          const isLive=activeIsLive&&f.name===activeLogFile;
          h+=`<tr><td><a class="flink" onclick="viewFile('${f.name}')">${f.date}</a>${isLive?'<span class="live">LIVE</span>':''}${f.duplicate?'<span class="dup-badge">'+t('duplicate')+'</span>':''}</td>`;
          h+=`<td class="fsize">${fmtSize(f.size)}</td>`;
          h+=`<td class="text-right"><span class="btn btn-blue btn-sm" onclick="viewFile('${f.name}')">${t('view')}</span></td></tr>`;
        }
        h+='</table></div>';
      }
      // Season overview (non-blocking — show list first, append season)
      const yr=new Date().getFullYear();
      api('/api/season/'+yr).then(season=>{
        if(season&&season.sailingDays>0&&currentView&&currentView.type==='list'){
          const seasonHtml=`<div class="card season-card">
            <div class="season-title">${t('season')} ${yr}</div>
            <div class="season-grid">
              <div><div class="season-val">${season.sailingDays}</div><div class="season-label">${t('sailingDays')}</div></div>
              <div><div class="season-val">${cvtDist(season.totalDistanceNm)}</div><div class="season-label">${uDist()}</div></div>
              <div><div class="season-val">${fmtDur(season.totalEngineHours)}</div><div class="season-label">${t('totalEngine')}</div></div>
            </div>
          </div>`;
          const existing=document.querySelector('.season-card');
          if(existing) existing.outerHTML=seasonHtml;
          else el.insertAdjacentHTML('beforeend',seasonHtml);
          // Update cache with season
          viewCache[cacheKey]=el.innerHTML;
        }
      }).catch(()=>{});
    }
    // Only update DOM if still on list view
    if(currentView&&currentView.type==='list'){
      el.innerHTML=h;
      viewCache[cacheKey]=h;
    }
  }catch(e){
    if(currentView&&currentView.type==='list'){
      el.innerHTML=renderTabs()+`<div class="card"><div class="empty">${t('errorPrefix')}: ${esc(e.message)}</div></div>`;
    }
  }
  loadChips();
}

async function showCreateVoyage(){
  const el=document.getElementById('app');
  el.innerHTML=renderTabs()+`<div class="loading">${t('loading')}</div>`;
  const files=await api('/api/logs');
  let h=renderTabs();
  h+=`<div class="card"><div class="card-title">${t('newVoyage')}</div><div class="v-create">
    <input type="text" id="v-name" placeholder="${t('voyageName')}">
    <div class="meta-text">${t('voyageSelectLogs')}</div>
    <div class="v-log-select" id="v-logs">`;
  for(const f of files){
    h+=`<label class="v-log-row"><input type="checkbox" value="${f.name}"><span class="v-log-date">${f.date}</span><span class="v-log-size">${fmtSize(f.size)}</span></label>`;
  }
  h+=`</div>
    <div class="btn-row">
      <span class="btn btn-blue" onclick="doCreateVoyage()">${t('voyageCreate')}</span>
      <span class="btn" onclick="activeTab='voyages';showList()">${t('evCancel')}</span>
    </div>
  </div></div>`;
  el.innerHTML=h;
  document.getElementById('v-name').focus();
}

async function autoDetectVoyages(){
  toast('Detecting…','info',10000);
  try{
    const suggestions=await api('/api/voyages/auto-detect');
    if(!suggestions.length){toast('No multi-day trips found','info',3000);return;}
    for(const s of suggestions){
      const name=s.suggestedName;
      await postApi('/api/voyages',{action:'create',name,logs:s.logs});
    }
    toast(suggestions.length+' voyage(s) created ✓','ok',3000);
    showList();
  }catch(e){toast('Error: '+e.message,'err',8000);}
}

async function doCreateVoyage(){
  const name=document.getElementById('v-name').value.trim();
  const checks=document.querySelectorAll('#v-logs input[type=checkbox]:checked');
  const logs=Array.from(checks).map(c=>c.value);
  if(!logs.length){toast(t('voyageNoLogs'),'err');return;}
  const vName=name||logs.map(f=>f.replace('nmea0183_','').replace('.log','').replace(/_part\d+/,'')).join(' → ');
  toast('Creating…','info',10000);
  try{
    await postApi('/api/voyages',{action:'create',name:vName,logs});
    toast('Voyage created ✓','ok',2000);
    activeTab='voyages';
    showList();
  }catch(e){toast('Error: '+e.message,'err',8000);}
}

/* ════════════════════════════════════════════════════
   ENGINE TAB
   ════════════════════════════════════════════════════ */
const MAINT_ICONS={oil:'🛢️',gearbox:'⚙️',impeller:'💧',fuel_filter:'⛽',air_filter:'🌬️',zincs:'🔩',antifouling:'🎨',
  underwater_inspect:'🔍',shaft_seal:'🚢',sail_inspect:'⛵',rigging:'🔗',rig_check:'📐',winch_lube:'🧴',
  windlass:'⚓',lines:'🪢',nav_lights:'💡',lifejacket:'🦺',extinguisher:'🧯',flares:'🔥',lifebuoy:'🛟',
  battery:'🔋',electronics:'📡',wiring:'⚡',other:'🔧'};
function maintLabel(type){return t('maint_'+type)||type;}

async function showEngine(){
  stopAuto();destroyMap();
  currentView={type:'list'};
  if(!_fromPop) history.pushState({type:'list',tab:'engine'},'','#list');
  const el=document.getElementById('app');
  el.innerHTML=renderTabs()+`<div class="loading">${t('loading')}</div>`;

  let eng;
  try{eng=await api('/api/engine');}catch(e){el.innerHTML=renderTabs()+`<div class="card"><div class="empty">${t('errorPrefix')}: ${esc(e.message)}</div></div>`;return;}

  let h=renderTabs();

  // ── Total hours ──
  h+=`<div class="card eng-hours">
    <div class="eng-hours-val">${(eng.totalHours||0).toFixed(1)}</div>
    <div class="eng-hours-label">${t('engineHoursTotal')}</div>
  </div>`;

  // ── Tank level ──
  const cap=eng.config.tankCapacityLiters||0;
  const level=eng.tankLevel;
  if(cap>0||level!==null){
    const pct=level!==null?Math.round(level*100):null;
    const liters=pct!==null&&cap>0?Math.round(cap*level):null;
    const color=pct!==null?(pct>50?'var(--green)':pct>25?'var(--orange)':'var(--red)'):'var(--dim)';
    h+=`<div class="card">
      <div class="card-title">${t('fuelTankLevel')}</div>
      <div class="eng-tank">
        <div class="eng-tank-bar"><div class="eng-tank-fill" style="width:${pct||0}%;background:${color}"></div></div>
        <div class="eng-tank-pct" style="color:${color}">${pct!==null?pct+'%':t('fuelNoSensor')}</div>
      </div>`;
    if(liters!==null) h+=`<div class="eng-tank-detail">${liters}L ${t('of')||'/'} ${cap}L</div>`;
    if(eng.avgConsumption&&liters){
      const rangeH=Math.round(liters/eng.avgConsumption*10)/10;
      h+=`<div class="eng-range"><span>${t('fuelAvgConsumption')}: <b>${eng.avgConsumption} L/${t('durH')}</b></span><span>${t('fuelRange')}: <b>~${rangeH} ${t('fuelRangeHours')}</b></span></div>`;
    }
    h+=`</div>`;
  }

  // ── Maintenance schedule ──
  if(eng.schedule&&eng.schedule.length){
    h+=`<div class="card"><div class="card-title">${t('maintenanceSchedule')}</div>`;
    for(const s of eng.schedule){
      const icon=MAINT_ICONS[s.type]||'🔧';
      const last=eng.maintenance.filter(m=>m.type===s.type).sort((a,b)=>b.hours-a.hours)[0];
      const lastH=last?last.hours:0;
      const lastDate=last?last.date:null;
      const sinceH=Math.round((eng.totalHours-lastH)*10)/10;

      if(s.intervalHours>0){
        const nextH=lastH+s.intervalHours;
        const rawPct=Math.round(sinceH/s.intervalHours*100);
        const pct=Math.max(0,Math.min(100,rawPct));
        const remaining=Math.round((nextH-eng.totalHours)*10)/10;
        const status=remaining<=0?'over':remaining<s.intervalHours*0.15?'due':'ok';
        const badge=status==='over'?`<span class="maint-badge maint-over">${t('maintenanceOverdue')}</span>`
          :status==='due'?`<span class="maint-badge maint-due">${t('maintenanceDue')}</span>`
          :`<span class="maint-badge maint-ok">${t('maintenanceOk')}</span>`;
        const barColor=sinceH<=0?'var(--dim)':status==='over'?'var(--red)':status==='due'?'var(--orange)':'var(--green)';
        const infoSince=Math.max(0,sinceH);
        h+=`<div class="maint-item">
          <span>${icon}</span>
          <div class="maint-label">${maintLabel(s.type)}</div>
          <div class="maint-bar"><div class="maint-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="maint-info">${infoSince}/${s.intervalHours}${t('durH')}</div>
          ${badge}
        </div>`;
      } else if(s.intervalMonths>0){
        const rawMonths=lastDate?Math.round((Date.now()-new Date(lastDate).getTime())/(30.44*86400000)):999;
        const monthsSince=Math.max(0,rawMonths);
        const rawPct=Math.round(monthsSince/s.intervalMonths*100);
        const pct=Math.max(0,Math.min(100,rawPct));
        const remaining=s.intervalMonths-monthsSince;
        const status=remaining<=0?'over':remaining<=2?'due':'ok';
        const badge=status==='over'?`<span class="maint-badge maint-over">${t('maintenanceOverdue')}</span>`
          :status==='due'?`<span class="maint-badge maint-due">${t('maintenanceDue')}</span>`
          :`<span class="maint-badge maint-ok">${t('maintenanceOk')}</span>`;
        const barColor=rawMonths<=0?'var(--dim)':status==='over'?'var(--red)':status==='due'?'var(--orange)':'var(--green)';
        h+=`<div class="maint-item">
          <span>${icon}</span>
          <div class="maint-label">${maintLabel(s.type)}</div>
          <div class="maint-bar"><div class="maint-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="maint-info">${monthsSince}/${s.intervalMonths} mnd</div>
          ${badge}
        </div>`;
      } else {
        h+=`<div class="maint-item"><span>${icon}</span><div class="maint-label">${maintLabel(s.type)}</div><div></div><div class="maint-info">${last?last.date:t('maintenanceNever')}</div><div></div></div>`;
      }
    }
    h+=`</div>`;
  }

  // ── Fuel log ──
  h+=`<div class="card"><div class="card-title">${t('fuelLog')}</div>`;
  if(eng.fuelLog.length){
    h+=`<div class="wx-scroll"><table class="fuel-table"><tr>
      <th>${t('fuelDate')}</th><th>${t('fuelHours')}</th><th>L</th><th>${t('fuelPricePerL')}</th><th>${t('fuelTotal')}</th><th></th><th></th>
    </tr>`;
    for(const f of eng.fuelLog){
      h+=`<tr id="fuel-row-${f.id}">
        <td>${f.date}</td><td>${f.hours}</td><td>${f.liters}</td>
        <td class="fuel-cost">${f.pricePerLiter!==null?'€'+f.pricePerLiter.toFixed(2):'—'}</td>
        <td class="fuel-cost">${f.totalCost!==null?'€'+f.totalCost.toFixed(2):'—'}</td>
        <td>${f.fullTank?'⛽':''} ${f.note?'<span class="fuel-note">'+esc(f.note)+'</span>':''}</td>
        <td class="nowrap">
          <span class="ev-note-btn" onclick="editFuel('${f.id}')">✏️</span>
          <span class="ev-del" onclick="deleteFuel('${f.id}')" class="action-btn">✕</span>
        </td>
      </tr>`;
    }
    h+=`</table></div>`;
  }
  h+=`<div class="ev-add-bar"><span class="btn btn-sm btn-blue" onclick="toggleEngForm('fuel-form')">+ ${t('fuelAdd')}</span></div>
  <div class="eng-form" id="fuel-form" class="hidden">
    <input type="hidden" id="ef-edit-id" value="">
    <div class="eng-form-row">
      <div><label class="eng-field-label">${t('fuelDate')}</label><input type="date" id="ef-date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div><label class="eng-field-label">${t('fuelHours')} ⏱</label><input type="number" id="ef-hours" step="0.1" value="${(eng.totalHours||0).toFixed(1)}"></div>
    </div>
    <div class="eng-form-row">
      <div><label class="eng-field-label">${t('fuelLiters')}</label><input type="number" id="ef-liters" step="0.1"></div>
      <div><label class="eng-field-label">${t('fuelPricePerL')}</label><input type="number" id="ef-price" step="0.01"></div>
    </div>
    <div class="eng-form-row">
      <div><label class="eng-field-label">${t('fuelNote')}</label><input type="text" id="ef-note" placeholder="${t('fuelNote')}"></div>
      <label class="self-end"><input type="checkbox" id="ef-full" checked> ${t('fuelFullTank')}</label>
    </div>
    <div class="eng-form-row">
      <span class="btn btn-sm btn-blue" onclick="saveFuel()">✓</span>
      <span class="btn btn-sm" onclick="cancelFuelEdit()">✕</span>
    </div>
  </div></div>`;

  // ── Maintenance history ──
  h+=`<div class="card"><div class="card-title">${t('maintenanceLog')}</div>`;
  if(eng.maintenance.length){
    for(const m of eng.maintenance){
      const icon=MAINT_ICONS[m.type]||'🔧';
      h+=`<div class="hist-item" id="maint-row-${m.id}">
        <span class="hist-date">${m.date}</span>
        <span class="hist-hours">${m.hours}${t('durH')}</span>
        <span class="hist-icon">${icon}</span>
        <span class="flex-1">${esc(maintLabel(m.type))}${m.note?' — <span class="fuel-note">'+esc(m.note)+'</span>':''}</span>
        <span class="ev-note-btn" onclick="editMaint('${m.id}')">✏️</span>
        <span class="ev-del" onclick="deleteMaint('${m.id}')" class="action-btn">✕</span>
      </div>`;
    }
  } else {
    h+=`<div class="empty">—</div>`;
  }
  h+=`<div class="ev-add-bar"><span class="btn btn-sm btn-blue" onclick="toggleEngForm('maint-form')">+ ${t('maintenanceAdd')}</span></div>
  <div class="eng-form" id="maint-form" class="hidden">
    <input type="hidden" id="em-edit-id" value="">
    <div class="eng-form-row">
      <div><label class="eng-field-label">${t('fuelDate')}</label><input type="date" id="em-date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div><label class="eng-field-label">${t('fuelHours')} ⏱</label><input type="number" id="em-hours" step="0.1" value="${(eng.totalHours||0).toFixed(1)}"></div>
    </div>
    <div class="eng-form-row">
      <div><label class="eng-field-label">${t('maintenanceType')}</label><select id="em-type">
        <optgroup label="${t('engineTab')}">
          ${['oil','gearbox','impeller','fuel_filter','air_filter'].map(k=>`<option value="${k}">${MAINT_ICONS[k]} ${maintLabel(k)}</option>`).join('')}
        </optgroup>
        <optgroup label="⛵">
          ${['sail_inspect','rigging','rig_check','winch_lube','windlass','lines','nav_lights'].map(k=>`<option value="${k}">${MAINT_ICONS[k]} ${maintLabel(k)}</option>`).join('')}
        </optgroup>
        <optgroup label="🚢">
          ${['antifouling','zincs','underwater_inspect','shaft_seal'].map(k=>`<option value="${k}">${MAINT_ICONS[k]} ${maintLabel(k)}</option>`).join('')}
        </optgroup>
        <optgroup label="🦺">
          ${['lifejacket','extinguisher','flares','lifebuoy'].map(k=>`<option value="${k}">${MAINT_ICONS[k]} ${maintLabel(k)}</option>`).join('')}
        </optgroup>
        <optgroup label="⚡">
          ${['battery','electronics','wiring'].map(k=>`<option value="${k}">${MAINT_ICONS[k]} ${maintLabel(k)}</option>`).join('')}
        </optgroup>
        <option value="other">🔧 ${maintLabel('other')}</option>
      </select></div>
    </div>
    <div class="eng-form-row">
      <div><label class="eng-field-label">${t('fuelNote')}</label><input type="text" id="em-note" placeholder="${t('fuelNote')}"></div>
    </div>
    <div class="eng-form-row">
      <span class="btn btn-sm btn-blue" onclick="saveMaint()">✓</span>
      <span class="btn btn-sm" onclick="cancelMaintEdit()">✕</span>
    </div>
  </div></div>`;

  el.innerHTML=h;
  loadChips();
}

function toggleEngForm(id){
  const el=document.getElementById(id);
  if(el){
    const show=el.style.display==='none';
    el.style.display=show?'':'none';
    if(show) setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
  }
}
async function saveFuel(){
  const liters=parseFloat(document.getElementById('ef-liters').value);
  if(!liters||liters<=0){toast('Liters?','err');return;}
  const price=parseFloat(document.getElementById('ef-price').value);
  const editId=document.getElementById('ef-edit-id').value;
  const data={
    date:document.getElementById('ef-date').value,
    hours:parseFloat(document.getElementById('ef-hours').value)||0,
    liters,
    pricePerLiter:isNaN(price)?null:price,
    totalCost:isNaN(price)?null:Math.round(liters*price*100)/100,
    fullTank:document.getElementById('ef-full').checked,
    note:document.getElementById('ef-note').value.trim()
  };
  try{
    if(editId){
      data.action='updateFuel'; data.id=editId;
    } else {
      data.action='addFuel';
    }
    await postApi('/api/engine',data);
    toast('⛽ ✓','ok',2000);showEngine();
  }catch(e){toast('Error: '+e.message,'err');}
}
function editFuel(id){
  // Find fuel entry from rendered data
  api('/api/engine').then(eng=>{
    const f=eng.fuelLog.find(x=>x.id===id);
    if(!f) return;
    document.getElementById('ef-edit-id').value=id;
    document.getElementById('ef-date').value=f.date||'';
    document.getElementById('ef-hours').value=f.hours||'';
    document.getElementById('ef-liters').value=f.liters||'';
    document.getElementById('ef-price').value=f.pricePerLiter!==null?f.pricePerLiter:'';
    document.getElementById('ef-note').value=f.note||'';
    document.getElementById('ef-full').checked=!!f.fullTank;
    const form=document.getElementById('fuel-form');
    if(form){form.style.display='';setTimeout(()=>form.scrollIntoView({behavior:'smooth',block:'nearest'}),50);}
  });
}
function cancelFuelEdit(){
  document.getElementById('ef-edit-id').value='';
  toggleEngForm('fuel-form');
}
async function deleteFuel(id){
  if(!confirm('Delete?'))return;
  try{await postApi('/api/engine',{action:'deleteFuel',id});showEngine();}catch(e){toast('Error','err');}
}
async function saveMaint(){
  const editId=document.getElementById('em-edit-id').value;
  const data={
    date:document.getElementById('em-date').value,
    hours:parseFloat(document.getElementById('em-hours').value)||0,
    type:document.getElementById('em-type').value,
    note:document.getElementById('em-note').value.trim()
  };
  try{
    if(editId){
      data.action='updateMaintenance'; data.id=editId;
    } else {
      data.action='addMaintenance';
    }
    await postApi('/api/engine',data);
    toast('🔧 ✓','ok',2000);showEngine();
  }catch(e){toast('Error: '+e.message,'err');}
}
function editMaint(id){
  api('/api/engine').then(eng=>{
    const m=eng.maintenance.find(x=>x.id===id);
    if(!m) return;
    document.getElementById('em-edit-id').value=id;
    document.getElementById('em-date').value=m.date||'';
    document.getElementById('em-hours').value=m.hours||'';
    document.getElementById('em-type').value=m.type||'other';
    document.getElementById('em-note').value=m.note||'';
    const form=document.getElementById('maint-form');
    if(form){form.style.display='';setTimeout(()=>form.scrollIntoView({behavior:'smooth',block:'nearest'}),50);}
  });
}
function cancelMaintEdit(){
  document.getElementById('em-edit-id').value='';
  toggleEngForm('maint-form');
}
async function deleteMaint(id){
  if(!confirm('Delete?'))return;
  try{await postApi('/api/engine',{action:'deleteMaintenance',id});showEngine();}catch(e){toast('Error','err');}
}
async function saveEngConfig(){
  try{
    await postApi('/api/engine',{
      action:'config',
      tankCapacityLiters:parseFloat(document.getElementById('ec-cap').value)||0,
      baseHours:parseFloat(document.getElementById('ec-base').value)||0,
      tankSensorPath:document.getElementById('ec-tank').value.trim()
    });
    toast('✓','ok',1500);
  }catch(e){toast('Error','err');}
}

async function saveMaintIntervals(count){
  try{
    const eng=await api('/api/engine');
    const schedule=eng.schedule||[];
    for(let i=0;i<count&&i<schedule.length;i++){
      const hEl=document.getElementById('ms-h-'+i);
      const mEl=document.getElementById('ms-m-'+i);
      if(hEl) schedule[i].intervalHours=parseInt(hEl.value)||0;
      if(mEl) schedule[i].intervalMonths=parseInt(mEl.value)||0;
    }
    await postApi('/api/engine',{action:'updateSchedule',schedule});
    toast('✓','ok',1500);
  }catch(e){toast('Error: '+e.message,'err');}
}

/* ════════════════════════════════════════════════════
   POWER TAB
   ════════════════════════════════════════════════════ */
async function showPower(){
  stopAuto();destroyMap();
  currentView={type:'list'};
  if(!_fromPop) history.pushState({type:'list',tab:'power'},'','#list');
  const el=document.getElementById('app');
  el.innerHTML=renderTabs()+`<div class="loading">${t('loading')}</div>`;

  let pw;
  try{pw=await api('/api/power');}catch(e){
    el.innerHTML=renderTabs()+`<div class="card"><div class="empty">${t('powerNoData')}<br><span class="meta-text">${t('powerHint')}</span></div></div>`;
    loadChips();return;
  }

  const hasData=pw.voltage!==null||pw.soc!==null||pw.current!==null;
  let h=renderTabs();

  if(!hasData){
    h+=`<div class="card"><div class="empty">${t('powerNoData')}<br><span class="meta-text">${t('powerHint')}</span></div></div>`;
    el.innerHTML=h;loadChips();return;
  }

  // ── House bank ──
  h+=`<div class="card"><div class="card-title">${t('powerBank1')}</div><div class="pwr-grid">`;
  if(pw.voltage!==null){
    const vColor=pw.voltage>=12.4?'var(--green)':pw.voltage>=12.0?'var(--orange)':'var(--red)';
    h+=`<div class="pwr-cell"><div class="pwr-val" style="color:${vColor}">${pw.voltage.toFixed(2)}</div><div class="pwr-unit">V</div></div>`;
  }
  if(pw.current!==null){
    const sign=pw.current>=0?'+':'';
    const cColor=pw.current>=0?'var(--green)':'var(--red)';
    h+=`<div class="pwr-cell"><div class="pwr-val" style="color:${cColor}">${sign}${pw.current.toFixed(1)}</div><div class="pwr-unit">A</div></div>`;
  }
  if(pw.watts!==null){
    const sign=pw.watts>=0?'+':'';
    h+=`<div class="pwr-cell"><div class="pwr-val">${sign}${pw.watts}</div><div class="pwr-unit">W</div></div>`;
  }
  if(pw.soc!==null){
    const sColor=pw.soc>=50?'var(--green)':pw.soc>=25?'var(--orange)':'var(--red)';
    h+=`<div class="pwr-cell"><div class="pwr-val" style="color:${sColor}">${pw.soc}</div><div class="pwr-unit">% SOC</div></div>`;
  }
  h+=`</div>`;
  // SOC bar
  if(pw.soc!==null){
    const sColor=pw.soc>=50?'var(--green)':pw.soc>=25?'var(--orange)':'var(--red)';
    h+=`<div class="eng-tank" class="soc-bar"><div class="eng-tank-bar"><div class="eng-tank-fill" style="width:${pw.soc}%;background:${sColor}"></div></div></div>`;
  }
  if(pw.batteryTemp!==null){
    h+=`<div class="batt-temp">${t('powerBattTemp')}: ${pw.batteryTemp}°C</div>`;
  }
  h+=`</div>`;

  // ── Start battery (bank 2) ──
  if(pw.voltage2!==null){
    h+=`<div class="card"><div class="card-title">${t('powerBank2')}</div><div class="pwr-grid">`;
    const vColor=pw.voltage2>=12.4?'var(--green)':pw.voltage2>=12.0?'var(--orange)':'var(--red)';
    h+=`<div class="pwr-cell"><div class="pwr-val" style="color:${vColor}">${pw.voltage2.toFixed(2)}</div><div class="pwr-unit">V</div></div>`;
    if(pw.current2!==null) h+=`<div class="pwr-cell"><div class="pwr-val">${pw.current2.toFixed(1)}</div><div class="pwr-unit">A</div></div>`;
    h+=`</div></div>`;
  }

  // ── Sources (charger / alternator / solar) ──
  const sources=[];
  if(pw.chargerCurrent!==null) sources.push({label:t('powerCharger'),val:pw.chargerCurrent.toFixed(1),unit:'A',icon:'🔌'});
  if(pw.alternatorCurrent!==null) sources.push({label:t('powerAlternator'),val:pw.alternatorCurrent.toFixed(1),unit:'A',icon:'⚡'});
  if(pw.solarCurrent!==null||pw.solarVoltage!==null){
    const watts=(pw.solarCurrent!==null&&pw.solarVoltage!==null)?Math.round(pw.solarCurrent*pw.solarVoltage):null;
    sources.push({label:t('powerSolar'),val:watts!==null?watts:(pw.solarCurrent||0).toFixed(1),unit:watts!==null?'W':'A',icon:'☀️'});
  }
  if(sources.length){
    h+=`<div class="card"><div class="card-title">${t('powerCharger')} / ${t('powerSolar')}</div><div class="pwr-grid">`;
    for(const s of sources){
      h+=`<div class="pwr-cell"><div class="tiny-text">${s.icon} ${s.label}</div><div class="pwr-val" class="pwr-source-val">${s.val}</div><div class="pwr-unit">${s.unit}</div></div>`;
    }
    h+=`</div></div>`;
  }

  // ── Today's Ah consumed ──
  if(pw.todayAh){
    h+=`<div class="card"><div class="set-row"><div class="set-label">${t('powerTodayAh')}</div><div>${pw.todayAh} Ah</div></div></div>`;
  }

  // ── Auto-refresh ──
  h+=`<div class="pwr-refresh"><span class="btn btn-sm" id="pwr-refresh" onclick="showPower()">⟳ ${t('refresh')||'Refresh'}</span></div>`;

  el.innerHTML=h;
  loadChips();
}

async function viewVoyage(vid){return guard(async()=>{
  stopAuto();destroyMap();
  currentView={type:'voyage',vid};
  if(!_fromPop) history.pushState({type:'voyage',vid},'','#voyage/'+vid);
  const el=document.getElementById('app');
  el.innerHTML=`<div class="loading">${t('analyzing')}</div>`;

  let v;
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),60000);
    const r=await fetch(API_BASE+'/api/voyages/'+vid+'/stats',{signal:controller.signal});
    clearTimeout(timeout);
    if(!r.ok) throw new Error('HTTP '+r.status);
    v=await r.json();
  }catch(e){
    el.innerHTML=`<div class="topbar"><div class="topbar-left"><a class="back" onclick="activeTab='voyages';showList()">‹<span class="back-text">${t('back')}</span></a><span class="topbar-title">${t('voyages')}</span></div></div>
      <div class="card"><div class="empty">${e.name==='AbortError'?t('voyageTimeout'):t('errorPrefix')+': '+esc(e.message)}</div></div>`;
    return;
  }

  // Missing logs warning
  let missingHtml='';
  if(v.missingLogs&&v.missingLogs.length){
    missingHtml=`<div class="card" class="warning-card">
      <div class="warning-title">⚠ ${t('voyageMissing',v.missingLogs.length)}</div>
      <div class="warning-detail">${v.missingLogs.map(f=>f.replace('nmea0183_','').replace('.log','')).join(', ')}</div>
    </div>`;
  }

  let h=`<div class="topbar">
    <div class="topbar-left"><a class="back" onclick="activeTab='voyages';showList()">‹<span class="back-text">${t('back')}</span></a><span class="topbar-title">${esc(v.name)}</span></div>
    <div class="topbar-right">
      <span class="btn btn-sm" onclick="toggleExport()">⬇</span>
      <span class="btn btn-sm" onclick="editVoyage('${vid}')">✏️</span>
      <span class="btn btn-sm btn-red" onclick="deleteVoyage('${vid}','${esc(v.name)}')">🗑</span>
    </div>
  </div>
  <div class="export-panel" id="export-panel">
    <div class="export-btns">
      <a class="btn btn-sm" id="exp-gpx" href="#">GPX</a>
      <a class="btn btn-sm" href="/api/voyages/${vid}/csv">CSV</a>
    </div>
    <div class="export-opts">
      <label><input type="checkbox" id="exp-ais" ${P.gpxAis?'checked':''} onchange="setSave('gpxAis',this.checked);updateGpxUrl()"> AIS</label>
      <label><input type="checkbox" id="exp-ev" ${P.gpxEvents!==false?'checked':''} onchange="setSave('gpxEvents',this.checked);updateGpxUrl()"> Events</label>
    </div>
  </div>`;
  _expBase='/api/voyages/'+vid+'/gpx';
  setTimeout(updateGpxUrl,0);

  h+=missingHtml;

  // Map
  if(v.track&&v.track.length>0){
    h+='<div class="card"><div id="map"></div></div>';
  }

  // Combined stats
  h+='<div class="card"><div class="card-title">'+t('voyageTotal')+' — '+v.days+' '+t('voyageDays')+'</div><div class="stats-grid">';
  h+=sgSec(t('navigation'));
  h+=sg(t('distance'),cvtDist(v.totalDistanceNm),uDist());
  h+=sg(t('duration'),fmtDur(v.durationHours),'');
  h+=sg(t('sogAvg'),cvtSpeed(v.sogAvgKn),uSpeed());
  h+=sg(t('sogMax'),cvtSpeed(v.sogMaxKn),uSpeed());
  h+=sg(t('start'),fmtTime(v.startTime),'');
  h+=sg(t('end'),fmtTime(v.endTime),'');
  if(v.twsAvgKn||v.twsMaxKn){
    h+=sgSec(t('wind'));
    h+=sg(t('twsAvg'),cvtWind(v.twsAvgKn),uWind());
    h+=sg(t('twsMax'),cvtWind(v.twsMaxKn),uWind());
  }
  h+=sgSec(t('engine'));
  h+=sg(t('hours'),v.totalEngineHours>0?fmtDur(v.totalEngineHours):'—','');
  h+=sg(t('periods'),v.totalEnginePeriods,'');
  if(v.depthSamples>0){
    h+=sgSec(t('depth'));
    h+=sg(t('depthMin'),cvtDepth(v.depthMinM),uDepth());
    h+=sg(t('depthMax'),cvtDepth(v.depthMaxM),uDepth());
    h+=sg(t('depthAvg'),cvtDepth(v.depthAvgM),uDepth());
  }
  if(v.rsaSamples>0||v.xteSamples>0||v.apSegments){
    h+=sgSec(t('autopilot'));
    if(v.rsaSamples) h+=sg(t('rudderAvg'),v.rsaAvgDeg,'°');
    if(v.rsaSamples) h+=sg(t('rudderMax'),v.rsaMaxDeg,'°');
    if(v.xteSamples) h+=sg(t('xteAvg'),v.xteAvgNm,'nm');
    if(v.xteSamples) h+=sg(t('xteMax'),v.xteMaxNm,'nm');
    if(v.apSegments) h+=sg(t('apSegments'),v.apSegments.length,'');
  }
  h+='</div></div>';

  // Per-day comparison table
  if(v.perDay&&v.perDay.length>1){
    const bestDist=Math.max(...v.perDay.map(d=>d.distanceNm||0));
    const bestSog=Math.max(...v.perDay.map(d=>d.sogMaxKn||0));
    const bestWind=Math.max(...v.perDay.map(d=>d.twsMaxKn||0));
    h+=`<div class="card"><div class="card-title">${t('voyagePerDay')}</div>
      <div class="wx-scroll"><table class="v-day-table">
      <tr><th>${t('date')}</th><th>${t('distance')}</th><th>${t('sogAvg')}</th><th>${t('sogMax')}</th><th>${t('twsAvg')}</th><th>${t('hours')}</th><th>${t('events')}</th></tr>`;
    for(const d of v.perDay){
      const date=d.logDate||d.filename.replace('nmea0183_','').replace('.log','');
      h+=`<tr>
        <td><a class="flink" onclick="viewFile('${d.filename}')">${date}</a></td>
        <td class="${d.distanceNm===bestDist?'v-best':''}">${cvtDist(d.distanceNm)||'—'} ${uDist()}</td>
        <td>${cvtSpeed(d.sogAvgKn)||'—'} ${uSpeed()}</td>
        <td class="${d.sogMaxKn===bestSog?'v-best':''}">${cvtSpeed(d.sogMaxKn)||'—'} ${uSpeed()}</td>
        <td>${cvtWind(d.twsAvgKn)||'—'} ${uWind()}</td>
        <td>${d.engineHours>0?fmtDur(d.engineHours):'—'}</td>
        <td>${d.eventCount||0}</td>
      </tr>`;
    }
    h+='</table></div></div>';
  }

  // Voyage notes
  h+=`<div class="card">
    <div class="card-title">${t('voyageNote')}</div>
    <div class="log-note-wrap">
      <textarea class="log-note-area" id="voyage-note" placeholder="${t('voyageNotePlaceholder')}" rows="3" oninput="markVoyageNoteDirty()">${v.note?esc(v.note):''}</textarea>
      <div class="log-note-bar"><span class="btn btn-sm btn-blue log-note-save" id="voyage-note-save" onclick="saveVoyageNote('${vid}')">✓</span></div>
    </div>
  </div>`;

  // Events with day filter
  if(v.events&&v.events.length>0){
    const evDays=[...new Set(v.events.map(e=>e.logDate).filter(Boolean))];
    h+=`<div class="card"><div class="card-title">${t('events')} (${v.events.length})</div>`;
    if(evDays.length>1){
      h+=`<div class="ev-day-filter">
        <span class="ev-day-btn active" onclick="filterVoyageEvents(null,this)">All</span>`;
      for(const d of evDays) h+=`<span class="ev-day-btn" onclick="filterVoyageEvents('${d}',this)">${d}</span>`;
      h+=`</div>`;
    }
    h+=`<div class="ev-list" id="v-ev-list">`;
    for(const ev of v.events){
      const icon=EVT_ICONS[ev.type]||'📌';
      const logFile=ev.logFile||'';
      h+=`<div class="ev-item ev-type-${ev.type}" data-day="${ev.logDate||''}">
        <span class="ev-date">${ev.logDate||''}</span>
        <span class="ev-time">${fmtHM(ev.time)}</span>
        <span class="ev-icon">${icon}</span>
        <span class="ev-detail">${esc(ev.detail)}</span>
        ${ev.manual
          ?`<span class="ev-note-btn" onclick="showEditEvent('${logFile}','${ev.type}','${ev.time}','${esc(ev.detail).replace(/'/g,"&#39;")}','${ev.note?esc(ev.note).replace(/'/g,"&#39;"):''}')" title="Edit">✏️</span><span class="ev-del" onclick="delEvent('${logFile}','${ev.type}','${ev.time}','${vid}')" title="${t('evDelete')}">✕</span>`
          :`<span class="ev-note-btn" onclick="editNote('${logFile}','${ev.type}','${ev.time}',this,'${vid}','${esc(ev.detail).replace(/'/g,"&#39;")}')" title="${t('evNoteEdit')}">✏️</span>`}
      </div>`;
      if(ev.note) h+=`<div class="ev-note" data-day="${ev.logDate||''}"><span class="ev-note-text">${esc(ev.note)}</span><span class="ev-note-del" onclick="if(confirm('Delete?'))saveNote('${logFile}','${ev.type}','${ev.time}','','${vid}','${esc(ev.detail).replace(/'/g,"&#39;")}')">✕</span></div>`;
    }
    h+='</div></div>';
  }

  el.innerHTML=h;

  // Render map with per-day colored tracks
  if(v.track&&v.track.length>0){
    document.documentElement.style.setProperty('--map-h',P.mapHeight||'45vh');
    leafletMap=L.map('map',{zoomControl:true,attributionControl:false});
    L.control.attribution({prefix:false,position:'bottomright'}).addTo(leafletMap);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxZoom:18}).addTo(leafletMap);
    if(P.seaMap) L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',{maxZoom:18,opacity:.8}).addTo(leafletMap);

    const dayColors=['#4fc3f7','#66bb6a','#ff9800','#ab47bc','#ef5350','#26c6da','#fdd835','#e91e63'];
    let allBounds=[];
    for(let di=0;di<v.perDay.length;di++){
      const dayTrack=v.track.filter(pt=>{
        if(!pt.time)return false;
        const d=pt.time.split('T')[0];
        return d===(v.perDay[di].logDate||'');
      });
      if(!dayTrack.length) continue;
      const coords=dayTrack.map(p=>[p.lat,p.lon]);
      const col=dayColors[di%dayColors.length];
      L.polyline(coords,{color:col,weight:3,opacity:.8}).addTo(leafletMap);
      allBounds=allBounds.concat(coords);
    }
    // If no date-match (e.g. no time), fall back to single track
    if(!allBounds.length){
      const coords=v.track.map(p=>[p.lat,p.lon]);
      L.polyline(coords,{color:'#4fc3f7',weight:3}).addTo(leafletMap);
      allBounds=coords;
    }
    // Event markers
    const evColors={engine:'#ff9800',course:'#26c6da',wind:'#ab47bc',battery:'#ef5350',hazard:'#ef5350',sighting:'#66bb6a',vhf:'#4fc3f7',dsc:'#e91e63',note:'#888',custom:'#fdd835'};
    for(const ev of (v.events||[])){
      if(!ev.time)continue;
      const col=evColors[ev.type]||'#fdd835';
      const icon=EVT_ICONS[ev.type]||'📌';
      let evLat=null,evLon=null;
      if(ev.lat&&ev.lon){evLat=ev.lat;evLon=ev.lon;}
      else{
        const evTime=new Date(ev.time).getTime();
        let closest=null,minDt=Infinity;
        for(const pt of v.track){if(!pt.time)continue;const dt=Math.abs(new Date(pt.time).getTime()-evTime);if(dt<minDt){minDt=dt;closest=pt;}}
        if(closest&&minDt<300000){evLat=closest.lat;evLon=closest.lon;}
      }
      if(evLat!==null&&evLon!==null){
        const marker=ev.type==='dsc'
          ? L.circleMarker([evLat,evLon],{radius:8,color:col,fillColor:col,fillOpacity:.9,weight:3})
          : L.circleMarker([evLat,evLon],{radius:6,color:col,fillColor:col,fillOpacity:.9,weight:2});
        marker.bindPopup(`<b>${icon} ${fmtHM(ev.time)}</b><br>${ev.detail}${ev.note?'<br><i>'+esc(ev.note)+'</i>':''}`).addTo(leafletMap);
      }
    }
    if(allBounds.length) leafletMap.fitBounds(L.latLngBounds(allBounds).pad(.1));
  }
});}

async function editVoyage(vid){
  const el=document.getElementById('app');
  el.innerHTML=`<div class="loading">${t('loading')}</div>`;
  const [voyages,files]=await Promise.all([api('/api/voyages'),api('/api/logs')]);
  const voyage=voyages.find(v=>v.id===vid);
  if(!voyage){toast('Voyage not found','err');activeTab='voyages';showList();return;}

  let h=`<div class="topbar">
    <div class="topbar-left"><a class="back" onclick="viewVoyage('${vid}')">‹<span class="back-text">${t('back')}</span></a><span class="topbar-title">${t('voyages')}</span></div>
  </div>`;
  h+=`<div class="card"><div class="card-title">${esc(voyage.name)}</div><div class="v-create">
    <input type="text" id="v-edit-name" value="${esc(voyage.name)}" placeholder="${t('voyageName')}">
    <div class="meta-text">${t('voyageSelectLogs')}</div>
    <div class="v-log-select" id="v-edit-logs">`;
  for(const f of files){
    const checked=voyage.logs.includes(f.name)?'checked':'';
    h+=`<label class="v-log-row"><input type="checkbox" value="${f.name}" ${checked}><span class="v-log-date">${f.date}</span><span class="v-log-size">${fmtSize(f.size)}</span></label>`;
  }
  h+=`</div>
    <div class="btn-row">
      <span class="btn btn-blue" onclick="doUpdateVoyage('${vid}')">💾 ${t('evSave')}</span>
      <span class="btn" onclick="viewVoyage('${vid}')">${t('evCancel')}</span>
    </div>
  </div></div>`;
  el.innerHTML=h;
}

async function doUpdateVoyage(vid){
  const name=document.getElementById('v-edit-name').value.trim();
  const checks=document.querySelectorAll('#v-edit-logs input[type=checkbox]:checked');
  const logs=Array.from(checks).map(c=>c.value);
  if(!logs.length){toast(t('voyageNoLogs'),'err');return;}
  try{
    await postApi('/api/voyages',{action:'update',id:vid,name:name||undefined,logs});
    toast('Updated ✓','ok',2000);
    viewVoyage(vid);
  }catch(e){toast('Error: '+e.message,'err');}
}

async function deleteVoyage(vid,name){
  if(!confirm(t('voyageDeleteConfirm',name)))return;
  try{
    await postApi('/api/voyages',{action:'delete',id:vid});
    toast('Deleted','ok',2000);
    activeTab='voyages';showList();
  }catch(e){toast('Error: '+e.message,'err');}
}

async function postApi(path,data){
  const url=API_BASE+path;
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const body=await r.text();
  if(!r.ok) throw new Error(r.status+': '+body.substring(0,200));
  try{return JSON.parse(body);}catch(e){return body;}
}

/* ════════════════════════════════════════════════════
   DETAIL VIEW
   ════════════════════════════════════════════════════ */
async function viewFile(fn){return guard(async()=>{
  stopAuto();destroyMap();
  currentView={type:'detail',fn};
  if(!_fromPop) history.pushState({type:'detail',fn},'','#log/'+fn);
  const el=document.getElementById('app');
  el.innerHTML=`<div class="loading">${t('analyzing')}</div>`;

  const [stats,logData,allVoyages]=await Promise.all([
    api('/api/logs/'+fn+'/stats').catch(()=>null),
    api('/api/logs/'+fn+'?lines=50').catch(()=>null),
    api('/api/voyages').catch(()=>[])
  ]);
  const inVoyages=allVoyages.filter(v=>v.logs&&v.logs.includes(fn));

  let h='';
  currentLogDate=stats&&stats.logDate?stats.logDate:new Date().toISOString().split('T')[0];

  h+=`<div class="topbar">
    <div class="topbar-left"><a class="back" onclick="showList()">‹<span class="back-text">${t('back')}</span></a><span class="topbar-title">${stats?stats.filename.replace('nmea0183_','').replace('.log',''):fn}</span>${stats&&stats.gpsQuality?`<span class="gps-q gps-q-${stats.gpsQuality.status}" title="GPS: ${stats.gpsQuality.pct}% invalid${stats.checksumFails?' | '+stats.checksumFails+' checksum fails':''}"></span>`:''}</div>
    <div class="topbar-right">
      <span class="btn btn-sm" onclick="toggleExport()">⬇</span>
      ${fn!==activeLogFile?`<span class="btn btn-sm btn-red" onclick="delFile('${fn}')">🗑</span>`:''}
    </div>
  </div>
  <div class="export-panel" id="export-panel">
    <div class="export-btns">
      <a class="btn btn-sm" id="exp-gpx" href="#">GPX</a>
      <a class="btn btn-sm" href="/api/logs/${fn}/csv">CSV</a>
      <a class="btn btn-sm" href="/api/logs/${fn}/download">${t('download')}</a>
      <span class="btn btn-sm" onclick="printReport()">🖨</span>
    </div>
    <div class="export-opts">
      <label><input type="checkbox" id="exp-ais" ${P.gpxAis?'checked':''} onchange="setSave('gpxAis',this.checked);updateGpxUrl()"> AIS</label>
      <label><input type="checkbox" id="exp-ev" ${P.gpxEvents!==false?'checked':''} onchange="setSave('gpxEvents',this.checked);updateGpxUrl()"> Events</label>
    </div>
  </div>`;
  if(inVoyages.length){
    h+=`<div class="voyage-link">${inVoyages.map(v=>`<a class="flink" onclick="viewVoyage('${v.id}')">📍 ${esc(v.name)}</a>`).join(' · ')}</div>`;
  }
  _expBase='/api/logs/'+fn+'/gpx';
  setTimeout(updateGpxUrl,0);

  if(stats&&stats.track&&stats.track.length>0){
    h+='<div class="card"><div id="map"></div></div>';
  } else {
    h+=`<div class="card"><div class="empty">${t('noTrack')}</div></div>`;
  }

  if(stats){
    h+='<div class="card"><div class="stats-grid">';
    h+=sgSec(t('navigation'));
    h+=sg(t('distance'),cvtDist(stats.totalDistanceNm),uDist());
    h+=sg(t('duration'),fmtDur(stats.durationHours),'');
    h+=sg(t('sogAvg'),cvtSpeed(stats.sogAvgKn),uSpeed());
    h+=sg(t('sogMax'),cvtSpeed(stats.sogMaxKn),uSpeed());
    h+=sg(t('start'),fmtHM(stats.startTime),'');
    h+=sg(t('end'),fmtHM(stats.endTime),'');
    h+=sgSec(t('wind'));
    h+=sg(t('twsAvg'),cvtWind(stats.twsAvgKn),uWind());
    h+=sg(t('twsMax'),cvtWind(stats.twsMaxKn),uWind());
    h+=sg(t('twaAvg'),stats.twaAvgDeg,'°');
    h+=sg(t('twaMin'),stats.twaMinDeg,'°');
    h+=sg(t('twaMax'),stats.twaMaxDeg,'°');
    h+=sgSec(t('engine'));
    h+=sg(t('hours'),stats.engineHours>0?fmtDur(stats.engineHours):'—','');
    h+=sg(t('periods'),stats.enginePeriods?stats.enginePeriods.length:0,'');
    h+=sg(t('rpmData'),stats.rpmSamples,'');
    if(stats.engineHours>0&&window._engAvgConsumption){
      h+=sg(t('fuelEstimate'),(stats.engineHours*window._engAvgConsumption).toFixed(1),'L');
    }
    if(stats.currentSamples>0||stats.socStart!==null){
      h+=sgSec(t('powerTab'));
      if(stats.ahConsumed) h+=sg(t('powerTodayAh'),stats.ahConsumed,'Ah');
      if(stats.socStart!==null&&stats.socEnd!==null) h+=sg(t('powerSoc'),stats.socStart+'% → '+stats.socEnd+'%','');
      if(stats.currentSamples) h+=sg(t('samples')||'Samples',stats.currentSamples,'');
    }
    if(stats.depthSamples>0){
      h+=sgSec(t('depth'));
      h+=sg(t('depthMin'),cvtDepth(stats.depthMinM),uDepth());
      h+=sg(t('depthMax'),cvtDepth(stats.depthMaxM),uDepth());
      h+=sg(t('depthAvg'),cvtDepth(stats.depthAvgM),uDepth());
      h+=sg(t('depthSamples'),stats.depthSamples,'');
    }
    if(stats.hdgSamples>0||stats.rsaSamples>0||stats.xteSamples>0){
      h+=sgSec(t('autopilot'));
      if(stats.hdgSamples) h+=sg(t('heading'),stats.hdgAvgDeg,'°');
      if(stats.rsaSamples) h+=sg(t('rudderAvg'),stats.rsaAvgDeg,'°');
      if(stats.rsaSamples) h+=sg(t('rudderMax'),stats.rsaMaxDeg,'°');
      if(stats.xteSamples) h+=sg(t('xteAvg'),stats.xteAvgNm,'nm');
      if(stats.xteSamples) h+=sg(t('xteMax'),stats.xteMaxNm,'nm');
      if(stats.apSegments) h+=sg(t('apSegments'),stats.apSegments.length,'');
    }
    h+='</div></div>';
  }

  if(stats&&stats.events&&stats.events.length>0){
    h+=`<div class="card" id="ev-card"><div class="card-title">${t('events')}</div><div class="ev-list" id="ev-list">`;
    for(const ev of stats.events){
      const icon=EVT_ICONS[ev.type]||'📌';
      h+=`<div class="ev-item ev-type-${ev.type}">
        <span class="ev-time">${fmtHM(ev.time)}</span>
        <span class="ev-icon">${icon}</span>
        <span class="ev-detail">${esc(ev.detail)}</span>
        ${ev.manual
          ?`<span class="ev-note-btn" onclick="showEditEvent('${fn}','${ev.type}','${ev.time}','${esc(ev.detail).replace(/'/g,"&#39;")}','${ev.note?esc(ev.note).replace(/'/g,"&#39;"):''}')" title="Edit">✏️</span><span class="ev-del" onclick="delEvent('${fn}','${ev.type}','${ev.time}')" title="${t('evDelete')}">✕</span>`
          :`<span class="ev-note-btn" onclick="editNote('${fn}','${ev.type}','${ev.time}',this,null,'${esc(ev.detail).replace(/'/g,"&#39;")}')" title="${t('evNoteEdit')}">✏️</span>`}
      </div>`;
      if(ev.note) h+=`<div class="ev-note"><span class="ev-note-text">${esc(ev.note)}</span><span class="ev-note-del" onclick="if(confirm('Delete?'))saveNote('${fn}','${ev.type}','${ev.time}','',null,'${esc(ev.detail).replace(/'/g,"&#39;")}')">✕</span></div>`;
    }
    h+='</div>';
  } else {
    h+=`<div class="card" id="ev-card"><div class="card-title">${t('events')}</div><div class="ev-list" id="ev-list"><div class="empty">—</div></div>`;
  }
  h+=`<div class="ev-add-bar">
    <span class="btn btn-sm btn-blue" onclick="showAddEvent('${fn}')">+ ${t('addEvent')}</span>
  </div>
  <div class="ev-form" id="ev-form" class="hidden">
    <div class="ev-form-row">
      <select id="ev-type">
        <option value="note">📝 ${t('evTypeNote')}</option>
        <option value="hazard">⚠️ ${t('evTypeHazard')}</option>
        <option value="sighting">🐬 ${t('evTypeSighting')}</option>
        <option value="vhf">📻 ${t('evTypeVhf')}</option>
        <option value="custom">📌 ${t('evTypeCustom')}</option>
      </select>
      <input type="time" id="ev-time" step="60">
    </div>
    <input type="text" id="ev-detail" placeholder="${t('evDetail')}" class="w-full"
      onkeydown="if(event.key==='Enter'){event.preventDefault();saveEvent('${fn}')}">
    <textarea id="ev-note-input" placeholder="${t('evNote')}" rows="2"></textarea>
    <div class="ev-form-row">
      <span class="btn btn-sm btn-blue" id="ev-save-btn" onclick="saveEvent('${fn}')" class="gap-sm">▶ ${t('evSave')}</span>
      <span class="btn btn-sm" onclick="hideAddEvent()">${t('evCancel')}</span>
    </div>
  </div></div>`;

  // ── Day-log notes ──
  h+=`<div class="card">
    <div class="card-title">${t('logNote')}</div>
    <div class="log-note-wrap">
      <textarea class="log-note-area" id="log-note" placeholder="${t('logNotePlaceholder')}" rows="3" oninput="markLogNoteDirty()">${stats&&stats.logNote?esc(stats.logNote):''}</textarea>
      <div class="log-note-bar"><span class="btn btn-sm btn-blue log-note-save" id="log-note-save" onclick="saveLogNote('${fn}')">✓</span></div>
    </div>
  </div>`;

  h+='<div id="wx-panel"></div>';

  // ── Sentence coverage ──
  if(stats&&stats.sentenceTypeCounts){
    const expected=['RMC','GGA','VTG','GSA','HDG','HDM','HDT','RSA','MWV','MWD','VWR','DBT','DBS','DPT','XDR','RPM','MTW','MTA','XTE','APB','DSC','VDM','VDO','SKAIS'];
    h+=`<div class="card"><div class="card-title">${t('sentenceCoverage')} — ${(stats.totalLines||0).toLocaleString()} ${t('totalLines')}</div><div class="cov-wrap">`;
    for(const st of expected){
      const n=stats.sentenceTypeCounts[st]||0;
      h+=`<span class="cov-tag${n?'  active':''}">${st}${n?'<span class="cov-n">'+n.toLocaleString()+'</span>':''}</span>`;
    }
    // Extra types not in expected
    const extras=Object.keys(stats.sentenceTypeCounts).filter(k=>!expected.includes(k)).sort();
    for(const st of extras){
      h+=`<span class="cov-tag active">${st}<span class="cov-n">${stats.sentenceTypeCounts[st].toLocaleString()}</span></span>`;
    }
    h+=`</div></div>`;
  }

  h+=`<div class="card no-print">
    <div class="chips" id="detail-chips"></div>
    <div class="nmea-toolbar">
      <input type="text" id="fi" placeholder="${t('filterPlaceholder')}" enterkeyhint="search"
        onkeydown="if(event.key==='Enter'){event.preventDefault();applyF('${fn}')}"
        oninput="debouncedFilter('${fn}')">
      <select id="ln" onchange="applyF('${fn}')">
        <option value="50" ${P.logLines===50?'selected':''}>50</option><option value="100" ${P.logLines===100?'selected':''}>100</option><option value="200" ${P.logLines===200?'selected':''}>200</option>
        <option value="500" ${P.logLines===500?'selected':''}>500</option><option value="0" ${P.logLines===0?'selected':''}>All</option>
      </select>
      <span class="btn btn-sm btn-blue" onclick="applyF('${fn}')">Filter</span>
      <span class="btn btn-sm" id="ar-btn" class="auto-btn" onclick="toggleAuto('${fn}')">⟳ ${t('off')}</span>
    </div>
    <div class="nmea-info" id="log-info"></div>
    <div class="log-view" id="log-content"></div>
  </div>`;

  el.innerHTML=h;
  if(stats&&stats.track&&stats.track.length>0) renderMap(stats.track, stats.events, stats.shallowest);
  if(logData) renderLog(logData);
  loadChips();
  if(stats&&stats.weatherIntervals&&stats.weatherIntervals.length>0&&stats.startTime){
    fetchIntervalWeather(fn);
  }
});}

function sg(label,val,unit){
  const display=(val!==null&&val!==undefined)?val:'—';
  return `<div class="sg-item"><div class="sg-label">${label}</div><div class="sg-val">${display}${unit?'<span class="sg-unit">'+unit+'</span>':''}</div></div>`;
}
function sgSec(title){return `<div class="sg-section">${title}</div>`;}

// ── Template helpers (DRY) ───────────────────────────
function cardOpen(title){
  return `<div class="card">${title?'<div class="card-title">'+title+'</div>':''}`; 
}
function cardClose(){return `</div>`;}
function addBar(label,onclick){
  return `<div class="ev-add-bar"><span class="btn btn-sm btn-blue" onclick="${onclick}">+ ${label}</span></div>`;
}
function warningCard(title,detail){
  return `<div class="card warning-card"><div class="warning-title">⚠ ${title}</div>${detail?'<div class="warning-detail">'+detail+'</div>':''}</div>`;
}

/* ════════════════════════════════════════════════════
   WEATHER + SEA STATE
   ════════════════════════════════════════════════════ */
async function fetchIntervalWeather(fn){
  const panel=document.getElementById('wx-panel');
  if(!panel)return;
  panel.innerHTML=`<div class="card"><div class="wx-loading">${t('fetchingWeather')}</div></div>`;

  let hours;
  try{
    hours=await api('/api/logs/'+fn+'/weather');
  }catch(e){console.error('Weather fetch error:',e);hours=[];}

  if(!hours||!hours.length){panel.innerHTML=`<div class="card"><div class="empty">${t('noWeather')}</div></div>`;return;}

  let html=`<div class="card"><div class="card-title">${t('weatherTitle')}</div><div class="wx-scroll"><table class="wx-table">`;
  html+=`<tr><th>${t('wxHour')}</th><th></th><th>${t('wxWeather')}</th><th>${t('wxTemp')}</th><th>${t('wxWind')}</th><th>${t('wxGusts')}</th><th>${t('wxWave')}</th>`;
  const hasMeasured=hours.some(w=>w.measuredTWS!==null||w.measuredTemp!==null);
  if(hasMeasured) html+=`<th>${t('wxMeasured')}</th><th>${t('wxDelta')}</th>`;
  html+='</tr>';

  for(const w of hours){
    const [icon,desc]=wmo(w.code);
    const timeLabel=String(w.hour).padStart(2,'0')+':00';
    const windDirStr=w.windDir!==null?windArrow(w.windDir):'';
    let waveStr='—';
    if(w.waveH!==null){
      waveStr=`${w.waveH.toFixed(1)}m`;
      if(w.wavePer!==null) waveStr+=` ${w.wavePer.toFixed(0)}s`;
      if(w.waveDir!==null) waveStr+=` ${windArrow(w.waveDir)}`;
    }
    html+=`<tr>
      <td class="nowrap">${timeLabel}</td>
      <td><span class="wx-icon">${icon}</span></td>
      <td><span class="wx-desc">${desc}</span></td>
      <td class="wx-temp">${w.temp!==null?cvtTemp(w.temp).toFixed(1)+uTemp():'—'}</td>
      <td class="wx-wind">${w.wind!==null?Math.round(cvtWind(w.wind))+uWind()+' '+windDirStr:'—'}</td>
      <td class="wx-gust">${w.gust!==null&&w.gust>0?Math.round(cvtWind(w.gust))+uWind():'—'}</td>
      <td class="wx-wave">${waveStr}</td>`;
    if(hasMeasured){
      let measStr='';
      if(w.measuredTWS!==null) measStr+=`${cvtWind(w.measuredTWS).toFixed(1)}${uWind()}`;
      if(w.measuredTemp!==null) measStr+=(measStr?' · ':'')+`${cvtTemp(w.measuredTemp).toFixed(1)}${uTemp()}`;
      html+=`<td class="wx-meas">${measStr||'—'}</td>`;
      let diffStr='';
      if(w.measuredTWS!==null&&w.wind!==null){
        const d=cvtWind(w.measuredTWS)-cvtWind(w.wind);const cls=d>0?'wx-diff-pos':'wx-diff-neg';
        diffStr+=`<span class="${cls}">${d>0?'+':''}${d.toFixed(1)}${uWind()}</span>`;
      }
      if(w.measuredTemp!==null&&w.temp!==null){
        const d=cvtTemp(w.measuredTemp)-cvtTemp(w.temp);const cls=d>0?'wx-diff-pos':'wx-diff-neg';
        diffStr+=(diffStr?' · ':'')+`<span class="${cls}">${d>0?'+':''}${d.toFixed(1)}${uTemp()}</span>`;
      }
      html+=`<td>${diffStr||'—'}</td>`;
    }
    html+='</tr>';
  }
  html+='</table></div>';
  html+=`<div class="wx-note">${t('wxSource')}</div></div>`;
  panel.innerHTML=html;
}

function windArrow(deg){
  if(deg===null||deg===undefined)return'';
  const arrows=['↓','↙','←','↖','↑','↗','→','↘'];
  return arrows[Math.round(deg/45)%8];
}

/* ════════════════════════════════════════════════════
   LEAFLET MAP
   ════════════════════════════════════════════════════ */
function destroyMap(){if(leafletMap){leafletMap.remove();leafletMap=null;}}

function renderMap(track, events, shallowest){
  document.documentElement.style.setProperty('--map-h',P.mapHeight||'45vh');
  leafletMap=L.map('map',{zoomControl:true,attributionControl:false});
  L.control.attribution({prefix:false,position:'bottomright'}).addTo(leafletMap);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM',maxZoom:18}).addTo(leafletMap);
  if(P.seaMap) L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',{maxZoom:18,opacity:.8}).addTo(leafletMap);

  const coords=track.map(p=>[p.lat,p.lon]);
  const poly=L.polyline(coords,{color:'#4fc3f7',weight:3,opacity:.85}).addTo(leafletMap);

  const sogPts=track.filter(p=>p.sog!==null);
  if(sogPts.length>10){
    const mx=sogPts.reduce((m,p)=>p.sog>m?p.sog:m,1);
    for(let i=1;i<coords.length;i++){
      const sog=track[i].sog;
      if(sog!==null){
        const r=Math.min(sog/mx,1);
        L.polyline([coords[i-1],coords[i]],{
          color:`rgb(${0|79+r*176},${0|195-r*112},${0|247-r*167})`,weight:3,opacity:.85
        }).addTo(leafletMap);
      }
    }
  }

  L.circleMarker(coords[0],{radius:7,color:'#66bb6a',fillColor:'#66bb6a',fillOpacity:1,weight:0})
    .bindPopup(`<b>${t('start')}</b><br>${fmtTime(track[0].time)}`).addTo(leafletMap);
  L.circleMarker(coords[coords.length-1],{radius:7,color:'#ef5350',fillColor:'#ef5350',fillOpacity:1,weight:0})
    .bindPopup(`<b>${t('end')}</b><br>${fmtTime(track[track.length-1].time)}`).addTo(leafletMap);

  // Shallowest point marker
  if(shallowest&&shallowest.lat&&shallowest.lon){
    L.circleMarker([shallowest.lat,shallowest.lon],{radius:7,color:'#ffa726',fillColor:'#ffa726',fillOpacity:1,weight:2,className:'shallow-marker'})
      .bindPopup(`<b>⚓ ${t('shallowest')}</b><br>${cvtDepth(shallowest.depth)} ${uDepth()}<br>${fmtHM(shallowest.time)}`).addTo(leafletMap);
  }

  if(events&&events.length>0){
    const evColors={engine:'#ff9800',course:'#26c6da',wind:'#ab47bc',battery:'#ef5350',hazard:'#ef5350',sighting:'#66bb6a',vhf:'#4fc3f7',dsc:'#e91e63',note:'#888',custom:'#fdd835'};
    for(const ev of events){
      if(!ev.time)continue;
      const col=evColors[ev.type]||'#fdd835';
      const icon=EVT_ICONS[ev.type]||'📌';
      let evLat=null,evLon=null;
      // Use event's own position if available (e.g. DSC calls)
      if(ev.lat&&ev.lon){evLat=ev.lat;evLon=ev.lon;}
      else{
        // Fall back to closest track point by time
        const evTime=new Date(ev.time).getTime();
        let closest=null,minDt=Infinity;
        for(const pt of track){if(!pt.time)continue;const dt=Math.abs(new Date(pt.time).getTime()-evTime);if(dt<minDt){minDt=dt;closest=pt;}}
        if(closest&&minDt<300000){evLat=closest.lat;evLon=closest.lon;}
      }
      if(evLat!==null&&evLon!==null){
        const marker=ev.type==='dsc'
          ? L.circleMarker([evLat,evLon],{radius:8,color:col,fillColor:col,fillOpacity:.9,weight:3})
          : L.circleMarker([evLat,evLon],{radius:6,color:col,fillColor:col,fillOpacity:.9,weight:2});
        marker.bindPopup(`<b>${icon} ${fmtHM(ev.time)}</b><br>${ev.detail}${ev.note?'<br><i>'+esc(ev.note)+'</i>':''}`).addTo(leafletMap);
      }
    }
  }

  leafletMap.fitBounds(poly.getBounds().pad(.1));
}

/* ════════════════════════════════════════════════════
   LOG VIEWER
   ════════════════════════════════════════════════════ */
function renderLog(data){
  const info=document.getElementById('log-info');
  const box=document.getElementById('log-content');
  if(!data){box.innerHTML=`<div class="empty">${t('errorLoading')}</div>`;return;}
  info.textContent=data.filter
    ? t('linesOfFiltered',data.returnedLines.toLocaleString(),data.totalLines.toLocaleString(),data.filter)
    : t('linesOf',data.returnedLines.toLocaleString(),data.totalLines.toLocaleString());
  if(!data.lines.length){box.innerHTML=`<div class="empty">${t('noResults')}</div>`;return;}
  // Build HTML in chunks to avoid blocking main thread on large logs
  const chunks=[];
  for(let i=0;i<data.lines.length;i++){
    chunks.push('<div class="ll">');
    chunks.push(colorize(data.lines[i]));
    chunks.push('</div>');
  }
  box.innerHTML=chunks.join('');
  box.scrollTop=box.scrollHeight;
}

const debouncedFilter=debounce((fn)=>applyF(fn),300);
async function applyF(fn){
  const filter=document.getElementById('fi').value;
  const lines=parseInt(document.getElementById('ln').value)||0;
  try{
    let u='/api/logs/'+fn+'?lines='+lines;
    if(filter)u+='&filter='+encodeURIComponent(filter);
    renderLog(await api(u));
  }catch(e){console.error(e);}
}

function toggleAuto(fn){
  const btn=document.getElementById('ar-btn');
  if(autoRefresh){stopAuto();btn.textContent='⟳ '+t('off');btn.classList.remove('btn-green');}
  else{btn.textContent='⟳ '+t('on');btn.classList.add('btn-green');
    autoRefresh=setInterval(()=>{applyF(fn);loadChips();},(P.autoRefreshSec||3)*1000);}
}
function stopAuto(){if(autoRefresh){clearInterval(autoRefresh);autoRefresh=null;}}

/* ── Export panel ── */
let _expBase='';
function toggleExport(){
  const p=document.getElementById('export-panel');
  if(p) p.classList.toggle('open');
}
function updateGpxUrl(){
  const el=document.getElementById('exp-gpx');
  if(!el||!_expBase)return;
  const ais=document.getElementById('exp-ais');
  const ev=document.getElementById('exp-ev');
  const params=[];
  if(ais&&ais.checked) params.push('ais=1');
  if(ev&&!ev.checked) params.push('events=0');
  el.href=_expBase+(params.length?'?'+params.join('&'):'');
}

function printReport(){
  // Set print header from current view
  const title=document.querySelector('.topbar-title');
  document.getElementById('print-title').textContent='NMEA0183 — '+(title?title.textContent:'Voyage');
  document.getElementById('print-sub').textContent='Printed '+new Date().toLocaleDateString()+' '+new Date().toLocaleTimeString();
  // Force Leaflet to redraw tiles before print
  if(leafletMap){
    leafletMap.invalidateSize();
    // Small delay to let tiles load
    setTimeout(()=>window.print(),400);
  } else {
    window.print();
  }
}

async function delFile(fn){
  if(!confirm(t('confirmDelete',fn)))return;
  try{
    const r=await fetch(API_BASE+'/api/logs/'+fn,{method:'DELETE'});
    if(!r.ok){
      try{
        const err=JSON.parse(await r.text());
        if(err.voyages){toast(t('deleteInVoyage',err.voyages.join(', ')),'err',8000);}
        else{toast(err.error||('Error '+r.status),'err',6000);}
      }catch(e2){toast('Error '+r.status,'err');}
      return;
    }
    toast(t('delete')+' ✓','ok',2000);
    Object.keys(viewCache).forEach(k=>delete viewCache[k]);
    showList();
  }catch(e){toast(t('errorPrefix')+': '+e.message,'err');}
}

async function loadTrash(){
  try{return await api('/api/trash');}catch(e){return[];}
}
async function restoreTrash(fn){
  try{
    await postApi('/api/trash',{action:'restore',name:fn});
    toast(t('trashRestored')+' ✓','ok',2000);
    showSettings();
  }catch(e){toast('Error: '+e.message,'err');}
}
async function deleteTrash(fn){
  if(!confirm(t('trashDeleteConfirm',fn)))return;
  try{
    await postApi('/api/trash',{action:'delete',name:fn});
    toast(t('trashDelete')+' ✓','ok',2000);
    showSettings();
  }catch(e){toast('Error: '+e.message,'err');}
}
async function emptyTrash(){
  if(!confirm(t('trashEmptyConfirm')))return;
  try{
    await postApi('/api/trash',{action:'empty'});
    toast(t('trashEmptied')+' ✓','ok',2000);
    showSettings();
  }catch(e){toast('Error: '+e.message,'err');}
}

/* ════════════════════════════════════════════════════
   MANUAL EVENTS
   ════════════════════════════════════════════════════ */
function toast(msg,type,dur){
  document.querySelectorAll('.toast').forEach(el=>el.remove());
  const d=document.createElement('div');
  d.className='toast toast-'+(type||'info');
  d.textContent=msg;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),dur||4000);
}

function showAddEvent(fn){
  const form=document.getElementById('ev-form');
  form.style.display='';
  const now=new Date();
  document.getElementById('ev-time').value=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  document.getElementById('ev-type').value='note';
  document.getElementById('ev-detail').value='';
  document.getElementById('ev-note-input').value='';
  // Reset save button to add mode
  const btn=document.getElementById('ev-save-btn');
  btn.setAttribute('onclick',`saveEvent('${fn}')`);
  btn.textContent='▶ '+t('evSave');
  document.getElementById('ev-detail').focus();
}

function showEditEvent(fn,type,time,detail,note){
  const form=document.getElementById('ev-form');
  form.style.display='';
  document.getElementById('ev-type').value=type;
  document.getElementById('ev-detail').value=detail||'';
  document.getElementById('ev-time').value=time?time.substring(11,16):'';
  document.getElementById('ev-note-input').value=note||'';
  // Switch save button to update mode
  const btn=document.getElementById('ev-save-btn');
  btn.setAttribute('onclick',`updateEvent('${fn}','${type}','${time}')`);
  btn.textContent='✓ '+t('evSave');
  document.getElementById('ev-detail').focus();
}

async function updateEvent(fn,oldType,oldTime){
  const type=document.getElementById('ev-type').value;
  const detail=document.getElementById('ev-detail').value.trim();
  const timeInput=document.getElementById('ev-time').value;
  const note=document.getElementById('ev-note-input').value.trim();
  if(!detail){toast(t('evDetail'),'err');document.getElementById('ev-detail').focus();return;}
  const tp=(timeInput||'').match(/(\d{1,2}):(\d{2})/);
  const hh=tp?tp[1].padStart(2,'0'):'12';
  const mm=tp?tp[2]:'00';
  const newTime=currentLogDate+'T'+hh+':'+mm+':00.000Z';
  toast('Saving…','info',10000);
  try{
    const url=API_BASE+'/api/logs/'+encodeURIComponent(fn)+'/events';
    await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',type:oldType,time:oldTime})});
    await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',type,detail,time:newTime,note:note||undefined})});
    toast('Updated ✓','ok',2000);
    hideAddEvent();
    viewFile(fn);
  }catch(e){toast('Error: '+e.message,'err',8000);}
}
function hideAddEvent(){document.getElementById('ev-form').style.display='none';}

async function saveEvent(fn){
  toast('Saving…','info',10000);
  try{
    const type=document.getElementById('ev-type').value;
    const timeStr=document.getElementById('ev-time').value;
    const detail=document.getElementById('ev-detail').value.trim();
    const note=document.getElementById('ev-note-input').value.trim();
    if(!detail){toast(t('evDetail'),'err');document.getElementById('ev-detail').focus();return;}
    const tp=(timeStr||'').match(/(\d{1,2}):(\d{2})/);
    const hh=tp?tp[1].padStart(2,'0'):'12';
    const mm=tp?tp[2]:'00';
    const isoStr=currentLogDate+'T'+hh+':'+mm+':00.000Z';
    console.log('saveEvent date:',{currentLogDate,timeStr,isoStr});
    const d=new Date(isoStr);
    if(isNaN(d.getTime())){toast('Invalid date: '+isoStr,'err',8000);return;}
    const evTime=d.toISOString();
    const url=API_BASE+'/api/logs/'+encodeURIComponent(fn)+'/events';
    console.log('saveEvent',url,{type,detail,time:evTime});
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',type,detail,time:evTime,note:note||undefined})});
    const body=await r.text();
    console.log('saveEvent response',r.status,body);
    if(!r.ok){toast('Error '+r.status+': '+body.substring(0,100),'err',8000);return;}
    toast('Event saved ✓','ok',2000);
    hideAddEvent();
    viewFile(fn);
  }catch(e){console.error('saveEvent',e);toast('Error: '+e.message,'err',8000);}
}

function editNote(fn,type,time,btn,voyageId,detail){
  const item=btn.closest('.ev-item');
  let next=item.nextElementSibling;
  if(next&&next.classList.contains('ev-note-editor')){next.remove();return;}
  let old='';
  if(next&&next.classList.contains('ev-note')){
    const txt=next.querySelector('.ev-note-text');
    old=txt?txt.textContent:next.textContent;
    next.remove();
  }
  const ed=document.createElement('div');
  ed.className='ev-note-editor';
  ed.style.cssText='padding:4px 12px 8px 72px;display:flex;gap:6px;align-items:center';
  const inp=document.createElement('input');
  inp.type='text';
  inp.style.cssText='flex:1;background:var(--card2);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 8px;font-size:.78em';
  inp.value=old;
  inp.placeholder=t('evNote');
  inp.onkeydown=e=>{if(e.key==='Enter')saveNote(fn,type,time,inp.value,voyageId,detail);};
  ed.appendChild(inp);
  const sb=document.createElement('span');
  sb.className='btn btn-sm btn-blue';
  sb.style.cssText='padding:4px 8px;font-size:.85em;cursor:pointer';
  sb.textContent='✓';
  sb.onclick=()=>saveNote(fn,type,time,inp.value,voyageId,detail);
  ed.appendChild(sb);
  item.after(ed);
  inp.focus();
}

async function saveNote(fn,type,time,note,voyageId,detail){
  toast('Saving…','info',10000);
  try{
    const url=API_BASE+'/api/logs/'+encodeURIComponent(fn)+'/events';
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'note',type,time,detail:detail||'',note})});
    const body=await r.text();
    if(!r.ok){toast('Error '+r.status,'err');return;}
    toast('Note saved ✓','ok',2000);
    if(voyageId) viewVoyage(voyageId); else viewFile(fn);
  }catch(e){toast('Error: '+e.message,'err',8000);}
}

function markLogNoteDirty(){
  const btn=document.getElementById('log-note-save');
  if(btn&&!btn.classList.contains('dirty')) btn.classList.add('dirty');
}
function markVoyageNoteDirty(){
  const btn=document.getElementById('voyage-note-save');
  if(btn&&!btn.classList.contains('dirty')) btn.classList.add('dirty');
}

async function saveLogNote(fn){
  const text=document.getElementById('log-note').value.trim();
  try{
    const url=API_BASE+'/api/logs/'+encodeURIComponent(fn)+'/events';
    await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'lognote',text})});
    const btn=document.getElementById('log-note-save');
    if(btn) btn.classList.remove('dirty');
    toast(t('logNote')+' ✓','ok',2000);
  }catch(e){toast('Error: '+e.message,'err');}
}

async function saveVoyageNote(vid){
  const text=document.getElementById('voyage-note').value.trim();
  try{
    await postApi('/api/voyages',{action:'update',id:vid,note:text});
    const btn=document.getElementById('voyage-note-save');
    if(btn) btn.classList.remove('dirty');
    toast(t('voyageNote')+' ✓','ok',2000);
  }catch(e){toast('Error: '+e.message,'err');}
}

async function delEvent(fn,type,time,voyageId){
  if(!confirm(t('evDelete')+'?')) return;
  try{
    const url=API_BASE+'/api/logs/'+encodeURIComponent(fn)+'/events';
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',type,time})});
    if(!r.ok){toast('Delete error','err');return;}
    toast('Deleted','ok',2000);
    if(voyageId) viewVoyage(voyageId); else viewFile(fn);
  }catch(e){toast('Error: '+e.message,'err',8000);}
}

function filterVoyageEvents(day,btn){
  document.querySelectorAll('.ev-day-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const items=document.querySelectorAll('#v-ev-list > [data-day]');
  for(const el of items){
    el.style.display=(!day||el.dataset.day===day)?'':'none';
  }
}

/* ── Settings page ── */
function showSettings(){
  stopAuto();destroyMap();
  currentView={type:'settings'};
  if(!_fromPop) history.pushState({type:'list',tab:'settings'},'','#settings');
  const el=document.getElementById('app');
  el.innerHTML=`<div class="loading">${t('loading')}</div>`;
  _renderSettings(el);
}

async function _renderSettings(el){

  const COMMON_TZ=['Europe/Amsterdam','Europe/London','Europe/Berlin','Europe/Paris','Europe/Athens',
    'America/New_York','America/Chicago','America/Los_Angeles','America/Anchorage',
    'Asia/Tokyo','Australia/Sydney','Pacific/Auckland','Atlantic/Azores','Atlantic/Canary'];

  let h=renderTabs();

  // ── Time & language ──
  h+=`<div class="card"><div class="set-group">
    <div class="set-group-title">${t('setTimeLang')}</div>
    <div class="set-row">
      <div class="set-label">${t('setLang')}</div>
      <select class="set-select" onchange="setSave('lang',this.value);reloadLang()">
        <option value="en" ${P.lang==='en'?'selected':''}>English</option>
        <option value="nl" ${P.lang==='nl'?'selected':''}>Nederlands</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setTZ')}</div>
      <select class="set-select" onchange="setSave('tz',this.value);toggleCustomTZ()">
        <option value="local" ${P.tz==='local'?'selected':''}>${t('tzDevice')}</option>
        <option value="utc" ${P.tz==='utc'?'selected':''}>UTC / Zulu</option>
        <option value="custom" ${P.tz==='custom'?'selected':''}>${t('tzCustom')}</option>
      </select>
    </div>
    <div class="set-row" id="set-tz-custom" class="tz-custom ${P.tz==='custom'?'show':''}">
      <div class="set-label">${t('setTZPick')}</div>
      <select class="set-select" onchange="setSave('tzCustom',this.value)">
        <option value="">—</option>
        ${COMMON_TZ.map(z=>`<option value="${z}" ${P.tzCustom===z?'selected':''}>${z.replace(/_/g,' ')}</option>`).join('')}
      </select>
    </div>
  </div></div>`;

  // ── Units ──
  h+=`<div class="card"><div class="set-group">
    <div class="set-group-title">${t('setUnits')}</div>
    <div class="set-row">
      <div class="set-label">${t('setSpeed')}</div>
      <select class="set-select" onchange="setSave('speedUnit',this.value)">
        <option value="kn" ${P.speedUnit==='kn'?'selected':''}>Knots</option>
        <option value="kmh" ${P.speedUnit==='kmh'?'selected':''}>km/h</option>
        <option value="ms" ${P.speedUnit==='ms'?'selected':''}>m/s</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setDist')}</div>
      <select class="set-select" onchange="setSave('distUnit',this.value)">
        <option value="nm" ${P.distUnit==='nm'?'selected':''}>Nautical miles</option>
        <option value="km" ${P.distUnit==='km'?'selected':''}>Kilometers</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setDepth')}</div>
      <select class="set-select" onchange="setSave('depthUnit',this.value)">
        <option value="m" ${P.depthUnit==='m'?'selected':''}>Meters</option>
        <option value="ft" ${P.depthUnit==='ft'?'selected':''}>Feet</option>
        <option value="fathom" ${P.depthUnit==='fathom'?'selected':''}>Fathoms</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setTemp')}</div>
      <select class="set-select" onchange="setSave('tempUnit',this.value)">
        <option value="C" ${P.tempUnit==='C'?'selected':''}>°C</option>
        <option value="F" ${P.tempUnit==='F'?'selected':''}>°F</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setWind')}</div>
      <select class="set-select" onchange="setSave('windUnit',this.value)">
        <option value="kn" ${P.windUnit==='kn'?'selected':''}>Knots</option>
        <option value="ms" ${P.windUnit==='ms'?'selected':''}>m/s</option>
        <option value="bft" ${P.windUnit==='bft'?'selected':''}>Beaufort</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setPress')}</div>
      <select class="set-select" onchange="setSave('pressUnit',this.value)">
        <option value="hPa" ${P.pressUnit==='hPa'?'selected':''}>hPa / mbar</option>
        <option value="inHg" ${P.pressUnit==='inHg'?'selected':''}>inHg</option>
      </select>
    </div>
  </div></div>`;

  // ── Map ──
  h+=`<div class="card"><div class="set-group">
    <div class="set-group-title">${t('setMap')}</div>
    <div class="set-row">
      <div class="set-label">${t('setSeaMap')}<small>${t('setSeaMapHint')}</small></div>
      <input type="checkbox" class="set-check" ${P.seaMap?'checked':''} onchange="setSave('seaMap',this.checked)">
    </div>
    <div class="set-row">
      <div class="set-label">${t('setMapHeight')}</div>
      <select class="set-select" onchange="setSave('mapHeight',this.value)">
        <option value="30vh" ${P.mapHeight==='30vh'?'selected':''}>${t('setCompact')} (30%)</option>
        <option value="45vh" ${P.mapHeight==='45vh'?'selected':''}>${t('setDefault')} (45%)</option>
        <option value="60vh" ${P.mapHeight==='60vh'?'selected':''}>${t('setLarge')} (60%)</option>
      </select>
    </div>
  </div></div>`;

  // ── Display ──
  h+=`<div class="card"><div class="set-group">
    <div class="set-group-title">${t('setDisplay')}</div>
    <div class="set-row">
      <div class="set-label">${t('setLogLines')}</div>
      <select class="set-select" onchange="setSave('logLines',parseInt(this.value))">
        <option value="50" ${P.logLines===50?'selected':''}>50</option>
        <option value="100" ${P.logLines===100?'selected':''}>100</option>
        <option value="200" ${P.logLines===200?'selected':''}>200</option>
        <option value="500" ${P.logLines===500?'selected':''}>500</option>
        <option value="0" ${P.logLines===0?'selected':''}>${t('all')}</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setAutoRefresh')}</div>
      <select class="set-select" onchange="setSave('autoRefreshSec',parseInt(this.value))">
        <option value="3" ${P.autoRefreshSec===3?'selected':''}>3s</option>
        <option value="5" ${P.autoRefreshSec===5?'selected':''}>5s</option>
        <option value="10" ${P.autoRefreshSec===10?'selected':''}>10s</option>
        <option value="0" ${P.autoRefreshSec===0?'selected':''}>${t('off')}</option>
      </select>
    </div>
    <div class="set-row">
      <div class="set-label">${t('setCompactMode')}<small>${t('setCompactHint')}</small></div>
      <input type="checkbox" class="set-check" ${P.compact?'checked':''} onchange="setSave('compact',this.checked);applyCompact()">
    </div>
  </div></div>`;

  // ── Export ──
  h+=`<div class="card"><div class="set-group">
    <div class="set-group-title">${t('setExport')}</div>
    <div class="set-row">
      <div class="set-label">${t('setGpxAis')}</div>
      <input type="checkbox" class="set-check" ${P.gpxAis?'checked':''} onchange="setSave('gpxAis',this.checked)">
    </div>
    <div class="set-row">
      <div class="set-label">${t('setGpxEvents')}</div>
      <input type="checkbox" class="set-check" ${P.gpxEvents?'checked':''} onchange="setSave('gpxEvents',this.checked)">
    </div>
  </div></div>`;

  // ── Engine / Fuel config ──
  try{
    const eng=await api('/api/engine');
    h+=`<div class="card"><div class="set-group">
      <div class="set-group-title">${t('engineTab')}</div>
      <div class="set-row">
        <div class="set-label">${t('fuelTankCapacity')}</div>
        <input type="number" class="set-select" id="ec-cap" value="${eng.config.tankCapacityLiters||''}" style="width:80px" onchange="saveEngConfig()">
      </div>
      <div class="set-row">
        <div class="set-label">${t('engineBaseHours')}</div>
        <input type="number" class="set-select" id="ec-base" value="${eng.config.baseHours||''}" step="0.1" style="width:80px" onchange="saveEngConfig()">
      </div>
      <div class="set-row">
        <div class="set-label">${t('tankSensorPath')}<small>${eng.tankLevel!==null?'✓ '+Math.round(eng.tankLevel*100)+'%':'✕'}</small></div>
        <input type="text" class="set-select" id="ec-tank" value="${eng.config.tankSensorPath||'tanks.fuel.0.currentLevel'}" style="width:180px;font-size:.75em" onchange="saveEngConfig()">
      </div>
    </div></div>`;

    // Maintenance intervals
    h+=`<div class="card"><div class="set-group">
      <div class="set-group-title">${t('maintenanceSchedule')}</div>
      <div class="set-row" style="border-bottom:none;padding-bottom:0">
        <div class="set-label"></div>
        <div style="display:flex;gap:4px;align-items:center;font-size:.68em;color:var(--muted);text-transform:uppercase;font-weight:600">
          <span style="width:60px;text-align:center">${t('durH')}</span>
          <span style="width:20px;text-align:center">${t('or')||'of'}</span>
          <span style="width:50px;text-align:center">mnd</span>
        </div>
      </div>`;
    for(let i=0;i<(eng.schedule||[]).length;i++){
      const s=eng.schedule[i];
      const icon=MAINT_ICONS[s.type]||'🔧';
      h+=`<div class="set-row">
        <div class="set-label">${icon} ${maintLabel(s.type)}</div>
        <div style="display:flex;gap:4px;align-items:center">
          <input type="number" class="set-select" id="ms-h-${i}" value="${s.intervalHours||''}" style="width:60px;text-align:center" placeholder="—">
          <span style="font-size:.72em;color:var(--dim)">${t('or')||'of'}</span>
          <input type="number" class="set-select" id="ms-m-${i}" value="${s.intervalMonths||''}" style="width:50px;text-align:center" placeholder="—">
        </div>
      </div>`;
    }
    h+=`<div class="set-row"><span class="btn btn-sm btn-blue" onclick="saveMaintIntervals(${(eng.schedule||[]).length})">${t('save')||'Save'}</span></div>`;
    h+=`</div></div>`;
  }catch(e){}

  // ── Storage ──
  try{
    const st=await api('/api/stats');
    if(st&&st.storage){
      const s=st.storage;
      h+=`<div class="card"><div class="set-group">
        <div class="set-group-title">${t('storageUsage')}</div>
        <div class="set-row"><div class="set-label">${t('storageLogs')}</div><div>${s.logCount}</div></div>
        <div class="set-row"><div class="set-label">${t('storageCompressed')}</div><div>${s.compressedCount}</div></div>
        <div class="set-row"><div class="set-label">${t('storageTrash')}</div><div>${s.trashCount}</div></div>
        <div class="set-row"><div class="set-label">${t('storageUsage')}</div><div>${s.totalMB} MB</div></div>
        <div class="set-row"><div class="set-label">${t('warmCache')}<small>${t('warmCacheHint')}</small></div><span class="btn btn-sm btn-blue" id="warm-btn" onclick="warmCache()">▶</span></div>
      </div></div>`;
    }
  }catch(e){}

  // ── Trash ──
  const trashFiles=await loadTrash();
  h+=`<div class="card"><div class="set-group">
    <div class="set-group-title">${t('trash')}</div>`;
  if(trashFiles.length){
    for(const f of trashFiles){
      h+=`<div class="set-row">
        <div class="set-label">${f.date}<small>${fmtSize(f.size)}</small></div>
        <div style="display:flex;gap:6px">
          <span class="btn btn-sm btn-blue" onclick="restoreTrash('${f.name}')">${t('trashRestore')}</span>
          <span class="btn btn-sm btn-red" onclick="deleteTrash('${f.name}')">✕</span>
        </div>
      </div>`;
    }
    h+=`<div class="set-row"><span class="btn btn-sm btn-red" onclick="emptyTrash()">${t('trashEmptyAll')}</span></div>`;
  } else {
    h+=`<div class="set-row"><div class="set-label" class="meta-text">${t('trashEmpty')}</div></div>`;
  }
  h+=`</div></div>`;

  // ── Reset ──
  h+=`<div class="set-reset"><span class="btn btn-red" onclick="if(confirm(t('setResetConfirm'))){localStorage.removeItem('nmea-prefs');P=Object.assign({},PREF_DEFAULTS);savePrefs();applyTheme('dark');applyCompact();showSettings();}">${t('setReset')}</span></div>`;

  el.innerHTML=h;
}

function setSave(key,val){P[key]=val;savePrefs();}
function toggleCustomTZ(){
  const el=document.getElementById('set-tz-custom');
  if(el) el.style.display=P.tz==='custom'?'':'none';
}
function reloadLang(){loadLang(P.lang).then(()=>showSettings());}
async function warmCache(){
  const btn=document.getElementById('warm-btn');
  if(btn){btn.textContent='⏳';btn.style.opacity='.5';btn.style.pointerEvents='none';}
  try{
    const r=await postApi('/api/cache/warm',{});
    toast(t('warmCacheDone',r.warmed||0,r.skipped||0),'ok',4000);
    if(btn) btn.textContent='✓';
  }catch(e){toast('Error: '+e.message,'err');if(btn) btn.textContent='✕';}
  finally{if(btn){btn.style.opacity='';btn.style.pointerEvents='';}}
}
function applyCompact(){
  if(P.compact) document.body.classList.add('compact');
  else document.body.classList.remove('compact');
}

async function refreshApp(){
  try{
    // Clear service worker caches
    if('caches' in window){
      const names=await caches.keys();
      for(const n of names) await caches.delete(n);
    }
    // Unregister service worker
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      for(const r of regs) await r.unregister();
    }
  }catch(e){}
  // Clear view cache
  Object.keys(viewCache).forEach(k=>delete viewCache[k]);
  // Hard reload
  window.location.reload(true);
}

/* ── Theme toggle ── */
function toggleTheme(){
  P.theme=P.theme==='light'?'dark':'light';
  savePrefs();
  applyTheme(P.theme);
}
function applyTheme(theme){
  if(theme==='light'){
    document.documentElement.setAttribute('data-theme','light');
    document.querySelector('meta[name="theme-color"]').content='#0277bd';
  }else{
    document.documentElement.removeAttribute('data-theme');
    document.querySelector('meta[name="theme-color"]').content='#4fc3f7';
  }
}

/* ── Apply saved prefs on load ── */
applyTheme(P.theme||'dark');
applyCompact();

/* ── Init ── */
async function initLang(){
  try{
    curLang=P.lang||'en';
    await loadLang(curLang);
  }catch(e){console.error('Lang init:',e);}
}
/* ── History navigation (swipe back support) ── */
let _fromPop=false;
history.replaceState({type:'list',tab:'logs'},'','#list');

window.addEventListener('popstate',function(e){
  const s=e.state;
  if(!s) return;
  _fromPop=true;
  if(s.type==='list'){activeTab=s.tab||'logs';if(activeTab==='engine')showEngine();else if(activeTab==='power')showPower();else if(activeTab==='settings')showSettings();else showList();}
  else if(s.type==='detail'&&s.fn){viewFile(s.fn);}
  else if(s.type==='voyage'&&s.vid){viewVoyage(s.vid);}
  else if(s.type==='settings'){showSettings();}
  else{showList();}
  _fromPop=false;
});

initLang().then(()=>{
  loadChips();showList();
  // Preload avg fuel consumption for day-log estimates
  api('/api/engine').then(e=>{window._engAvgConsumption=e.avgConsumption||null;}).catch(()=>{});
});
setInterval(loadChips,15000);

/* ── PWA Service Worker ── */
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}

/* ── Offline detection ── */
function updateOnlineStatus(){
  const bar=document.getElementById('offline-bar');
  if(bar) bar.style.display=navigator.onLine?'none':'block';
}
window.addEventListener('online',updateOnlineStatus);
window.addEventListener('offline',updateOnlineStatus);
updateOnlineStatus();
