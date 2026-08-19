(function(){
  const order=['home','stats','archive','settings'];
  const pages=[...document.querySelectorAll('.page')];
  const buttons=[...document.querySelectorAll('.nav-btn')];
  function go(name){
    if(!order.includes(name)) return;
    pages.forEach(p=>p.classList.toggle('active',p.dataset.page===name));
    buttons.forEach(b=>b.classList.toggle('active',b.dataset.target===name));
    history.replaceState(null,'','#'+name);
    scrollTo({top:0,behavior:'smooth'});
  }
  buttons.forEach(b=>b.addEventListener('click',()=>go(b.dataset.target)));
  const initial=location.hash.slice(1);
  if(order.includes(initial)) go(initial);
  const schedule=window.KenoEngine?.SCHEDULE||[];
  const box=document.getElementById('scheduleList');
  if(box) box.innerHTML=schedule.map(t=>`<span class="chip">${t}</span>`).join('');
  window.Keno4MNav={go};
})();
