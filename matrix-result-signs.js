// M5M v1.2.6 — только знаки в матрице "Алгоритм"
// 🔥 = TOP-3, 🔥🔥 = резерв, ❌ = мимо
(function(){
  'use strict';

  function signFor(r){
    if(!r) return '';
    const reserve = Array.isArray(r.m5Reserve) ? r.m5Reserve.map(Number) : [];
    const actual = Number(r.actual);
    const reserveHit = reserve.includes(actual);
    if(reserveHit) return '🔥🔥';
    if(r.hitTop3) return '🔥';
    return '❌';
  }

  function decorate(){
    const table = document.querySelector('#algoMatrix table.algo-matrix');
    const app = window.M5App;
    const runtime = app && app.getRuntime ? app.getRuntime() : null;
    if(!table || !runtime || !Array.isArray(runtime.history)) return;

    const rows = [...table.querySelectorAll('tbody tr')];
    const schedule = [...table.querySelectorAll('thead th')].slice(1).map(th=>th.textContent.trim());
    const byKey = new Map(runtime.history.map(r => [`${r.date}|${r.time}`, r]));

    for(const tr of rows){
      const dateCell = tr.querySelector('th');
      if(!dateCell) continue;
      const date = (dateCell.childNodes[0]?.textContent || dateCell.textContent || '').trim();
      const cells = [...tr.querySelectorAll('td')];

      cells.forEach((td, i)=>{
        const r = byKey.get(`${date}|${schedule[i]}`);
        if(!r) return;

        // Убираем только наш старый знак, если он уже был.
        td.querySelectorAll('.m5m-outcome-sign').forEach(el=>el.remove());

        const b = td.querySelector('b');
        if(!b) return;

        const s = document.createElement('span');
        s.className = 'm5m-outcome-sign';
        s.textContent = signFor(r);
        s.setAttribute('aria-label', 'Результат');
        b.insertAdjacentElement('afterend', s);
      });
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    #algoMatrix .m5m-outcome-sign{
      display:inline-block;
      margin-left:5px;
      font-size:.78em;
      line-height:1;
      vertical-align:middle;
      white-space:nowrap;
    }
  `;
  document.head.appendChild(style);

  // После каждого обновления приложения.
  const observer = new MutationObserver(()=>queueMicrotask(decorate));
  const start = ()=>{
    const box = document.getElementById('algoMatrix');
    if(box) observer.observe(box,{childList:true,subtree:true});
    decorate();
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, {once:true});
  }else{
    start();
  }

  window.addEventListener('focus', decorate);
  setInterval(decorate, 3000);
})();
