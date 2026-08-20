(function(){
  'use strict';
  const E=window.M5Engine,S=window.M5MatrixStore;
  const LS={overrides:'m5m.overrides.v3',custom:'m5m.customMatrix.v3'};
  let baseMatrix=null,matrix=null,forecast=null,customActive=false,lastFP='';
  const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const load=(k,d)=>{try{const x=localStorage.getItem(k);return x==null?d:JSON.parse(x)}catch{return d}},save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  function toast(x){const t=$('toast');if(!t)return;t.textContent=x;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}
  function fp(rows){return JSON.stringify((rows||[]).slice(-2));}
  function countsText(c){return Object.entries(c||{}).sort((a,b)=>b[1]-a[1]||Number(a[0])-Number(b[0])).map(([v,n])=>n>1?`${v}×${n}`:v).join(' · ')||'—';}

  async function fetchOptionalJSON(name){
    try{const r=await fetch(`${name}?ts=${Date.now()}`,{cache:'no-store'});if(!r.ok)return null;return await r.json();}
    catch(e){console.warn(name,e);return null;}
  }
  function mergeServerState(src){
    if(src?.version!==3)return;
    const st=S.load();let changed=false;
    for(const [k,r] of Object.entries(src.finalized||{})){
      const before=st.finalized[k];
      if(JSON.stringify(before)!==JSON.stringify(r)){st.finalized[k]=r;changed=true;}
      if(st.snapshots[k]){delete st.snapshots[k];changed=true;}
    }
    for(const [k,p] of Object.entries(src.snapshots||{})){
      if(st.finalized[k])continue;
      if(JSON.stringify(st.snapshots[k])!==JSON.stringify(p)){st.snapshots[k]=p;changed=true;}
    }
    if(changed)S.save(st);
  }
  async function loadLearningSources(){
    const seed=await fetchOptionalJSON('data/algorithm_seed_v3.json');
    if(seed)S.mergeSeed(seed);
    const server=await fetchOptionalJSON('data/m5-server-state.json');
    if(server)mergeServerState(server);
  }
  async function fetchArchive(){if(customActive){const c=load(LS.custom,null);if(c?.rows)return c;}const r=await fetch(`data/archive.json?ts=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}

  function renderForecast(){
    if(!forecast)return;
    $('targetTime').textContent=forecast.target.time;$('targetDate').textContent=`${forecast.target.date} · ${forecast.weekday}`;
    $('mainValue').textContent=forecast.main??'—';$('modelMode').textContent=`${forecast.model.mode} · база ${forecast.model.historyRows} · история ${Math.round(forecast.model.adaptiveWeight*100)}%`;
    $('pickBalls').innerHTML=forecast.picks.map((v,i)=>`<span class="ball ${i===0?'main-ball':''}">${v}</span>`).join('');
    $('reserveBalls').innerHTML=forecast.reserve.map(v=>`<span class="scanner-ball">${v}</span>`).join('');
    $('vChain').textContent=forecast.vChain.join('–');$('hChain').textContent=forecast.hChain.join('–');
    $('rawMethods').innerHTML=Object.entries(forecast.methods).map(([name,m])=>`<div class="method"><div><b>${name}</b><span>L${m.usedLen} · ${esc(m.usedChain.join('–'))}</span></div><strong>${esc(countsText(m.counts))}</strong></div>`).join('');
    $('repeatLine').innerHTML=forecast.repeats.map(r=>`<span class="repeat-chip">${r.label} ${r.value??'—'}</span>`).join('');
    $('scoreTable').innerHTML=forecast.ranking.map((r,i)=>`<tr class="${i<3?'picked-row':''}"><td>${i+1}</td><td><b>${r.value}</b></td><td>${r.score.toFixed(1)}</td><td>${r.structureScore.toFixed(1)}</td><td>${r.historyScore.toFixed(1)}</td><td>${r.coverage}</td><td>${r.raw_total}</td><td>${r.depth}</td><td>${r.repeat_count}</td><td>${esc((r.methods||[]).join('+')||'—')}</td><td>${esc((r.repeats||[]).join('')||'—')}</td></tr>`).join('');
  }

  function renderHistory(){const fin=Object.values(S.load().finalized).sort((a,b)=>E.parseDate(b.date)-E.parseDate(a.date)||E.SCHEDULE.indexOf(b.time)-E.SCHEDULE.indexOf(a.time));$('historyBody').innerHTML=fin.slice(0,150).map(r=>`<tr><td>${r.date}</td><td>${r.time}</td><td><b>${r.actual}</b></td><td>${r.m5Main??'—'}</td><td>${(r.m5Picks||[]).join('·')||'—'}</td><td>${r.hitMain?'✅ главный':r.hitTop3?'☑️ TOP-3':'❌'}</td><td>${esc(r.criterion||'—')}</td></tr>`).join('');}

  function renderMatrix(){
    const st=S.load(),fin=Object.values(st.finalized).sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
    const dates=[...new Set(fin.map(x=>x.date))].slice(-8);let html='<table class="algo-matrix"><thead><tr><th>Дата</th>'+E.SCHEDULE.map(t=>`<th>${t}</th>`).join('')+'</tr></thead><tbody>';
    for(const d of dates){html+=`<tr><th>${d}<small>${E.weekday(d)}</small></th>`;for(const t of E.SCHEDULE){const r=st.finalized[`${d}|${t}`];html+=r?`<td title="${esc(r.criterion)}"><b>${r.actual}</b><small>${esc(r.criterion)}</small><em>cov ${r.coverage} · raw ${r.raw_total} · d ${r.depth} · rep ${r.repeat_count}</em></td>`:'<td></td>';}html+='</tr>';}html+='</tbody></table>';$('algoMatrix').innerHTML=html;
    const p=Object.values(st.snapshots).filter(x=>!st.finalized[x.key]).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)).at(-1);$('algoPending').innerHTML=p?`<b>${p.date} · ${p.weekday} · ${p.time}</b><span>🔒 RAW + повторы + M5 SCORE сохранены до факта</span>`:'Нет ожидающего снимка';
    $('algoMeta').textContent=`снимков ${Object.keys(st.snapshots).length} · завершено ${Object.keys(st.finalized).length}`;
  }

  function fillControls(){if(!$('resultTime').options.length)$('resultTime').innerHTML=E.SCHEDULE.map(t=>`<option>${t}</option>`).join('');if(forecast){$('resultDate').value=forecast.target.date;$('resultTime').value=forecast.target.time;}}
  function renderAll(){renderForecast();renderHistory();renderMatrix();fillControls();$('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;}

  async function compute(rows,reason){baseMatrix=rows;matrix=E.cloneMatrix(rows);E.applyOverrides(matrix,load(LS.overrides,{}));S.reconcile(matrix);const target=E.nextTarget(matrix);forecast=E.predict(matrix,target,S.load());S.capture(forecast);renderAll();window.dispatchEvent(new CustomEvent('m5:forecast',{detail:{forecast,reason}}));}
  async function refresh(reason='refresh',show=false){try{await loadLearningSources();const j=await fetchArchive();if(!j?.rows?.length)throw new Error('неверный archive.json');const changed=fp(j.rows)!==lastFP;lastFP=fp(j.rows);await compute(j.rows,reason);if(show||changed)toast(`M5 пересчитан · ${forecast.target.time}`);}catch(e){console.error(e);$('archiveStatus').textContent=`Ошибка: ${e.message}`;}}

  $('recalc').addEventListener('click',()=>refresh('manual',true));$('forceUpdate').addEventListener('click',()=>refresh('force',true));
  $('saveResult').addEventListener('click',async()=>{const d=$('resultDate').value.trim(),t=$('resultTime').value,v=E.val($('resultValue').value);if(!E.parseDate(d)||!E.SCHEDULE.includes(t)||v==null){toast('Проверь дату/время/столб');return;}const o=load(LS.overrides,{});o[`${d}|${t}`]=v;save(LS.overrides,o);$('resultValue').value='';await compute(baseMatrix,'manual-result');toast(`Факт ${d} ${t} = ${v}`);});
  $('clearLocal').addEventListener('click',async()=>{if(!confirm('Очистить локальные факты M5?'))return;localStorage.removeItem(LS.overrides);await compute(baseMatrix,'clear');toast('Локальные факты очищены');});
  $('exportXlsx').addEventListener('click',()=>{if(!window.XLSX)return;const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(matrix),'КЕНО столбы');XLSX.writeFile(wb,'M5M_current_archive.xlsx');});
  $('exportAlgo').addEventListener('click',()=>{if(!window.XLSX)return;const st=S.load(),rows=[['Дата','День','Время','Факт','M5 главный','M5 TOP3','Попадание','Критерий','Coverage','Raw','Depth','Repeats']];Object.values(st.finalized).sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time)).forEach(r=>rows.push([r.date,r.weekday,r.time,r.actual,r.m5Main,(r.m5Picks||[]).join('-'),r.hitMain?'MAIN':r.hitTop3?'TOP3':'MISS',r.criterion,r.coverage,r.raw_total,r.depth,(r.repeats||[]).join('')]));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'M5 алгоритм');XLSX.writeFile(wb,'M5M_algorithm_matrix_v3.xlsx');});
  $('importXlsx').addEventListener('change',async ev=>{const f=ev.target.files?.[0];if(!f||!window.XLSX)return;try{const wb=XLSX.read(await f.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});save(LS.custom,{rows});customActive=true;await compute(rows,'import');toast('Excel загружен');}catch(e){toast(e.message)}ev.target.value='';});
  $('useOfficial').addEventListener('click',async()=>{localStorage.removeItem(LS.custom);customActive=false;await refresh('official',true);});
  $('clearAlgo').addEventListener('click',async()=>{if(!confirm('Очистить накопленную матрицу M5 на этом устройстве?'))return;S.clear();await loadLearningSources();await compute(baseMatrix,'clear-algo');toast('Матрица очищена и серверная история восстановлена');});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh('visible',false)});setInterval(()=>{if(!document.hidden&&!customActive)refresh('timer',false)},15000);
  window.M5App={getForecast:()=>forecast,getMatrix:()=>matrix?E.cloneMatrix(matrix):null,refresh};
  (async()=>{customActive=!!load(LS.custom,null)?.rows;await refresh('startup',false);})();
})();
