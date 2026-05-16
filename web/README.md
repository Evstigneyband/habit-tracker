# Твой челлендж Web

React/Vite-версия трекера привычек. Целевая архитектура:

- React + Vite для фронтенда
- Supabase Auth для регистрации и входа
- Supabase Postgres для челленджей, целей и ежедневных отметок
- Vercel для публикации
- Telegram MiniApp как следующий слой поверх веб-приложения

## Локальный запуск

```bash
npm install
npm run dev -- --host 0.0.0.0
```

После запуска:

- Mac: `http://localhost:5173`
- iPhone в той же Wi-Fi сети: `http://<IP-MAC>:5173`

## Supabase

1. Создать проект в Supabase.
2. Открыть SQL Editor.
3. Выполнить SQL из `supabase/schema.sql`.
4. Скопировать Project URL и anon public key.
5. Создать `web/.env.local` по примеру `.env.example`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

После изменения `.env.local` нужно перезапустить Vite dev server.

## Текущий статус

Интерфейс уже перенесён в React и работает на mock-данных. Supabase SDK, клиент,
сервисы авторизации и базовая SQL-схема добавлены. Следующий шаг: подключить экран
входа/регистрации к Supabase Auth.
