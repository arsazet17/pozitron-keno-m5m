(function(){
  'use strict';
  const E=window.KenoEngine;
  const LS={overrides:'m5m.overrides.v1',records:'m5m.records.v1',custom:'m5m.customMatrix.v1'};
  let matrix=null, baseMatrix=null, forecast=null, xlsxWorkbook=null, xlsxSheetName=null, customActive=false;
  let archiveFingerprint='', autoRefreshBusy=false, syncMeta=null;
  const AUTO_REFRESH_MS=10*1000;

  const $=id=>document.getElementById(id);
  function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  const memStore={};
  function loadJSON(key,fallback){
    try{const raw=localStorage.getItem(key);if(raw!=null)return JSON.parse(raw)}catch(e){console.warn('localStorage read',e)}
    return Object.prototype.hasOwnProperty.call(memStore,key)?memStore[key]:fallback;
  }
  function saveJSON(key,v){memStore[key]=v;try{localStorage.setItem(key,JSON.stringify(v))}catch(e){console.warn('localStorage write',e)}}
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function methodValues(m){const c={};m.continuations.forEach(x=>c[x.v]=(c[x.v]||0)+1);return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([v,n])=>n>1?`${v}×${n}`:v).join(', ')||'—'}
  function recordKey(r){return `${r.date}|${r.time}`}

  async function fetchJSON(url,backup){
    const tryOne=async u=>{
      const sep=u.includes('?')?'&':'?';
      const r=await fetch(`${u}${sep}_v=m5m001`,{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const text=await r.text();
      if(/^\s*</.test(text)) throw new Error('получен HTML вместо JSON');
      return JSON.parse(text);
    };
    try{return await tryOne(url)}catch(e){
      if(backup){console.warn(`Основной архив ${url} не загрузился`,e);return await tryOne(backup)}
      throw new Error(`Не удалось загрузить ${url}: ${e.message}`);
    }
  }


  async function loadSyncMeta(){
    try{
      syncMeta=await fetchJSON('data/last_sync.json','https://raw.githubusercontent.com/arsazet17/pozitron-keno-m5m/main/data/last_sync.json');
    }catch(e){
      console.warn('last_sync.json не загрузился',e);
      syncMeta=null;
    }
  }

  function nextDrawNumber(){
    const raw=syncMeta?.latestOfficial?.draw;
    const n=Number(raw);
    return Number.isFinite(n) ? n+1 : null;
  }

  function formatDrawNo(n){
    const v=Number(n);
    return Number.isFinite(v) ? `№${v}` : '№—';
  }


  function matrixActual(date,time){
    if(!matrix)return null;
    const hm=E.headerMap(matrix), c=hm[time];
    if(c==null)return null;
    const r=matrix.findIndex((row,i)=>i>0 && String(row?.[0])===String(date));
    if(r<1)return null;
    return E.val(matrix[r][c]);
  }

  function officialFilledSequence(){
    if(!matrix)return [];
    const latest=syncMeta?.latestOfficial;
    const latestDate=latest?.date, latestTime=latest?.time;
    const latestDateObj=E.parseDate(latestDate);
    if(!latestDateObj || !latestTime)return [];

    const out=[];
    const hm=E.headerMap(matrix);
    for(let r=1;r<matrix.length;r++){
      const date=String(matrix[r]?.[0]||'');
      const d=E.parseDate(date);
      if(!d || d>latestDateObj)continue;
      for(const time of E.SCHEDULE){
        const c=hm[time];
        if(c==null)continue;
        if(d.getTime()===latestDateObj.getTime() && E.SCHEDULE.indexOf(time)>E.SCHEDULE.indexOf(latestTime))break;
        const actual=E.val(matrix[r][c]);
        if(actual!=null)out.push({date,time,actual});
      }
    }
    return out;
  }

  function officialDrawFor(date,time){
    const latest=syncMeta?.latestOfficial;
    const latestDraw=Number(latest?.draw);
    if(!Number.isFinite(latestDraw))return null;

    const seq=officialFilledSequence();
    if(!seq.length)return null;
    const latestIndex=seq.findIndex(x=>x.date===String(latest.date)&&x.time===String(latest.time));
    const targetIndex=seq.findIndex(x=>x.date===String(date)&&x.time===String(time));
    if(latestIndex<0 || targetIndex<0 || targetIndex>latestIndex)return null;
    return latestDraw-(latestIndex-targetIndex);
  }

  function reconcileRecordsFromArchive(){
    const rows=getRecords();
    let changed=false;
    for(const r of rows){
      const actual=matrixActual(r.date,r.time);
      if(actual!=null && r.actual==null){
        r.actual=actual;
        r.hitV1=Array.isArray(r.v1) && r.v1.includes(actual);
        r.hitConsensus=r.consensus!=null && r.consensus===actual;
        changed=true;
      }
      if(r.actual!=null && !Number.isFinite(Number(r.draw))){
        const draw=officialDrawFor(r.date,r.time);
        if(draw!=null){r.draw=draw;changed=true;}
      }
    }
    if(changed)setRecords(rows);
    return changed;
  }


  function historicalForecast(date,time){
    if(!matrix)return null;
    const hm=E.headerMap(matrix);
    const col=hm[time];
    const row=matrix.findIndex((r,i)=>i>0 && String(r?.[0])===String(date));
    if(row<1 || col==null)return null;

    // Восстанавливаем состояние архива РОВНО перед этим тиражом:
    // удаляем все более поздние даты и все значения этого дня начиная с target.
    const snap=E.cloneMatrix(matrix.slice(0,row+1));
    for(let c=col;c<snap[row].length;c++) snap[row][c]=null;

    const target={row,date:String(date),time:String(time),col};
    const f=E.predict(snap,target);
    return {
      draw:officialDrawFor(date,time),
      date:String(date),
      time:String(time),
      v1:f.v1.values,
      v2:f.v2.value,
      gg:f.gg.value,
      consensus:f.consensus
    };
  }

  function backfillCompletedForecasts(){
    if(!matrix || !syncMeta?.latestOfficial?.date)return false;

    const latestDate=String(syncMeta.latestOfficial.date);
    const completed=officialFilledSequence().filter(x=>x.date===latestDate);
    if(!completed.length)return false;

    const rows=getRecords();
    let changed=false;

    for(const x of completed){
      const k=`${x.date}|${x.time}`;
      let rec=rows.find(r=>recordKey(r)===k);

      // Если прогноз был сохранён раньше — только дополняем официальный факт.
      if(rec && Array.isArray(rec.v1) && rec.v1.length){
        const hitV1=rec.v1.includes(x.actual);
        const hitConsensus=rec.consensus!=null && rec.consensus===x.actual;
        const draw=Number.isFinite(Number(rec.draw)) ? rec.draw : officialDrawFor(x.date,x.time);

        if(rec.actual!==x.actual || rec.hitV1!==hitV1 || rec.hitConsensus!==hitConsensus || rec.draw!==draw){
          rec.actual=x.actual;
          rec.hitV1=hitV1;
          rec.hitConsensus=hitConsensus;
          rec.draw=draw;
          changed=true;
        }
        continue;
      }

      // Если локальная запись прогноза потерялась — пересчитываем прогноз
      // на историческом срезе ДО этого тиража и создаём запись заново.
      try{
        const hist=historicalForecast(x.date,x.time);
        if(!hist || !Array.isArray(hist.v1) || !hist.v1.length)continue;
        rec={
          ...hist,
          actual:x.actual,
          hitV1:hist.v1.includes(x.actual),
          hitConsensus:hist.consensus!=null && hist.consensus===x.actual,
          restored:true
        };
        rows.push(rec);
        changed=true;
      }catch(e){
        console.warn('Не удалось восстановить прогноз',x.date,x.time,e);
      }
    }

    if(changed){
      rows.sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
      setRecords(rows);
    }
    return changed;
  }

  function archiveFingerprintOf(rows){
    if(!Array.isArray(rows))return '';
    return JSON.stringify(rows.slice(-3));
  }

  // Последний реально заполненный официальный слот в archive.json.
  // Нужен, чтобы экран не смешивал уже новый last_sync.json со ещё старым archive.json
  // (или наоборот) во время короткого рассинхрона GitHub/Raw CDN.
  function latestArchiveOfficial(rows){
    if(!Array.isArray(rows)||rows.length<2)return null;
    const hm={};
    (rows[0]||[]).forEach((x,i)=>{if(i>0&&x!=null)hm[String(x)]=i;});

    for(let r=rows.length-1;r>=1;r--){
      const date=String(rows[r]?.[0]||'');
      if(!date)continue;
      for(let i=E.SCHEDULE.length-1;i>=0;i--){
        const time=E.SCHEDULE[i],c=hm[time];
        if(c==null)continue;
        const column=E.val(rows[r]?.[c]);
        if(column!=null)return {date,time,column};
      }
    }
    return null;
  }

  function sameOfficial(a,b){
    if(!a||!b)return false;
    return String(a.date)===String(b.date)
      && String(a.time)===String(b.time)
      && E.val(a.column)===E.val(b.column);
  }

  function officialKey(meta){
    const x=meta?.latestOfficial;
    return x ? `${x.draw??''}|${x.date??''}|${x.time??''}|${x.column??''}` : '';
  }

  function expectedTargetKey(rows){
    try{
      const probe=E.cloneMatrix(rows);
      E.applyOverrides(probe,loadJSON(LS.overrides,{}));
      const t=E.nextTarget(probe);
      return `${t.date}|${t.time}`;
    }catch(e){
      console.warn('Не удалось вычислить ожидаемый следующий тираж',e);
      return '';
    }
  }

  async function autoRefreshArchive(showToast=false){
    if(autoRefreshBusy || customActive || document.hidden)return;
    autoRefreshBusy=true;
    try{
      const oldMeta=syncMeta;
      const oldMetaKey=officialKey(oldMeta);
      const oldTarget=forecast?.target ? `${forecast.target.date}|${forecast.target.time}` : '';
      const stamp=Date.now();

      const j=await fetchJSON(
        `https://raw.githubusercontent.com/arsazet17/pozitron-keno-m5m/main/data/archive.json?_auto=${stamp}`,
        `data/archive.json?_auto=${stamp}`
      );
      if(!j||!Array.isArray(j.rows)||j.rows.length<3)throw new Error('AUTO: архив JSON имеет неверный формат');

      // ВАЖНО: читаем last_sync в том же цикле и принимаем пару только целиком.
      await loadSyncMeta();
      const newMetaKey=officialKey(syncMeta);
      const archiveLatest=latestArchiveOfficial(j.rows);
      const metaLatest=syncMeta?.latestOfficial||null;

      if(metaLatest && !sameOfficial(archiveLatest,metaLatest)){
        console.warn('M5M AUTO: archive.json и last_sync.json ещё не синхронизированы; ждём следующую проверку',{
          archive:archiveLatest,
          lastSync:metaLatest
        });
        // Не допускаем состояния «номер уже новый, время ещё старое».
        syncMeta=oldMeta;
        return;
      }

      const freshFingerprint=archiveFingerprintOf(j.rows);
      const currentFingerprint=archiveFingerprint || archiveFingerprintOf(baseMatrix);
      const expectedTarget=expectedTargetKey(j.rows);
      const archiveChanged=freshFingerprint!==currentFingerprint;
      const metaChanged=newMetaKey!==oldMetaKey;
      const targetMismatch=!!expectedTarget && expectedTarget!==oldTarget;

      // Если и архив, и мета те же, всё равно проверяем, не завис ли target в памяти.
      if(!archiveChanged && !metaChanged && !targetMismatch){
        reconcileRecordsFromArchive();
        backfillCompletedForecasts();
        renderStats();
        return;
      }

      baseMatrix=j.rows;
      matrix=E.cloneMatrix(baseMatrix);
      E.applyOverrides(matrix,loadJSON(LS.overrides,{}));
      archiveFingerprint=freshFingerprint;

      $('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;
      $('archiveStatus').classList.remove('error');

      // Не оставляем в памяти старый Excel после прихода нового официального результата.
      xlsxWorkbook=null;
      xlsxSheetName=null;
      if(window.XLSX && $('exportXlsx'))$('exportXlsx').disabled=false;

      reconcileRecordsFromArchive();
      backfillCompletedForecasts();
      compute();

      const newTarget=forecast?.target ? `${forecast.target.date}|${forecast.target.time}` : '';
      if(showToast || oldTarget!==newTarget || metaChanged){
        toast(`Новый тираж получен · следующий ${forecast?.target?.time||'—'}`);
      }
    }catch(e){
      console.warn('M5M AUTO экран: проверка архива',e);
    }finally{
      autoRefreshBusy=false;
    }
  }

  function startAutoRefresh(){
    // Первая тихая проверка почти сразу после запуска.
    window.setTimeout(()=>autoRefreshArchive(false),1000);

    // Пока приложение открыто — проверяем архив каждые 10 секунд.
    window.setInterval(()=>autoRefreshArchive(false),AUTO_REFRESH_MS);

    // После возврата из фона проверяем сразу, не ждём минуту.
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden)autoRefreshArchive(true);
    });
    window.addEventListener('focus',()=>autoRefreshArchive(false));
    window.addEventListener('pageshow',()=>autoRefreshArchive(false));
    window.addEventListener('online',()=>autoRefreshArchive(true));
  }

  async function removeOldPwaCache(){
    let had=false;
    try{
      if('serviceWorker' in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        had=regs.length>0 || !!navigator.serviceWorker.controller;
        await Promise.all(regs.map(r=>r.unregister().catch(()=>false)));
      }
      if('caches' in window){
        const keys=await caches.keys();
        if(keys.some(k=>k.startsWith('m5m-')))had=true;
        await Promise.all(keys.filter(k=>k.startsWith('m5m-')).map(k=>caches.delete(k)));
      }
    }catch(e){console.warn('Очистка старого PWA-кэша',e)}
    return had;
  }

  async function forceUpdate(){
    const b=$('forceUpdate');
    if(b){b.disabled=true;b.textContent='⟳ Обновляю…';}
    await removeOldPwaCache();
    const u=new URL(location.href);u.searchParams.set('_clean','1');u.searchParams.set('_update',Date.now());location.replace(u.href);
  }

  async function loadArchive(){
    // LIVE-режим всегда стартует с официального archive.json.
    // Старый импорт Excel не должен навсегда подменять автоархив.
    try{localStorage.removeItem(LS.custom)}catch(e){}
    const j=await fetchJSON('data/archive.json','https://raw.githubusercontent.com/arsazet17/pozitron-keno-m5m/main/data/archive.json');
    if(!j||!Array.isArray(j.rows)||j.rows.length<3)throw new Error('Архив JSON имеет неверный формат');
    baseMatrix=j.rows;
    customActive=false;
    matrix=E.cloneMatrix(baseMatrix);
    E.applyOverrides(matrix,loadJSON(LS.overrides,{}));
    archiveFingerprint=archiveFingerprintOf(baseMatrix);
    $('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;$('archiveStatus').classList.remove('error');
  }

  async function loadXlsx(){
    if(!window.XLSX){$('exportXlsx').disabled=true;return;}
    if(customActive){return;}
    try{
      const xr=await fetch('data/m5m_stolby_po_date_vremeni.xlsx',{cache:'no-store'});if(!xr.ok)throw new Error(`Excel HTTP ${xr.status}`);const b=await xr.arrayBuffer();
      xlsxWorkbook=XLSX.read(b,{type:'array'});xlsxSheetName=xlsxWorkbook.SheetNames[0];
      applyOverridesToWorkbook();
    }catch(e){console.warn(e);$('exportXlsx').disabled=true;}
  }

  function getRecords(){return loadJSON(LS.records,[])}
  function setRecords(rows){saveJSON(LS.records,rows)}
  function upsertRecord(r){
    const rows=getRecords(),k=recordKey(r),i=rows.findIndex(x=>recordKey(x)===k);
    if(i>=0) rows[i]={...rows[i],...r}; else rows.push(r);
    rows.sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
    setRecords(rows);
  }

  async function seedRecords(){
    if(getRecords().length) return;
    try{
      const seed=await fetchJSON('data/predictions_seed.json','https://raw.githubusercontent.com/arsazet17/pozitron-keno-m5m/main/data/predictions_seed.json');
      seed.forEach(r=>upsertRecord({...r,hitV1:r.v1.includes(r.actual),hitConsensus:r.consensus!=null&&r.consensus===r.actual}));
    }catch{}
  }

  function compute(){
    const target=E.nextTarget(matrix);
    forecast=E.predict(matrix,target);
    forecast.targetDraw=nextDrawNumber();
    upsertRecord({draw:forecast.targetDraw,date:target.date,time:target.time,v1:forecast.v1.values,v2:forecast.v2.value,gg:forecast.gg.value,consensus:forecast.consensus,actual:null});
    renderForecast();renderResultSelector();renderStats();
  }

  function renderForecast(){
    const f=forecast,t=f.target;
    $('targetTime').textContent=t.time;$('targetDate').textContent=t.date;
    const drawBox=$('targetDraw'); if(drawBox) drawBox.textContent=`Тираж ${formatDrawNo(f.targetDraw)}`;
    $('v1Balls').innerHTML=f.v1.values.map(n=>`<div class="ball">${n}</div>`).join('');
    $('v2Value').textContent=f.v2.value??'—';$('ggValue').textContent=f.gg.value??'—';
    $('vChain').textContent=f.vChain.join('–');$('hChain').textContent=f.hChain.join('–');
    $('vChainLen').textContent=f.vChain.length;$('hChainLen').textContent=f.hChain.length;
    const cb=$('consensusBox');
    if(f.consensus!=null){cb.className='consensus';cb.innerHTML=`🔥 <strong>ГЛАВНЫЙ АКЦЕНТ — СТОЛБ ${f.consensus}</strong><div class="small" style="margin-top:5px">В1 + В2 + Доп. Г/Г совпали.</div>`}
    else {cb.className='consensus none';cb.innerHTML='<strong>Полного согласования нет</strong>'}
    $('methods').innerHTML=Object.entries(f.methods).map(([name,m])=>`<div class="method"><b>${name}</b><div><div class="chain">${m.usedChain.join('–')||'—'}</div><div class="muted small">длина ${m.usedLen}, продолжений ${m.continuations.length}</div></div><div class="nexts">${esc(methodValues(m))}</div></div>`).join('');
  }

  function renderResultSelector(){
    const t=forecast.target;
    $('resultTime').innerHTML=`<option value="${t.time}">${t.date} · ${t.time}</option>`;
    $('resultValue').value='';
  }

  function updateMatrixCell(date,time,value){
    const hm=E.headerMap(matrix),c=hm[time];if(c==null)throw new Error('Время отсутствует в Excel');
    const r=E.ensureDateRow(matrix,date);matrix[r][c]=value;
    const overrides=loadJSON(LS.overrides,{});overrides[`${date}|${time}`]=value;saveJSON(LS.overrides,overrides);
  }

  function saveResult(){
    if(!forecast)return;
    const n=E.val($('resultValue').value);if(n==null){toast('Введите столб от 1 до 10');return;}
    const {date,time}=forecast.target;
    const rec=getRecords().find(r=>r.date===date&&r.time===time) || {draw:forecast.targetDraw,date,time,v1:forecast.v1.values,v2:forecast.v2.value,gg:forecast.gg.value,consensus:forecast.consensus};
    rec.actual=n;rec.hitV1=rec.v1.includes(n);rec.hitConsensus=rec.consensus!=null&&rec.consensus===n;upsertRecord(rec);
    updateMatrixCell(date,time,n);updateWorkbookCell(date,time,n);
    $('lastCheck').innerHTML=`${formatDrawNo(rec.draw)} · ${date} ${time} → столб <b>${n}</b>. Основной В1: <span class="${rec.hitV1?'hit':'miss'}">${rec.hitV1?'ПОПАЛ':'мимо'}</span>${rec.consensus!=null?`; согласованный ${rec.consensus}: <span class="${rec.hitConsensus?'hit':'miss'}">${rec.hitConsensus?'ПОПАЛ':'мимо'}</span>`:''}.`;
    toast(`Зафиксировано: ${time} → ${n}`);compute();
  }


  function renderStats(){
    const dayBox=$('dayAccordion');
    if(!dayBox)return;

    const latestDate=String(syncMeta?.latestOfficial?.date || forecast?.target?.date || matrix?.[matrix.length-1]?.[0] || '');
    const completed=officialFilledSequence()
      .filter(x=>x.date===latestDate)
      .sort((a,b)=>E.SCHEDULE.indexOf(b.time)-E.SCHEDULE.indexOf(a.time));

    const saved=getRecords();
    const display=[];

    for(const x of completed){
      let rec=saved.find(r=>recordKey(r)===`${x.date}|${x.time}`);

      // Если записи нет — восстанавливаем прогноз строго по архиву ДО тиража.
      if(!rec || !Array.isArray(rec.v1) || !rec.v1.length){
        try{
          const hist=historicalForecast(x.date,x.time);
          if(hist && Array.isArray(hist.v1) && hist.v1.length){
            rec={...hist,restored:true};
          }
        }catch(e){
          console.warn('STAT restore',x.date,x.time,e);
        }
      }

      // Даже если прогноз по какой-то причине не восстановился,
      // сам официальный тираж всё равно показываем — статистика не должна быть пустой.
      rec=rec || {
        draw:officialDrawFor(x.date,x.time),
        date:x.date,time:x.time,
        v1:[],v2:null,gg:null,consensus:null
      };

      rec.draw=Number.isFinite(Number(rec.draw)) ? Number(rec.draw) : officialDrawFor(x.date,x.time);
      rec.actual=x.actual;
      rec.hitV1=Array.isArray(rec.v1) && rec.v1.includes(x.actual);
      rec.hitConsensus=rec.consensus!=null && rec.consensus===x.actual;
      display.push(rec);
    }

    // Сохраняем восстановленные записи как резерв, но экран от них больше не зависит.
    if(display.length){
      const merged=getRecords();
      let changed=false;
      for(const r of display){
        if(!Array.isArray(r.v1) || !r.v1.length)continue;
        const k=recordKey(r),i=merged.findIndex(z=>recordKey(z)===k);
        if(i<0){merged.push({...r});changed=true;}
        else if(merged[i].actual==null || !Array.isArray(merged[i].v1) || !merged[i].v1.length){
          merged[i]={...merged[i],...r};changed=true;
        }
      }
      if(changed){
        merged.sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
        setRecords(merged);
      }
    }

    dayBox.innerHTML=display.map(r=>{
      const hasForecast=Array.isArray(r.v1) && r.v1.length;
      const hit=hasForecast && !!r.hitV1;
      const status=hit ? '🔥' : '—';
      const consText=r.consensus==null
        ? '<div class="detail-line muted">Главный акцент: нет полного согласования</div>'
        : `<div class="detail-line">Главный акцент: <b>${r.consensus}</b> <span class="${r.hitConsensus?'hit':'miss'}">${r.hitConsensus?'✓':'×'}</span></div>`;
      return `<details class="day-item ${hit?'is-hit':'is-miss'}">
        <summary>
          <span class="day-draw">${formatDrawNo(r.draw)}</span>
          <span class="day-date">${r.date}</span>
          <span class="day-time">${r.time}</span>
          <span class="day-fire" aria-label="${hit?'Угадано':'Мимо'}">${status}</span>
          <span class="day-chevron">▾</span>
        </summary>
        <div class="day-item-body">
          <div class="detail-line">Факт: <b>${r.actual}</b></div>
          <div class="detail-line">Вариант 1: <b>${hasForecast?r.v1.join(', '):'не восстановлен'}</b>${hasForecast?` <span class="${hit?'hit':'miss'}">${hit?'ПОПАЛ':'мимо'}</span>`:''}</div>
          <div class="detail-line">Вариант 2: <b>${r.v2??'—'}</b></div>
          <div class="detail-line">Доп. Г/Г: <b>${r.gg??'—'}</b></div>
          ${consText}
        </div>
      </details>`;
    }).join('') || '<div class="stats-empty">Официальных завершённых тиражей за эти сутки пока нет.</div>';
  }

  function applyOverridesToWorkbook(){
    const ov=loadJSON(LS.overrides,{});for(const [k,v] of Object.entries(ov)){const [d,t]=k.split('|');updateWorkbookCell(d,t,E.val(v));}
  }
  function updateWorkbookCell(date,time,value){
    if(!xlsxWorkbook||!window.XLSX)return;
    const ws=xlsxWorkbook.Sheets[xlsxSheetName], arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    const header=arr[0]||[],c=header.indexOf(time);if(c<0)return;
    let r=arr.findIndex((x,i)=>i>0&&String(x[0])===date);
    if(r<0){r=arr.length;ws[XLSX.utils.encode_cell({r,c:0})]={t:'s',v:date};}
    const addr=XLSX.utils.encode_cell({r,c});
    const oldCell=ws[addr]||{};ws[addr]={...oldCell,t:'n',v:value};
    const range=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
    range.e.r=Math.max(range.e.r,r);range.e.c=Math.max(range.e.c,c);ws['!ref']=XLSX.utils.encode_range(range);
  }

  function exportXlsx(){
    if(!window.XLSX){toast('Модуль Excel ещё не загрузился');return;}
    if(!xlsxWorkbook){
      const ws=XLSX.utils.aoa_to_sheet(matrix), wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'КЕНО столбы');xlsxWorkbook=wb;xlsxSheetName='КЕНО столбы';
    }
    applyOverridesToWorkbook();
    const d=forecast?.target.date?.replaceAll('.','-')||'archive';
    XLSX.writeFile(xlsxWorkbook,`m5m_stolby_aktualny_${d}.xlsx`);toast('Актуальный Excel сформирован');
  }

  function importXlsx(file){
    if(!window.XLSX){toast('Модуль Excel не загружен');return;}
    const fr=new FileReader();fr.onload=()=>{
      try{
        const wb=XLSX.read(fr.result,{type:'array'}),sn=wb.SheetNames[0],arr=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:null});
        if(!arr.length||String(arr[0][0])!=='Дата / Время')throw new Error('Неверный формат');
        xlsxWorkbook=wb;xlsxSheetName=sn;baseMatrix=arr;customActive=true;matrix=E.cloneMatrix(arr);E.applyOverrides(matrix,loadJSON(LS.overrides,{}));
        $('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;compute();toast('Excel загружен и принят как рабочий архив');
      }catch(e){console.error(e);toast('Не удалось прочитать Excel');}
    };fr.readAsArrayBuffer(file);
  }

  async function init(){
    $('forceUpdate')?.addEventListener('click',forceUpdate);
    try{
      const u=new URL(location.href);
      if(!u.searchParams.has('_clean')){
        const had=await removeOldPwaCache();
        if(had){u.searchParams.set('_clean','1');u.searchParams.set('_update',Date.now());location.replace(u.href);return;}
      }
      await loadArchive();await seedRecords();await loadSyncMeta();
      // На старте не показываем смешанную пару «новый номер + старое время».
      // Если Raw CDN отдал archive.json и last_sync.json разных поколений,
      // номер временно скрывается, а тихий автоопрос через 1 секунду сам выровняет экран.
      if(syncMeta?.latestOfficial && !sameOfficial(latestArchiveOfficial(baseMatrix),syncMeta.latestOfficial)){
        console.warn('M5M START: archive.json и last_sync.json разных поколений; ждём синхронизации');
        syncMeta=null;
      }
      reconcileRecordsFromArchive();backfillCompletedForecasts();await loadXlsx();compute();
      $('saveResult').addEventListener('click',saveResult);$('exportXlsx').addEventListener('click',exportXlsx);$('recalc').addEventListener('click',()=>{reconcileRecordsFromArchive();backfillCompletedForecasts();compute();toast('Пересчитано по текущему архиву')});
      $('importXlsx').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)importXlsx(f)});
      startAutoRefresh();
      // v0.1.0-M5M: синхронизация экрана + статистика строится прямо из официального архива и не зависит от localStorage
      // и сразу после возврата приложения из фона.
      // Service Worker временно отключён до стабилизации запуска на телефоне.
    }catch(e){
      console.error(e);
      const msg=(e&&e.message)?e.message:'Ошибка запуска';
      $('archiveStatus').textContent=`Ошибка: ${msg}`;$('archiveStatus').classList.add('error');toast(msg);
    }
  }
  init();
})();
