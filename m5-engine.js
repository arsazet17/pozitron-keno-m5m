(function(global){
  'use strict';

  const SCHEDULE=[
    '00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32',
    '04:02','04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32',
    '08:02','08:17','08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32',
    '12:02','12:17','12:32','13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32',
    '16:02','16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02','19:32',
    '20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17','22:32','23:02','23:32'
  ];
  const METHOD_ORDER=['В→В','В→Г','Г→В','Г→Г'];
  const REPEAT_ORDER=['🔵','🌸','🟢','🟠','💗','🔴'];

  function val(x){const n=Number(x);return Number.isInteger(n)&&n>=1&&n<=10?n:null;}
  function parseDate(s){const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);if(!m)return null;let y=Number(m[3]);if(y<100)y+=2000;return new Date(Date.UTC(y,Number(m[2])-1,Number(m[1])));}
  function formatDate(d){return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${String(d.getUTCFullYear()%100).padStart(2,'0')}`;}
  function shiftDate(s,days){const d=parseDate(s);if(!d)return s;d.setUTCDate(d.getUTCDate()+days);return formatDate(d);}
  function weekday(s){const d=parseDate(s);return d?['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'][d.getUTCDay()]:'—';}
  function cloneMatrix(rows){return rows.map(r=>r.slice());}
  function headerMap(matrix){const m={};(matrix[0]||[]).forEach((x,i)=>{if(i>0&&x!=null)m[String(x)]=i;});return m;}
  function ensureDateRow(matrix,date){let i=matrix.findIndex((r,k)=>k>0&&String(r?.[0])===String(date));if(i>=0)return i;const row=new Array(matrix[0].length).fill(null);row[0]=date;matrix.push(row);return matrix.length-1;}
  function latestDateRow(matrix){for(let i=matrix.length-1;i>=1;i--)if(matrix[i]?.[0])return i;return -1;}
  function nextTarget(matrix){const hm=headerMap(matrix);let row=latestDateRow(matrix);if(row<1)throw new Error('В архиве нет дат');for(const time of SCHEDULE){const col=hm[time];if(col!=null&&val(matrix[row][col])==null)return{row,date:String(matrix[row][0]),time,col};}const date=shiftDate(String(matrix[row][0]),1);row=ensureDateRow(matrix,date);return{row,date,time:SCHEDULE[0],col:hm[SCHEDULE[0]]};}
  function applyOverrides(matrix,overrides){const hm=headerMap(matrix);for(const [k,v] of Object.entries(overrides||{})){const [date,time]=k.split('|'),n=val(v),c=hm[time];if(n==null||c==null)continue;const r=ensureDateRow(matrix,date);matrix[r][c]=n;}return matrix;}
  function getVal(matrix,date,time){const hm=headerMap(matrix),c=hm[time];if(c==null)return null;const r=matrix.findIndex((x,i)=>i>0&&String(x?.[0])===String(date));return r<1?null:val(matrix[r][c]);}
  function slotShift(date,time,delta){let i=SCHEDULE.indexOf(time),d=date;if(i<0)return{date,time};let j=i+delta;while(j<0){d=shiftDate(d,-1);j+=SCHEDULE.length;}while(j>=SCHEDULE.length){d=shiftDate(d,1);j-=SCHEDULE.length;}return{date:d,time:SCHEDULE[j]};}

  function verticalChain(matrix,targetCol,targetRow,len=6){const a=[];for(let r=1;r<targetRow;r++){const v=val(matrix[r][targetCol]);if(v!=null)a.push(v);}return a.slice(-len);}
  function horizontalChain(matrix,target,len=6){const hm=headerMap(matrix),a=[];for(let r=1;r<=target.row;r++){for(const time of SCHEDULE){const c=hm[time];if(c==null)continue;if(r===target.row&&c>=target.col)break;const v=val(matrix[r][c]);if(v!=null)a.push(v);}}return a.slice(-len);}
  function verticalSequences(matrix){const seqs=[];for(let c=1;c<matrix[0].length;c++){const items=[];for(let r=1;r<matrix.length;r++){const v=val(matrix[r][c]);if(v!=null)items.push({v,row:r,col:c,date:String(matrix[r][0]),time:String(matrix[0][c])});}if(items.length)seqs.push(items);}return seqs;}
  function horizontalSequences(matrix){const seqs=[];for(let r=1;r<matrix.length;r++){const items=[];for(let c=1;c<matrix[0].length;c++){const v=val(matrix[r][c]);if(v!=null)items.push({v,row:r,col:c,date:String(matrix[r][0]),time:String(matrix[0][c])});}if(items.length)seqs.push(items);}return seqs;}
  function matchContinuations(seqs,pattern){const out=[];if(!pattern.length)return out;for(const seq of seqs){for(let i=0;i+pattern.length<seq.length;i++){let ok=true;for(let k=0;k<pattern.length;k++)if(seq[i+k].v!==pattern[k]){ok=false;break;}if(ok)out.push(seq[i+pattern.length]);}}return out;}
  function methodAtLen(matrix,baseChain,orientation,len){const useLen=Math.min(Math.max(Number(len)||0,0),baseChain.length);if(useLen<1)return{usedLen:0,usedChain:[],continuations:[]};const seqs=orientation==='V'?verticalSequences(matrix):horizontalSequences(matrix);const pattern=baseChain.slice(-useLen);return{usedLen:useLen,usedChain:pattern,continuations:matchContinuations(seqs,pattern)};}
  function findMethod(matrix,baseChain,orientation){for(let len=baseChain.length;len>=1;len--){const m=methodAtLen(matrix,baseChain,orientation,len);if(m.continuations.length)return m;}return{usedLen:0,usedChain:[],continuations:[]};}
  function countContinuations(m){const c={};for(const x of m.continuations||[])c[x.v]=(c[x.v]||0)+1;return c;}

  function repeats(matrix,target){
    const prevDay=shiftDate(target.date,-1),twoDays=shiftDate(target.date,-2);
    const g=slotShift(prevDay,target.time,-1),o=slotShift(prevDay,target.time,1),h=slotShift(target.date,target.time,-1),r=slotShift(target.date,target.time,-2);
    return [
      {label:'🔵',name:'вторые сутки',value:getVal(matrix,prevDay,target.time),date:prevDay,time:target.time},
      {label:'🌸',name:'третьи сутки',value:getVal(matrix,twoDays,target.time),date:twoDays,time:target.time},
      {label:'🟢',name:'диагональ вправо',value:getVal(matrix,g.date,g.time),date:g.date,time:g.time},
      {label:'🟠',name:'диагональ влево',value:getVal(matrix,o.date,o.time),date:o.date,time:o.time},
      {label:'💗',name:'предыдущий тираж',value:getVal(matrix,h.date,h.time),date:h.date,time:h.time},
      {label:'🔴',name:'через один тираж',value:getVal(matrix,r.date,r.time),date:r.date,time:r.time}
    ];
  }

  function bitMask(labels,order){let n=0;for(const x of labels||[]){const i=order.indexOf(x);if(i>=0)n|=(1<<i);}return n;}
  function depthBucket(x){return x<=0?'0':x<=4?'1-4':x<=8?'5-8':'9+';}
  function rawBucket(x){return x<=0?'0':x===1?'1':x===2?'2':'3+';}
  function candidateClass(c){return `${c.methodMask}:${rawBucket(c.raw_total)}:${depthBucket(c.depth)}:${c.repeatMask}`;}

  function buildCandidates(methods,reps){
    const out={};for(let n=1;n<=10;n++)out[n]={value:n,methods:[],coverage:0,raw_total:0,depth:0,repeats:[],repeat_count:0};
    for(const [name,m] of Object.entries(methods)){
      const counts=m.counts||{};for(const [sv,cnt] of Object.entries(counts)){const n=Number(sv),x=out[n];x.raw_total+=cnt;if(cnt>0&&!x.methods.includes(name)){x.methods.push(name);x.coverage++;x.depth+=m.usedLen;}}
    }
    for(const r of reps){if(r.value!=null){const x=out[r.value];x.repeats.push(r.label);x.repeat_count++;}}
    for(const x of Object.values(out)){x.methods.sort((a,b)=>METHOD_ORDER.indexOf(a)-METHOD_ORDER.indexOf(b));x.repeats.sort((a,b)=>REPEAT_ORDER.indexOf(a)-REPEAT_ORDER.indexOf(b));x.methodMask=bitMask(x.methods,METHOD_ORDER);x.repeatMask=bitMask(x.repeats,REPEAT_ORDER);x.classKey=candidateClass(x);}
    return out;
  }

  function currentRaw(matrix,target){
    const vChain=verticalChain(matrix,target.col,target.row,6),hChain=horizontalChain(matrix,target,6);
    if(vChain.length<2||hChain.length<2)throw new Error('Недостаточно данных для RAW-цепочек');
    const rawMethods={
      'В→В':findMethod(matrix,vChain,'V'),
      'В→Г':findMethod(matrix,vChain,'H'),
      'Г→В':findMethod(matrix,hChain,'V'),
      'Г→Г':findMethod(matrix,hChain,'H')
    };
    const methods={};for(const [name,m] of Object.entries(rawMethods))methods[name]={usedLen:m.usedLen,usedChain:m.usedChain.slice(),counts:countContinuations(m)};
    const reps=repeats(matrix,target),candidates=buildCandidates(methods,reps);
    return{target:{...target},weekday:weekday(target.date),vChain,hChain,methods,repeats:reps,candidates};
  }

  function normalizeCandidates(cands){
    const xs=Object.values(cands),maxCov=Math.max(1,...xs.map(x=>x.coverage)),maxRaw=Math.max(1,...xs.map(x=>x.raw_total)),maxDepth=Math.max(1,...xs.map(x=>x.depth)),maxRep=Math.max(1,...xs.map(x=>x.repeat_count));
    for(const x of xs){
      const cov=x.coverage/maxCov,raw=x.raw_total/maxRaw,depth=x.depth/maxDepth,rep=x.repeat_count/maxRep;
      x.structureScore=100*(0.36*cov+0.24*raw+0.14*depth+0.26*rep);
      // Нулевой RAW не обнуляет столб: M5 обязан учитывать режимы "вне базы".
      if(x.coverage===0&&x.repeat_count===0)x.structureScore=12;
      else if(x.coverage===0)x.structureScore=Math.max(x.structureScore,18+14*rep);
    }
  }

  function finalizedFull(store){return Object.values(store?.finalized||{}).filter(r=>r?.snapshot?.candidates&&r.actual!=null).sort((a,b)=>parseDate(a.date)-parseDate(b.date)||SCHEDULE.indexOf(a.time)-SCHEDULE.indexOf(b.time));}
  function addStat(map,key,hit,w){if(!key)return;const x=map[key]||(map[key]={e:0,h:0});x.e+=w;if(hit)x.h+=w;}
  function prob(stat){if(!stat||stat.e<2)return null;const prior=8,base=.1;return(stat.h+prior*base)/(stat.e+prior);}
  function logLift(p){if(p==null)return null;return Math.log(Math.max(.02,p)/.1);}

  function learnModel(store){
    const rows=finalizedFull(store),groups={method:{},coverage:{},raw:{},repeatCount:{},repeatMask:{},timeClass:{},weekdayClass:{},transition:{},outside:{}};
    let prevActualClass=null;
    rows.forEach((r,idx)=>{
      const age=rows.length-1-idx,w=age<30?1.6:age<90?1.2:1;
      const snap=r.snapshot,actual=Number(r.actual),actualCand=snap.candidates?.[actual];
      for(let n=1;n<=10;n++){
        const c=snap.candidates?.[n];if(!c)continue;const hit=n===actual;
        addStat(groups.method,String(c.methodMask),hit,w);
        addStat(groups.coverage,String(c.coverage),hit,w);
        addStat(groups.raw,rawBucket(c.raw_total),hit,w);
        addStat(groups.repeatCount,String(c.repeat_count),hit,w);
        addStat(groups.repeatMask,String(c.repeatMask),hit,w);
        addStat(groups.timeClass,`${snap.time}|${c.classKey}`,hit,w);
        addStat(groups.weekdayClass,`${snap.weekday}|${c.classKey}`,hit,w);
        if(prevActualClass)addStat(groups.transition,`${prevActualClass}|${c.classKey}`,hit,w);
        addStat(groups.outside,c.coverage===0?'OUT':'IN',hit,w);
      }
      if(actualCand)prevActualClass=actualCand.classKey;
    });
    return{rows,groups,lastActualClass:prevActualClass};
  }

  function historyScore(c,raw,model){
    const probes=[
      [model.groups.method[String(c.methodMask)],.18],
      [model.groups.coverage[String(c.coverage)],.10],
      [model.groups.raw[rawBucket(c.raw_total)],.10],
      [model.groups.repeatCount[String(c.repeat_count)],.10],
      [model.groups.repeatMask[String(c.repeatMask)],.12],
      [model.groups.timeClass[`${raw.target.time}|${c.classKey}`],.16],
      [model.groups.weekdayClass[`${raw.weekday}|${c.classKey}`],.10],
      [model.lastActualClass?model.groups.transition[`${model.lastActualClass}|${c.classKey}`]:null,.14]
    ];
    let sum=0,weight=0,parts=[];
    for(const [st,w] of probes){const p=prob(st),l=logLift(p);if(l==null)continue;sum+=w*l;weight+=w;parts.push({p,w,e:st.e,h:st.h});}
    const outside=prob(model.groups.outside[c.coverage===0?'OUT':'IN']);if(outside!=null){sum+=.12*logLift(outside);weight+=.12;parts.push({p:outside,w:.12});}
    if(!weight)return{score:50,evidence:0,parts:[]};
    const z=Math.max(-2.6,Math.min(2.6,sum/weight));
    return{score:50+50*Math.tanh(z/1.8),evidence:weight,parts};
  }

  function predict(matrix,target,store){
    const raw=currentRaw(matrix,target);normalizeCandidates(raw.candidates);
    const model=learnModel(store),n=model.rows.length;
    const adaptiveWeight=Math.min(.78,.08+n/90*.70);
    const ranking=Object.values(raw.candidates).map(c=>{
      const hs=historyScore(c,raw,model);
      const score=(1-adaptiveWeight)*c.structureScore+adaptiveWeight*hs.score;
      return{...c,historyScore:hs.score,historyEvidence:hs.evidence,score};
    }).sort((a,b)=>b.score-a.score||b.historyScore-a.historyScore||b.structureScore-a.structureScore||a.value-b.value);
    return{
      ...raw,
      ranking,
      picks:ranking.slice(0,3).map(x=>x.value),
      reserve:ranking.slice(3,5).map(x=>x.value),
      main:ranking[0]?.value??null,
      model:{name:'M5 Adaptive Matrix',version:'1.0',historyRows:n,mode:n<30?'BOOTSTRAP':n<80?'HYBRID':'ADAPTIVE',adaptiveWeight}
    };
  }

  global.M5Engine={SCHEDULE,METHOD_ORDER,REPEAT_ORDER,val,parseDate,formatDate,shiftDate,weekday,cloneMatrix,headerMap,ensureDateRow,nextTarget,applyOverrides,getVal,currentRaw,predict,buildCandidates};
})(typeof window!=='undefined'?window:globalThis);
