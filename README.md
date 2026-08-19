# M5M

Независимый полный клон стабильного M4 для разработки нового алгоритма.

## Репозиторий

`arsazet17/pozitron-keno-m5m`

## Стартовое состояние

Сейчас M5M повторяет рабочую логику и архив M4, но имеет полностью отдельные:

- имя приложения и PWA;
- localStorage-ключи `m5m.*`;
- GitHub Actions workflow `M5M · Stoloto AUTO`;
- concurrency group `m5m-stoloto-auto`;
- скрипт `scripts/m5m_stoloto_sync.py`;
- Excel `data/m5m_stolby_po_date_vremeni.xlsx`;
- fallback URL на `arsazet17/pozitron-keno-m5m`;
- GitHub Pages deployment;
- иконки и заставку M5M.

## Столото

В GitHub Repository Secrets должны существовать:

- `STOLOTO_EMAIL`
- `STOLOTO_PASSWORD`

Скрипт автообновления читает только последние 10 официальных тиражей, делает три проверки и дописывает новые результаты в полный архив.

## Важно

M4 и M5M — два независимых приложения. Изменения нового алгоритма дальше делаем только здесь.
