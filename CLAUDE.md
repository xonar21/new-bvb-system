# BVB Freight — Live Datatable

## Что это за проект

Полная замена старого Laravel + Vue дашборда для BVB Freight. Новая система — полностью независимый проект на **Go + React + PostgreSQL**, который читает данные напрямую из Google Sheets и показывает их в real-time таблице.

Старый проект (Laravel) остаётся работать параллельно для других функций (EDI, email AI, MCC/Budex синхронизация). Новый проект НЕ зависит от старого.

## Что решает

- Медленный Laravel API (Eloquent ORM, MySQL) заменён на Go + pgx (прямые запросы, <5ms)
- Старый Vue + Echo (Pusher) заменён на React + TanStack Query (оптимистичные обновления) + Native WebSocket
- Google Sheets синхронизация теперь на Go (была в Laravel SyncLoads.php)
- Своя PostgreSQL, не зависит от MySQL старого проекта

## Стек

| Компонент | Технология |
|-----------|-----------|
| Backend | Go 1.26, Fiber v2, pgx v5, JWT, gorilla/websocket |
| Frontend | React 19, Vite, TanStack Query, TanStack Table, Zustand, TypeScript |
| Database | PostgreSQL 16 (Alpine), Redis 7 (Alpine) |
| Infra | Docker Compose, Nginx (для production), Vite proxy (для dev) |
| Sync | Google Sheets API v4 (service account), goroutine + ticker |
| Auth | JWT (HS256), bcrypt, Bearer token |

## Структура проекта

```
C:\job\new-bvb-system
├── backend/                    # Go backend
│   ├── cmd/
│   │   ├── server/main.go      # Точка входа — Fiber сервер
│   │   ├── seed/main.go        # Seed пользователей (bcrypt хеши)
│   │   └── migrate/main.go     # Миграция данных из MySQL (старый проект)
│   ├── internal/
│   │   ├── config/config.go    # Env vars (godotenv)
│   │   ├── db/
│   │   │   ├── postgres.go     # pgxpool подключение (25 conns)
│   │   │   └── migrations.go   # Схема + авто-seed пользователей
│   │   ├── sheets/
│   │   │   ├── client.go       # Google Sheets API (JWT auth)
│   │   │   ├── models.go       # RawLoad структура
│   │   │   └── sync.go         # SyncWorker: читает AB LOADS, нормализует, upsert
│   │   ├── loads/
│   │   │   ├── model.go        # Load struct (18 полей)
│   │   │   ├── repository.go   # CRUD + BulkOrder
│   │   │   ├── handler.go      # Fiber handlers (Index, Show, Store, Update, Delete, BulkOrder)
│   │   │   ├── validator.go    # Валидация
│   │   │   └── logic.go        # NormalizeGateCode, DetectMCC, GetRateInterval
│   │   ├── users/
│   │   │   ├── model.go        # User struct
│   │   │   ├── repository.go   # FindByEmail, FindByID
│   │   │   └── handler.go      # Login handler
│   │   ├── auth/
│   │   │   ├── jwt.go          # IssueToken, ValidateToken (HS256)
│   │   │   └── middleware.go   # Bearer token middleware
│   │   └── ws/
│   │       ├── hub.go          # WebSocket Hub: register/unregister/broadcast/presence
│   │       ├── client.go       # Client: ReadPump/WritePump (ping/pong)
│   │       └── messages.go     # Message, PresenceUpdate
│   ├── go.mod / go.sum
│   ├── Dockerfile              # Production (multi-stage, alpine)
│   ├── Dockerfile.dev          # Dev (air hot-reload)
│   ├── .air.toml               # Go hot-reload конфиг
│   ├── service-account.json    # Google service account (НЕ в git)
│   └── .env.example
│
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── api/client.ts       # Fetch wrapper с Bearer token
│   │   ├── types/Load.ts       # TypeScript типы (Load, User, WSMessage)
│   │   ├── hooks/
│   │   │   ├── useLoads.ts     # TanStack Query: useLoads, useUpdateLoad (optimistic), useDeleteLoad
│   │   │   └── useWebSocket.ts # Native WebSocket с auto-reconnect, обновляет query cache
│   │   ├── store/
│   │   │   ├── authStore.ts    # Zustand: token, user, login/logout, persist в localStorage
│   │   │   └── wsStore.ts      # Zustand: isConnected, onlineUsers
│   │   ├── features/LiveDatatable/
│   │   │   ├── LiveDatatable.tsx # Главный компонент: TanStack Table, фильтры, пагинация
│   │   │   ├── LoadCell.tsx     # Inline editing (double-click, debounce)
│   │   │   ├── OnlineUsersBar.tsx # Статус WS + список онлайн юзеров
│   │   │   └── columns.tsx      # 9 колонок таблицы
│   │   ├── components/
│   │   │   └── LoginPage.tsx    # Страница логина
│   │   ├── App.tsx             # QueryClientProvider, auth guard, routing
│   │   └── main.tsx            # Точка входа
│   ├── Dockerfile              # Production (node build + nginx)
│   ├── Dockerfile.dev          # Dev (Vite HMR)
│   ├── nginx.conf              # Nginx: serve static + proxy /api и /ws
│   └── vite.config.ts          # Vite + proxy /api и /ws
│
├── docker-compose.yml           # Production: postgres, redis, backend, frontend, pgadmin
├── docker-compose.dev.yml       # Dev overrides: hot-reload (air + Vite HMR)
├── infra/
│   └── schema.sql               # PostgreSQL схема (loads + users + индексы)
├── PROGRESS.md                  # Статус выполнения задач
└── CLAUDE.md                    # Этот файл
```

## API Endpoints

| Method | Path | Auth | Описание |
|--------|------|------|----------|
| POST | /api/auth/login | Нет | Логин → JWT token |
| GET | /api/loads | Bearer | Список load'ов с фильтрами |
| GET | /api/loads/:id | Bearer | Один load |
| POST | /api/loads | Bearer | Создать load |
| PUT | /api/loads/:id | Bearer | Обновить load |
| DELETE | /api/loads/:id | Bearer | Удалить load |
| POST | /api/loads/bulk-order | Bearer | Переупорядочить |
| WS | /ws?token=... | JWT query | WebSocket (load.*, presence) |

**Фильтры GET /api/loads:** `date_from`, `date_to`, `status`, `gate_code`, `is_mcc`, `is_bold`, `is_lock`

## WebSocket Сообщения

- `load.created` — новый load создан
- `load.updated` — load обновлён
- `load.deleted` — load удалён
- `load.order-updated` — порядок изменён
- `presence` — онлайн юзеры (user_id, user_name, online, count)

## Google Sheets Sync (SyncWorker)

- Читает лист **"AB LOADS"** из Google Sheets
- Запускается при старте, потом каждые **15 минут**
- **Пропускает past-dated** строки
- **Зелёные строки** (#93c47d) → статус `pick up`, не импортируются
- **Gate code normalization**: ltrim leading zeros
- **Rate interval**: rate + offset по таблице (50-50, 100-150, и т.д.)
- **MCC detection**: notes содержит "mcc cans" или "mcc bottles"
- **HOT**: колонка H содержит "HOT"
- **Batch upsert** с `ON CONFLICT (gate_code_col6) DO UPDATE`
- **Lock protection**: `WHERE loads.is_lock = false`

## Таблица loads (18 колонок)

pick_up_date_col1, commodity_col2, pickup_date_location_col3, delivery_date_location_col4, assigned_user_col5, gate_code_col6 (unique), rate_col7, rate_min, rate_max, is_bold, is_mcc, is_lock, font_size, status, note_mcc, comments, order_number, cell_formats (JSONB)

## Пользователи (seed при старте)

| Email | Password | Role |
|-------|----------|------|
| user1@bvb.local | password1 | user |
| user2@bvb.local | password2 | user |
| admin@bvb.local | admin123 | admin |

## Запуск

### Production
```powershell
docker compose up --build
# Frontend: http://localhost:8080
# Backend:  http://localhost:3001
# pgAdmin:  http://localhost:5050 (admin@example.com / admin123)
```

### Dev (hot-reload)
```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
# Frontend: http://localhost:5173 (Vite HMR)
# Backend:  http://localhost:3001 (air)
```

### Seed (если нужно пересоздать пользователей)
```powershell
docker run --rm --network=new-bvb-system_bvb-network -e PG_HOST=postgres -v .\backend:/app -w /app golang:1.26-alpine go run ./cmd/seed/
```

### Миграция данных из MySQL (старый проект)
```powershell
docker run --rm --network=new-bvb-system_bvb-network -e MYSQL_HOST=host.docker.internal -e MYSQL_PORT=3307 -e PG_HOST=postgres -v .\backend:/app -w /app golang:1.26-alpine go run ./cmd/migrate/
```

## Важные замечания

- `service-account.json` — в .gitignore, не коммитить!
- `backend/.env` и `frontend/.env` — не в git
- PostgreSQL volume `pgdata` — данные сохраняются между перезапусками
- Локальный PostgreSQL (Windows service) может конфликтовать на порту 5432 — остановить через `Stop-Service postgresql-x64-17`
- Go module name: `bvb-datatable`

## Что уже работает

- [x] Go backend: config, db, sheets sync, loads API, WebSocket, JWT auth
- [x] React frontend: авторизация, таблица с фильтрами/сортировкой/пагинацией, inline editing, WebSocket real-time обновления, online users
- [x] Google Sheets синхронизация (service account настроен)
- [x] Docker: production + dev режимы (hot-reload)
- [x] pgAdmin для просмотра БД
- [ ] Drag & drop reorder строк
- [ ] Cell formatting (bold/color/font-size)
- [ ] Cell focus whispers
- [ ] Tailwind CSS
