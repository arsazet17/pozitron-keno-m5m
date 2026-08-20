'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ARCHIVE = path.join(DATA, 'archive.json');
const SEED = path.join(DATA, 'algorithm_seed_v3.json');
const STATE = path.join(DATA, 'm5-server-state.json');
const STATUS = path.join(DATA, 'm5-server-status.json');
const MAX_FINALIZED = 1800;

require(path.join(ROOT, 'm5-engine.js'));
const E = globalThis.M5Engine;
if (!E) throw new Error('M5Engine не загрузился');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (fallback !== null) return fallback; throw e; }
}
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
function blank(){ return {version:3, snapshots:{}, finalized:{}}; }
function key(d,t){ return `${d}|${t}`; }
function arr(x){ return Array.isArray(x) ? x : []; }
function nval(x,d=0){ const n=Number(x); return Number.isFinite(n) ? n : d; }

function candidateForPending(c){
  c=c||{};
  return {
    value:nval(c.value), methods:arr(c.methods).slice(), coverage:nval(c.coverage), raw_total:nval(c.raw_total),
    depth:nval(c.depth), repeats:arr(c.repeats).slice(), repeat_count:nval(c.repeat_count),
    methodMask:nval(c.methodMask), repeatMask:nval(c.repeatMask), classKey:String(c.classKey||'0:0:0:0')
  };
}
function candidateForModel(c){
  c=c||{};
  return {
    methodMask:nval(c.methodMask), coverage:nval(c.coverage), raw_total:nval(c.raw_total),
    repeat_count:nval(c.repeat_count), repeatMask:nval(c.repeatMask), classKey:String(c.classKey||'0:0:0:0')
  };
}
function modelSnapshot(s){
  const candidates={};
  for (const [k,c] of Object.entries(s?.candidates||{})) candidates[k]=candidateForModel(c);
  return {date:String(s?.date||''), weekday:String(s?.weekday||''), time:String(s?.time||''), candidates};
}
function pendingFromForecast(f, source='SERVER_PRE_DRAW'){
  const candidates={};
  for (const [k,c] of Object.entries(f.candidates||{})) candidates[k]=candidateForPending(c);
  return {
    version:3,
    key:key(f.target.date,f.target.time),
    date:f.target.date,
    weekday:f.weekday,
    time:f.target.time,
    capturedAt:new Date().toISOString(),
    source,
    candidates,
    m5:{
      main:f.main??null,
      picks:arr(f.picks).slice(),
      reserve:arr(f.reserve).slice(),
      model:{...(f.model||{})}
    }
  };
}
function criterion(c){
  const a=[];
  if (c?.methods?.length) a.push(c.methods.join(' + ')); else a.push('вне RAW');
  if (c?.repeats?.length) a.push(c.repeats.join(' + ')); else if (!c?.methods?.length) a.push('вне повторов');
  return a.join(' + ');
}
function finalizedFromPending(snap, actual, source=null){
  const c=snap.candidates?.[actual] || {
    methods:[],coverage:0,raw_total:0,depth:0,repeats:[],repeat_count:0,classKey:'0:0:0:0'
  };
  return {
    key:snap.key,
    date:snap.date,
    weekday:snap.weekday,
    time:snap.time,
    actual:Number(actual),
    criterion:criterion(c),
    coverage:nval(c.coverage),
    raw_total:nval(c.raw_total),
    depth:nval(c.depth),
    methods:arr(c.methods).slice(),
    repeats:arr(c.repeats).slice(),
    repeat_count:nval(c.repeat_count),
    classKey:String(c.classKey||'0:0:0:0'),
    m5Main:snap.m5?.main??null,
    m5Picks:arr(snap.m5?.picks).slice(),
    m5Reserve:arr(snap.m5?.reserve).slice(),
    hitMain:(snap.m5?.main===Number(actual)),
    hitTop3:arr(snap.m5?.picks).includes(Number(actual)),
    capturedAt:String(snap.capturedAt||''),
    finalizedAt:new Date().toISOString(),
    snapshot:modelSnapshot(snap),
    source:source || snap.source || 'SERVER_PRE_DRAW'
  };
}
function compactExistingFinalized(r){
  if (!r) return null;
  return {
    key:String(r.key||key(r.date,r.time)),
    date:String(r.date||''),
    weekday:String(r.weekday||''),
    time:String(r.time||''),
    actual:nval(r.actual,null),
    criterion:String(r.criterion||''),
    coverage:nval(r.coverage),
    raw_total:nval(r.raw_total),
    depth:nval(r.depth),
    methods:arr(r.methods).slice(),
    repeats:arr(r.repeats).slice(),
    repeat_count:nval(r.repeat_count),
    classKey:String(r.classKey||'0:0:0:0'),
    m5Main:r.m5Main??null,
    m5Picks:arr(r.m5Picks).slice(),
    m5Reserve:arr(r.m5Reserve).slice(),
    hitMain:!!r.hitMain,
    hitTop3:!!r.hitTop3,
    capturedAt:String(r.capturedAt||''),
    finalizedAt:String(r.finalizedAt||''),
    snapshot:modelSnapshot(r.snapshot||{}),
    source:r.source||'SEED'
  };
}
function compactExistingPending(s){
  if (!s) return null;
  const candidates={};
  for (const [k,c] of Object.entries(s.candidates||{})) candidates[k]=candidateForPending(c);
  return {
    version:3,
    key:String(s.key||key(s.date,s.time)),
    date:String(s.date||''),
    weekday:String(s.weekday||''),
    time:String(s.time||''),
    capturedAt:String(s.capturedAt||new Date().toISOString()),
    source:String(s.source||'SERVER_PRE_DRAW'),
    candidates,
    m5:{
      main:s.m5?.main??null,
      picks:arr(s.m5?.picks).slice(),
      reserve:arr(s.m5?.reserve).slice(),
      model:{...(s.m5?.model||{})}
    }
  };
}
function normalizeState(src){
  const s=blank();
  for (const [k,r] of Object.entries(src?.finalized||{})) {
    const x=compactExistingFinalized(r);
    if (x) s.finalized[k]=x;
  }
  for (const [k,p] of Object.entries(src?.snapshots||{})) {
    if (s.finalized[k]) continue;
    const x=compactExistingPending(p);
    if (x) s.snapshots[k]=x;
  }
  return s;
}
function mergeSeed(state, seed){
  if (seed?.version!==3) return state;
  for (const [k,r] of Object.entries(seed.finalized||{})) {
    if (!state.finalized[k]) state.finalized[k]=compactExistingFinalized(r);
    delete state.snapshots[k];
  }
  for (const [k,p] of Object.entries(seed.snapshots||{})) {
    if (!state.finalized[k] && !state.snapshots[k]) state.snapshots[k]=compactExistingPending(p);
  }
  return state;
}
function timeValue(date,time){
  const d=E.parseDate(date);
  const di=d?.getTime?.()||0;
  const si=E.SCHEDULE.indexOf(String(time));
  return di*100 + Math.max(0,si);
}
function sortKeysByTime(obj){
  return Object.keys(obj).sort((ka,kb)=>{
    const a=obj[ka], b=obj[kb];
    return timeValue(a.date,a.time)-timeValue(b.date,b.time);
  });
}
function trimFinalized(state){
  const ks=sortKeysByTime(state.finalized);
  if (ks.length<=MAX_FINALIZED) return;
  for (const k of ks.slice(0, ks.length-MAX_FINALIZED)) delete state.finalized[k];
}
function reconcileExistingPending(state, matrix){
  let finalizedNow=0;
  for (const [k,snap] of Object.entries({...state.snapshots})) {
    if (state.finalized[k]) {
      delete state.snapshots[k];
      continue;
    }
    const actual=E.getVal(matrix,snap.date,snap.time);
    if (actual!=null) {
      state.finalized[k]=finalizedFromPending(snap,actual);
      delete state.snapshots[k];
      finalizedNow++;
      console.log(`M5 FINALIZE REAL ${k} => ${actual}`);
    }
  }
  return finalizedNow;
}

function headerMap(matrix){
  const out={};
  (matrix[0]||[]).forEach((v,i)=>{
    if(i>0 && v!=null) out[String(v)]=i;
  });
  return out;
}
function findRow(matrix,date){
  return matrix.findIndex((r,i)=>i>0 && String(r?.[0])===String(date));
}
function targetObject(matrix,date,time){
  const row=findRow(matrix,date);
  const col=headerMap(matrix)[String(time)];
  if(row<1 || col==null) return null;
  return {row,date:String(date),time:String(time),col};
}
function completedSlots(matrix){
  const hm=headerMap(matrix);
  const out=[];
  for(let r=1;r<matrix.length;r++){
    const date=String(matrix[r]?.[0]||'');
    if(!date) continue;
    for(const tm of E.SCHEDULE){
      const c=hm[tm];
      if(c==null) continue;
      const actual=E.val(matrix[r][c]);
      if(actual!=null){
        out.push({date,time:tm,actual,k:key(date,tm)});
      }
    }
  }
  out.sort((a,b)=>timeValue(a.date,a.time)-timeValue(b.date,b.time));
  return out;
}
function historicalMatrix(full,date,time){
  const out=E.cloneMatrix(full);
  const cut=timeValue(date,time);
  const hm=headerMap(out);

  for(let r=1;r<out.length;r++){
    const ds=String(out[r]?.[0]||'');
    if(!ds) continue;
    for(const tm of E.SCHEDULE){
      const c=hm[tm];
      if(c==null) continue;
      if(timeValue(ds,tm)>=cut) out[r][c]=null;
    }
  }
  return out;
}
function stateBefore(state,date,time){
  const cut=timeValue(date,time);
  const s=blank();

  for(const [k,r] of Object.entries(state.finalized||{})){
    if(timeValue(r.date,r.time)<cut) s.finalized[k]=r;
  }
  return s;
}
function latestFinalizedTime(state){
  const ks=sortKeysByTime(state.finalized);
  if(!ks.length) return -Infinity;
  const r=state.finalized[ks[ks.length-1]];
  return timeValue(r.date,r.time);
}

// ГЛАВНОЕ ИСПРАВЛЕНИЕ:
// ничего не сканируем "на 120 тиражей назад".
// Берём ПОСЛЕДНЮЮ сохранённую строку истории и идём только ВПЕРЁД
// до последнего фактического тиража. Если пропусков нет — цикл пустой.
function catchUpFromLastSaved(state, fullMatrix){
  const all=completedSlots(fullMatrix);
  const lastSaved=latestFinalizedTime(state);
  const missing=all.filter(x => timeValue(x.date,x.time)>lastSaved && !state.finalized[x.k]);

  let restored=0;

  for(const slot of missing){
    // Если на этот тираж есть настоящий предтиражный снимок —
    // используем его, ничего не реконструируем.
    const realSnap=state.snapshots[slot.k];
    if(realSnap){
      state.finalized[slot.k]=finalizedFromPending(realSnap,slot.actual,'SERVER_PRE_DRAW');
      delete state.snapshots[slot.k];
      restored++;
      console.log(`M5 CONTINUOUS FINALIZE REAL ${slot.k} => ${slot.actual}`);
      continue;
    }

    // Иначе восстанавливаем ТОЛЬКО конкретно пропущенный тираж.
    // Сам факт этого тиража и всё будущее в расчёт не попадают.
    const pastMatrix=historicalMatrix(fullMatrix,slot.date,slot.time);
    const target=targetObject(pastMatrix,slot.date,slot.time);
    if(!target){
      console.warn(`M5 CONTINUOUS SKIP ${slot.k}: target not found`);
      continue;
    }

    try{
      const pastState=stateBefore(state,slot.date,slot.time);
      const forecast=E.predict(pastMatrix,target,pastState);
      const snap=pendingFromForecast(forecast,'SERVER_RECONSTRUCTED_GAP');
      snap.capturedAt='RECONSTRUCTED_AFTER_GAP';

      state.finalized[slot.k]=finalizedFromPending(
        snap,
        slot.actual,
        'SERVER_RECONSTRUCTED_GAP'
      );

      restored++;
      console.log(
        `M5 CONTINUOUS RESTORE ${slot.k} => ${slot.actual}; ` +
        `main=${forecast.main}; top3=${arr(forecast.picks).join('-')}; reserve=${arr(forecast.reserve).join('-')}`
      );
    }catch(e){
      console.warn(`M5 CONTINUOUS SKIP ${slot.k}: ${e.message}`);
    }
  }

  return {
    restored,
    checked:missing.length,
    from:lastSaved
  };
}

const archive=readJson(ARCHIVE);
if (!archive?.rows?.length) throw new Error('data/archive.json: rows отсутствуют');
const matrix=E.cloneMatrix(archive.rows);

let state=fs.existsSync(STATE) ? normalizeState(readJson(STATE)) : blank();
state=mergeSeed(state, readJson(SEED, blank()));

// 1. Закрываем реальные ожидающие прогнозы, если их факт уже пришёл.
const finalizedNow=reconcileExistingPending(state,matrix);

// 2. Идём только от последней сохранённой строки истории вперёд.
//    Никаких 120 тиражей назад.
const catchup=catchUpFromLastSaved(state,matrix);
trimFinalized(state);

// 3. Создаём текущий настоящий прогноз на следующий активный тираж.
const target=E.nextTarget(matrix);
const targetKey=key(target.date,target.time);
let created=false;
let forecast=null;

if (!state.finalized[targetKey] && !state.snapshots[targetKey]) {
  forecast=E.predict(matrix,target,state);
  state.snapshots[targetKey]=pendingFromForecast(forecast,'SERVER_PRE_DRAW');
  created=true;
  console.log(
    `M5 CAPTURE ${targetKey}: main=${forecast.main}, ` +
    `top3=${arr(forecast.picks).join('-')}, reserve=${arr(forecast.reserve).join('-')}`
  );
} else {
  const p=state.snapshots[targetKey];
  if (p) {
    console.log(
      `M5 pending already exists ${targetKey}: ` +
      `main=${p.m5?.main}, top3=${arr(p.m5?.picks).join('-')}`
    );
  }
}

trimFinalized(state);
writeJsonAtomic(STATE,state);

const pending=state.snapshots[targetKey]||null;
writeJsonAtomic(STATUS,{
  version:3,
  updatedAt:new Date().toISOString(),
  target:{date:target.date,time:target.time,key:targetKey},
  prediction:pending?{
    main:pending.m5?.main??null,
    picks:arr(pending.m5?.picks),
    reserve:arr(pending.m5?.reserve),
    capturedAt:pending.capturedAt
  }:null,
  createdNow:created,
  finalizedNow,
  restoredNow:catchup.restored,
  checkedMissingNow:catchup.checked,
  totals:{
    pending:Object.keys(state.snapshots).length,
    finalized:Object.keys(state.finalized).length
  },
  rule:'История идёт непрерывно только вперёд: от последней сохранённой строки до последнего фактического тиража. Если пропусков нет — ничего лишнего не пересчитывается.'
});

console.log(
  `M5 SERVER OK target=${targetKey} ` +
  `pending=${Object.keys(state.snapshots).length} ` +
  `finalized=${Object.keys(state.finalized).length} ` +
  `restored=${catchup.restored}`
);
