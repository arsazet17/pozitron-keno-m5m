#!/usr/bin/env python3
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parent
INDEX=ROOT/'index.html'; APP=ROOT/'app.js'; DIRECT=ROOT/'runtime-direct.js'; SW=ROOT/'sw.js'; SIGNS=ROOT/'matrix-result-signs.js'; BUILD=ROOT/'scripts/m5m_build_runtime.js'

# index: version, control means DAYS, cache bust
s=INDEX.read_text('utf-8')
s=s.replace('v1.2.7','v1.2.8')
s=s.replace('style.css?v=127-algo-history','style.css?v=128-algo-days')
s=s.replace('m5m-result-icons.css?v=127','m5m-result-icons.css?v=128')
s=s.replace('m5m-result-icons-helper.js?v=127','m5m-result-icons-helper.js?v=128')
s=s.replace('app.js?v=m5new011','app.js?v=m5new012')
s=s.replace('matrix-result-signs.js?v=127-signs1','matrix-result-signs.js?v=128-signs1')
s=s.replace("./sw.js?v=m5m-runtime-direct-v9-20260924","./sw.js?v=m5m-runtime-direct-v10-20260924")
s=s.replace('<span>История</span><div class="algo-count-stepper"><button id="algoCountMinus" type="button" aria-label="Уменьшить количество тиражей">−</button><input id="algoHistoryCount" type="number" min="1" max="300" value="20" inputmode="numeric" aria-label="Количество тиражей в матрице"><button id="algoCountPlus" type="button" aria-label="Увеличить количество тиражей">+</button></div><small>тиражей · <span id="algoHistoryShown">из 0</span></small>', '<span>Дни</span><div class="algo-count-stepper"><button id="algoCountMinus" type="button" aria-label="Уменьшить количество дней">−</button><input id="algoHistoryCount" type="number" min="1" max="60" value="5" inputmode="numeric" aria-label="Количество дней в матрице"><button id="algoCountPlus" type="button" aria-label="Увеличить количество дней">+</button></div><small>дней · <span id="algoHistoryShown">из 0</span></small>')
INDEX.write_text(s,'utf-8')

# app: day based matrix, full schedule columns, lazy compact history
s=APP.read_text('utf-8')
old=re.compile(r"  const ALGO_HISTORY_COUNT_KEY='m5mAlgoHistoryCountV1';\n  let algoHistoryCount=20;\n  try\{\n    const saved=Math\.floor\(Number\(localStorage\.getItem\(ALGO_HISTORY_COUNT_KEY\)\)\);\n    if\(Number\.isFinite\(saved\)&&saved>0\)algoHistoryCount=saved;\n  \}catch\(e\)\{\}")
new="""  const ALGO_DAY_COUNT_KEY='m5mAlgoDayCountV1';
  let algoDayCount=5;
  let algoHistory=null;
  let algoHistoryLoading=false;
  try{
    const saved=Math.floor(Number(localStorage.getItem(ALGO_DAY_COUNT_KEY)));
    if(Number.isFinite(saved)&&saved>0)algoDayCount=saved;
  }catch(e){}"""
s,n=old.subn(new,s,1)
if n!=1: raise SystemExit('day state anchor not found')

start=s.index('  function algoHistoryMax(){')
end=s.index('\n  function fillControls(){',start)
block="""  function algoRows(){
    return Array.isArray(algoHistory)&&algoHistory.length ? algoHistory : (runtime?.history||[]);
  }
  function algoDates(){
    const rows=[...algoRows()].reverse();
    return [...new Set(rows.map(x=>x.date).filter(Boolean))];
  }
  function algoDayMax(){ return Math.max(1,algoDates().length||1); }
  function normalizedAlgoDayCount(v=algoDayCount){
    const n=Math.floor(Number(v));
    return Math.max(1,Math.min(algoDayMax(),Number.isFinite(n)?n:5));
  }
  function syncAlgoHistoryControl(){
    const input=$('algoHistoryCount'); if(!input)return;
    algoDayCount=normalizedAlgoDayCount(algoDayCount);
    input.max=String(algoDayMax());
    if(document.activeElement!==input)input.value=String(algoDayCount);
    const label=$('algoHistoryShown');
    if(label)label.textContent=`из ${algoDayMax()}`;
  }
  function setAlgoDayCount(v){
    algoDayCount=normalizedAlgoDayCount(v);
    try{localStorage.setItem(ALGO_DAY_COUNT_KEY,String(algoDayCount));}catch(e){}
    syncAlgoHistoryControl();
    if(runtime)renderMatrix();
  }
  async function ensureAlgoHistory(){
    if(algoHistory||algoHistoryLoading)return;
    algoHistoryLoading=true;
    try{
      const x=await fetchJSON('data/m5-algorithm-history.json');
      if(!Array.isArray(x?.history)||!x.history.length)throw new Error('пустая история алгоритма');
      algoHistory=x.history;
      syncAlgoHistoryControl();
      renderMatrix();
      window.dispatchEvent(new CustomEvent('m5:algo-history'));
    }catch(e){ console.warn('M5 algorithm history:',e); }
    finally{algoHistoryLoading=false;}
  }
  function renderMatrix(){
    const all=algoRows();
    const allDates=algoDates();
    const dayLimit=normalizedAlgoDayCount();
    const dates=allDates.slice(-dayLimit);
    const dateSet=new Set(dates);
    const selected=all.filter(r=>dateSet.has(r.date));
    const byKey=new Map(selected.map(r=>[`${r.date}|${r.time}`,r]));
    const times=E.SCHEDULE;
    const minWidth=Math.max(620,118+times.length*108);
    let html=`<table class="algo-matrix" style="min-width:${minWidth}px"><thead><tr><th>Дата</th>`+times.map(t=>`<th>${t}</th>`).join('')+'</tr></thead><tbody>';
    for(const d of dates){
      html+=`<tr><th>${d}<small>${E.weekday(d)}</small></th>`;
      for(const t of times){
        const r=byKey.get(`${d}|${t}`);
        html+=r?`<td title="${esc(r.criterion)}"><b>${r.actual}</b><small>${esc(r.criterion)}</small><em>cov ${r.coverage} · raw ${r.raw_total} · d ${r.depth} · rep ${r.repeat_count}</em></td>`:'<td></td>';
      }
      html+='</tr>';
    }
    html+='</tbody></table>';
    $('algoMatrix').innerHTML=html;
    const p=runtime?.pending;
    $('algoPending').innerHTML=p?`<b>${p.date} · ${p.weekday} · ${p.time}</b><span>🔒 SERVER RAW + повторы + M5 SCORE сохранены до факта</span>`:'Нет ожидающего снимка';
    $('algoMeta').textContent=`дней ${dates.length} · тиражей ${selected.length} · завершено ${runtime?.totals?.finalized??0}`;
    syncAlgoHistoryControl();
  }
"""
s=s[:start]+block+s[end:]
s=s.replace("setAlgoHistoryCount(algoCountInput.value)","setAlgoDayCount(algoCountInput.value)")
s=s.replace("setAlgoHistoryCount(algoHistoryCount-1)","setAlgoDayCount(algoDayCount-1)")
s=s.replace("setAlgoHistoryCount(algoHistoryCount+1)","setAlgoDayCount(algoDayCount+1)")
s=s.replace("    getRuntime:()=>runtime,\n    getMatrix:()=>matrix?E.cloneMatrix(matrix):null,", "    getRuntime:()=>runtime,\n    getAlgorithmHistory:()=>algoRows().slice(),\n    getMatrix:()=>matrix?E.cloneMatrix(matrix):null,")
anchor="  $('recalc').addEventListener('click',()=>refresh('manual',true));"
s=s.replace(anchor,"  const algoNav=document.querySelector('.nav-btn[data-target=\"algorithm\"]');\n  if(algoNav)algoNav.addEventListener('click',()=>ensureAlgoHistory());\n\n"+anchor,1)
APP.write_text(s,'utf-8')

# runtime-direct: allow direct lazy history file
s=DIRECT.read_text('utf-8')
s=s.replace("    'data/m5-runtime.json',", "    'data/m5-runtime.json',\n    'data/m5-algorithm-history.json',")
DIRECT.write_text(s,'utf-8')

# service worker direct map + cache id
s=SW.read_text('utf-8')
s=s.replace("const CACHE='m5m-runtime-direct-v8-20260822';","const CACHE='m5m-runtime-direct-v10-20260924';")
s=s.replace("  '/data/m5-runtime.json':'data/m5-runtime.json',", "  '/data/m5-runtime.json':'data/m5-runtime.json',\n  '/data/m5-algorithm-history.json':'data/m5-algorithm-history.json',")
SW.write_text(s,'utf-8')

# signs use full matrix history when available
s=SIGNS.read_text('utf-8')
s=s.replace("      const runtime = app && app.getRuntime ? app.getRuntime() : null;\n      if(!table || !runtime || !Array.isArray(runtime.history)) return;", "      const runtime = app && app.getRuntime ? app.getRuntime() : null;\n      const fullHistory = app && app.getAlgorithmHistory ? app.getAlgorithmHistory() : runtime?.history;\n      if(!table || !runtime || !Array.isArray(fullHistory)) return;")
s=s.replace("      const byKey = new Map(runtime.history.map(r => [`${r.date}|${r.time}`, r]));", "      const byKey = new Map(fullHistory.map(r => [`${r.date}|${r.time}`, r]));")
s=s.replace("  window.addEventListener('m5:forecast', ()=>setTimeout(decorate, 0));", "  window.addEventListener('m5:forecast', ()=>setTimeout(decorate, 0));\n  window.addEventListener('m5:algo-history', ()=>setTimeout(decorate, 0));")
SIGNS.write_text(s,'utf-8')

# runtime builder also publishes compact 1800-row algorithm history separately
s=BUILD.read_text('utf-8')
s=s.replace("const RUNTIME=path.join(DATA,'m5-runtime.json');", "const RUNTIME=path.join(DATA,'m5-runtime.json');\nconst ALGO_HISTORY=path.join(DATA,'m5-algorithm-history.json');")
needle="const generation=`${latest.draw}|${latest.date}|${latest.time}|${latest.column}|${historyRows}|${target.date}|${target.time}`;"
insert=needle+"\nconst algoHist=Object.values(state.finalized||{})\n  .filter(r=>r?.date&&r?.time&&timeValue(r.date,r.time)<=timeValue(latest.date,latest.time))\n  .sort((a,b)=>timeValue(b.date,b.time)-timeValue(a.date,a.time))\n  .slice(0,1800)\n  .map(r=>compactHistory(r,drawByKey.get(key(r.date,r.time))));\natomic(ALGO_HISTORY,{version:1,generation,generatedAt:new Date().toISOString(),history:algoHist});"
if 'const algoHist=' not in s:
    if needle not in s: raise SystemExit('builder generation anchor missing')
    s=s.replace(needle,insert,1)
BUILD.write_text(s,'utf-8')

print('M5M v1.2.8 day matrix patch ready')
