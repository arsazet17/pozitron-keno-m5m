(function(global){
  'use strict';
  const E=global.M5Engine,STORE='m5m.algorithmMatrix.v3',DISK_VERSION=4;
  const MAX_FINALIZED=1800;

  function blank(){return{version:3,snapshots:{},finalized:{}};}
  function key(d,t){return`${d}|${t}`;}
  function arr(x){return Array.isArray(x)?x:[];}
  function num(x,d=0){const n=Number(x);return Number.isFinite(n)?n:d;}

  // На диск пишется компактная v4, но наружу API по-прежнему отдаёт логическую v3.
  // Так M5-движок не меняется, а localStorage перестаёт раздуваться.
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
      time:String(s?.time||''),capturedAt:String(s?.capturedAt||new Date().toISOString()),candidates,
      m5:{main:s?.m5?.main??null,picks:arr(s?.m5?.picks).slice(),reserve:arr(s?.m5?.reserve).slice()}
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
      key:String(r.key||key(r.date,r.time)),date:String(r.date||''),weekday:String(r.weekday||''),time:String(r.time||''),
      actual:num(r.actual,null),criterion:String(r.criterion||''),coverage:num(r.coverage),raw_total:num(r.raw_total),depth:num(r.depth),
      methods:arr(r.methods).slice(),repeats:arr(r.repeats).slice(),repeat_count:num(r.repeat_count),classKey:String(r.classKey||'0:0:0:0'),
      m5Main:r.m5Main??null,m5Picks:arr(r.m5Picks).slice(),m5Reserve:arr(r.m5Reserve).slice(),hitMain:!!r.hitMain,hitTop3:!!r.hitTop3,
      capturedAt:String(r.capturedAt||''),finalizedAt:String(r.finalizedAt||''),snapshot:modelSnapshot(r.snapshot||{})
    };
  }

  function normalizeState(src){
    const out=blank();
    for(const [k,r] of Object.entries(src?.finalized||{})){
      const x=compactFinalized(r);if(x)out.finalized[k]=x;
    }
    for(const [k,s] of Object.entries(src?.snapshots||{})){
      if(out.finalized[k])continue;
      out.snapshots[k]=compactPending(s);
    }
    trimFinalized(out,MAX_FINALIZED);
    return out;
  }

  function sortFinalizedKeys(s){
    return Object.keys(s.finalized).sort((a,b)=>{
      const A=s.finalized[a],B=s.finalized[b];
      const da=E?.parseDate?.(A.date)?.getTime?.()||0,db=E?.parseDate?.(B.date)?.getTime?.()||0;
      if(da!==db)return da-db;
      const ia=E?.SCHEDULE?.indexOf?.(A.time)??-1,ib=E?.SCHEDULE?.indexOf?.(B.time)??-1;
      return ia-ib;
    });
  }
  function trimFinalized(s,max){
    const ks=sortFinalizedKeys(s);if(ks.length<=max)return;
    for(const k of ks.slice(0,ks.length-max))delete s.finalized[k];
  }

  // Компактный формат на диске: длинные имена полей не повторяются сотни раз.
  function packCandidate(c,full){
    return full
      ?[num(c.value),arr(c.methods),num(c.coverage),num(c.raw_total),num(c.depth),arr(c.repeats),num(c.repeat_count),num(c.methodMask),num(c.repeatMask),String(c.classKey||'0:0:0:0')]
      :[num(c.methodMask),num(c.coverage),num(c.raw_total),num(c.repeat_count),num(c.repeatMask),String(c.classKey||'0:0:0:0')];
  }
  function unpackCandidate(a,full){
    a=arr(a);
    return full
      ?{value:num(a[0]),methods:arr(a[1]),coverage:num(a[2]),raw_total:num(a[3]),depth:num(a[4]),repeats:arr(a[5]),repeat_count:num(a[6]),methodMask:num(a[7]),repeatMask:num(a[8]),classKey:String(a[9]||'0:0:0:0')}
      :{methodMask:num(a[0]),coverage:num(a[1]),raw_total:num(a[2]),repeat_count:num(a[3]),repeatMask:num(a[4]),classKey:String(a[5]||'0:0:0:0')};
  }
  function packCandidates(obj,full){
    const out=[];for(let n=1;n<=10;n++)out.push(packCandidate(obj?.[n]||obj?.[String(n)]||{},full));return out;
  }
  function unpackCandidates(a,full){
    const out={};arr(a).forEach((x,i)=>{if(i<10)out[i+1]=unpackCandidate(x,full);});return out;
  }

  function packState(src){
    const s=normalizeState(src),p=[],f=[];
    for(const x of Object.values(s.snapshots))p.push([x.key,x.date,x.weekday,x.time,x.capturedAt,packCandidates(x.candidates,true),x.m5?.main??null,arr(x.m5?.picks),arr(x.m5?.reserve)]);
    for(const r of Object.values(s.finalized))f.push([
      r.key,r.date,r.weekday,r.time,r.actual,r.criterion,r.coverage,r.raw_total,r.depth,r.methods,r.repeats,r.repeat_count,r.classKey,
      r.m5Main,r.m5Picks,r.hitMain?1:0,r.hitTop3?1:0,r.capturedAt,r.finalizedAt,packCandidates(r.snapshot?.candidates,false),r.m5Reserve
    ]);
    return{version:DISK_VERSION,p,f};
  }

  function unpackState(d){
    const s=blank();
    for(const a of arr(d?.p)){
      const x={version:3,key:String(a[0]||''),date:String(a[1]||''),weekday:String(a[2]||''),time:String(a[3]||''),capturedAt:String(a[4]||''),candidates:unpackCandidates(a[5],true),m5:{main:a[6]??null,picks:arr(a[7]),reserve:arr(a[8])}};
      if(x.key)s.snapshots[x.key]=x;
    }
    for(const a of arr(d?.f)){
      const r={key:String(a[0]||''),date:String(a[1]||''),weekday:String(a[2]||''),time:String(a[3]||''),actual:num(a[4],null),criterion:String(a[5]||''),coverage:num(a[6]),raw_total:num(a[7]),depth:num(a[8]),methods:arr(a[9]),repeats:arr(a[10]),repeat_count:num(a[11]),classKey:String(a[12]||'0:0:0:0'),m5Main:a[13]??null,m5Picks:arr(a[14]),m5Reserve:arr(a[20]),hitMain:!!a[15],hitTop3:!!a[16],capturedAt:String(a[17]||''),finalizedAt:String(a[18]||''),snapshot:{date:String(a[1]||''),weekday:String(a[2]||''),time:String(a[3]||''),candidates:unpackCandidates(a[19],false)}};
      if(r.key)s.finalized[r.key]=r;
    }
    return s;
  }

  function writeState(state){
    const s=normalizeState(state);
    let max=MAX_FINALIZED,lastErr=null;
    while(true){
      trimFinalized(s,max);
      try{
        localStorage.setItem(STORE,JSON.stringify(packState(s)));
        // Синхронизируем объект вызывающей стороны с реально сохранённой версией.
        if(state&&typeof state==='object'){state.version=3;state.snapshots=s.snapshots;state.finalized=s.finalized;}
        return s;
      }catch(e){
        lastErr=e;
        const count=Object.keys(s.finalized).length;
        if(count<=120)break;
        max=Math.max(120,Math.floor(count*.75));
        console.warn(`M5 storage quota: уменьшаем локальную историю до ${max} записей`);
      }
    }
    console.warn('M5 storage: localStorage недоступен, продолжаем расчёт в памяти',lastErr);
    // Главное: квота больше не должна останавливать сам прогноз.
    return s;
  }

  function load(){
    try{
      const raw=localStorage.getItem(STORE);if(!raw)return blank();
      const x=JSON.parse(raw);
      if(x?.version===DISK_VERSION)return unpackState(x);
      if(x?.version===3){
        const s=normalizeState(x);
        // Миграция старого раздутого v3 в компактный формат при первом открытии.
        writeState(s);
        return s;
      }
      return blank();
    }catch(e){console.warn('M5 storage load',e);return blank();}
  }
  function save(x){return writeState(x);}

  function snapshotFromForecast(f){
    const candidates={};for(const [n,c] of Object.entries(f.candidates||{}))candidates[n]=compactCandidate(c,true);
    return{version:3,key:key(f.target.date,f.target.time),date:f.target.date,weekday:f.weekday,time:f.target.time,capturedAt:new Date().toISOString(),candidates,m5:{main:f.main,picks:arr(f.picks).slice(),reserve:arr(f.reserve).slice()}};
  }
  function criterion(c){const a=[];if(c.methods?.length)a.push(c.methods.join(' + '));else a.push('вне RAW');if(c.repeats?.length)a.push(c.repeats.join(' + '));else if(!c.methods?.length)a.push('вне повторов');return a.join(' + ');}
  function finalize(snap,actual){
    const c=snap.candidates?.[actual]||{methods:[],coverage:0,raw_total:0,depth:0,repeats:[],repeat_count:0,methodMask:0,repeatMask:0,classKey:'0:0:0:0'};
    return{key:snap.key,date:snap.date,weekday:snap.weekday,time:snap.time,actual,criterion:criterion(c),coverage:c.coverage,raw_total:c.raw_total,depth:c.depth,methods:arr(c.methods),repeats:arr(c.repeats),repeat_count:c.repeat_count,classKey:c.classKey,m5Main:snap.m5?.main??null,m5Picks:arr(snap.m5?.picks),m5Reserve:arr(snap.m5?.reserve),hitMain:(snap.m5?.main===actual),hitTop3:arr(snap.m5?.picks).includes(actual),capturedAt:snap.capturedAt,finalizedAt:new Date().toISOString(),snapshot:modelSnapshot(snap)};
  }
  function reconcile(matrix){
    const s=load();let changed=false;
    for(const [k,snap] of Object.entries(s.snapshots)){
      if(s.finalized[k]){delete s.snapshots[k];changed=true;continue;}
      const a=E.getVal(matrix,snap.date,snap.time);
      if(a!=null){s.finalized[k]=finalize(snap,a);delete s.snapshots[k];changed=true;}
    }
    if(changed)save(s);return s;
  }
  function capture(forecast){const s=load(),k=key(forecast.target.date,forecast.target.time);if(!s.snapshots[k]&&!s.finalized[k]){s.snapshots[k]=snapshotFromForecast(forecast);save(s);}return s;}
  function mergeSeed(seed){
    if(seed?.version!==3)return load();
    const s=load();let changed=false;
    for(const [k,v] of Object.entries(seed.finalized||{}))if(!s.finalized[k]){s.finalized[k]=compactFinalized(v);delete s.snapshots[k];changed=true;}
    for(const [k,v] of Object.entries(seed.snapshots||{}))if(!s.finalized[k]&&!s.snapshots[k]){s.snapshots[k]=compactPending(v);changed=true;}
    if(changed)save(s);return s;
  }
  function clear(){localStorage.removeItem(STORE);return blank();}
  global.M5MatrixStore={STORE,load,save,key,reconcile,capture,mergeSeed,clear};
})(typeof window!=='undefined'?window:globalThis);
