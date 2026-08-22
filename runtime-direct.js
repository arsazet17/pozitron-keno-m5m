(() => {
  'use strict';

  // M5M v1.2.5 — источник LIVE-данных не зависит от снимка GitHub Pages.
  const RAW_BASE = 'https://raw.githubusercontent.com/arsazet17/pozitron-keno-m5m/main/';
  const nativeFetch = window.fetch.bind(window);

  const LIVE_FILES = new Set([
    'data/m5-runtime.json',
    'data/archive.json',
    'data/m5-server-state.json',
    'data/m5-server-status.json',
    'data/last_sync.json'
  ]);

  function sourceUrl(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if (!raw) return null;
      const u = new URL(raw, location.href);

      // Перехватываем только файлы data именно этого приложения.
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

  function noCacheHeaders(input, init) {
    const h = new Headers(
      init?.headers ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
    );
    h.set('Cache-Control', 'no-cache');
    h.set('Pragma', 'no-cache');
    return h;
  }

  window.fetch = async function(input, init = {}) {
    const rel = sourceUrl(input);
    if (!rel) return nativeFetch(input, init);

    const raw = new URL(rel, RAW_BASE);
    raw.searchParams.set('ts', String(Date.now()));

    const opts = {
      ...init,
      cache: 'no-store',
      headers: noCacheHeaders(input, init)
    };

    try {
      const r = await nativeFetch(raw.href, opts);
      if (!r.ok) throw new Error(`RAW HTTP ${r.status}`);
      return r;
    } catch (err) {
      // Для главного runtime НЕЛЬЗЯ возвращать старый снимок Pages.
      // Лучше показать "нет свежего снимка", чем старый день/старый прогноз.
      if (rel === 'data/m5-runtime.json') throw err;

      // Для вспомогательных файлов допускаем резервный запрос Pages без кэша.
      const original = new URL(
        typeof input === 'string' ? input : input.url,
        location.href
      );
      original.searchParams.set('ts', String(Date.now()));
      return nativeFetch(original.href, opts);
    }
  };

  // Отдельная защита перехода суток по Москве.
  // При смене даты сразу принудительно просим приложение перечитать LIVE runtime.
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

  function forceLiveRefresh(reason) {
    if (window.M5App?.refresh) {
      window.M5App.refresh(reason, true).catch?.(() => {});
    }
  }

  setInterval(() => {
    const next = moscowDateKey();
    if (next !== dayKey) {
      dayKey = next;
      forceLiveRefresh('day-rollover');
    }
  }, 30_000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const next = moscowDateKey();
      if (next !== dayKey) dayKey = next;
      forceLiveRefresh('visible-direct-live');
    }
  });

  window.addEventListener('online', () => forceLiveRefresh('online-direct-live'));
})();
