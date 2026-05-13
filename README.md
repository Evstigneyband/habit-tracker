# Твой челлендж

Google Apps Script веб-приложение для трекинга челленджей.

## Файлы

- `Code.gs` — backend: регистрация, вход, сессии, создание челленджа, ежедневные отметки.
- `Index.html` — frontend: мобильный современный интерфейс.
- `appsscript.json` — manifest проекта Apps Script.

## База

Используется Google Sheet:

https://docs.google.com/spreadsheets/d/1ez1YJkM3t_DGePktOoEE3Nor8w1yL0PpBINlTBwrlgM

Ключевые вкладки:

- `Users`
- `Sessions`
- `Challenges`
- `Goals`
- `DailyEntries`
- `Settings`
- `Schema`

## Как развернуть вручную

1. Открой таблицу `Habit Tracker Database`.
2. Перейди в `Расширения` -> `Apps Script`.
3. Создай/замени файлы:
   - `Code.gs`
   - `Index.html`
   - `appsscript.json`
4. Нажми `Deploy` -> `New deployment`.
5. Выбери тип `Web app`.
6. Execute as: `Me`.
7. Who has access: `Anyone`.
8. Скопируй URL веб-приложения.

## Что уже работает

- регистрация по email и паролю;
- вход по email и паролю;
- запоминание входа в браузере через session token;
- создание одного активного челленджа;
- цели без часов;
- цели с часами;
- дневной прогресс в процентах;
- сохранение отметок в Google Sheets.

## Важное

Пароли не сохраняются в открытом виде. В таблице хранятся `passwordHash` и `passwordSalt`.
