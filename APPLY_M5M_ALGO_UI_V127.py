#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / 'index.html'
APP = ROOT / 'app.js'
STYLE = ROOT / 'style.css'
SW = ROOT / 'sw.js'

for p in (INDEX, APP, STYLE, SW):
    if not p.exists():
        raise SystemExit(f'Не найден {p.name}')

# ---------------- app.js ----------------
app = APP.read_text(encoding='utf-8')

anchor = "  let refreshing=false;\n"
insert = """  let refreshing=false;\n  const ALGO_HISTORY_COUNT_KEY='m5mAlgoHistoryCountV1';\n  let algoHistoryCount=20;\n  try{\n    const saved=Math.floor(Number(localStorage.getItem(ALGO_HISTORY_COUNT_KEY)));\n    if(Number.isFinite(saved)&&saved>0)algoHistoryCount=saved;\n  }catch(e){}\n"""
if 'ALGO_HISTORY_COUNT_KEY' not in app:
    if anchor not in app:
        raise SystemExit('Не найден якорь refreshing')
    app = app.replace(anchor, insert, 1)

new_matrix = r'''  function algoHistoryMax(){
    const published=Number(runtime?.history?.length)||0;
    return Math.max(1,Math.min(300,published||300));
  }
  function normalizedAlgoHistoryCount(v=algoHistoryCount){
    const n=Math.floor(Number(v));
    return Math.max(1,Math.min(algoHistoryMax(),Number.isFinite(n)?n:20));
  }
  function syncAlgoHistoryControl(){
    const input=$('algoHistoryCount');
    if(!input)return;
    algoHistoryCount=normalizedAlgoHistoryCount(algoHistoryCount);
    input.max=String(algoHistoryMax());
    if(document.activeElement!==input)input.value=String(algoHistoryCount);
    const label=$('algoHistoryShown');
    if(label)label.textContent=`из ${runtime?.history?.length||0}`;
  }
  function setAlgoHistoryCount(v){
    algoHistoryCount=normalizedAlgoHistoryCount(v);
    try{localStorage.setItem(ALGO_HISTORY_COUNT_KEY,String(algoHistoryCount));}catch(e){}
    syncAlgoHistoryControl();
    if(runtime)renderMatrix();
  }
  function renderMatrix(){
    const all=Array.isArray(runtime?.history)?runtime.history:[];
    const limit=normalizedAlgoHistoryCount();
    const selected=all.slice(0,limit);
    const chronological=[...selected].reverse();
    const dates=[...new Set(chronological.map(x=>x.date))];
    const visibleTimes=new Set(selected.map(x=>x.time));
    const times=E.SCHEDULE.filter(t=>visibleTimes.has(t));
    const byKey=new Map(selected.map(r=>[`${r.date}|${r.time}`,r]));
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
    $('algoMeta').textContent=`показано ${selected.length} · завершено ${runtime?.totals?.finalized??0} · SERVER LIVE`;
    syncAlgoHistoryControl();
  }'''

app2, n = re.subn(r"  function renderMatrix\(\)\{.*?\n  \}\n\n  function fillControls", new_matrix + "\n\n  function fillControls", app, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'Не удалось заменить renderMatrix: {n}')
app = app2

old_refresh_pattern = r"  async function refresh\(reason='refresh',show=false\)\{.*?\n  \}\n\n  async function ensureArchive"
new_refresh = r'''  async function refresh(reason='refresh',show=false){
    if(refreshing)return;
    refreshing=true;
    try{
      const x=await loadRuntime();
      const first=!runtime;
      const changed=x.generation!==lastGeneration;
      const keepScroll=document.querySelector('.page.active')?.dataset.page==='algorithm';
      const scrollY=keepScroll?window.scrollY:null;
      runtime=x; forecast=x.forecast; lastGeneration=x.generation;

      // Автоопрос сервера не должен каждые 10 секунд пересобирать DOM.
      // Перерисовываем только первый экран или действительно новый generation.
      if(first||changed){
        renderAll();
        window.dispatchEvent(new CustomEvent('m5:forecast',{detail:{forecast,reason,generation:x.generation}}));
        if(keepScroll&&scrollY!=null){
          requestAnimationFrame(()=>window.scrollTo({top:scrollY,left:0,behavior:'auto'}));
        }
      }

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

  async function ensureArchive'''
app2, n = re.subn(old_refresh_pattern, new_refresh, app, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'Не удалось заменить refresh: {n}')
app = app2

bind_anchor = "  $('recalc').addEventListener('click',()=>refresh('manual',true));\n"
bind_insert = r'''  const algoCountInput=$('algoHistoryCount');
  if(algoCountInput){
    algoCountInput.addEventListener('change',()=>setAlgoHistoryCount(algoCountInput.value));
    algoCountInput.addEventListener('blur',()=>setAlgoHistoryCount(algoCountInput.value));
    algoCountInput.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();algoCountInput.blur();}
    });
  }
  if($('algoCountMinus'))$('algoCountMinus').addEventListener('click',()=>setAlgoHistoryCount(algoHistoryCount-1));
  if($('algoCountPlus'))$('algoCountPlus').addEventListener('click',()=>setAlgoHistoryCount(algoHistoryCount+1));
  syncAlgoHistoryControl();

  $('recalc').addEventListener('click',()=>refresh('manual',true));
'''
if 'algoCountMinus' not in app:
    if bind_anchor not in app:
        raise SystemExit('Не найден якорь recalc')
    app = app.replace(bind_anchor, bind_insert, 1)

APP.write_text(app, encoding='utf-8')

# ---------------- index.html ----------------
html = INDEX.read_text(encoding='utf-8')
old_section = '<section class="card"><div class="title-row"><h2>🔒 Предтиражный снимок</h2><span class="pill cyan">до факта</span></div><div id="algoPending"></div></section>'
new_section = '''<section class="card"><div class="title-row"><h2>🔒 Предтиражный снимок</h2><span class="pill cyan">до факта</span></div><div class="algo-pending-tools"><div id="algoPending"></div><div class="algo-count-box"><span>История</span><div class="algo-count-stepper"><button id="algoCountMinus" type="button" aria-label="Уменьшить количество тиражей">−</button><input id="algoHistoryCount" type="number" min="1" max="300" value="20" inputmode="numeric" aria-label="Количество тиражей в матрице"><button id="algoCountPlus" type="button" aria-label="Увеличить количество тиражей">+</button></div><small>тиражей · <span id="algoHistoryShown">из 0</span></small></div></div></section>'''
if 'id="algoHistoryCount"' not in html:
    if old_section not in html:
        raise SystemExit('Не найден блок Предтиражный снимок')
    html = html.replace(old_section, new_section, 1)

html = html.replace('v1.2.6','v1.2.7')
html = html.replace('style.css?v=m5-cat-force2','style.css?v=127-algo-history')
html = html.replace('m5m-result-icons.css?v=126','m5m-result-icons.css?v=127')
html = html.replace('m5m-result-icons-helper.js?v=126','m5m-result-icons-helper.js?v=127')
html = html.replace('app.js?v=m5new010','app.js?v=m5new011')
html = html.replace('matrix-result-signs.js?v=126-signs1','matrix-result-signs.js?v=127-signs1')
html = html.replace("./sw.js?v=m5-runtime-direct-v8-20260822","./sw.js?v=m5m-runtime-direct-v9-20260924")
INDEX.write_text(html, encoding='utf-8')

# ---------------- style.css ----------------
css = STYLE.read_text(encoding='utf-8')
marker = '/* v1.2.7 — управление глубиной истории матрицы */'
if marker not in css:
    css += r'''

/* v1.2.7 — управление глубиной истории матрицы */
.algo-pending-tools{
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center
}
.algo-count-box{
  min-width:132px;padding:9px 10px;border:1px solid rgba(85,214,255,.24);
  border-radius:13px;background:#091827;text-align:center
}
.algo-count-box>span{
  display:block;margin-bottom:6px;color:var(--cyan);font-size:10px;font-weight:900;
  letter-spacing:.08em;text-transform:uppercase
}
.algo-count-stepper{display:grid;grid-template-columns:30px 58px 30px;gap:5px;align-items:center;justify-content:center}
.algo-count-stepper button{
  width:30px;height:30px;padding:0;border:1px solid #315373;border-radius:9px;
  background:#11263d;color:#eef6ff;font-size:18px;font-weight:900;line-height:1
}
.algo-count-stepper input{
  width:58px;height:30px;padding:3px 5px;border:1px solid #315373;border-radius:9px;
  background:#061523;color:var(--gold);text-align:center;font-size:15px;font-weight:900
}
.algo-count-box small{display:block;margin-top:5px;color:var(--muted);font-size:9px;white-space:nowrap}
@media(max-width:420px){
  .algo-pending-tools{grid-template-columns:minmax(0,1fr) 126px;gap:9px}
  .algo-count-box{min-width:126px;padding:8px 7px}
  .algo-count-stepper{grid-template-columns:28px 54px 28px;gap:4px}
  .algo-count-stepper button{width:28px;height:28px}
  .algo-count-stepper input{width:54px;height:28px}
}
'''
STYLE.write_text(css, encoding='utf-8')

# ---------------- sw.js ----------------
sw = SW.read_text(encoding='utf-8')
sw = re.sub(r"const CACHE='[^']+';", "const CACHE='m5m-runtime-direct-v9-20260924';", sw, count=1)
SW.write_text(sw, encoding='utf-8')

print('M5M ALGORITHM UI v1.2.7 PATCH PASS')
