(function(){
  'use strict';

  const E=window.KenoEngine;
  if(!E || typeof E.nextTarget!=='function') return;

  const ONLY_DATE='17.08.26';
  const FIRST_DRAW='03:02';
  const originalNextTarget=E.nextTarget.bind(E);

  E.nextTarget=function(matrix,schedule=E.SCHEDULE){
    const row=E.latestDateRow(matrix);
    if(row<1 || String(matrix[row][0])!==ONLY_DATE){
      return originalNextTarget(matrix,schedule);
    }

    const hm=E.headerMap(matrix);
    const firstIndex=schedule.indexOf(FIRST_DRAW);
    if(firstIndex<0) return originalNextTarget(matrix,schedule);

    // Только 17.08.2026: ночной перерыв, первый реальный тираж 03:02 МСК.
    for(let i=firstIndex;i<schedule.length;i++){
      const time=schedule[i];
      const c=hm[time];
      if(c==null) continue;
      if(E.val(matrix[row][c])==null){
        return {row,date:String(matrix[row][0]),time,col:c};
      }
    }

    // После последнего тиража 17.08 возвращаемся к обычному расписанию 18.08.
    const date=E.nextDate(String(matrix[row][0]));
    const nextRow=E.ensureDateRow(matrix,date);
    const time=schedule[0];
    const col=hm[time];
    return {row:nextRow,date,time,col};
  };
})();
