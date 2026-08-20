const CACHE='m5m-cat-splash-20260820-v1';
const ASSETS=['./','./index.html','./style.css','./m5-engine.js','./matrix-store.js','./app.js','./navigation.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./data/algorithm_seed_v3.json'];
const DYNAMIC=['/data/archive.json','/data/m5-server-state.json','/data/m5-server-status.json','/data/last_sync.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(DYNAMIC.some(x=>u.pathname.endsWith(x))){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x)).catch(()=>{});return r;}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x)).catch(()=>{});return r;}).catch(()=>caches.match(e.request)));
});
