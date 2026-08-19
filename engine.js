(function(global){
  'use strict';

  const SCHEDULE = [
    '00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32',
    '04:02','04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32',
    '08:02','08:17','08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32',
    '12:02','12:17','12:32','13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32',
    '16:02','16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02','19:32',
    '20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17','22:32','23:02','23:32'
  ];

  function val(x){
    const n = Number(x);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
  }

  function parseDate(s){
    const m=String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(!m) return null;
    let y=Number(m[3]); if(y<100) y+=2000;
    return new Date(Date.UTC(y,Number(m[2])-1,Number(m[1])));
  }

  function formatDate(d){
    const dd=String(d.getUTCDate()).padStart(2,'0');
    const mm=String(d.getUTCMonth()+1).padStart(2,'0');
    const yy=String(d.getUTCFullYear()%100).padStart(2,'0');
    return `${dd}.${mm}.${yy}`;
  }

  function nextDate(s){
    const d=parseDate(s); if(!d) return s;
    d.setUTCDate(d.getUTCDate()+1); return formatDate(d);
  }

  function cloneMatrix(rows){ return rows.map(r=>r.slice()); }

  function headerMap(matrix){
    const map={};
    (matrix[0]||[]).forEach((x,i)=>{ if(i>0 && x!=null) map[String(x)]=i; });
    return map;
  }

  function ensureDateRow(matrix,date){
    let idx=matrix.findIndex((r,i)=>i>0 && String(r[0])===date);
    if(idx>=0) return idx;
    const row=new Array(matrix[0].length).fill(null); row[0]=date;
    matrix.push(row); return matrix.length-1;
  }

  function latestDateRow(matrix){
    for(let i=matrix.length-1;i>=1;i--) if(matrix[i] && matrix[i][0]) return i;
    return -1;
  }

  function nextTarget(matrix,schedule=SCHEDULE){
    const hm=headerMap(matrix);
    let row=latestDateRow(matrix);
    if(row<1) throw new Error('В архиве нет строк с датами');
    for(const time of schedule){
      const c=hm[time];
      if(c==null) continue;
      if(val(matrix[row][c])==null) return {row,date:String(matrix[row][0]),time,col:c};
    }
    const date=nextDate(String(matrix[row][0]));
    row=ensureDateRow(matrix,date);
    const time=schedule[0], col=hm[time];
    return {row,date,time,col};
  }

  function verticalChain(matrix,targetCol,targetRow,len=6){
    const a=[];
    for(let r=1;r<targetRow;r++){
      const v=val(matrix[r][targetCol]);
      if(v!=null) a.push(v);
    }
    return a.slice(-len);
  }

  function horizontalChain(matrix,target,schedule=SCHEDULE,len=6){
    const hm=headerMap(matrix), a=[];
    for(let r=1;r<=target.row;r++){
      for(const time of schedule){
        const c=hm[time]; if(c==null) continue;
        if(r===target.row && c>=target.col) break;
        const v=val(matrix[r][c]);
        if(v!=null) a.push(v);
      }
    }
    return a.slice(-len);
  }

  function verticalSequences(matrix){
    const seqs=[];
    for(let c=1;c<matrix[0].length;c++){
      const items=[];
      for(let r=1;r<matrix.length;r++){
        const v=val(matrix[r][c]);
        if(v!=null) items.push({v,row:r,col:c,date:String(matrix[r][0]),time:String(matrix[0][c])});
      }
      if(items.length) seqs.push(items);
    }
    return seqs;
  }

  function horizontalSequences(matrix){
    const seqs=[];
    for(let r=1;r<matrix.length;r++){
      const items=[];
      for(let c=1;c<matrix[0].length;c++){
        const v=val(matrix[r][c]);
        if(v!=null) items.push({v,row:r,col:c,date:String(matrix[r][0]),time:String(matrix[0][c])});
      }
      if(items.length) seqs.push(items);
    }
    return seqs;
  }

  function matchContinuations(seqs,pattern){
    const out=[];
    if(!pattern.length) return out;
    for(const seq of seqs){
      for(let i=0;i+pattern.length<seq.length;i++){
        let ok=true;
        for(let k=0;k<pattern.length;k++) if(seq[i+k].v!==pattern[k]){ok=false;break;}
        if(ok){
          const nx=seq[i+pattern.length];
          out.push({...nx, order:nx.row*1000+nx.col});
        }
      }
    }
    return out;
  }

  // Строго проверить одну конкретную длину цепочки. Никаких скрытых перескоков.
  function methodAtLen(matrix,baseChain,orientation,len){
    const useLen=Math.min(Math.max(Number(len)||0,0),baseChain.length);
    if(useLen<1) return {orientation,baseChain:baseChain.slice(),usedChain:[],usedLen:0,continuations:[]};
    const seqs=orientation==='V' ? verticalSequences(matrix) : horizontalSequences(matrix);
    const pattern=baseChain.slice(baseChain.length-useLen);
    const continuations=matchContinuations(seqs,pattern);
    return {orientation,baseChain:baseChain.slice(),usedChain:pattern,usedLen:useLen,continuations};
  }

  // Первичный поиск: 6→5→4… только отрезанием слева до первого совпадения.
  function findMethod(matrix,baseChain,orientation,maxLen){
    const cap=Math.min(maxLen==null?baseChain.length:maxLen,baseChain.length);
    for(let len=cap;len>=1;len--){
      const m=methodAtLen(matrix,baseChain,orientation,len);
      if(m.continuations.length) return m;
    }
    return {orientation,baseChain:baseChain.slice(),usedChain:[],usedLen:0,continuations:[]};
  }

  function counts(items){
    const m=new Map();
    items.forEach(x=>m.set(x.v,(m.get(x.v)||0)+1));
    return m;
  }

  function leaders(items){
    const c=counts(items); let max=0, ls=[];
    for(const [k,n] of c){
      if(n>max){max=n;ls=[k];} else if(n===max) ls.push(k);
    }
    return {counts:c,max,leaders:ls.sort((a,b)=>a-b)};
  }

  // В1 строго: охват методов → общая частота → глубина цепочек → номер столба.
  // Свежесть/давность совпадения запрещена как критерий.
  function variant1(methods){
    const by={};
    for(let n=1;n<=10;n++) by[n]={value:n,methodSet:new Set(),strength:0,total:0};
    for(const [name,m] of Object.entries(methods)){
      const seen=new Set();
      for(const x of m.continuations){
        const b=by[x.v]; b.total++;
        if(!seen.has(x.v)){
          seen.add(x.v);
          b.methodSet.add(name);
          b.strength+=m.usedLen;
        }
      }
    }
    const ranked=Object.values(by).filter(x=>x.methodSet.size).sort((a,b)=>
      b.methodSet.size-a.methodSet.size || b.total-a.total || b.strength-a.strength || a.value-b.value
    );
    return {
      values:ranked.slice(0,3).map(x=>x.value),
      ranked:ranked.map(x=>({value:x.value,coverage:x.methodSet.size,methods:[...x.methodSet],total:x.total,strength:x.strength}))
    };
  }

  // В2: при ничьей каждая активная цепочка сокращается РОВНО на 1 за раунд.
  // Если на промежуточной длине совпадений нет, следующий раунд продолжает сокращение.
  function variant2(matrix,specs,initialMethods){
    let current={...initialMethods};
    let round=0;
    while(round<8){
      const all=Object.values(current).flatMap(m=>m.continuations);
      const l=leaders(all);
      if(l.leaders.length===1){
        return {value:l.leaders[0],counts:Object.fromEntries(l.counts),rounds:round+1,methods:current,tie:false};
      }

      const canShorten=Object.values(current).some(m=>m.usedLen>1);
      if(!canShorten){
        return {value:null,counts:Object.fromEntries(l.counts),rounds:round+1,methods:current,tie:true,tied:l.leaders};
      }

      const next={};
      for(const [name,s] of Object.entries(specs)){
        const cur=current[name];
        next[name]=cur.usedLen>1
          ? methodAtLen(matrix,s.chain,s.orientation,cur.usedLen-1)
          : cur;
      }
      current=next;
      round++;
    }

    const all=Object.values(current).flatMap(m=>m.continuations);
    const l=leaders(all);
    return {value:l.leaders.length===1?l.leaders[0]:null,counts:Object.fromEntries(l.counts),rounds:round,methods:current,tie:l.leaders.length!==1,tied:l.leaders};
  }

  // Доп. Г/Г: тот же строгий шаг -1. При ничьей на длине 1 — результата нет.
  // Свежесть не используется.
  function extraGG(matrix,hChain,initial){
    let cur=initial, round=0;
    while(round<8){
      const l=leaders(cur.continuations);
      if(l.leaders.length===1){
        return {value:l.leaders[0],usedChain:cur.usedChain,counts:Object.fromEntries(l.counts),rounds:round+1,tie:false};
      }
      if(cur.usedLen<=1){
        return {value:null,usedChain:cur.usedChain,counts:Object.fromEntries(l.counts),rounds:round+1,tie:true,tied:l.leaders};
      }
      cur=methodAtLen(matrix,hChain,'H',cur.usedLen-1);
      round++;
    }
    const l=leaders(cur.continuations);
    return {value:l.leaders.length===1?l.leaders[0]:null,usedChain:cur.usedChain,counts:Object.fromEntries(l.counts),rounds:round,tie:l.leaders.length!==1,tied:l.leaders};
  }

  function predict(matrix,target){
    const vChain=verticalChain(matrix,target.col,target.row,6);
    const hChain=horizontalChain(matrix,target,SCHEDULE,6);
    if(vChain.length<2 || hChain.length<2) throw new Error('Недостаточно данных для расчёта цепочек');
    const specs={
      'В/В':{chain:vChain,orientation:'V'},
      'В/Г':{chain:vChain,orientation:'H'},
      'Г/В':{chain:hChain,orientation:'V'},
      'Г/Г':{chain:hChain,orientation:'H'}
    };
    const methods={};
    for(const [name,s] of Object.entries(specs)) methods[name]=findMethod(matrix,s.chain,s.orientation,s.chain.length);
    const v1=variant1(methods);
    const v2=variant2(matrix,specs,methods);
    const gg=extraGG(matrix,hChain,methods['Г/Г']);
    const consensus=(v2.value!=null && gg.value===v2.value && v1.values.includes(v2.value)) ? v2.value : null;
    return {target,vChain,hChain,methods,v1,v2,gg,consensus};
  }

  function applyOverrides(matrix,overrides){
    const hm=headerMap(matrix);
    for(const [key,value] of Object.entries(overrides||{})){
      const [date,time]=key.split('|'); const c=hm[time]; if(c==null) continue;
      const r=ensureDateRow(matrix,date); matrix[r][c]=val(value);
    }
    return matrix;
  }

  global.KenoEngine={SCHEDULE,val,parseDate,formatDate,nextDate,cloneMatrix,headerMap,ensureDateRow,latestDateRow,nextTarget,verticalChain,horizontalChain,findMethod,methodAtLen,variant1,variant2,extraGG,predict,applyOverrides};
})(typeof window!=='undefined'?window:globalThis);
