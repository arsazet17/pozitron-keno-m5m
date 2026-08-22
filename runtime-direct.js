(() => {
  'use strict';

  // M5M v1.2.6 — LIVE data directly from GitHub main, without CORS-preflight headers.
  const RAW_BASE = 'https://raw.githubusercontent.com/arsazet17/pozitron-keno-m5m/main/';
  const nativeFetch = window.fetch.bind(window);

  const LIVE_FILES = new Set([
    'data/m5-runtime.json',
    'data/archive.json',
    'data/m5-server-state.json',
    'data/m5-server-status.json',
    'data/last_sync.json'
  ]);

  function liveRelativePath(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if (!raw) return null;
      const u = new URL(raw, location.href);
      const marker = '/pozitron-keno-m5m/';
      let rel = '';

      const i = u.pathname.indexOf(marker);
      if (i >= 0) rel = u.pathname.slice(i + marker.length);
      else if (u.origin === location.origin && u.pathname.startsWith('/data/')) rel = u.pathname.slice(1);

      rel = rel.replace(/^\.?\//, '');
      return LIVE_FILES.has(rel) ? rel : null;
    } catch {
      return null;
    }
  }

  async function rawFetch(rel, init = {}) {
    const u = new URL(rel, RAW_BASE);
    u.searchParams.set('ts', String(Date.now()));

    // IMPORTANT: no custom Cache-Control/Pragma request headers here.
    // They cause a CORS preflight in mobile Chrome.
    return nativeFetch(u.href, {
      ...init,
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
      headers: undefined
    });
  }

  window.fetch = async function(input, init = {}) {
    const rel = liveRelativePath(input);
    if (!rel) return nativeFetch(input, init);

    const r = await rawFetch(rel, init);
    if (!r.ok) throw new Error(`M5 LIVE RAW HTTP ${r.status}`);
    return r;
  };

  function moscowDateKey() {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
      return `${m.year}-${m.month}-${m.day}`;
    } catch {
      return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    }
  }

  let dayKey = moscowDateKey();

  function refresh(reason, show = false) {
    try {
      const p = window.M5App?.refresh?.(reason, show);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }

  // Midnight guard + foreground guard.
  setInterval(() => {
    const next = moscowDateKey();
    if (next !== dayKey) {
      dayKey = next;
      refresh('day-rollover-live', true);
    }
  }, 30_000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      dayKey = moscowDateKey();
      refresh('visible-live', false);
    }
  });

  window.addEventListener('online', () => refresh('online-live', true));
})();
