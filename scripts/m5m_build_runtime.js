'use strict';

const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data');
const ARCHIVE=path.join(DATA,'archive.json');
const STATE=path.join(DATA,'m5-server-state.json');
const SYNC=path.join(DATA,'last_sync.json');
const RUNTIME=path.join(DATA,'m5-runtime.json');

require(path.join(ROOT,'m5-engine.js'));
const E=globalThis.M5Engine;
if(!E)throw new Error('M5Engine не загрузился');

const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function atomic(file,obj){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj)+'\n','utf8');fs.renameSync(tmp,file);}
function key(d,t){return `${d}|${t}`;}
function timeValue(date,time){const d=E.parseDate(date);const di=d?.getTime?.()||0;return di*100+Math.max(0,E.SCHEDULE.indexOf(String(time)));}
function completedSlots(matrix){
  const hm=E.headerMap(matrix),out=[];
  for(let r=1;r<matrix.length;r++){
    const date=String(matrix[r]?.[0]||''); if(!E.parseDate(date))continue;
    for(const time of E.SCHEDULE){
      const c=hm[time]; if(c==null)continue;
      const actual=E.val(matrix[r]?.[c]);
      if(actual!=null)out.push({date,time,actual,key:key(date,time)});
    }
  }
  out.sort((a,b)=>timeValue(a.date,a.time)-timeValue(b.date,b.time));
  return out;
}
function compactHistory(r,draw){
  return {
    key:String(r.key||key(r.date,r.time)),draw:draw??null,
    date:String(r.date||''),weekday:String(r.weekday||E.weekday(r.date)||''),time:String(r.time||''),
    actual:Number(r.actual),criterion:String(r.criterion||''),coverage:Number(r.coverage||0),raw_total:Number(r.raw_total||0),
    depth:Number(r.depth||0),methods:Array.isArray(r.methods)?r.methods:[],repeats:Array.isArray(r.repeats)?r.repeats:[],
    repeat_count:Number(r.repeat_count||0),m5Main:r.m5Main??null,m5Picks:Array.isArray(r.m5Picks)?r.m5Picks:[],
    m5Reserve:Array.isArray(r.m5Reserve)?r.m5Reserve:[],hitMain:!!r.hitMain,hitTop3:!!r.hitTop3,
    capturedAt:String(r.capturedAt||''),finalizedAt:String(r.finalizedAt||''),source:String(r.source||'SERVER')
  };
}

const archive=read(ARCHIVE),state=read(STATE),sync=read(SYNC);
if(!archive?.rows?.length)throw new Error('archive.json пуст');
if(state?.version!==3)throw new Error('m5-server-state version != 3');
const latest=sync?.latestOfficial;
if(!latest?.draw||!latest?.date||!latest?.time)throw new Error('last_sync.latestOfficial отсутствует');

const matrix=E.cloneMatrix(archive.rows);
const slots=completedSlots(matrix);
const latestKey=key(latest.date,latest.time);
const latestIndex=slots.findIndex(x=>x.key===latestKey);
if(latestIndex<0)throw new Error(`официальный тираж ${latestKey} отсутствует в archive.json`);
if(Number(slots[latestIndex].actual)!==Number(latest.column))throw new Error(`archive/latestOfficial расходятся для ${latestKey}`);

const latestFinal=state.finalized?.[latestKey];
if(!latestFinal)throw new Error(`M5 история ещё не финализировала официальный тираж ${latestKey}`);
if(Number(latestFinal.actual)!==Number(latest.column))throw new Error(`M5 state/latestOfficial расходятся для ${latestKey}`);

const target=E.nextTarget(matrix);
const forecast=E.predict(matrix,target,state);
if(!forecast?.target||forecast.target.date!==target.date||forecast.target.time!==target.time)throw new Error('M5 прогноз имеет неверную цель');

const drawByKey=new Map();
for(let i=0;i<slots.length;i++)drawByKey.set(slots[i].key,Number(latest.draw)+(i-latestIndex));
const hist=Object.values(state.finalized||{})
  .filter(r=>r?.date&&r?.time&&timeValue(r.date,r.time)<=timeValue(latest.date,latest.time))
  .sort((a,b)=>timeValue(b.date,b.time)-timeValue(a.date,a.time))
  .slice(0,300)
  .map(r=>compactHistory(r,drawByKey.get(key(r.date,r.time))));
if(!hist.length||hist[0].key!==latestKey||Number(hist[0].actual)!==Number(latest.column))throw new Error('верх истории не совпадает с latestOfficial');

const pending=state.snapshots?.[key(target.date,target.time)]||null;
const historyRows=Number(forecast.model?.historyRows);
if(!Number.isFinite(historyRows)||historyRows<1)throw new Error('M5 model.historyRows некорректен');

const generation=`${latest.draw}|${latest.date}|${latest.time}|${latest.column}|${historyRows}|${target.date}|${target.time}`;
const runtime={
  version:4,
  generation,
  generatedAt:new Date().toISOString(),
  source:'SERVER_ATOMIC_STOLOTO_M5',
  latestOfficial:{draw:Number(latest.draw),date:String(latest.date),time:String(latest.time),column:Number(latest.column)},
  totals:{finalized:historyRows,storedFinalized:Object.keys(state.finalized||{}).length,historyPublished:hist.length},
  target:{date:target.date,time:target.time},
  forecast,
  pending:pending?{key:String(pending.key||key(pending.date,pending.time)),date:String(pending.date),weekday:String(pending.weekday||E.weekday(pending.date)),time:String(pending.time),capturedAt:String(pending.capturedAt||''),main:pending.m5?.main??null,picks:pending.m5?.picks||[],reserve:pending.m5?.reserve||[]}:null,
  history:hist
};

atomic(RUNTIME,runtime);
console.log(`M5 RUNTIME OK generation=${generation} historyRows=${historyRows} latest=${latestKey} target=${target.date}|${target.time}`);
