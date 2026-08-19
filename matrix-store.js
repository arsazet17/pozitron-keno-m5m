(function(global){
  'use strict';
  const E=global.M5Engine,STORE='m5m.algorithmMatrix.v3';
  function blank(){return{version:3,snapshots:{},finalized:{}};}
  function load(){try{const x=JSON.parse(localStorage.getItem(STORE)||'null');return x?.version===3?x:blank();}catch{return blank();}}
  function save(x){localStorage.setItem(STORE,JSON.stringify(x));}
  function key(d,t){return`${d}|${t}`;}
  function snapshotFromForecast(f){
    const candidates={};for(const [n,c] of Object.entries(f.candidates))candidates[n]={value:c.value,methods:c.methods.slice(),coverage:c.coverage,raw_total:c.raw_total,depth:c.depth,repeats:c.repeats.slice(),repeat_count:c.repeat_count,methodMask:c.methodMask,repeatMask:c.repeatMask,classKey:c.classKey};
    const methods={};for(const [n,m] of Object.entries(f.methods))methods[n]={usedLen:m.usedLen,usedChain:m.usedChain.slice(),counts:{...m.counts}};
    return{version:3,key:key(f.target.date,f.target.time),date:f.target.date,weekday:f.weekday,time:f.target.time,capturedAt:new Date().toISOString(),vChain:f.vChain.slice(),hChain:f.hChain.slice(),methods,repeats:f.repeats.map(r=>({...r})),candidates,m5:{main:f.main,picks:f.picks.slice(),reserve:f.reserve.slice(),ranking:f.ranking.map(x=>({value:x.value,score:x.score,structureScore:x.structureScore,historyScore:x.historyScore})),model:{...f.model}}};
  }
  function criterion(c){const a=[];if(c.methods?.length)a.push(c.methods.join(' + '));else a.push('вне RAW');if(c.repeats?.length)a.push(c.repeats.join(' + '));else if(!c.methods?.length)a.push('вне повторов');return a.join(' + ');}
  function finalize(snap,actual){const c=snap.candidates?.[actual]||{methods:[],coverage:0,raw_total:0,depth:0,repeats:[],repeat_count:0,methodMask:0,repeatMask:0,classKey:'0:0:0:0'};return{key:snap.key,date:snap.date,weekday:snap.weekday,time:snap.time,actual,criterion:criterion(c),coverage:c.coverage,raw_total:c.raw_total,depth:c.depth,methods:c.methods,repeats:c.repeats,repeat_count:c.repeat_count,classKey:c.classKey,m5Main:snap.m5?.main??null,m5Picks:snap.m5?.picks||[],hitMain:(snap.m5?.main===actual),hitTop3:(snap.m5?.picks||[]).includes(actual),capturedAt:snap.capturedAt,finalizedAt:new Date().toISOString(),snapshot:snap};}
  function reconcile(matrix){const s=load();let changed=false;for(const [k,snap] of Object.entries(s.snapshots)){if(s.finalized[k])continue;const a=E.getVal(matrix,snap.date,snap.time);if(a!=null){s.finalized[k]=finalize(snap,a);changed=true;}}if(changed)save(s);return s;}
  function capture(forecast){const s=load(),k=key(forecast.target.date,forecast.target.time);if(!s.snapshots[k]){s.snapshots[k]=snapshotFromForecast(forecast);save(s);}return s;}
  function mergeSeed(seed){if(seed?.version!==3)return load();const s=load();let changed=false;for(const [k,v] of Object.entries(seed.snapshots||{})){if(!s.snapshots[k]){s.snapshots[k]=v;changed=true;}}for(const [k,v] of Object.entries(seed.finalized||{})){if(!s.finalized[k]){s.finalized[k]=v;changed=true;}}if(changed)save(s);return s;}
  function clear(){localStorage.removeItem(STORE);return blank();}
  global.M5MatrixStore={STORE,load,save,key,reconcile,capture,mergeSeed,clear};
})(typeof window!=='undefined'?window:globalThis);
