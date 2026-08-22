const CACHE='m5m-runtime-direct-v8-20260822';

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
  '/data/m5-runtime.json':'data/m5-runtime.json',
  '/data/archive.json':'data/archive.json',
  '/data/m5-server-state.json':'data/m5-server-state.json',
  '/data/m5-server-status.json':'data/m5-server-status.json',
  '/data/last_sync.json':'data/last_sync.json'
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

  // Redirect ONLY same-origin data requests.
  // Cross-origin raw.githubusercontent.com requests are left alone,
  // so we never recursively intercept the direct LIVE request.
  if(u.origin===self.location.origin){
    const found=Object.entries(DIRECT).find(([suffix])=>u.pathname.endsWith(suffix));
    if(found){
      const raw=new URL(found[1],RAW_BASE);
      raw.searchParams.set('ts',String(Date.now()));

      e.respondWith(
        fetch(raw.href,{
          method:'GET',
          cache:'no-store',
          mode:'cors',
          credentials:'omit'
        }).then(r=>{
          if(!r.ok)throw new Error('M5 RAW HTTP '+r.status);
          return r;
        })
      );
      return;
    }
  }

  // Static shell: network first; cache only as offline fallback.
  if(u.origin===self.location.origin){
    e.respondWith(
      fetch(new Request(e.request,{cache:'no-store'}))
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
          return r;
        })
        .catch(()=>caches.match(e.request))
    );
  }
});
