// M5M v0.1.2 — kill-switch старого Service Worker.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('m5m-')).map(k=>caches.delete(k)));
  await self.registration.unregister();
  const clientsList=await self.clients.matchAll({type:'window'});
  clientsList.forEach(c=>c.navigate(c.url));
})()));
self.addEventListener('fetch',()=>{});
