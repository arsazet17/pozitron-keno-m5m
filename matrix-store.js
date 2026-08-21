(function(global){
  'use strict';

  const E=global.M5Engine;
  let state=blank();

  function blank(){return{version:3,snapshots:{},finalized:{}};}
  function key(d,t){return`${d}|${t}`;}
  function arr(x){return Array.isArray(x)?x:[];}
  function num(x,d=0){const n=Number(x);return Number.isFinite(n)?n:d;}

  function clone(x){
    try{return structuredClone(x);}
    catch{return JSON.parse(JSON.stringify(x));}
  }

  function compactCandidate(c,full=false){
    c=c||{};
    if(full){
      return{
        value:num(c.value),methods:arr(c.methods).slice(),coverage:num(c.coverage),raw_total:num(c.raw_total),
        depth:num(c.depth),repeats:arr(c.repeats).slice(),repeat_count:num(c.repeat_count),
        methodMask:num(c.methodMask),repeatMask:num(c.repeatMask),classKey:String(c.classKey||'0:0:0:0')
      };
    }
    return{
      methodMask:num(c.methodMask),coverage:num(c.coverage),raw_total:num(c.raw_total),
      repeat_count:num(c.repeat_count),repeatMask:num(c.repeatMask),classKey:String(c.classKey||'0:0:0:0')
    };
  }

  function compactPending(s){
    const candidates={};
    for(const [n,c] of Object.entries(s?.candidates||{}))candidates[n]=compactCandidate(c,true);
    return{
      version:3,key:String(s?.key||key(s?.date,s?.time)),date:String(s?.date||''),weekday:String(s?.weekday||''),
      time:String(s?.time||''),capturedAt:String(s?.capturedAt||new Date().toISOString()),
      source:String(s?.source||'BROWSER_MEMORY'),
      candidates,
      m5:{
        main:s?.m5?.main??null,
        picks:arr(s?.m5?.picks).slice(),
        reserve:arr(s?.m5?.reserve).slice(),
        model:{...(s?.m5?.model||{})}
      }
    };
  }

  function modelSnapshot(s){
    const candidates={};
    for(const [n,c] of Object.entries(s?.candidates||{}))candidates[n]=compactCandidate(c,false);
    return{date:String(s?.date||''),weekday:String(s?.weekday||''),time:String(s?.time||''),candidates};
  }

  function compactFinalized(r){
    if(!r)return null;
    return{
      key:String(r.key||key(r.date,r.time)),
      date:String(r.date||''),weekday:String(r.weekday||''),time:String(r.time||''),
      actual:num(r.actual,null),criterion:String(r.criterion||''),coverage:num(r.coverage),
      raw_total:num(r.raw_total),depth:num(r.depth),methods:arr(r.methods).slice(),
      repeats:arr(r.repeats).slice(),repeat_count:num(r.repeat_count),classKey:String(r.classKey||'0:0:0:0'),
      m5Main:r.m5Main??null,m5Picks:arr(r.m5Picks).slice(),m5Reserve:arr(r.m5Reserve).slice(),
      hitMain:!!r.hitMain,hitTop3:!!r.hitTop3,capturedAt:String(r.capturedAt||''),
      finalizedAt:String(r.finalizedAt||''),snapshot:modelSnapshot(r.snapshot||{}),
      source:String(r.source||'SERVER')
    };
  }

  function normalizeState(src){
    const out=blank();
    for(const [k,r] of Object.entries(src?.finalized||{})){
      const x=compactFinalized(r); if(x)out.finalized[k]=x;
    }
    for(const [k,s] of Object.entries(src?.snapshots||{})){
      if(out.finalized[k])continue;
      out.snapshots[k]=compactPending(s);
    }
    return out;
  }

  function load(){return state;}

  function save(x){
    state=normalizeState(x);
    return state;
  }

  function replaceFromServer(server){
    if(server?.version!==3)return state;
    state=normalizeState(server);
    return state;
  }

  function mergeSeed(seed){
    if(seed?.version!==3)return state;
    for(const [k,v] of Object.entries(seed.finalized||{})){
      if(!state.finalized[k])state.finalized[k]=compactFinalized(v);
      delete state.snapshots[k];
    }
    for(const [k,v] of Object.entries(seed.snapshots||{})){
      if(!state.finalized[k]&&!state.snapshots[k])state.snapshots[k]=compactPending(v);
    }
    return state;
  }

  function snapshotFromForecast(f){
    const candidates={};
    for(const [n,c] of Object.entries(f.candidates||{}))candidates[n]=compactCandidate(c,true);
    return{
      version:3,
      key:key(f.target.date,f.target.time),
      date:f.target.date,weekday:f.weekday,time:f.target.time,
      capturedAt:new Date().toISOString(),
      source:'BROWSER_MEMORY',
      candidates,
      m5:{
        main:f.main,
        picks:arr(f.picks).slice(),
        reserve:arr(f.reserve).slice(),
        model:{...(f.model||{})}
      }
    };
  }

  function criterion(c){
    const a=[];
    if(c.methods?.length)a.push(c.methods.join(' + ')); else a.push('вне RAW');
    if(c.repeats?.length)a.push(c.repeats.join(' + ')); else if(!c.methods?.length)a.push('вне повторов');
    return a.join(' + ');
  }

  function finalize(snap,actual){
    const c=snap.candidates?.[actual]||{
      methods:[],coverage:0,raw_total:0,depth:0,repeats:[],repeat_count:0,
      methodMask:0,repeatMask:0,classKey:'0:0:0:0'
    };
    return{
      key:snap.key,date:snap.date,weekday:snap.weekday,time:snap.time,actual,
      criterion:criterion(c),coverage:c.coverage,raw_total:c.raw_total,depth:c.depth,
      methods:arr(c.methods),repeats:arr(c.repeats),repeat_count:c.repeat_count,classKey:c.classKey,
      m5Main:snap.m5?.main??null,m5Picks:arr(snap.m5?.picks),m5Reserve:arr(snap.m5?.reserve),
      hitMain:(snap.m5?.main===actual),hitTop3:arr(snap.m5?.picks).includes(actual),
      capturedAt:snap.capturedAt,finalizedAt:new Date().toISOString(),
      snapshot:modelSnapshot(snap),source:snap.source||'BROWSER_MEMORY'
    };
  }

  function reconcile(matrix){
    let changed=false;
    for(const [k,snap] of Object.entries({...state.snapshots})){
      if(state.finalized[k]){
        delete state.snapshots[k];
        changed=true;
        continue;
      }
      const a=E.getVal(matrix,snap.date,snap.time);
      if(a!=null){
        state.finalized[k]=finalize(snap,a);
        delete state.snapshots[k];
        changed=true;
      }
    }
    return state;
  }

  function capture(forecast){
    const k=key(forecast.target.date,forecast.target.time);
    if(!state.snapshots[k]&&!state.finalized[k]){
      state.snapshots[k]=snapshotFromForecast(forecast);
    }
    return state;
  }

  function clear(){
    state=blank();
    return state;
  }

  global.M5MatrixStore={
    STORE:'MEMORY_ONLY_NO_LOCALSTORAGE',
    load,save,replaceFromServer,mergeSeed,reconcile,capture,clear,key
  };
})(typeof window!=='undefined'?window:globalThis);
