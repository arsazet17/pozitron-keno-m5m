const CACHE='m5m-runtime-live-v4-20260821';
const ASSETS=['./assets/m5m-splash-cat-original.png','./','./index.html','./style.css','./m5-engine.js','./matrix-store.js','./app.js','./navigation.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
const DYNAMIC=['/data/m5-runtime.json','/data/archive.json','/data/m5-server-state.json','/data/m5-server-status.json','/data/last_sync.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(DYNAMIC.some(x=>u.pathname.endsWith(x))){
    e.respondWith(fetch(new Request(e.request,{cache:'no-store'})).catch(()=>new Response('',{status:503,statusText:'Fresh server data unavailable'})));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x)).catch(()=>{});return r;}).catch(()=>caches.match(e.request)));
});
