# BVB Freight — Live Datatable Migration Progress

## Статус выполнения

### Фаза 0: Инфраструктура проекта
- [ ] **Task 0.1**: Создать структуру директорий проекта (backend/, frontend/, infra/)
- [ ] **Task 0.2**: Docker Compose (PostgreSQL + Redis) + схема БД
- [ ] **Task 0.3**: Go module init + загрузка зависимостей

### Фаза 1: Go Backend — Config & DB
- [ ] **Task 1.1**: Пакет config (чтение env vars)
- [ ] **Task 1.2**: Пакет db (pgxpool подключение + миграции)
- [ ] **Task 1.3**: Пакет sheets (Google Sheets API клиент + sync worker)
- [ ] **Task 1.4**: Пакет loads (model, repository, handler, validator, logic)
- [ ] **Task 1.5**: Пакет ws (WebSocket Hub + Client + Messages)
- [ ] **Task 1.6**: Пакет auth (JWT issue/verify + middleware)
- [ ] **Task 1.7**: Пакет users (model, repository, handler)
- [ ] **Task 1.8**: main.go — сборка всего вместе

### Фаза 2: React Frontend
- [ ] **Task 2.1**: Vite + React + TS инициализация + зависимости
- [ ] **Task 2.2**: Types, API client, env config
- [ ] **Task 2.3**: Hooks (useLoads — TanStack Query, useWebSocket — native WS)
- [ ] **Task 2.4**: Stores (authStore, wsStore — Zustand)
- [ ] **Task 2.5**: Компоненты (LiveDatatable, LoadRow, LoadCell, columns, OnlineUsersBar)
- [ ] **Task 2.6**: Интеграция (App.tsx, main.tsx, роутинг, логин)

### Фаза 3: Деплой
- [ ] **Task 3.1**: Nginx reverse proxy config
- [ ] **Task 3.2**: Dockerfile для Go сервиса
- [ ] **Task 3.3**: .env примеры

---

## Legend
- [ ] — не сделано
- [x] — сделано
- 🔄 — в процессе
