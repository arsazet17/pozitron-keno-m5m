(function(){
  'use strict';

  const E=window.M5Engine,S=window.M5MatrixStore;
  const PREF_KEYS={overrides:'m5m.overrides.v4',custom:'m5m.customMatrix.v4'};
  let prefs={};
  let baseMatrix=null,matrix=null,forecast=null,customActive=false,lastFP='',syncMeta=null;

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // ---- IndexedDB вместо localStorage ----
  const DB_NAME='m5m-client-db';
  const DB_VERSION=1;
  const DB_STORE='kv';
  let dbPromise=null;

  function openDB(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){resolve(null);return;}
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE);
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>{console.warn('M5M IndexedDB open',req.error);resolve(null);};
    });
    return dbPromise;
  }

  async function dbGet(k){
    const db=await openDB(); if(!db)return undefined;
    return new Promise(resolve=>{
      try{
        const tx=db.transaction(DB_STORE,'readonly');
        const req=tx.objectStore(DB_STORE).get(k);
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>resolve(undefined);
      }catch{resolve(undefined);}
    });
  }

  async function dbPut(k,v){
    const db=await openDB(); if(!db)return false;
    return new Promise(resolve=>{
      try{
        const tx=db.transaction(DB_STORE,'readwrite');
        tx.objectStore(DB_STORE).put(v,k);
        tx.oncomplete=()=>resolve(true);
        tx.onerror=()=>resolve(false);
      }catch{resolve(false);}
    });
  }

  async function dbDelete(k){
    const db=await openDB(); if(!db)return false;
    return new Promise(resolve=>{
      try{
        const tx=db.transaction(DB_STORE,'readwrite');
        tx.objectStore(DB_STORE).delete(k);
        tx.oncomplete=()=>resolve(true);
        tx.onerror=()=>resolve(false);
      }catch{resolve(false);}
    });
  }

  async function initPrefs(){
    for(const k of Object.values(PREF_KEYS)){
      const v=await dbGet(k);
      if(v!==undefined)prefs[k]=v;
    }
  }

  const load=(k,d)=>Object.prototype.hasOwnProperty.call(prefs,k)?prefs[k]:d;
  const save=(k,v)=>{prefs[k]=v;dbPut(k,v);return v;};
  const remove=(k)=>{delete prefs[k];dbDelete(k);};

  function toast(x){
    const t=$('toast');if(!t)return;
    t.textContent=x;t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2400);
  }
  function fp(rows){return JSON.stringify((rows||[]).slice(-2));}
  function countsText(c){
    return Object.entries(c||{}).sort((a,b)=>b[1]-a[1]||Number(a[0])-Number(b[0]))
      .map(([v,n])=>n>1?`${v}×${n}`:v).join(' · ')||'—';
  }
  function formatDrawNo(n){
    if(n==null||n===''||Number(n)<=0)return '№—';
    const v=Number(n);return Number.isFinite(v)?`№${v}`:'№—';
  }

  async function fetchOptionalJSON(name){
    try{
      const r=await fetch(`${name}?ts=${Date.now()}`,{cache:'no-store'});
      if(!r.ok)return null;
      return await r.json();
    }catch(e){console.warn(name,e);return null;}
  }

  // Сервер — единственный источник истории.
  // Никакой истории в localStorage/IndexedDB не хранится.
  function applyServerState(src){
    if(src?.version!==3)return;
    if(typeof S.replaceFromServer==='function')S.replaceFromServer(src);
    else S.save(src);
  }

  async function loadLearningSources(){
    const server=await fetchOptionalJSON('data/m5-server-state.json');
    if(server)applyServerState(server);
    else{
      const seed=await fetchOptionalJSON('data/algorithm_seed_v3.json');
      if(seed)S.mergeSeed(seed);
    }
    syncMeta=await fetchOptionalJSON('data/last_sync.json');
  }

  async function fetchArchive(){
    if(customActive){
      const c=load(PREF_KEYS.custom,null);
      if(c?.rows)return c;
    }
    const r=await fetch(`data/archive.json?ts=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  function officialFilledSequence(){
    if(!matrix)return [];
    const out=[],hm=E.headerMap(matrix);
    for(let r=1;r<matrix.length;r++){
      const date=String(matrix[r]?.[0]||'');
      if(!E.parseDate(date))continue;
      for(const time of E.SCHEDULE){
        const c=hm[time];if(c==null)continue;
        const actual=E.val(matrix[r]?.[c]);
        if(actual!=null)out.push({date,time,actual});
      }
    }
    return out;
  }

  function officialDrawFor(date,time){
    const latest=syncMeta?.latestOfficial,latestDraw=Number(latest?.draw);
    if(!latest||!Number.isFinite(latestDraw)||latestDraw<=0)return null;
    const seq=officialFilledSequence();if(!seq.length)return null;
    const li=seq.findIndex(x=>x.date===String(latest.date)&&x.time===String(latest.time));
    const ti=seq.findIndex(x=>x.date===String(date)&&x.time===String(time));
    if(li<0||ti<0)return null;
    const draw=latestDraw+(ti-li);
    return Number.isFinite(draw)&&draw>0?draw:null;
  }

  function renderForecast(){
    if(!forecast)return;
    $('targetTime').textContent=forecast.target.time;
    $('targetDate').textContent=`${forecast.target.date} · ${forecast.weekday}`;
    $('mainValue').textContent=forecast.main??'—';
    $('modelMode').textContent=`${forecast.model.mode} · база ${forecast.model.historyRows} · история ${Math.round(forecast.model.adaptiveWeight*100)}%`;
    $('pickBalls').innerHTML=forecast.picks.map((v,i)=>`<span class="ball ${i===0?'main-ball':''}">${v}</span>`).join('');
    $('reserveBalls').innerHTML=forecast.reserve.map(v=>`<span class="scanner-ball">${v}</span>`).join('');
    $('vChain').textContent=forecast.vChain.join('–');
    $('hChain').textContent=forecast.hChain.join('–');
    $('rawMethods').innerHTML=Object.entries(forecast.methods).map(([name,m])=>
      `<div class="method"><div><b>${name}</b><span>L${m.usedLen} · ${esc(m.usedChain.join('–'))}</span></div><strong>${esc(countsText(m.counts))}</strong></div>`
    ).join('');
    $('repeatLine').innerHTML=forecast.repeats.map(r=>`<span class="repeat-chip">${r.label} ${r.value??'—'}</span>`).join('');
  }

  function renderHistory(){
    const box=$('historyBody');if(!box)return;

    const opened=new Set(
      [...box.querySelectorAll('details.history-item[open]')]
        .map(x=>x.dataset.key).filter(Boolean)
    );

    const fin=Object.values(S.load().finalized)
      .sort((a,b)=>E.parseDate(b.date)-E.parseDate(a.date)||E.SCHEDULE.indexOf(b.time)-E.SCHEDULE.indexOf(a.time))
      .slice(0,150);

    box.innerHTML=fin.map(r=>{
      const draw=officialDrawFor(r.date,r.time)??r.draw??null;
      const hit=!!r.hitTop3;
      const mainHit=!!r.hitMain;
      const reserve=(r.m5Reserve||[]);
      const reserveHit=reserve.includes(Number(r.actual));
      const won=hit||reserveHit;
      const status=reserveHit?'🔥🔥':hit?'🔥':'—';
      const resultText=mainHit?'🔥 ГЛАВНЫЙ':hit?'🔥 TOP-3':reserveHit?'🔥 РЕЗЕРВ':'мимо';
      const top3=(r.m5Picks||[]).join(' · ')||'—';
      const reserveText=reserve.join(' · ')||'—';
      return `<details class="history-item ${won?'is-hit':'is-miss'}" data-key="${esc(r.key||`${r.date}|${r.time}`)}">
        <summary>
          <span class="history-draw">${formatDrawNo(draw)}</span>
          <span class="history-date">${esc(r.date)}</span>
          <span class="history-time">${esc(r.time)}</span>
          <span class="history-column">ст${r.actual??'—'}</span>
          <span class="history-fire" aria-label="${won?'Выигрыш':'Мимо'}">${status}</span>
          <span class="history-chevron">▾</span>
        </summary>
        <div class="history-body">
          <div class="history-line"><span>Тираж</span><b>${formatDrawNo(draw)}</b></div>
          <div class="history-line"><span>Дата</span><b>${esc(r.date)}</b></div>
          <div class="history-line"><span>Время</span><b>${esc(r.time)}</b></div>
          <div class="history-line"><span>Столб</span><b class="history-fact">${r.actual??'—'}</b></div>
          <div class="history-line"><span>Главный M5</span><b>${r.m5Main??'—'} ${mainHit?'<em class="history-win">✓</em>':''}</b></div>
          <div class="history-line"><span>TOP-3 M5</span><b class="history-top3">${esc(top3)}</b></div>
          <div class="history-line"><span>Результат</span><b class="${won?'history-win':'history-miss'}">${resultText}</b></div>
          <div class="history-line"><span>Резерв M5</span><b class="history-reserve">${esc(reserveText)}</b></div>
          ${reserveHit?'<div class="history-line history-reserve-hit"><span>Резерв</span><b>🔥 ВЫШЕЛ ИЗ РЕЗЕРВА</b></div>':''}
          <div class="history-reason"><span>Почему вышел столб</span><b>${esc(r.criterion||'—')}</b></div>
        </div>
      </details>`;
    }).join('')||'<div class="history-empty">Пока нет завершённых прогнозов M5.</div>';

    for(const d of box.querySelectorAll('details.history-item')){
      if(opened.has(d.dataset.key))d.open=true;
    }
  }

  function renderMatrix(){
    const st=S.load();
    const fin=Object.values(st.finalized)
      .sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
    const dates=[...new Set(fin.map(x=>x.date))].slice(-8);
    let html='<table class="algo-matrix"><thead><tr><th>Дата</th>'+E.SCHEDULE.map(t=>`<th>${t}</th>`).join('')+'</tr></thead><tbody>';
    for(const d of dates){
      html+=`<tr><th>${d}<small>${E.weekday(d)}</small></th>`;
      for(const t of E.SCHEDULE){
        const r=st.finalized[`${d}|${t}`];
        html+=r?`<td title="${esc(r.criterion)}"><b>${r.actual}</b><small>${esc(r.criterion)}</small><em>cov ${r.coverage} · raw ${r.raw_total} · d ${r.depth} · rep ${r.repeat_count}</em></td>`:'<td></td>';
      }
      html+='</tr>';
    }
    html+='</tbody></table>';
    $('algoMatrix').innerHTML=html;

    const p=Object.values(st.snapshots)
      .filter(x=>!st.finalized[x.key])
      .sort((a,b)=>String(a.capturedAt).localeCompare(String(b.capturedAt))).at(-1);

    $('algoPending').innerHTML=p
      ?`<b>${p.date} · ${p.weekday} · ${p.time}</b><span>🔒 RAW + повторы + M5 SCORE сохранены до факта</span>`
      :'Нет ожидающего снимка';
    $('algoMeta').textContent=`снимков ${Object.keys(st.snapshots).length} · завершено ${Object.keys(st.finalized).length} · SERVER`;
  }

  function fillControls(){
    if(!$('resultTime').options.length)$('resultTime').innerHTML=E.SCHEDULE.map(t=>`<option>${t}</option>`).join('');
    if(forecast){
      $('resultDate').value=forecast.target.date;
      $('resultTime').value=forecast.target.time;
    }
  }

  function renderAll(){
    renderForecast();renderHistory();renderMatrix();fillControls();
    $('archiveStatus').textContent=`Архив: ${matrix.length-1} дат · история SERVER`;
  }

  async function compute(rows,reason){
    baseMatrix=rows;
    matrix=E.cloneMatrix(rows);
    E.applyOverrides(matrix,load(PREF_KEYS.overrides,{}));
    S.reconcile(matrix);
    const target=E.nextTarget(matrix);
    forecast=E.predict(matrix,target,S.load());
    S.capture(forecast);
    renderAll();
    window.dispatchEvent(new CustomEvent('m5:forecast',{detail:{forecast,reason}}));
  }

  async function refresh(reason='refresh',show=false){
    try{
      // Сначала всегда тянем свежую серверную историю.
      await loadLearningSources();
      const j=await fetchArchive();
      if(!j?.rows?.length)throw new Error('неверный archive.json');
      const changed=fp(j.rows)!==lastFP;
      lastFP=fp(j.rows);
      await compute(j.rows,reason);
      if(show||changed)toast(`M5 пересчитан · ${forecast.target.time}`);
    }catch(e){
      console.error(e);
      $('archiveStatus').textContent=`Ошибка: ${e.message}`;
    }
  }

  $('recalc').addEventListener('click',()=>refresh('manual',true));
  $('forceUpdate').addEventListener('click',()=>refresh('force',true));

  $('saveResult').addEventListener('click',async()=>{
    const d=$('resultDate').value.trim(),t=$('resultTime').value,v=E.val($('resultValue').value);
    if(!E.parseDate(d)||!E.SCHEDULE.includes(t)||v==null){
      toast('Проверь дату/время/столб');return;
    }
    const o={...load(PREF_KEYS.overrides,{})};
    o[`${d}|${t}`]=v;
    save(PREF_KEYS.overrides,o);
    $('resultValue').value='';
    await compute(baseMatrix,'manual-result');
    toast(`Факт ${d} ${t} = ${v}`);
  });

  $('clearLocal').addEventListener('click',async()=>{
    if(!confirm('Очистить локальные факты M5?'))return;
    remove(PREF_KEYS.overrides);
    await compute(baseMatrix,'clear');
    toast('Локальные факты очищены');
  });

  $('exportXlsx').addEventListener('click',()=>{
    if(!window.XLSX)return;
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(matrix),'КЕНО столбы');
    XLSX.writeFile(wb,'M5M_current_archive.xlsx');
  });

  $('exportAlgo').addEventListener('click',()=>{
    if(!window.XLSX)return;
    const st=S.load(),rows=[['Дата','День','Время','Факт','M5 главный','M5 TOP3','M5 резерв','Попадание','Критерий','Coverage','Raw','Depth','Repeats']];
    Object.values(st.finalized)
      .sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time))
      .forEach(r=>rows.push([
        r.date,r.weekday,r.time,r.actual,r.m5Main,(r.m5Picks||[]).join('-'),(r.m5Reserve||[]).join('-'),
        r.hitMain?'MAIN':r.hitTop3?'TOP3':(r.m5Reserve||[]).includes(Number(r.actual))?'RESERVE':'MISS',
        r.criterion,r.coverage,r.raw_total,r.depth,(r.repeats||[]).join('')
      ]));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'M5 алгоритм');
    XLSX.writeFile(wb,'M5M_algorithm_matrix_v3.xlsx');
  });

  $('importXlsx').addEventListener('change',async ev=>{
    const f=ev.target.files?.[0];
    if(!f||!window.XLSX)return;
    try{
      const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
      save(PREF_KEYS.custom,{rows});
      customActive=true;
      await compute(rows,'import');
      toast('Excel загружен');
    }catch(e){toast(e.message)}
    ev.target.value='';
  });

  $('useOfficial').addEventListener('click',async()=>{
    remove(PREF_KEYS.custom);
    customActive=false;
    await refresh('official',true);
  });

  $('clearAlgo').addEventListener('click',async()=>{
    if(!confirm('Перезагрузить серверную матрицу M5?'))return;
    S.clear();
    await refresh('reload-server',true);
    toast('Серверная история загружена заново');
  });

  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)refresh('visible',false);
  });

  setInterval(()=>{
    if(!document.hidden&&!customActive)refresh('timer',false);
  },15000);

  window.M5App={
    getForecast:()=>forecast,
    getMatrix:()=>matrix?E.cloneMatrix(matrix):null,
    refresh
  };

  (async()=>{
    await initPrefs();
    customActive=!!load(PREF_KEYS.custom,null)?.rows;
    await refresh('startup',false);
  })();
})();
