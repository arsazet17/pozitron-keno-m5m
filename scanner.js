(function(){
  'use strict';

  const LABELS={
    full:'Полное совпадение В1 + В2 + Доп.',
    v1_v2:'Основной + Вариант 2',
    v1_gg:'Основной + Доп. Г/Г'
  };

  let timeStats=null;
  let loadError=false;
  let lastSignature='';

  const $=id=>document.getElementById(id);
  const numberFrom=id=>{
    const n=Number($(id)?.textContent?.trim());
    return Number.isInteger(n)&&n>=1&&n<=10?n:null;
  };
  const v1Values=()=>[...document.querySelectorAll('#v1Balls .ball')]
    .map(x=>Number(x.textContent.trim()))
    .filter(n=>Number.isInteger(n)&&n>=1&&n<=10);

  function pct(rate){
    return Number.isFinite(Number(rate))
      ? `${(Number(rate)*100).toFixed(1).replace('.',',')}%`
      : '—';
  }

  async function loadTimeStats(){
    try{
      const r=await fetch(`data/time_stats.json?_v=${Date.now()}`,{cache:'no-store'});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json();
      if(!j||!j.times||!j.baseline)throw new Error('неверный формат time_stats.json');
      timeStats=j;
      loadError=false;
    }catch(e){
      console.warn('M5M scanner: time_stats.json',e);
      timeStats=null;
      loadError=true;
    }
    lastSignature='';
    render();
  }

  function sampleFor(category,time){
    const stat=timeStats?.times?.[time]?.[category];
    const base=timeStats?.baseline?.[category];
    if(!stat||!base)return null;

    const recent=stat.recent180||{};
    const all=stat.all||{};

    if(Number(recent.cases)>=8){
      return {sample:recent,baseline:base.recent180||{},scope:`последние ${timeStats.recentDays||180} дней`};
    }
    if(Number(all.cases)>=30){
      return {sample:all,baseline:base.all||{},scope:'вся история'};
    }
    if(Number(all.cases)>=10 && Number(all.hits)===0){
      return {sample:all,baseline:base.all||{},scope:'вся история'};
    }
    return {sample:recent,baseline:base.recent180||{},scope:`последние ${timeStats.recentDays||180} дней`,insufficient:true};
  }

  function adviceFor(category,time){
    if(loadError){
      return {level:'unknown',icon:'⚪',title:'Статистика времени недоступна',text:'Не удалось загрузить временную статистику.'};
    }
    if(!timeStats){
      return {level:'unknown',icon:'⚪',title:'Загрузка статистики',text:'Временная статистика загружается…'};
    }

    const picked=sampleFor(category,time);
    if(!picked){
      return {level:'unknown',icon:'⚪',title:'Нет данных',text:'Для этого времени статистика ещё не рассчитана.'};
    }

    const {sample,baseline,scope,insufficient}=picked;
    const cases=Number(sample.cases)||0;
    const hits=Number(sample.hits)||0;
    const rate=Number(sample.rate);
    const baseRate=Number(baseline.rate);
    const facts=`${hits}/${cases}${cases?` (${pct(rate)})`:''}`;

    if(insufficient || cases<8){
      return {
        level:'unknown',icon:'⚪',
        title:'Мало статистики',
        text:`${scope}: ${facts}. Время пока не подтверждено для ставки.`
      };
    }

    if((cases>=12 && rate>=Math.max(0.15,(Number.isFinite(baseRate)?baseRate:0.10)+0.03))){
      return {
        level:'strong',icon:'🔥',
        title:'Сильное время',
        text:`${scope}: ${facts}. Такой сигнал здесь попадал часто — время благоприятно для ставки.`
      };
    }

    if(rate>=Math.max(0.12,(Number.isFinite(baseRate)?baseRate:0.10)+0.015)){
      return {
        level:'good',icon:'🟢',
        title:'Благоприятное время',
        text:`${scope}: ${facts}. Такой сигнал здесь попадал чаще обычного — время благоприятно для ставки.`
      };
    }

    if((hits===0 && cases>=10) || rate<=Math.min(0.08,(Number.isFinite(baseRate)?baseRate:0.10)-0.015)){
      return {
        level:'bad',icon:'🔴',
        title:'Неблагоприятное время',
        text:`${scope}: ${facts}. Попадания минимальны — ставку по этому сигналу не рекомендую.`
      };
    }

    return {
      level:'neutral',icon:'🟡',
      title:'Нейтральное время',
      text:`${scope}: ${facts}. Явного преимущества времени нет — усиление ставки не рекомендую.`
    };
  }

  function activeSignals(v1,v2,gg){
    const inV2=v2!=null&&v1.includes(v2);
    const inGG=gg!=null&&v1.includes(gg);
    const full=inV2&&inGG&&v2===gg;
    return {
      full:full?v2:null,
      v1_v2:inV2?v2:null,
      v1_gg:inGG?gg:null
    };
  }

  function scannerCategory(n,v1,v2,gg){
    const a=v1.includes(n),b=v2===n,c=gg===n;
    if(a&&b&&c)return 'full';
    if(a&&b)return 'v1_v2';
    if(a&&c)return 'v1_gg';
    return null;
  }

  function badges(n,v1,v2,gg){
    const out=[];
    if(v1.includes(n))out.push('<span class="scan-badge gold">В1</span>');
    if(v2===n)out.push('<span class="scan-badge cyan">В2</span>');
    if(gg===n)out.push('<span class="scan-badge purple">Доп.</span>');
    return out.join('');
  }

  function renderScanner(time,v1,v2,gg){
    const box=$('forecastScanner');
    if(!box)return;
    const cols=[...new Set([...v1,...(v2!=null?[v2]:[]),...(gg!=null?[gg]:[])])];

    if(!cols.length){
      box.innerHTML='<div class="scanner-empty">Прогноз ещё не рассчитан.</div>';
      return;
    }

    box.innerHTML=`
      <div class="scanner-scope">Сканируются только столбы прогноза: <b>${cols.join(' · ')}</b>. Новые столбы сканер не добавляет.</div>
      <div class="scanner-list">
        ${cols.map(n=>{
          const category=scannerCategory(n,v1,v2,gg);
          const adv=category?adviceFor(category,time):null;
          const text=category
            ? `${LABELS[category]}. ${adv.text}`
            : 'Совпадения между вариантами для этого столба нет — временной сигнал не активен.';
          const level=adv?.level||'plain';
          const icon=adv?.icon||'•';
          return `<div class="scanner-row ${level}">
            <div class="scanner-ball">${n}</div>
            <div class="scanner-copy">
              <div class="scanner-badges">${badges(n,v1,v2,gg)}</div>
              <div class="scanner-text">${icon} ${text}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  function renderTimeAdvice(time,v1,v2,gg){
    const box=$('timeAdvice');
    if(!box)return;
    const active=activeSignals(v1,v2,gg);

    box.innerHTML=Object.keys(LABELS).map(category=>{
      const column=active[category];
      if(column==null){
        return `<div class="time-signal inactive">
          <div class="time-signal-head"><b>${LABELS[category]}</b><span>сигнал не активен</span></div>
        </div>`;
      }
      const adv=adviceFor(category,time);
      return `<div class="time-signal ${adv.level}">
        <div class="time-signal-head"><b>${adv.icon} ${LABELS[category]} → столб ${column}</b><span>${adv.title}</span></div>
        <div class="time-signal-copy">${adv.text}</div>
      </div>`;
    }).join('');

    const meta=$('timeStatsMeta');
    if(meta){
      meta.textContent=timeStats
        ? `Бэктест до ${timeStats.latestDate}; основное окно — ${timeStats.recentDays||180} дней.`
        : (loadError?'Временная статистика временно недоступна.':'Загрузка временной статистики…');
    }
  }

  function render(){
    const time=$('targetTime')?.textContent?.trim();
    const v1=v1Values();
    const v2=numberFrom('v2Value');
    const gg=numberFrom('ggValue');
    if(!time||time==='—'||!v1.length)return;

    const signature=JSON.stringify([time,v1,v2,gg,timeStats?.generatedAt||'',loadError]);
    if(signature===lastSignature)return;
    lastSignature=signature;

    renderScanner(time,v1,v2,gg);
    renderTimeAdvice(time,v1,v2,gg);
  }

  function startObserver(){
    const nodes=['targetTime','v1Balls','v2Value','ggValue'].map($).filter(Boolean);
    if(!nodes.length)return;
    const observer=new MutationObserver(()=>render());
    nodes.forEach(node=>observer.observe(node,{childList:true,subtree:true,characterData:true}));
    render();
  }

  startObserver();
  loadTimeStats();
})();