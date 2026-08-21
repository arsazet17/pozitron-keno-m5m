(function(){
  'use strict';

  const E=window.M5Engine;
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  let runtime=null;
  let forecast=null;
  let matrix=null;
  let lastGeneration='';
  let refreshing=false;

  function toast(x){
    const t=$('toast'); if(!t)return;
    t.textContent=x; t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2400);
  }
  function countsText(c){
    return Object.entries(c||{}).sort((a,b)=>b[1]-a[1]||Number(a[0])-Number(b[0]))
      .map(([v,n])=>n>1?`${v}×${n}`:v).join(' · ')||'—';
  }
  function formatDrawNo(n){
    if(n==null||n===''||Number(n)<=0)return '№—';
    const v=Number(n); return Number.isFinite(v)?`№${v}`:'№—';
  }
  async function fetchJSON(url){
    const join=url.includes('?')?'&':'?';
    const r=await fetch(`${url}${join}ts=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);
    return await r.json();
  }
  function validRuntime(x){
    if(!x||x.version!==4)return false;
    if(!x.generation||!x.latestOfficial||!x.forecast?.target)return false;
    if(!Array.isArray(x.history))return false;
    const n=Number(x.totals?.finalized);
    const h=Number(x.forecast?.model?.historyRows);
    if(!Number.isFinite(n)||!Number.isFinite(h)||n!==h)return false;
    const latest=x.latestOfficial;
    const head=x.history[0];
    if(head && (String(head.date)!==String(latest.date)||String(head.time)!==String(latest.time)||Number(head.actual)!==Number(latest.column)))return false;
    return true;
  }

  function renderForecast(){
    if(!forecast)return;
    $('targetTime').textContent=forecast.target.time;
    $('targetDate').textContent=`${forecast.target.date} · ${forecast.weekday}`;
    $('mainValue').textContent=forecast.main??'—';
    $('modelMode').textContent=`${forecast.model.mode} · база ${forecast.model.historyRows} · история ${Math.round(forecast.model.adaptiveWeight*100)}%`;
    $('pickBalls').innerHTML=(forecast.picks||[]).map((v,i)=>`<span class="ball ${i===0?'main-ball':''}">${v}</span>`).join('');
    $('reserveBalls').innerHTML=(forecast.reserve||[]).map(v=>`<span class="scanner-ball">${v}</span>`).join('');
    $('vChain').textContent=(forecast.vChain||[]).join('–')||'—';
    $('hChain').textContent=(forecast.hChain||[]).join('–')||'—';
    $('rawMethods').innerHTML=Object.entries(forecast.methods||{}).map(([name,m])=>
      `<div class="method"><div><b>${name}</b><span>L${m.usedLen} · ${esc((m.usedChain||[]).join('–'))}</span></div><strong>${esc(countsText(m.counts))}</strong></div>`
    ).join('');
    $('repeatLine').innerHTML=(forecast.repeats||[]).map(r=>`<span class="repeat-chip">${r.label} ${r.value??'—'}</span>`).join('');
  }

  function renderHistory(){
    const box=$('historyBody'); if(!box)return;
    const opened=new Set([...box.querySelectorAll('details.history-item[open]')].map(x=>x.dataset.key).filter(Boolean));
    const fin=(runtime?.history||[]).slice(0,150);
    box.innerHTML=fin.map(r=>{
      const hit=!!r.hitTop3, mainHit=!!r.hitMain, reserve=(r.m5Reserve||[]);
      const reserveHit=reserve.includes(Number(r.actual)), won=hit||reserveHit;
      const status=reserveHit?'🔥🔥':hit?'🔥':'—';
      const resultText=mainHit?'🔥 ГЛАВНЫЙ':hit?'🔥 TOP-3':reserveHit?'🔥 РЕЗЕРВ':'мимо';
      const top3=(r.m5Picks||[]).join(' · ')||'—', reserveText=reserve.join(' · ')||'—';
      return `<details class="history-item ${won?'is-hit':'is-miss'}" data-key="${esc(r.key||`${r.date}|${r.time}`)}">
        <summary>
          <span class="history-draw">${formatDrawNo(r.draw)}</span>
          <span class="history-date">${esc(r.date)}</span>
          <span class="history-time">${esc(r.time)}</span>
          <span class="history-column">ст${r.actual??'—'}</span>
          <span class="history-fire" aria-label="${won?'Выигрыш':'Мимо'}">${status}</span>
          <span class="history-chevron">▾</span>
        </summary>
        <div class="history-body">
          <div class="history-line"><span>Тираж</span><b>${formatDrawNo(r.draw)}</b></div>
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
    for(const d of box.querySelectorAll('details.history-item'))if(opened.has(d.dataset.key))d.open=true;
  }

  function renderMatrix(){
    const fin=(runtime?.history||[]).slice().reverse();
    const dates=[...new Set(fin.map(x=>x.date))].slice(-8);
    const byKey=new Map(fin.map(r=>[`${r.date}|${r.time}`,r]));
    let html='<table class="algo-matrix"><thead><tr><th>Дата</th>'+E.SCHEDULE.map(t=>`<th>${t}</th>`).join('')+'</tr></thead><tbody>';
    for(const d of dates){
      html+=`<tr><th>${d}<small>${E.weekday(d)}</small></th>`;
      for(const t of E.SCHEDULE){
        const r=byKey.get(`${d}|${t}`);
        html+=r?`<td title="${esc(r.criterion)}"><b>${r.actual}</b><small>${esc(r.criterion)}</small><em>cov ${r.coverage} · raw ${r.raw_total} · d ${r.depth} · rep ${r.repeat_count}</em></td>`:'<td></td>';
      }
      html+='</tr>';
    }
    html+='</tbody></table>';
    $('algoMatrix').innerHTML=html;
    const p=runtime?.pending;
    $('algoPending').innerHTML=p?`<b>${p.date} · ${p.weekday} · ${p.time}</b><span>🔒 SERVER RAW + повторы + M5 SCORE сохранены до факта</span>`:'Нет ожидающего снимка';
    $('algoMeta').textContent=`снимков ${p?1:0} · завершено ${runtime?.totals?.finalized??0} · SERVER LIVE`;
  }

  function fillControls(){
    if(!$('resultTime').options.length)$('resultTime').innerHTML=E.SCHEDULE.map(t=>`<option>${t}</option>`).join('');
    if(forecast){$('resultDate').value=forecast.target.date;$('resultTime').value=forecast.target.time;}
  }
  function renderAll(){
    renderForecast(); renderHistory(); renderMatrix(); fillControls();
    const l=runtime.latestOfficial;
    $('archiveStatus').textContent=`LIVE №${l.draw} · ${l.date} ${l.time} · база ${runtime.totals.finalized}`;
  }

  async function loadRuntime(){
    const x=await fetchJSON('data/m5-runtime.json');
    if(!validRuntime(x))throw new Error('M5 runtime не прошёл проверку целостности');
    return x;
  }

  async function refresh(reason='refresh',show=false){
    if(refreshing)return;
    refreshing=true;
    try{
      const x=await loadRuntime();
      const changed=x.generation!==lastGeneration;
      runtime=x; forecast=x.forecast; lastGeneration=x.generation;
      renderAll();
      window.dispatchEvent(new CustomEvent('m5:forecast',{detail:{forecast,reason,generation:x.generation}}));
      if(show||changed)toast(`M5 LIVE · база ${x.totals.finalized} · ${forecast.target.time}`);
    }catch(e){
      console.error(e);
      forecast=null;
      $('mainValue').textContent='—';
      $('pickBalls').innerHTML='';
      $('reserveBalls').innerHTML='';
      $('archiveStatus').textContent=`ОБНОВЛЕНИЕ: ${e.message}`;
      toast('Нет свежего единого снимка — прогноз заблокирован');
    }finally{refreshing=false;}
  }

  async function ensureArchive(){
    if(matrix)return matrix;
    const j=await fetchJSON('data/archive.json');
    if(!j?.rows?.length)throw new Error('archive.json пуст');
    matrix=E.cloneMatrix(j.rows);
    return matrix;
  }

  $('recalc').addEventListener('click',()=>refresh('manual',true));
  $('forceUpdate').addEventListener('click',()=>refresh('force',true));

  $('saveResult').addEventListener('click',()=>toast('LIVE-режим: факты принимает сервер автоматически из Столото'));
  $('clearLocal').addEventListener('click',()=>toast('LIVE-режим: локальная история отключена'));
  $('clearAlgo').addEventListener('click',()=>refresh('reload-server',true));
  $('useOfficial').addEventListener('click',()=>refresh('official',true));

  $('exportXlsx').addEventListener('click',async()=>{
    if(!window.XLSX)return;
    try{
      const m=await ensureArchive();
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(m),'КЕНО столбы');
      XLSX.writeFile(wb,'M5M_current_archive.xlsx');
    }catch(e){toast(e.message)}
  });

  $('exportAlgo').addEventListener('click',()=>{
    if(!window.XLSX||!runtime)return;
    const rows=[['Тираж','Дата','День','Время','Факт','M5 главный','M5 TOP3','M5 резерв','Попадание','Критерий','Coverage','Raw','Depth','Repeats']];
    (runtime.history||[]).slice().reverse().forEach(r=>rows.push([
      r.draw,r.date,r.weekday,r.time,r.actual,r.m5Main,(r.m5Picks||[]).join('-'),(r.m5Reserve||[]).join('-'),
      r.hitMain?'MAIN':r.hitTop3?'TOP3':(r.m5Reserve||[]).includes(Number(r.actual))?'RESERVE':'MISS',
      r.criterion,r.coverage,r.raw_total,r.depth,(r.repeats||[]).join('')
    ]));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'M5 алгоритм');
    XLSX.writeFile(wb,'M5M_algorithm_server_live.xlsx');
  });

  $('importXlsx').addEventListener('change',ev=>{
    ev.target.value='';
    toast('LIVE-архитектура: обучение только на серверной официальной истории');
  });

  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh('visible',false);});
  window.addEventListener('focus',()=>refresh('focus',false));
  window.addEventListener('online',()=>refresh('online',false));
  setInterval(()=>{if(!document.hidden)refresh('timer',false);},10000);

  window.M5App={
    getForecast:()=>forecast,
    getRuntime:()=>runtime,
    getMatrix:()=>matrix?E.cloneMatrix(matrix):null,
    refresh
  };

  refresh('startup',false);
})();
