(function(){
  const order=['home','history','algorithm','archive','settings'],
        pages=[...document.querySelectorAll('.page')],
        buttons=[...document.querySelectorAll('.nav-btn')];

  function go(name){
    if(!order.includes(name))return;
    pages.forEach(p=>p.classList.toggle('active',p.dataset.page===name));
    buttons.forEach(b=>b.classList.toggle('active',b.dataset.target===name));
    history.replaceState(null,'','#'+name);
    scrollTo({top:0,behavior:'smooth'});
  }

  buttons.forEach(b=>b.addEventListener('click',()=>go(b.dataset.target)));
  const initial=location.hash.slice(1);
  if(order.includes(initial))go(initial);

  // M5M HISTORY MOBILE FIX:
  // На телефоне история больше не является широкой таблицей.
  // Каждый тираж показывается отдельной карточкой:
  // дата/время, факт, главный M5, TOP-3, результат, критерий факта.
  const style=document.createElement('style');
  style.id='m5-history-mobile-fix';
  style.textContent=`
  @media (max-width:620px){
    .page[data-page="history"] .table-card{
      padding:0!important;
      background:transparent!important;
      border:0!important;
      box-shadow:none!important;
      overflow:visible!important;
    }
    .page[data-page="history"] .table-wrap{overflow:visible!important}
    .page[data-page="history"] table{
      display:block!important;
      width:100%!important;
      min-width:0!important;
      border-collapse:separate!important;
      font-size:13px!important;
    }
    .page[data-page="history"] thead{display:none!important}
    .page[data-page="history"] tbody{display:block!important;width:100%!important}
    .page[data-page="history"] tbody tr{
      display:grid!important;
      grid-template-columns:1fr 1fr!important;
      gap:9px 12px!important;
      width:100%!important;
      margin:0 0 12px!important;
      padding:14px!important;
      background:linear-gradient(180deg,rgba(18,38,60,.98),rgba(11,28,45,.98))!important;
      border:1px solid rgba(130,180,220,.18)!important;
      border-radius:16px!important;
      box-shadow:0 8px 24px rgba(0,0,0,.14)!important;
    }
    .page[data-page="history"] tbody td{
      display:flex!important;
      flex-direction:column!important;
      gap:3px!important;
      min-width:0!important;
      padding:0!important;
      border:0!important;
      white-space:normal!important;
      font-size:14px!important;
      color:#eef6ff!important;
    }
    .page[data-page="history"] tbody td::before{
      font-size:9px!important;
      line-height:1.1!important;
      letter-spacing:.10em!important;
      text-transform:uppercase!important;
      color:#8fa5bb!important;
      font-weight:700!important;
    }
    .page[data-page="history"] tbody td:nth-child(1)::before{content:"Дата"}
    .page[data-page="history"] tbody td:nth-child(2)::before{content:"Время"}
    .page[data-page="history"] tbody td:nth-child(3)::before{content:"Факт"}
    .page[data-page="history"] tbody td:nth-child(4)::before{content:"Главный M5"}
    .page[data-page="history"] tbody td:nth-child(5)::before{content:"TOP-3 M5"}
    .page[data-page="history"] tbody td:nth-child(6)::before{content:"Результат"}
    .page[data-page="history"] tbody td:nth-child(7)::before{content:"Почему вышел факт"}

    .page[data-page="history"] tbody td:nth-child(3),
    .page[data-page="history"] tbody td:nth-child(4){
      font-size:25px!important;
      font-weight:900!important;
      color:#ffd166!important;
      background:#091827!important;
      border-radius:12px!important;
      padding:9px 10px!important;
    }
    .page[data-page="history"] tbody td:nth-child(5),
    .page[data-page="history"] tbody td:nth-child(6),
    .page[data-page="history"] tbody td:nth-child(7){
      grid-column:1/-1!important;
      background:#091827!important;
      border-radius:12px!important;
      padding:9px 10px!important;
    }
    .page[data-page="history"] tbody td:nth-child(5){
      font-size:18px!important;
      font-weight:800!important;
      color:#55d6ff!important;
    }
    .page[data-page="history"] tbody td:nth-child(6){
      font-size:17px!important;
      font-weight:900!important;
    }
    .page[data-page="history"] tbody td:nth-child(7){
      font-size:13px!important;
      color:#d7e6f4!important;
    }
  }`;
  document.head.appendChild(style);

  window.M5Nav={go};
})();