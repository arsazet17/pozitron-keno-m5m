// M5M v1.2.6 — знаки результата в матрице "Алгоритм"
// 🔥 = TOP-3, 🔥🔥 = резерв, ❌ = мимо
(function(){
  'use strict';

  function signFor(r){
    if(!r) return '';
    const reserve = Array.isArray(r.m5Reserve) ? r.m5Reserve.map(Number) : [];
    const actual = Number(r.actual);
    if(reserve.includes(actual)) return '🔥🔥';
    if(r.hitTop3) return '🔥';
    return '❌';
  }

  function decorate(){
    try{
      const table = document.querySelector('#algoMatrix table.algo-matrix');
      const app = window.M5App;
      const runtime = app && app.getRuntime ? app.getRuntime() : null;
      if(!table || !runtime || !Array.isArray(runtime.history)) return;

      const headers = [...table.querySelectorAll('thead th')];
      const schedule = headers.slice(1).map(th => th.textContent.trim());
      const byKey = new Map(runtime.history.map(r => [`${r.date}|${r.time}`, r]));

      for(const tr of table.querySelectorAll('tbody tr')){
        const dateCell = tr.querySelector('th');
        if(!dateCell) continue;

        const firstNode = dateCell.childNodes[0];
        const date = String(firstNode ? firstNode.textContent : dateCell.textContent).trim();

        [...tr.querySelectorAll('td')].forEach((td, i)=>{
          const r = byKey.get(`${date}|${schedule[i]}`);
          const numberEl = td.querySelector('b');
          if(!r || !numberEl) return;

          const wanted = signFor(r);
          let signEl = td.querySelector('.m5m-outcome-sign');

          if(!signEl){
            signEl = document.createElement('span');
            signEl.className = 'm5m-outcome-sign';
            signEl.setAttribute('aria-hidden','true');
            numberEl.insertAdjacentElement('afterend', signEl);
          }

          // Важно: меняем DOM только если значение реально изменилось.
          if(signEl.textContent !== wanted) signEl.textContent = wanted;
        });
      }
    }catch(e){
      console.warn('M5M matrix signs:', e);
    }
  }

  const style = document.createElement('style');
  style.textContent = `
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

  // app.js сам сообщает, когда новый runtime уже отрисован.
  window.addEventListener('m5:forecast', ()=>setTimeout(decorate, 0));
  window.addEventListener('focus', decorate);
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden) decorate();
  });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(decorate, 300), {once:true});
  }else{
    setTimeout(decorate, 300);
  }

  // Редкая страховочная проверка без MutationObserver.
  setInterval(decorate, 5000);
})();
