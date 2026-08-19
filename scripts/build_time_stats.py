#!/usr/bin/env python3
import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEDULE = [
    "00:02","00:17","00:32","01:02","01:17","01:32","02:02","02:17","02:32","03:02","03:32",
    "04:02","04:17","04:32","05:02","05:17","05:32","06:02","06:17","06:32","07:02","07:32",
    "08:02","08:17","08:32","09:02","09:17","09:32","10:02","10:17","10:32","11:02","11:32",
    "12:02","12:17","12:32","13:02","13:17","13:32","14:02","14:17","14:32","15:02","15:32",
    "16:02","16:17","16:32","17:02","17:17","17:32","18:02","18:17","18:32","19:02","19:32",
    "20:02","20:17","20:32","21:02","21:17","21:32","22:02","22:17","22:32","23:02","23:32"
]
SCHEDULE_SET = set(SCHEDULE)
CATEGORIES = ("full", "v1_v2", "v1_gg")


def valid_column(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 10 else None


def parse_date(s):
    for fmt in ("%d.%m.%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(str(s), fmt).date()
        except ValueError:
            pass
    return None


class BacktestEngine:
    """Incremental backtest that mirrors STRICT M5M engine rules."""

    def __init__(self):
        self.idx_v = {n: defaultdict(list) for n in range(1, 7)}
        self.idx_h = {n: defaultdict(list) for n in range(1, 7)}
        self.vert_seq = defaultdict(list)
        self.schedule_history = []

    @staticmethod
    def add_index(index, seq_before, new_value, order):
        for length in range(1, min(6, len(seq_before)) + 1):
            pattern = tuple(seq_before[-length:])
            index[length][pattern].append((new_value, order))

    def method_at_len(self, base_chain, orientation, length):
        index = self.idx_v if orientation == "V" else self.idx_h
        use_len = min(max(int(length or 0), 0), len(base_chain), 6)
        if use_len < 1:
            return {
                "orientation": orientation,
                "baseChain": list(base_chain),
                "usedChain": [],
                "usedLen": 0,
                "continuations": [],
            }
        pattern = tuple(base_chain[-use_len:])
        items = index[use_len].get(pattern, [])
        return {
            "orientation": orientation,
            "baseChain": list(base_chain),
            "usedChain": list(pattern),
            "usedLen": use_len,
            "continuations": items,
        }

    def find_method(self, base_chain, orientation, max_len=None):
        cap = min(len(base_chain), 6, len(base_chain) if max_len is None else max_len)
        for length in range(cap, 0, -1):
            method = self.method_at_len(base_chain, orientation, length)
            if method["continuations"]:
                return method
        return {
            "orientation": orientation,
            "baseChain": list(base_chain),
            "usedChain": [],
            "usedLen": 0,
            "continuations": [],
        }

    @staticmethod
    def leaders(items):
        counts = Counter(v for v, _ in items)
        if not counts:
            return [], counts
        maximum = max(counts.values())
        return sorted(v for v, n in counts.items() if n == maximum), counts

    def variant1(self, methods):
        # STRICT: method coverage -> raw frequency -> chain strength -> value.
        # Freshness/recency is intentionally NOT used.
        by = {
            n: {
                "value": n,
                "methods": set(),
                "strength": 0,
                "total": 0,
            }
            for n in range(1, 11)
        }
        for name, method in methods.items():
            seen = set()
            for value, _order in method["continuations"]:
                row = by[value]
                row["total"] += 1
                if value not in seen:
                    seen.add(value)
                    row["methods"].add(name)
                    row["strength"] += method["usedLen"]

        ranked = [x for x in by.values() if x["methods"]]
        ranked.sort(
            key=lambda x: (
                -len(x["methods"]),
                -x["total"],
                -x["strength"],
                x["value"],
            )
        )
        return [x["value"] for x in ranked[:3]]

    def variant2(self, specs, initial_methods):
        # STRICT: on a tie, every active chain shortens by exactly one per round.
        current = dict(initial_methods)
        rounds = 0
        while rounds < 8:
            all_items = [
                item
                for method in current.values()
                for item in method["continuations"]
            ]
            leaders, _ = self.leaders(all_items)
            if len(leaders) == 1:
                return leaders[0]

            can_shorten = any(m["usedLen"] > 1 for m in current.values())
            if not can_shorten:
                return None

            next_methods = {}
            for name, spec in specs.items():
                cur = current[name]
                if cur["usedLen"] > 1:
                    next_methods[name] = self.method_at_len(
                        spec["chain"], spec["orientation"], cur["usedLen"] - 1
                    )
                else:
                    next_methods[name] = cur
            current = next_methods
            rounds += 1
        return None

    def extra_gg(self, h_chain, initial):
        # STRICT: same exact -1 shortening. Tie at length 1 => no result.
        # No freshness fallback.
        current = initial
        rounds = 0
        while rounds < 8:
            leaders, _ = self.leaders(current["continuations"])
            if len(leaders) == 1:
                return leaders[0]
            if current["usedLen"] <= 1:
                return None
            current = self.method_at_len(h_chain, "H", current["usedLen"] - 1)
            rounds += 1
        return None

    def predict_before(self, col_index):
        v_chain = self.vert_seq[col_index][-6:]
        h_chain = self.schedule_history[-6:]
        if len(v_chain) < 2 or len(h_chain) < 2:
            return None

        specs = {
            "В/В": {"chain": list(v_chain), "orientation": "V"},
            "В/Г": {"chain": list(v_chain), "orientation": "H"},
            "Г/В": {"chain": list(h_chain), "orientation": "V"},
            "Г/Г": {"chain": list(h_chain), "orientation": "H"},
        }
        methods = {
            name: self.find_method(spec["chain"], spec["orientation"])
            for name, spec in specs.items()
        }
        v1 = self.variant1(methods)
        v2 = self.variant2(specs, methods)
        gg = self.extra_gg(h_chain, methods["Г/Г"])
        consensus = v2 if v2 is not None and gg == v2 and v2 in v1 else None
        return {"v1": v1, "v2": v2, "gg": gg, "consensus": consensus}

    def add_value(self, col_index, row_seq, value, order, is_schedule):
        self.add_index(self.idx_v, self.vert_seq[col_index], value, order)
        self.vert_seq[col_index].append(value)

        self.add_index(self.idx_h, row_seq, value, order)
        row_seq.append(value)

        if is_schedule:
            self.schedule_history.append(value)


def signal_rows(prediction):
    if prediction is None:
        return []
    out = []
    v1 = prediction["v1"]
    v2 = prediction["v2"]
    gg = prediction["gg"]
    consensus = prediction["consensus"]

    if consensus is not None:
        out.append(("full", consensus))
    if v2 is not None and v2 in v1:
        out.append(("v1_v2", v2))
    if gg is not None and gg in v1:
        out.append(("v1_gg", gg))
    return out


def empty_stat():
    return {"all": [0, 0], "recent180": [0, 0]}


def pack(pair):
    cases, hits = pair
    return {
        "cases": cases,
        "hits": hits,
        "rate": round(hits / cases, 6) if cases else None,
    }


def build(rows, recent_days=180):
    if not isinstance(rows, list) or len(rows) < 3:
        raise RuntimeError("archive rows are missing")
    header = rows[0]
    if not isinstance(header, list) or len(header) < 2:
        raise RuntimeError("archive header is missing")

    dated_rows = [
        r for r in rows[1:]
        if isinstance(r, list) and r and parse_date(r[0])
    ]
    if not dated_rows:
        raise RuntimeError("archive has no dated rows")

    latest_date = max(parse_date(r[0]) for r in dated_rows)
    cutoff = latest_date - timedelta(days=recent_days - 1)

    by_time = {cat: defaultdict(empty_stat) for cat in CATEGORIES}
    baseline = {cat: empty_stat() for cat in CATEGORIES}
    engine = BacktestEngine()

    for row_index, row in enumerate(rows[1:], start=1):
        if not isinstance(row, list) or not row:
            continue
        date_obj = parse_date(row[0])
        if not date_obj:
            continue

        row_seq = []
        for col_index in range(1, min(len(header), len(row))):
            value = valid_column(row[col_index])
            if value is None:
                continue
            tm = str(header[col_index])
            is_schedule = tm in SCHEDULE_SET

            if is_schedule:
                prediction = engine.predict_before(col_index)
                for category, signal_column in signal_rows(prediction):
                    hit = int(value == signal_column)
                    stat = by_time[category][tm]
                    stat["all"][0] += 1
                    stat["all"][1] += hit
                    baseline[category]["all"][0] += 1
                    baseline[category]["all"][1] += hit
                    if date_obj >= cutoff:
                        stat["recent180"][0] += 1
                        stat["recent180"][1] += hit
                        baseline[category]["recent180"][0] += 1
                        baseline[category]["recent180"][1] += hit

            order = row_index * 1000 + col_index
            engine.add_value(col_index, row_seq, value, order, is_schedule)

    payload = {
        "version": 2,
        "rules": "strict-coverage-frequency-strength-exact-minus-one-no-freshness",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "latestDate": latest_date.strftime("%d.%m.%y"),
        "recentDays": recent_days,
        "definitions": {
            "full": "Вариант 1 + Вариант 2 + Доп. Г/Г: один и тот же столб",
            "v1_v2": "Столб Варианта 2 входит в три столба Варианта 1",
            "v1_gg": "Столб Доп. Г/Г входит в три столба Варианта 1",
        },
        "baseline": {},
        "times": {},
    }

    for category in CATEGORIES:
        payload["baseline"][category] = {
            "all": pack(baseline[category]["all"]),
            "recent180": pack(baseline[category]["recent180"]),
        }

    for tm in SCHEDULE:
        payload["times"][tm] = {}
        for category in CATEGORIES:
            stat = by_time[category].get(tm, empty_stat())
            payload["times"][tm][category] = {
                "all": pack(stat["all"]),
                "recent180": pack(stat["recent180"]),
            }
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", default="data/archive.json")
    parser.add_argument("--output", default="data/time_stats.json")
    parser.add_argument("--recent-days", type=int, default=180)
    args = parser.parse_args()

    archive_path = Path(args.archive)
    output_path = Path(args.output)
    archive = json.loads(archive_path.read_text(encoding="utf-8"))
    payload = build(archive.get("rows"), recent_days=args.recent_days)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"M5M TIME STATS STRICT PASS: {payload['latestDate']} · "
        f"{len(payload['times'])} времен"
    )


if __name__ == "__main__":
    main()
