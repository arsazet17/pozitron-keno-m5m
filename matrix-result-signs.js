// M5M v1.2.9 — живая матрица «Алгоритм» + знаки результата
// Матрица всегда объединяет длинную серверную историю с самым свежим runtime.
// Это устраняет отставание экрана «Алгоритм» от главного экрана M5.
(function(){
  'use strict';

  let serverHistory=null;
  let serverGeneration='';
  let loadingHistory=false;
  let lastRenderSignature='';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function signFor(r){
    if(!r) return '';
    const reserve=Array.isArray(r.m5Reserve)?r.m5Reserve.map(Number):[];
    const actual=Number(r.actual);
    if(reserve.includes(actual)) return '🔥🔥';
    if(r.hitTop3) return '🔥';
    return '❌';
  }

  function getRuntime(){
    try{return window.M5App?.getRuntime?.()||null;}catch{return null;}
  }

  function fallbackHistory(){
    try{
      const x=window.M5App?.getAlgorithmHistory?.();
      return Array.isArray(x)?x:[];
    }catch{return [];}
  }

  // Длинная история нужна для выбранных 10/20/30 дней,
  // а runtime всегда имеет приоритет для самых свежих тиражей.
  function mergedHistory(){
    const runtime=getRuntime();
    const base=Array.isArray(serverHistory)&&serverHistory.length?serverHistory:fallbackHistory();
    const map=new Map();

    for(const r of base){
      if(!r?.date||!r?.time) continue;
      map.set(`${r.date}|${r.time}`,r);
    }
    for(const r of (runtime?.history||[])){
      if(!r?.date||!r?.time) continue;
      map.set(`${r.date}|${r.time}`,r);
    }

    return [...map.values()];
  }

  function allDates(rows){
    // Серверная история идёт от нового к старому. Для таблицы нужны даты старые → новые.
    return [...new Set([...rows].reverse().map(r=>r?.date).filter(Boolean))];
  }

  function dayLimit(max){
    const input=$('algoHistoryCount');
    const n=Math.floor(Number(input?.value||5));
    return Math.max(1,Math.min(max||1,Number.isFinite(n)&&n>0?n:5));
  }

  function weekday(date){
    try{return window.M5Engine?.weekday?.(date)||'';}catch{return '';}
  }

  function decorate(table,byKey,schedule){
    if(!table)return;
    for(const tr of table.querySelectorAll('tbody tr')){
      const dateCell=tr.querySelector('th');
      if(!dateCell)continue;
      const firstNode=dateCell.childNodes[0];
      const date=String(firstNode?firstNode.textContent:dateCell.textContent).trim();

      [...tr.querySelectorAll('td')].forEach((td,i)=>{
        const r=byKey.get(`${date}|${schedule[i]}`);
        const numberEl=td.querySelector('b');
        if(!r||!numberEl)return;
        const wanted=signFor(r);
        let signEl=td.querySelector('.m5m-outcome-sign');
        if(!signEl){
          signEl=document.createElement('span');
          signEl.className='m5m-outcome-sign';
          signEl.setAttribute('aria-hidden','true');
          numberEl.insertAdjacentElement('afterend',signEl);
        }
        if(signEl.textContent!==wanted)signEl.textContent=wanted;
      });
    }
  }

  function renderMatrix(force=false){
    try{
      const box=$('algoMatrix');
      const runtime=getRuntime();
      if(!box||!runtime)return;

      const rows=mergedHistory();
      if(!rows.length)return;

      const datesAll=allDates(rows);
      const limit=dayLimit(datesAll.length);
      const dates=datesAll.slice(-limit);
      const dateSet=new Set(dates);
      const selected=rows.filter(r=>dateSet.has(r.date));
      const byKey=new Map(selected.map(r=>[`${r.date}|${r.time}`,r]));
      const schedule=Array.isArray(window.M5Engine?.SCHEDULE)?window.M5Engine.SCHEDULE:[];
      if(!schedule.length)return;

      const sig=[runtime.generation||'',serverGeneration||'',limit,dates[0]||'',dates.at(-1)||'',selected.length].join('|');
      const tableNow=box.querySelector('table.algo-matrix');
      if(!force&&sig===lastRenderSignature&&tableNow){
        decorate(tableNow,byKey,schedule);
        return;
      }

      const oldLeft=box.scrollLeft;
      const minWidth=Math.max(620,118+schedule.length*108);
      let html=`<table class="algo-matrix" style="min-width:${minWidth}px"><thead><tr><th>Дата</th>`+
        schedule.map(t=>`<th>${t}</th>`).join('')+'</tr></thead><tbody>';

      for(const d of dates){
        html+=`<tr><th>${esc(d)}<small>${esc(weekday(d))}</small></th>`;
        for(const t of schedule){
          const r=byKey.get(`${d}|${t}`);
          html+=r
            ? `<td title="${esc(r.criterion)}"><b>${r.actual}</b><small>${esc(r.criterion)}</small><em>cov ${r.coverage} · raw ${r.raw_total} · d ${r.depth} · rep ${r.repeat_count}</em></td>`
            : '<td></td>';
        }
        html+='</tr>';
      }
      html+='</tbody></table>';
      box.innerHTML=html;
      box.scrollLeft=oldLeft;

      const p=runtime.pending;
      const pending=$('algoPending');
      if(pending){
        pending.innerHTML=p
          ? `<b>${esc(p.date)} · ${esc(p.weekday)} · ${esc(p.time)}</b><span>🔒 SERVER RAW + повторы + M5 SCORE сохранены до факта</span>`
          : 'Нет ожидающего снимка';
      }

      const meta=$('algoMeta');
      if(meta)meta.textContent=`дней ${dates.length} · тиражей ${selected.length} · завершено ${runtime?.totals?.finalized??0}`;

      const shown=$('algoHistoryShown');
      if(shown)shown.textContent=`из ${datesAll.length}`;
      const input=$('algoHistoryCount');
      if(input)input.max=String(Math.max(1,datesAll.length));

      const table=box.querySelector('table.algo-matrix');
      decorate(table,byKey,schedule);
      lastRenderSignature=sig;
    }catch(e){
      console.warn('M5M live matrix:',e);
    }
  }

  async function loadFreshHistory(force=false){
    if(loadingHistory)return;
    const runtime=getRuntime();
    if(!force&&serverHistory&&serverGeneration===runtime?.generation)return;
    loadingHistory=true;
    try{
      const r=await fetch(`data/m5-algorithm-history.json?ts=${Date.now()}`,{
        cache:'no-store',
        headers:{'Cache-Control':'no-cache'}
      });
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const x=await r.json();
      if(!Array.isArray(x?.history)||!x.history.length)throw new Error('пустая история');
      serverHistory=x.history;
      serverGeneration=String(x.generation||'');
      lastRenderSignature='';
      renderMatrix(true);
    }catch(e){
      console.warn('M5M matrix history:',e);
      // Даже если длинная история временно недоступна, свежий runtime всё равно показываем.
      renderMatrix(true);
    }finally{
      loadingHistory=false;
    }
  }

  function sync(forceHistory=false){
    // Сначала моментально показываем свежие факты из runtime.
    renderMatrix(true);
    // Затем тихо подтягиваем полный серверный хвост для большого числа дней.
    loadFreshHistory(forceHistory).catch(()=>{});
  }

  const style=document.createElement('style');
  style.textContent=`
    #algoMatrix .m5m-outcome-sign{
      display:inline-block;
      margin-left:5px;
      font-size:.76em;
      line-height:1;
      vertical-align:middle;
      white-space:nowrap;
    }
  `;
  document.head.appendChild(style);

  // Новый runtime уже получен: обновляем матрицу в тот же момент, а не при следующем входе в раздел.
  window.addEventListener('m5:forecast',()=>setTimeout(()=>sync(true),0));
  window.addEventListener('m5:algo-history',()=>setTimeout(()=>sync(false),0));

  const algoNav=document.querySelector('.nav-btn[data-target="algorithm"]');
  if(algoNav)algoNav.addEventListener('click',()=>setTimeout(()=>sync(true),0));

  for(const id of ['algoCountMinus','algoCountPlus']){
    const el=$(id);
    if(el)el.addEventListener('click',()=>setTimeout(()=>renderMatrix(true),0));
  }
  const countInput=$('algoHistoryCount');
  if(countInput){
    for(const ev of ['change','blur'])countInput.addEventListener(ev,()=>setTimeout(()=>renderMatrix(true),0));
  }

  window.addEventListener('focus',()=>sync(true));
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)sync(true);
  });

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>sync(true),350),{once:true});
  }else{
    setTimeout(()=>sync(true),350);
  }
})();
