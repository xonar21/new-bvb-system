# План реализации: Live-Datatable на Go + React + PostgreSQL
**Проект:** BVB Freight — Live Datatable  
**Статус:** Новый НЕЗАВИСИМЫЙ проект (не связан с Laravel)  
**Дата:** 2026-05-04

---

## ⚠️ КРИТИЧЕСКОЕ ПОНИМАНИЕ

**Новый проект НЕ использует Laravel API, НЕ использует MySQL, НЕ зависит от текущей системы.**

```
❌ НЕПРАВИЛЬНО:
React → Go → Laravel API → MySQL
(зависимость от другого проекта)

✅ ПРАВИЛЬНО:
Go → Google Sheets (читает напрямую)
React → Go API (только отсюда данные)
Go → PostgreSQL (свою базу)

Оба проекта работают независимо.
```

**Laravel SyncLoads используется ТОЛЬКО как пример логики синхронизации.**  
**Реально Google Sheets синхронизирует Go, не Laravel.**

---

## 1. АРХИТЕКТУРА: ПОЛНАЯ НЕЗАВИСИМОСТЬ

```
BVB FREIGHT СИСТЕМА v2 (НОВЫЙ ПРОЕКТ)
══════════════════════════════════════════════════════════════════════════

┌────────────────────────────────────────────────────────────────────┐
│ Google Sheets "AB LOADS"  (публичный источник данных)              │
│ ├─ Юзер заполняет вручную                                          │
│ ├─ Колонки: Date, Commodity, Pickup, Delivery, Ref#, GateCode...   │
│ └─ Читается API v4 (публичный доступ)                              │
└────────────┬─────────────────────────────────────────────────────┘
             │
             │ Google Sheets API (google-api-python-client или Go library)
             │
             ▼
┌────────────────────────────────────────────────────────────────────┐
│ Go Service (НОВЫЙ ПРОЕКТ)                                          │
│ ├─ SyncWorker (goroutine): каждые N минут читает Google Sheets     │
│ │  └─ Логика из Laravel SyncLoads.php (но на Go)                   │
│ │     ├─ Нормализация gate_code (ltrim leading zeros)              │
│ │     ├─ Проверка зелёных rows (#93c47d)                          │
│ │     ├─ Вычисление rate_min/rate_max по rate interval таблице     │
│ │     ├─ Detect MCC loads (notes содержит 'mcc cans/bottles')      │
│ │     └─ Batch insert/update в PostgreSQL                          │
│ │                                                                   │
│ ├─ REST API (Fiber):                                               │
│ │  ├─ GET /api/loads — список с фильтрами                          │
│ │  ├─ PUT /api/loads/{id} — обновить                               │
│ │  ├─ DELETE /api/loads/{id} — удалить                             │
│ │  └─ POST /api/loads/bulk-order — переупорядочивание              │
│ │                                                                   │
│ ├─ WebSocket Hub (/ws):                                            │
│ │  ├─ Broadcast load.created/updated/deleted                       │
│ │  ├─ Presence (online users)                                      │
│ │  └─ Cell focus/blur whispers                                     │
│ │                                                                   │
│ └─ Auth: JWT verify (Redis кэш токенов)                            │
└────────────┬─────────────────────────────────────────────────────┘
             │
             │ PostgreSQL (свой, отдельный)
             │
             ▼
┌────────────────────────────────────────────────────────────────────┐
│ PostgreSQL (БД ПРОЕКТА)                                             │
│ ├─ loads (18 колонок, перенесены из MySQL через Sheets синхронизацию) │
│ ├─ users (auth)                                                     │
│ └─ Индексы для скорости                                            │
└────────────┬─────────────────────────────────────────────────────┘
             │
             │ JSON REST + WebSocket
             │
             ▼
┌────────────────────────────────────────────────────────────────────┐
│ React Frontend (НОВЫЙ ПРОЕКТ)                                      │
│ ├─ TanStack Table (виртуализация)                                   │
│ ├─ TanStack Query (optimistic updates)                              │
│ ├─ Zustand (state)                                                  │
│ └─ Native WebSocket (real-time)                                     │
└────────────────────────────────────────────────────────────────────┘


СТАРЫЙ ПРОЕКТ (ОСТАЁТСЯ ОТДЕЛЬНО)
═════════════════════════════════════════════════════════════════════

Laravel (MySQL)
├─ Email AI negotiate
├─ EDI/AS2 messages
├─ Budex/MCC sync
└─ НЕ ТРОГАЕМ, не зависим от этого
```

---

## 2. ДАННЫЕ: ОТКУДА БЕРУТ?

### Go Service читает Google Sheets НАПРЯМУЮ

**Laravel способ (для примера логики):**
```php
// app/Console/Commands/SyncLoads.php
$service = new Sheets($client);
$response = $service->spreadsheets->get($spreadsheetId, [
    'ranges' => [$range],
    'includeGridData' => true,
]);
```

**Go способ (новый проект):**
```go
// internal/sync/sheets.go
import "google.golang.org/api/sheets/v4"

func (s *SheetsSync) FetchLoads(ctx context.Context) ([]RawLoad, error) {
    service, _ := sheets.NewService(ctx, option.WithCredentialsFile(keyPath))
    spreadsheet, _ := service.Spreadsheets.Get(sheetID).Do()
    
    // Читаем диапазон A2:I1000
    valueRange, _ := service.Spreadsheets.Values.Get(sheetID, "AB LOADS!A2:I1000").Do()
    
    // Парсим значения в структуры
    var loads []RawLoad
    for _, row := range valueRange.Values {
        loads = append(loads, parseRow(row))
    }
    return loads, nil
}
```

**Ключевой момент:** Go НЕ спрашивает Laravel, читает Sheets сам.

### Каждый раз синхронизация:

```go
// cmd/server/main.go
go func() {
    ticker := time.NewTicker(15 * time.Minute) // каждые 15 минут
    for range ticker.C {
        loads, _ := sheetsSync.FetchLoads(ctx)
        for _, load := range loads {
            // Нормализация (логика из SyncLoads.php)
            normalized := normalizeGateCode(load.GateCode)  // ltrim zeros
            isMCC := detectMCC(load.Notes)  // 'mcc cans' или 'mcc bottles'?
            rateMin, rateMax := calculateRateInterval(load.Rate)
            
            // Upsert в PostgreSQL
            db.UpsertLoad(ctx, Load{
                GateCode: normalized,
                Rate: load.Rate,
                RateMin: rateMin,
                RateMax: rateMax,
                IsMCC: isMCC,
                // ... остальные поля
            })
        }
    }
}()
```

---

## 3. БД: НОВАЯ POSTGRESQL

### 3.1 Создание БД (первый раз)

```bash
# Поднять PostgreSQL
docker run -d \
  --name bvb-postgres \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=bvb_datatable \
  -p 5432:5432 \
  postgres:16-alpine

# Создать схему (SQL ниже)
psql postgresql://postgres:secret@localhost/bvb_datatable < schema.sql
```

### 3.2 Схема PostgreSQL (новая БД)

```sql
-- Таблица loads (18 колонок из Sheets)
CREATE TABLE loads (
    id                          BIGSERIAL PRIMARY KEY,
    pick_up_date_col1           DATE,
    commodity_col2              VARCHAR(255),
    pickup_date_location_col3   VARCHAR(255),
    delivery_date_location_col4 VARCHAR(255),
    assigned_user_col5          VARCHAR(255),
    gate_code_col6              VARCHAR(255) NOT NULL UNIQUE,
    rate_col7                   INTEGER,
    rate_min                    INTEGER,
    rate_max                    INTEGER,
    is_bold                     BOOLEAN DEFAULT FALSE,
    is_mcc                      BOOLEAN DEFAULT FALSE,
    is_lock                     BOOLEAN DEFAULT FALSE,
    font_size                   INTEGER,
    status                      VARCHAR(100),
    note_mcc                    TEXT,
    comments                    TEXT,
    order_number                INTEGER,
    cell_formats                JSONB,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_loads_pick_up_date ON loads(pick_up_date_col1);
CREATE INDEX idx_loads_status ON loads(status);
CREATE INDEX idx_loads_gate_code ON loads(gate_code_col6);
CREATE INDEX idx_loads_is_mcc ON loads(is_mcc);
CREATE INDEX idx_loads_is_bold ON loads(is_bold);
CREATE INDEX idx_loads_is_lock ON loads(is_lock);

-- Таблица users (для auth)
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    role            VARCHAR(50) DEFAULT 'user',
    is_blocked      BOOLEAN DEFAULT FALSE,
    last_active_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- Вставить юзеров (для тестирования)
INSERT INTO users (email, password_hash, name) VALUES
    ('user1@bvb.local', 'hash...', 'User One'),
    ('user2@bvb.local', 'hash...', 'User Two');
```

**Важно:** это НОВАЯ БД, не восстановленная из MySQL.  
**Данные заполняются через Go SheetsSync, не копируются из Laravel.**

---

## 4. GO SERVICE — ПОЛНАЯ РЕАЛИЗАЦИЯ

### 4.1 Структура проекта

```
bvb-go-datatable/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── config/
│   │   └── config.go          # env vars
│   ├── db/
│   │   ├── postgres.go         # pgxpool
│   │   └── migrations.go       # schema создание
│   ├── sheets/
│   │   ├── client.go           # Google Sheets API
│   │   ├── sync.go             # SheetsSync worker
│   │   └── models.go           # RawLoad struct
│   ├── auth/
│   │   ├── jwt.go              # JWT issue/verify
│   │   └── middleware.go       # Auth middleware
│   ├── loads/
│   │   ├── model.go            # Load struct
│   │   ├── repository.go       # DB operations
│   │   ├── handler.go          # HTTP handlers
│   │   ├── validator.go        # validation
│   │   └── logic.go            # нормализация, rate_interval
│   ├── users/
│   │   ├── model.go
│   │   ├── repository.go
│   │   └── handler.go
│   └── ws/
│       ├── hub.go              # WebSocket Hub
│       ├── client.go           # Client struct
│       └── messages.go         # Message types
├── go.mod
├── go.sum
├── .env                        # (не в git!)
└── Dockerfile
```

### 4.2 main.go

```go
package main

import (
    "context"
    "log"
    "time"
    
    "bvb-datatable/internal/config"
    "bvb-datatable/internal/db"
    "bvb-datatable/internal/sheets"
    "bvb-datatable/internal/ws"
    "bvb-datatable/internal/loads"
    "bvb-datatable/internal/auth"
    
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/cors"
)

func main() {
    cfg := config.Load()
    
    // PostgreSQL подключение
    pgPool, err := db.NewPostgres(cfg.PostgresDSN)
    if err != nil {
        log.Fatal("DB connect failed:", err)
    }
    defer pgPool.Close()
    
    // Создать схему если не существует
    db.Migrate(pgPool)
    
    // Google Sheets синхронизация (работает в фоне)
    sheetsClient := sheets.NewClient(cfg.GoogleServiceAccount)
    sheetSync := sheets.NewSync(sheetsClient, pgPool, cfg.GoogleSheetID)
    
    // Запустить синхронизацию каждые 15 минут
    go func() {
        ticker := time.NewTicker(15 * time.Minute)
        defer ticker.Stop()
        
        // Первый раз синхронизируем сразу
        if err := sheetSync.Sync(context.Background()); err != nil {
            log.Println("Initial sync failed:", err)
        }
        
        // Потом каждые 15 минут
        for range ticker.C {
            if err := sheetSync.Sync(context.Background()); err != nil {
                log.Println("Sync error:", err)
            }
        }
    }()
    
    // WebSocket Hub
    wsHub := ws.NewHub()
    go wsHub.Run()
    
    // Fiber приложение
    app := fiber.New()
    
    // CORS
    app.Use(cors.New(cors.Config{
        AllowOrigins: cfg.CORSOrigins,
        AllowHeaders: "Content-Type,Authorization",
    }))
    
    // Auth middleware
    authMW := auth.NewMiddleware(cfg.JWTSecret)
    
    // Repository & Handlers
    loadsRepo := loads.NewRepository(pgPool)
    loadsHandler := loads.NewHandler(loadsRepo, wsHub)
    
    // Роуты
    api := app.Group("/api")
    loadsHandler.RegisterRoutes(api, authMW)
    
    // WebSocket
    app.Get("/ws", func(c *fiber.Ctx) error {
        return ws.HandleWS(c, wsHub)
    })
    
    // Auth endpoint
    userRepo := users.NewRepository(pgPool)
    authHandler := auth.NewHandler(userRepo, cfg.JWTSecret)
    app.Post("/api/auth/login", authHandler.Login)
    
    log.Printf("🚀 Server starting on :%s", cfg.Port)
    app.Listen(":" + cfg.Port)
}
```

### 4.3 Google Sheets Sync (как SyncLoads.php но на Go)

```go
// internal/sheets/sync.go

type SheetsSync struct {
    client  *sheets.Service
    db      *pgxpool.Pool
    sheetID string
}

func (s *SheetsSync) Sync(ctx context.Context) error {
    // 1. Читаем Google Sheets
    rows, err := s.fetchRows(ctx)
    if err != nil {
        return err
    }
    
    // 2. Парсим строки
    var loads []RawLoad
    for _, row := range rows {
        load := s.parseRow(row)
        if load == nil {
            continue // empty row или past-dated
        }
        loads = append(loads, *load)
    }
    
    // 3. Трансформируем (нормализация, rate_interval и т.д.)
    for i, load := range loads {
        // Нормализация gate_code (убрать ведущие нули)
        loads[i].GateCode = strings.TrimLeft(load.GateCode, "0")
        
        // Detect MCC
        loads[i].IsMCC = strings.Contains(
            strings.ToLower(load.Notes),
            "mcc cans") || strings.Contains(
            strings.ToLower(load.Notes),
            "mcc bottles")
        
        // Rate interval
        loads[i].RateMin, loads[i].RateMax = s.getRateInterval(load.Rate)
        
        // Hot flag
        loads[i].IsBold = strings.ToUpper(load.Hot) == "HOT"
    }
    
    // 4. Batch upsert в PostgreSQL
    err = s.batchUpsert(ctx, loads)
    return err
}

func (s *SheetsSync) batchUpsert(ctx context.Context, loads []RawLoad) error {
    batch := &pgx.Batch{}
    
    for _, load := range loads {
        batch.Queue(`
            INSERT INTO loads (
                pick_up_date_col1, commodity_col2, pickup_date_location_col3,
                delivery_date_location_col4, assigned_user_col5, gate_code_col6,
                rate_col7, rate_min, rate_max, is_bold, is_mcc, note_mcc,
                created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
            ON CONFLICT (gate_code_col6) DO UPDATE SET
                pick_up_date_col1 = $1,
                commodity_col2 = $2,
                rate_min = $8,
                rate_max = $9,
                is_bold = $10,
                is_mcc = $11,
                updated_at = NOW()
            WHERE loads.is_lock = false
        `,
            load.PickUpDate, load.Commodity, load.PickupLocation,
            load.DeliveryLocation, load.AssignedUser, load.GateCode,
            load.Rate, load.RateMin, load.RateMax, load.IsBold,
            load.IsMCC, load.Notes)
    }
    
    results := s.db.SendBatch(ctx, batch)
    defer results.Close()
    
    for i := 0; i < batch.Len(); i++ {
        _, err := results.Exec()
        if err != nil {
            return err
        }
    }
    
    return results.Close()
}

func (s *SheetsSync) getRateInterval(rate int) (int, int) {
    switch {
    case rate <= 799:
        return rate + 50, rate + 50
    case rate <= 1199:
        return rate + 50, rate + 100
    case rate <= 1799:
        return rate + 100, rate + 150
    case rate <= 2399:
        return rate + 100, rate + 200
    case rate <= 2999:
        return rate + 150, rate + 250
    default:
        return rate + 200, rate + 300
    }
}
```

### 4.4 REST API Handler (Fiber)

```go
// internal/loads/handler.go

type Handler struct {
    repo *Repository
    hub  *ws.Hub
}

func (h *Handler) RegisterRoutes(api *fiber.Router, auth fiber.Handler) {
    loads := api.Group("/loads", auth)
    
    loads.Get("/",           h.Index)          // список
    loads.Post("/",          h.Store)          // создать
    loads.Get("/:id",        h.Show)           // получить
    loads.Put("/:id",        h.Update)         // обновить
    loads.Delete("/:id",     h.Delete)         // удалить
    loads.Post("/bulk-order", h.BulkOrder)     // переупорядочение
}

// Index: GET /api/loads?date_from=2026-05-01&status=active
func (h *Handler) Index(c *fiber.Ctx) error {
    filters := &Filters{
        DateFrom: c.Query("date_from"),
        DateTo:   c.Query("date_to"),
        Status:   c.Query("status"),
        GateCode: c.Query("gate_code"),
    }
    
    loads, err := h.repo.List(c.Context(), filters)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": err.Error()})
    }
    
    return c.JSON(fiber.Map{"loads": loads})
}

// Update: PUT /api/loads/{id}
// 🚀 ОПТИМИСТИЧНЫЙ ПАТТЕРН
func (h *Handler) Update(c *fiber.Ctx) error {
    id, _ := strconv.ParseInt(c.Params("id"), 10, 64)
    userID := c.Locals("user_id").(int64)
    
    var req UpdateRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": err.Error()})
    }
    
    // 1. Обновляем в БД
    load, err := h.repo.Update(c.Context(), id, req)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": err.Error()})
    }
    
    // 2. Отправляем ответ (БЫСТРО)
    resp := fiber.Map{"load": load}
    
    // 3. Broadcast в фоне (горутина, не блокирует)
    go h.hub.BroadcastToOthers(userID, ws.WSMessage{
        Type:    "load.updated",
        Payload: load,
    })
    
    return c.JSON(resp)
}
```

### 4.5 WebSocket Hub

```go
// internal/ws/hub.go

type Hub struct {
    clients    map[*Client]bool
    broadcast  chan []byte
    toOthers   chan BroadcastMsg
    register   chan *Client
    unregister chan *Client
    mu         sync.RWMutex
}

func (h *Hub) Run() {
    for {
        select {
        case client := <-h.register:
            h.clients[client] = true
            h.broadcastOnlineUsers()
            
        case client := <-h.unregister:
            delete(h.clients, client)
            close(client.send)
            h.broadcastOnlineUsers()
            
        case msg := <-h.broadcast:
            for client := range h.clients {
                select {
                case client.send <- msg:
                default:
                    close(client.send)
                    delete(h.clients, client)
                }
            }
            
        case bmsg := <-h.toOthers:
            for client := range h.clients {
                if client.userID != bmsg.senderID {
                    select {
                    case client.send <- bmsg.data:
                    default:
                        close(client.send)
                        delete(h.clients, client)
                    }
                }
            }
        }
    }
}
```

---

## 5. REACT FRONTEND — НЕЗАВИСИМЫЙ НОВЫЙ ПРОЕКТ

### 5.1 Структура

```
bvb-react-datatable/
├── src/
│   ├── api/
│   │   └── client.ts           # fetch wrapper
│   ├── store/
│   │   ├── authStore.ts        # Zustand
│   │   └── wsStore.ts
│   ├── hooks/
│   │   ├── useLoads.ts         # TanStack Query
│   │   └── useWebSocket.ts     # native WS
│   ├── types/
│   │   └── Load.ts
│   ├── features/
│   │   └── LiveDatatable/
│   │       ├── LiveDatatable.tsx
│   │       ├── LoadRow.tsx
│   │       ├── LoadCell.tsx
│   │       └── columns.ts
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── vite.config.ts
└── .env                        # VITE_API_URL=http://localhost:3001
```

### 5.2 useLoads Hook (TanStack Query + Optimistic)

```typescript
// src/hooks/useLoads.ts

export function useUpdateLoad() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<Load> }) =>
            apiClient.put<Load>(`/api/loads/${id}`, data),

        // 🚀 OPTIMISTIC UPDATE
        onMutate: async ({ id, data }) => {
            // Отменяем ongoing запросы
            await queryClient.cancelQueries({ queryKey: ['loads'] });

            // Сохраняем старое состояние
            const prev = queryClient.getQueryData<Load[]>(['loads']);

            // СРАЗУ обновляем UI локально (0ms)
            queryClient.setQueryData<Load[]>(['loads'], (old) =>
                old?.map(l => l.id === id ? { ...l, ...data } : l) ?? []
            );

            return { prev };
        },

        // При ошибке откатываем
        onError: (err, vars, ctx) => {
            queryClient.setQueryData(['loads'], ctx?.prev);
        },
    });
}
```

### 5.3 WebSocket (native, не Echo/Pusher)

```typescript
// src/hooks/useWebSocket.ts

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001/ws';

export function useWebSocket() {
    const ws = useRef<WebSocket | null>(null);
    const { token } = useAuthStore();
    const queryClient = useQueryClient();

    const connect = useCallback(() => {
        if (!token) return;

        ws.current = new WebSocket(`${WS_URL}?token=${token}`);

        ws.current.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            
            switch (msg.type) {
                case 'load.updated':
                    // Синхронизировать с сервером
                    queryClient.setQueryData<Load[]>(['loads'], (old) =>
                        old?.map(l => l.id === msg.payload.id ? msg.payload : l) ?? []
                    );
                    break;
                    
                case 'load.created':
                    queryClient.setQueryData<Load[]>(['loads'], (old) =>
                        old ? [...old, msg.payload] : [msg.payload]
                    );
                    break;
                    
                case 'load.deleted':
                    queryClient.setQueryData<Load[]>(['loads'], (old) =>
                        old?.filter(l => l.id !== msg.payload.id) ?? []
                    );
                    break;
            }
        };

        ws.current.onclose = () => {
            setTimeout(connect, 2000); // Авто-реконнект
        };
    }, [token, queryClient]);

    useEffect(() => {
        connect();
        return () => ws.current?.close();
    }, [connect]);

    return ws.current;
}
```

---

## 6. ФАЗЫ РАЗРАБОТКИ (НЕЗАВИСИМЫЙ ПРОЕКТ)

### Фаза 1: Инфра (1 день)

- [ ] Docker Compose: PostgreSQL + Redis (опционально)
- [ ] Создать схему PostgreSQL (sql скрипт)
- [ ] Проверить подключение: `psql postgresql://...`
- [ ] Google service account JSON ключ (скачать из Google Cloud)
- [ ] Проверить доступ к Google Sheets API

### Фаза 2: Go Backend (3-4 дня)

- [ ] `go mod init bvb-datatable`
- [ ] Зависимости: fiber, pgx, google-api-go-client, websocket
- [ ] Config: env vars читаются (PORT, PG_DSN, GOOGLE_SHEET_ID и т.д.)
- [ ] DB: PostgreSQL подключение, schema создание
- [ ] Sheets: Google API клиент, первая синхронизация
- [ ] Sync worker: горутина, читает Sheets каждые 15 минут
- [ ] Loads repo: List, Get, Create, Update, Delete, BulkOrder
- [ ] Fiber handlers: GET /api/loads, PUT /api/loads/{id}, DELETE и т.д.
- [ ] WebSocket: Hub, client registration, broadcast
- [ ] Auth: JWT issue (POST /api/auth/login), verify middleware
- [ ] Тесты: curl запросы на все endpoints
- [ ] Measure: response time должен быть <5ms ✅

### Фаза 3: React Frontend (3-4 дня)

- [ ] `npm create vite ... --template react-ts`
- [ ] Зависимости: @tanstack/react-table, @tanstack/react-query, zustand
- [ ] Types: Load.ts (18 полей), User, WebSocket messages
- [ ] API client: fetch wrapper с auth token
- [ ] Hooks: useLoads (TanStack Query), useWebSocket (native WS)
- [ ] Stores: authStore (Zustand), wsStore
- [ ] Components: LiveDatatable, LoadRow, LoadCell, OnlineUsersBar
- [ ] Columns: 9 колонок TanStack Table
- [ ] Features: cell edit (debounce 600ms), drag-reorder, cell focus whispers
- [ ] Styling: Tailwind CSS
- [ ] Integration test: 2 браузера, одновременное редактирование → изменения видны

### Фаза 4: Деплой (1 день)

- [ ] Nginx reverse proxy (Go API + React)
- [ ] systemd сервис для Go
- [ ] .env файлы (не в git)
- [ ] Docker / Kubernetes (опционально)
- [ ] Нагрузочный тест: 50 concurrent WS соединений
- [ ] Latency check: <10ms ощущаемая ✅

---

## 7. КРИТИЧЕСКИЕ ОТЛИЧИЯ ОТ СТАРОГО ПРОЕКТА

| Аспект | Старый (Laravel) | Новый (Go) |
|--------|------------------|-----------|
| **БД** | MySQL | PostgreSQL (новая) |
| **Sheets sync** | Laravel SyncLoads.php | Go SheetsSync.go |
| **API** | Laravel Eloquent REST | Go pgx + Fiber |
| **WebSocket** | Laravel Reverb + Echo | Go Hub goroutines |
| **Auth** | Laravel token in MySQL | JWT verify + Redis cache |
| **Frontend** | Vue + Pinia + Echo | React + TanStack Query + native WS |
| **Depends on** | Laravel ничего не знает о новом проекте | Новый проект ничего не знает о Laravel |
| **Data source** | Google Sheets | Google Sheets (то же, но читает Go) |

**Главное:** нет никакой интеграции между проектами. Два независимых стека.

---

## 8. .env файлы (ПРИМЕРЫ)

### Go (.env)

```env
PORT=3001
PG_HOST=localhost
PG_PORT=5432
PG_DB=bvb_datatable
PG_USER=postgres
PG_PASSWORD=secret
PG_SSLMODE=disable

GOOGLE_SHEET_ID=1x2x3x4x5x...
GOOGLE_SERVICE_ACCOUNT=/path/to/service-account.json

JWT_SECRET=super_secret_key_change_in_prod

CORS_ORIGINS=http://localhost:5173,https://app.example.com
```

### React (.env)

```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001/ws
```

---

## 9. ОЖИДАЕМЫЕ РЕЗУЛЬТАТЫ

| Метрика | Значение |
|---------|----------|
| HTTP response | <5ms ✅ |
| WebSocket broadcast | <5ms ✅ |
| UI feels instant | Да (optimistic) ✅ |
| 50 concurrent users | Легко ✅ |
| Data sync (Sheets) | Каждые 15 минут ✅ |
| Depends on Laravel | НЕТ ✅ |

---

## 10. ПОРЯДОК ЗАПУСКА

1. **Docker:** `docker-compose up -d` (PostgreSQL)
2. **Go:** `go run cmd/server/main.go`
3. **React:** `npm run dev`
4. **Open:** http://localhost:5173
5. **Login:** email/password (из seed данных)
6. **Редактируй:** таблица работает независимо

---

## ⚠️ ОСНОВНОЙ МОМЕНТ

**Новый проект НЕ общается с Laravel.**
- Google Sheets читает Go, не Laravel
- PostgreSQL новая, не восстановленная из MySQL
- React говорит только с Go API
- Laravel может работать параллельно, но это отдельная система

**Использование Laravel кода:**
- Только как ПРИМЕР логики (normalizeGateCode, getRateInterval и т.д.)
- Реально переписано на Go с тем же функционалом

**Результат:** полностью независимый, быстрый, чистый проект.

