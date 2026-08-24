// M5M v1.2.6 — helper for history/result icons
// Logic requested:
//   🔥   = hit in TOP-3
//   🔥🔥 = hit from RESERVE
//   ❌   = miss
//
// Use from your main renderer:
//   const outcome = M5MResultIcons.getOutcome(entry);
//   const rowIcon = M5MResultIcons.getListBadge(outcome);
//   const resultLabel = M5MResultIcons.getResultLabel(outcome);
//   const reserveLabel = M5MResultIcons.getReserveLabel(outcome);

(function () {
  function normalizeArray(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
    if (typeof v === 'string') {
      return v.split(/[^\d]+/).map(Number).filter(Number.isFinite);
    }
    return [];
  }

  function hasAnyFlag(entry, keys) {
    return keys.some(k => !!entry?.[k]);
  }

  function getActualColumn(entry) {
    return Number(
      entry?.column ??
      entry?.actualColumn ??
      entry?.factColumn ??
      entry?.resultColumn ??
      entry?.stolb ??
      entry?.fact ??
      NaN
    );
  }

  function getTop3(entry) {
    return normalizeArray(
      entry?.top3 ??
      entry?.top3M5 ??
      entry?.top3List ??
      entry?.predTop3 ??
      entry?.predictionTop3 ??
      entry?.main3
    );
  }

  function getReserve(entry) {
    return normalizeArray(
      entry?.reserve ??
      entry?.reserveM5 ??
      entry?.reserveList ??
      entry?.predictionReserve ??
      entry?.predReserve
    );
  }

  function getOutcome(entry) {
    const e = entry || {};
    const type = String(
      e.outcomeType ?? e.resultType ?? e.hitType ?? e.resultKind ?? ''
    ).toLowerCase();

    if (/(reserve|резерв)/.test(type)) return 'reserve';
    if (/(top-?3|top3|main|основ)/.test(type)) return 'top3';
    if (/(miss|мимо|none|nohit)/.test(type)) return 'miss';

    if (hasAnyFlag(e, ['hitReserve', 'isReserveHit', 'reserveHit'])) return 'reserve';
    if (hasAnyFlag(e, ['hitTop3', 'isTop3Hit', 'top3Hit'])) return 'top3';

    const actual = getActualColumn(e);
    const top3 = getTop3(e);
    const reserve = getReserve(e);

    if (Number.isFinite(actual)) {
      if (reserve.includes(actual)) return 'reserve';
      if (top3.includes(actual)) return 'top3';
    }

    return 'miss';
  }

  function getListBadge(outcome) {
    switch (outcome) {
      case 'reserve': return '🔥🔥';
      case 'top3': return '🔥';
      default: return '❌';
    }
  }

  function getResultLabel(outcome) {
    switch (outcome) {
      case 'reserve': return '🔥 РЕЗЕРВ';
      case 'top3': return '🔥 TOP-3';
      default: return '❌ МИМО';
    }
  }

  function getReserveLabel(outcome) {
    switch (outcome) {
      case 'reserve': return '🔥 ВЫШЕЛ ИЗ РЕЗЕРВА';
      default: return '—';
    }
  }

  function getResultClass(outcome) {
    switch (outcome) {
      case 'reserve': return 'result-badge result-badge--reserve';
      case 'top3': return 'result-badge result-badge--top3';
      default: return 'result-badge result-badge--miss';
    }
  }

  window.M5MResultIcons = {
    getOutcome,
    getListBadge,
    getResultLabel,
    getReserveLabel,
    getResultClass
  };
})();
