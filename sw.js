const CACHE='m5m-runtime-direct-v7-20260822';
const ASSETS=[
  './assets/m5m-splash-cat-original.png',
  './',
  './index.html',
  './style.css',
  './m5-engine.js',
  './matrix-store.js',
  './runtime-direct.js',
  './app.js',
  './navigation.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const RAW_BASE='https://raw.githubusercontent.com/arsazet17/pozitron-keno-m5m/main/';
const DIRECT={
  '/data/m5-runtime.json': RAW_BASE+'data/m5-runtime.json',
  '/data/archive.json': RAW_BASE+'data/archive.json',
  '/data/m5-server-state.json': RAW_BASE+'data/m5-server-state.json',
  '/data/m5-server-status.json': RAW_BASE+'data/m5-server-status.json',
  '/data/last_sync.json': RAW_BASE+'data/last_sync.json'
};

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;

  const u=new URL(e.request.url);
  const direct=Object.entries(DIRECT).find(([suffix])=>u.pathname.endsWith(suffix));

  if(direct){
    const rawUrl=direct[1]+'?ts='+Date.now();
    e.respondWith(
      fetch(rawUrl,{
        cache:'no-store',
        mode:'cors',
        headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}
      }).then(r=>{
        if(!r.ok)throw new Error('RAW HTTP '+r.status);
        return r;
      }).catch(err=>{
        // Главный runtime никогда не подменяем старым кэшем/Pages.
        if(u.pathname.endsWith('/data/m5-runtime.json')) throw err;
        return fetch(new Request(e.request,{cache:'no-store'}));
      })
    );
    return;
  }

  // Статика: network-first. Старый кэш только как офлайн-резерв.
  e.respondWith(
    fetch(new Request(e.request,{cache:'no-store'}))
      .then(r=>{
        const x=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,x)).catch(()=>{});
        return r;
      })
      .catch(()=>caches.match(e.request))
  );
});
