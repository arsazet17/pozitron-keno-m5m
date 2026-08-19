#!/usr/bin/env python3
import asyncio
import copy
import json
import re
import sys
from datetime import datetime, date, time as dt_time, timezone
from pathlib import Path

from openpyxl import load_workbook
from playwright.async_api import async_playwright

LOGIN_URL = "https://oauth.stoloto.ru/login"
ARCHIVE_URL = "https://m.stoloto.ru/keno2/archive/"

ARCHIVE_JSON = Path("data/archive.json")
ARCHIVE_XLSX = Path("data/m5m_stolby_po_date_vremeni.xlsx")
LAST_SYNC = Path("data/last_sync.json")

# Для каждого запуска проверяем только 10 самых свежих официальных тиражей.
TAIL_SIZE = 10

SCHEDULE = [
    "00:02","00:17","00:32","01:02","01:17","01:32","02:02","02:17","02:32","03:02","03:32",
    "04:02","04:17","04:32","05:02","05:17","05:32","06:02","06:17","06:32","07:02","07:32",
    "08:02","08:17","08:32","09:02","09:17","09:32","10:02","10:17","10:32","11:02","11:32",
    "12:02","12:17","12:32","13:02","13:17","13:32","14:02","14:17","14:32","15:02","15:32",
    "16:02","16:17","16:32","17:02","17:17","17:32","18:02","18:17","18:32","19:02","19:32",
    "20:02","20:17","20:32","21:02","21:17","21:32","22:02","22:17","22:32","23:02","23:32"
]
SCHEDULE_SET = set(SCHEDULE)
SCHEDULE_POS = {t: i for i, t in enumerate(SCHEDULE)}

MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
    "мая": 5, "июня": 6, "июля": 7, "августа": 8,
    "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}

def norm_space(s):
    return re.sub(r"[ \t]+", " ", str(s or "").replace("\xa0", " ")).strip()

def moscow_today():
    # Workflow runs in UTC; use fixed MSK offset +03:00 for date label normalization.
    now = datetime.now(timezone.utc).astimezone(timezone.utc)
    # 2026 Moscow is UTC+3 year-round.
    from datetime import timedelta
    return (now + timedelta(hours=3)).date()

def parse_date_label(label):
    raw = norm_space(label).lower()
    today = moscow_today()
    if raw == "сегодня":
        d = today
    elif raw == "вчера":
        from datetime import timedelta
        d = today - timedelta(days=1)
    else:
        m = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", raw)
        if m:
            y = int(m.group(3))
            if y < 100:
                y += 2000
            d = date(y, int(m.group(2)), int(m.group(1)))
        else:
            m = re.fullmatch(r"(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?", raw)
            if not m or m.group(2) not in MONTHS:
                return None
            y = int(m.group(3)) if m.group(3) else today.year
            mm = MONTHS[m.group(2)]
            if not m.group(3) and mm > today.month + 6:
                y -= 1
            d = date(y, mm, int(m.group(1)))
    return d.strftime("%d.%m.%y")

def parse_archive_date(s):
    s = norm_space(s)
    for fmt in ("%d.%m.%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None

def parse_time(text):
    m = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b", str(text or ""))
    if not m:
        return None
    return f"{int(m.group(1)):02d}:{int(m.group(2)):02d}"

def parse_draw(text):
    m = re.search(r"№\s*([0-9]{4,})", str(text or ""))
    return int(m.group(1)) if m else None

def parse_column(text):
    m = re.search(r"столбец\s*([1-9]|10)\b", norm_space(text), re.I)
    return int(m.group(1)) if m else None

def valid_column(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 10 else None

async def login(page, email, password):
    await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)

    login_selectors = [
        'input[type="email"]',
        'input[name*="email" i]',
        'input[name*="login" i]',
        'input[autocomplete="username"]',
        'input[type="text"]',
    ]
    pass_selectors = [
        'input[type="password"]',
        'input[name*="password" i]',
        'input[autocomplete="current-password"]',
    ]

    login_loc = None
    for sel in login_selectors:
        loc = page.locator(sel).first
        if await loc.count():
            login_loc = loc
            break

    pass_loc = None
    for sel in pass_selectors:
        loc = page.locator(sel).first
        if await loc.count():
            pass_loc = loc
            break

    if login_loc is None or pass_loc is None:
        raise RuntimeError("Не найдены поля входа OAuth Столото")

    await login_loc.fill(email)
    await pass_loc.fill(password)

    candidates = [
        page.get_by_role("button", name=re.compile("войти", re.I)).first,
        page.locator('button[type="submit"]').first,
        page.locator('input[type="submit"]').first,
    ]
    clicked = False
    for btn in candidates:
        if await btn.count():
            await btn.click()
            clicked = True
            break
    if not clicked:
        raise RuntimeError("Не найдена кнопка «Войти»")

    try:
        await page.wait_for_load_state("domcontentloaded", timeout=60000)
    except Exception:
        pass
    await page.wait_for_timeout(2500)

async def expand_archive(page, target_rows=TAIL_SIZE):
    """Гарантирует, что на странице есть минимум target_rows тиражей.

    Для обычной работы Столото уже показывает достаточно свежих строк, поэтому
    старый архив больше не разворачиваем до 120 записей.
    """
    last = -1
    stable = 0
    for _ in range(6):
        count = await page.locator("tr").evaluate_all(
            r"""els => els.filter(el => /№\s*\d{4,}/.test(el.innerText || '')).length"""
        )
        if count >= target_rows:
            break
        stable = stable + 1 if count == last else 0
        last = count

        more = page.get_by_role("button", name=re.compile(r"показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$", re.I)).last
        if await more.count():
            try:
                if await more.is_visible():
                    await more.click(timeout=5000)
                    await page.wait_for_timeout(1200)
                    continue
            except Exception:
                pass

        more_link = page.get_by_role("link", name=re.compile(r"показать\s*(ещё|еще)|загрузить\s*(ещё|еще)|^(ещё|еще)$", re.I)).last
        if await more_link.count():
            try:
                if await more_link.is_visible():
                    await more_link.click(timeout=5000)
                    await page.wait_for_timeout(1200)
                    continue
            except Exception:
                pass

        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(1200)
        if stable >= 2:
            break

async def collect_rows(page):
    await page.goto(ARCHIVE_URL, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(2500)
    await expand_archive(page, TAIL_SIZE)

    raw = await page.locator("body").evaluate(
        """() => {
          const drawRx = /№\\s*\\d{4,}/;
          const dateRx = /^(Сегодня|Вчера|\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{2,4}|\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\\s+\\d{4})?)$/i;
          const norm = s => String(s || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+/g, ' ').trim();
          const all = [...document.querySelectorAll('body *')];

          function nearestDateLabel(el) {
            let best = null;
            for (const node of all) {
              if (node === el || el.contains(node)) continue;
              const pos = node.compareDocumentPosition(el);
              if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
              const t = norm(node.innerText || node.textContent || '');
              if (!t || t.length > 40 || !dateRx.test(t)) continue;
              if (node.children && node.children.length > 3) continue;
              best = t;
            }
            return best;
          }

          let candidates = [...document.querySelectorAll('tr')]
            .filter(el => drawRx.test(el.innerText || ''));

          if (!candidates.length) {
            candidates = all.filter(el => {
              const text = norm(el.innerText || '');
              if (!drawRx.test(text)) return false;
              return ![...el.children].some(ch => drawRx.test(norm(ch.innerText || '')));
            });
          }

          return candidates.map(el => ({
            text: el.innerText || '',
            dateLabel: nearestDateLabel(el)
          }));
        }"""
    )
    return raw

def parse_rows(raw_rows):
    parsed = []
    carry_date = None
    for row in raw_rows:
        text = str(row.get("text", ""))
        label = norm_space(row.get("dateLabel", ""))
        if label:
            carry_date = label

        draw = parse_draw(text)
        if not draw:
            continue
        tm = parse_time(text)
        col = parse_column(text)
        if not tm or tm not in SCHEDULE_SET:
            continue
        if col is None:
            raise RuntimeError(f"Тираж №{draw}: Столото не отдал «Столбец N»")

        date_label = label or carry_date
        ds = parse_date_label(date_label) if date_label else None
        if not ds:
            raise RuntimeError(f"Тираж №{draw}: не распознана дата")

        parsed.append({"draw": draw, "date": ds, "time": tm, "column": col})

    uniq = {}
    for d in parsed:
        uniq[d["draw"]] = d

    # Строго только 10 самых свежих тиражей.
    rows = sorted(uniq.values(), key=lambda x: x["draw"])
    return rows[-TAIL_SIZE:]

async def triple_read(page):
    reads = []
    for i in range(3):
        rows = parse_rows(await collect_rows(page))
        if len(rows) < TAIL_SIZE:
            raise RuntimeError(
                f"Чтение {i+1}: найдено только {len(rows)} тиражей, нужно {TAIL_SIZE}"
            )
        reads.append(rows)
        print(
            f"Чтение {i+1}: последние {len(rows)} тиражей, "
            f"№{rows[0]['draw']}–№{rows[-1]['draw']}"
        )
        if i < 2:
            await page.wait_for_timeout(1000)

    maps = [dict((d["draw"], d) for d in arr) for arr in reads]
    common = sorted(set(maps[0]) & set(maps[1]) & set(maps[2]))
    if len(common) < TAIL_SIZE:
        raise RuntimeError(
            f"Последние 10 изменились между проверками: общих тиражей только {len(common)}. "
            "Безопасно пропускаем этот запуск; следующий cron проверит снова."
        )

    stable = []
    for draw in common[-TAIL_SIZE:]:
        a, b, c = maps[0][draw], maps[1][draw], maps[2][draw]
        key = lambda d: (d["date"], d["time"], d["column"])
        if key(a) == key(b) == key(c):
            stable.append(a)

    if len(stable) < TAIL_SIZE:
        raise RuntimeError(
            f"Тройную проверку прошли только {len(stable)} из {TAIL_SIZE} последних тиражей"
        )

    stable = stable[-TAIL_SIZE:]
    print(f"Тройная проверка PASS: последние {len(stable)} тиражей совпали 3/3")
    return stable

def load_archive():
    data = json.loads(ARCHIVE_JSON.read_text(encoding="utf-8"))
    rows = data.get("rows")
    if not isinstance(rows, list) or len(rows) < 2:
        raise RuntimeError("data/archive.json имеет неверный формат")
    return data

def header_map(rows):
    return {str(v): i for i, v in enumerate(rows[0]) if i > 0 and v is not None}

def ensure_date_row(rows, date_str):
    for i, r in enumerate(rows[1:], start=1):
        if r and str(r[0]) == date_str:
            return i

    target = parse_archive_date(date_str)
    row = [None] * len(rows[0])
    row[0] = date_str
    insert_at = len(rows)
    for i, r in enumerate(rows[1:], start=1):
        cur = parse_archive_date(r[0] if r else None)
        if cur and target and cur > target:
            insert_at = i
            break
    rows.insert(insert_at, row)
    return insert_at

def merge_official(archive, stable):
    rows = archive["rows"]
    hm = header_map(rows)

    # Берём только свежий хвост текущей/новой даты.
    archive_dates = [parse_archive_date(r[0]) for r in rows[1:] if r]
    archive_dates = [d for d in archive_dates if d]
    min_date = max(archive_dates) if archive_dates else None

    candidates = []
    for d in stable:
        dd = parse_archive_date(d["date"])
        if min_date and dd and dd < min_date:
            continue
        candidates.append(d)

    candidates.sort(key=lambda x: (parse_archive_date(x["date"]), SCHEDULE_POS[x["time"]], x["draw"]))

    added = []
    confirmed = 0

    for d in candidates:
        c = hm.get(d["time"])
        if c is None:
            continue
        r = ensure_date_row(rows, d["date"])
        cur = valid_column(rows[r][c])

        if cur is None:
            rows[r][c] = d["column"]
            added.append(d)
        elif cur == d["column"]:
            confirmed += 1
        else:
            raise RuntimeError(
                f"КОНФЛИКТ {d['date']} {d['time']}: рабочий архив={cur}, Столото={d['column']}. "
                "Автообновление остановлено, ничего не перезаписано."
            )

    return candidates, added, confirmed

def norm_excel_time(v):
    if isinstance(v, dt_time):
        return v.strftime("%H:%M")
    if isinstance(v, datetime):
        return v.strftime("%H:%M")
    s = norm_space(v)
    m = re.match(r"^(\d{1,2}):(\d{2})", s)
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None

def excel_date_key(v):
    if isinstance(v, datetime):
        return v.strftime("%d.%m.%y")
    if isinstance(v, date):
        return v.strftime("%d.%m.%y")
    s = norm_space(v)
    d = parse_archive_date(s)
    return d.strftime("%d.%m.%y") if d else s

def copy_row_style(ws, src_row, dst_row):
    if src_row < 1:
        return
    for c in range(1, ws.max_column + 1):
        src, dst = ws.cell(src_row, c), ws.cell(dst_row, c)
        if src.has_style:
            dst._style = copy.copy(src._style)
        dst.font = copy.copy(src.font)
        dst.fill = copy.copy(src.fill)
        dst.border = copy.copy(src.border)
        dst.alignment = copy.copy(src.alignment)
        dst.number_format = src.number_format
        dst.protection = copy.copy(src.protection)

def update_excel(added):
    if not added:
        return
    wb = load_workbook(ARCHIVE_XLSX)
    ws = wb[wb.sheetnames[0]]

    xh = {}
    for c in range(2, ws.max_column + 1):
        t = norm_excel_time(ws.cell(1, c).value)
        if t:
            xh[t] = c

    rows_by_date = {}
    for r in range(2, ws.max_row + 1):
        k = excel_date_key(ws.cell(r, 1).value)
        if k:
            rows_by_date[k] = r

    for d in added:
        c = xh.get(d["time"])
        if c is None:
            continue

        key = parse_archive_date(d["date"]).strftime("%d.%m.%y")
        r = rows_by_date.get(key)
        if r is None:
            r = ws.max_row + 1
            copy_row_style(ws, r - 1, r)
            ws.cell(r, 1).value = key
            rows_by_date[key] = r

        cur = valid_column(ws.cell(r, c).value)
        if cur is not None and cur != d["column"]:
            raise RuntimeError(
                f"КОНФЛИКТ Excel {d['date']} {d['time']}: {cur} != {d['column']}"
            )
        ws.cell(r, c).value = d["column"]

    wb.save(ARCHIVE_XLSX)

async def main():
    import os
    email = os.environ.get("STOLOTO_EMAIL", "").strip()
    password = os.environ.get("STOLOTO_PASSWORD", "").strip()

    if not email or not password:
        raise RuntimeError(
            "В Secrets репозитория должны быть STOLOTO_EMAIL и STOLOTO_PASSWORD"
        )

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                locale="ru-RU",
                timezone_id="Europe/Moscow",
                viewport={"width": 390, "height": 844},
                user_agent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36",
            )
            page = await context.new_page()
            await login(page, email, password)
            stable = await triple_read(page)
        finally:
            await browser.close()

    archive = load_archive()
    candidates, added, confirmed = merge_official(archive, stable)

    if added:
        ARCHIVE_JSON.write_text(
            json.dumps(archive, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        update_excel(added)

    last = candidates[-1] if candidates else stable[-1]
    info = {
        "updatedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "source": "Официальный Столото OAuth · M5M standalone · tail10",
        "stableDraws": len(stable),
        "checkedTail": len(candidates),
        "confirmedExisting": confirmed,
        "added": len(added),
        "latestOfficial": last,
        "addedRows": added,
    }
    LAST_SYNC.write_text(
        json.dumps(info, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"M5M TAIL10 PASS: добавлено {len(added)}, подтверждено {confirmed}.")
    print(f"Последний официальный: №{last['draw']} {last['date']} {last['time']} -> столб {last['column']}")
    if added:
        print("Добавлено: " + ", ".join(f"{x['date']} {x['time']}->{x['column']}" for x in added))

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        raise
