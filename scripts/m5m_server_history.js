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
function pendingFromForecast(f){
  const candidates={};
  for (const [k,c] of Object.entries(f.candidates||{})) candidates[k]=candidateForPending(c);
  return {
    version:3, key:key(f.target.date,f.target.time), date:f.target.date, weekday:f.weekday, time:f.target.time,
    capturedAt:new Date().toISOString(), candidates,
    m5:{main:f.main??null, picks:arr(f.picks).slice(), reserve:arr(f.reserve).slice(), model:{...(f.model||{})}}
  };
}
function criterion(c){
  const a=[];
  if (c?.methods?.length) a.push(c.methods.join(' + ')); else a.push('вне RAW');
  if (c?.repeats?.length) a.push(c.repeats.join(' + ')); else if (!c?.methods?.length) a.push('вне повторов');
  return a.join(' + ');
}
function finalizedFromPending(snap, actual){
  const c=snap.candidates?.[actual] || {methods:[],coverage:0,raw_total:0,depth:0,repeats:[],repeat_count:0,classKey:'0:0:0:0'};
  return {
    key:snap.key, date:snap.date, weekday:snap.weekday, time:snap.time, actual:Number(actual),
    criterion:criterion(c), coverage:nval(c.coverage), raw_total:nval(c.raw_total), depth:nval(c.depth),
    methods:arr(c.methods).slice(), repeats:arr(c.repeats).slice(), repeat_count:nval(c.repeat_count), classKey:String(c.classKey||'0:0:0:0'),
    m5Main:snap.m5?.main??null, m5Picks:arr(snap.m5?.picks).slice(),
    hitMain:(snap.m5?.main===Number(actual)), hitTop3:arr(snap.m5?.picks).includes(Number(actual)),
    capturedAt:String(snap.capturedAt||''), finalizedAt:new Date().toISOString(), snapshot:modelSnapshot(snap),
    source:'SERVER_PRE_DRAW'
  };
}
function compactExistingFinalized(r){
  if (!r) return null;
  return {
    key:String(r.key||key(r.date,r.time)), date:String(r.date||''), weekday:String(r.weekday||''), time:String(r.time||''),
    actual:nval(r.actual,null), criterion:String(r.criterion||''), coverage:nval(r.coverage), raw_total:nval(r.raw_total), depth:nval(r.depth),
    methods:arr(r.methods).slice(), repeats:arr(r.repeats).slice(), repeat_count:nval(r.repeat_count), classKey:String(r.classKey||'0:0:0:0'),
    m5Main:r.m5Main??null, m5Picks:arr(r.m5Picks).slice(), hitMain:!!r.hitMain, hitTop3:!!r.hitTop3,
    capturedAt:String(r.capturedAt||''), finalizedAt:String(r.finalizedAt||''), snapshot:modelSnapshot(r.snapshot||{}), source:r.source||'SEED'
  };
}
function compactExistingPending(s){
  if (!s) return null;
  const candidates={};
  for (const [k,c] of Object.entries(s.candidates||{})) candidates[k]=candidateForPending(c);
  return {
    version:3, key:String(s.key||key(s.date,s.time)), date:String(s.date||''), weekday:String(s.weekday||''), time:String(s.time||''),
    capturedAt:String(s.capturedAt||new Date().toISOString()), candidates,
    m5:{main:s.m5?.main??null,picks:arr(s.m5?.picks).slice(),reserve:arr(s.m5?.reserve).slice(),model:{...(s.m5?.model||{})}}
  };
}
function normalizeState(src){
  const s=blank();
  for (const [k,r] of Object.entries(src?.finalized||{})) {
    const x=compactExistingFinalized(r); if (x) s.finalized[k]=x;
  }
  for (const [k,p] of Object.entries(src?.snapshots||{})) {
    if (s.finalized[k]) continue;
    const x=compactExistingPending(p); if (x) s.snapshots[k]=x;
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
function sortKeysByTime(obj){
  return Object.keys(obj).sort((ka,kb)=>{
    const a=obj[ka], b=obj[kb];
    const da=E.parseDate(a.date)?.getTime?.()||0, db=E.parseDate(b.date)?.getTime?.()||0;
    if (da!==db) return da-db;
    return E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time);
  });
}
function trimFinalized(state){
  const ks=sortKeysByTime(state.finalized);
  if (ks.length<=MAX_FINALIZED) return;
  for (const k of ks.slice(0, ks.length-MAX_FINALIZED)) delete state.finalized[k];
}
function reconcile(state, matrix){
  let finalizedNow=0;
  for (const [k,snap] of Object.entries({...state.snapshots})) {
    if (state.finalized[k]) { delete state.snapshots[k]; continue; }
    const actual=E.getVal(matrix,snap.date,snap.time);
    if (actual!=null) {
      state.finalized[k]=finalizedFromPending(snap,actual);
      delete state.snapshots[k];
      finalizedNow++;
      console.log(`M5 SERVER FINALIZE ${k} => ${actual}`);
    }
  }
  return finalizedNow;
}

const archive=readJson(ARCHIVE);
if (!archive?.rows?.length) throw new Error('data/archive.json: rows отсутствуют');
const matrix=E.cloneMatrix(archive.rows);
let state=fs.existsSync(STATE) ? normalizeState(readJson(STATE)) : blank();
state=mergeSeed(state, readJson(SEED, blank()));
const finalizedNow=reconcile(state,matrix);
trimFinalized(state);

const target=E.nextTarget(matrix);
const targetKey=key(target.date,target.time);
let created=false;
let forecast=null;
if (!state.finalized[targetKey] && !state.snapshots[targetKey]) {
  forecast=E.predict(matrix,target,state);
  state.snapshots[targetKey]=pendingFromForecast(forecast);
  created=true;
  console.log(`M5 SERVER CAPTURE ${targetKey}: main=${forecast.main}, top3=${forecast.picks.join('-')}`);
} else {
  const p=state.snapshots[targetKey];
  if (p) console.log(`M5 SERVER pending already exists ${targetKey}: main=${p.m5?.main}, top3=${arr(p.m5?.picks).join('-')}`);
}

trimFinalized(state);
writeJsonAtomic(STATE,state);
const pending=state.snapshots[targetKey]||null;
writeJsonAtomic(STATUS,{
  version:1,
  updatedAt:new Date().toISOString(),
  target:{date:target.date,time:target.time,key:targetKey},
  prediction:pending?{main:pending.m5?.main??null,picks:arr(pending.m5?.picks),reserve:arr(pending.m5?.reserve),capturedAt:pending.capturedAt}:null,
  createdNow:created,
  finalizedNow,
  totals:{pending:Object.keys(state.snapshots).length,finalized:Object.keys(state.finalized).length},
  rule:'Только серверный предтиражный снимок. Пропущенные тиражи задним числом не создаются.'
});
console.log(`M5 SERVER OK target=${targetKey} pending=${Object.keys(state.snapshots).length} finalized=${Object.keys(state.finalized).length}`);
