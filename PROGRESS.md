# BVB Freight — Live Datatable Migration Progress

## Статус выполнения

### Фаза 0: Инфраструктура проекта
- [x] **Task 0.1**: Создать структуру директорий проекта (backend/, frontend/, infra/)
- [x] **Task 0.2**: Docker Compose (PostgreSQL + Redis) + схема БД
- [x] **Task 0.3**: Go module init + загрузка зависимостей

### Фаза 1: Go Backend — Config & DB
- [x] **Task 1.1**: Пакет config (чтение env vars)
- [x] **Task 1.2**: Пакет db (pgxpool подключение + миграции)
- [x] **Task 1.3**: Пакет sheets (Google Sheets API клиент + sync worker)
- [x] **Task 1.4**: Пакет loads (model, repository, handler, validator, logic)
- [x] **Task 1.5**: Пакет ws (WebSocket Hub + Client + Messages)
- [x] **Task 1.6**: Пакет auth (JWT issue/verify + middleware)
- [x] **Task 1.7**: Пакет users (model, repository, handler)
- [x] **Task 1.8**: main.go — сборка всего вместе

### Фаза 2: React Frontend
- [x] **Task 2.1**: Vite + React + TS инициализация + зависимости
- [x] **Task 2.2**: Types, API client, env config
- [ ] **Task 2.3**: Hooks (useLoads — TanStack Query, useWebSocket — native WS)
- [ ] **Task 2.4**: Stores (authStore, wsStore — Zustand)
- [ ] **Task 2.5**: Компоненты (LiveDatatable, LoadRow, LoadCell, columns, OnlineUsersBar)
- [ ] **Task 2.6**: Интеграция (App.tsx, main.tsx, роутинг, логин)

### Фаза 3: Деплой
- [x] **Task 3.1**: Nginx reverse proxy config (для frontend)
- [x] **Task 3.2**: Dockerfile для Go сервиса и React
- [x] **Task 3.3**: .env примеры + Docker dev mode (air + Vite HMR)

---

## Legend
- [ ] — не сделано
- [x] — сделано
- 🔄 — в процессе

---

## Что сделано
- Полностью Go backend: структура пакетов, config, db, sheets sync, loads API, WebSocket hub, JWT auth
- Frontend инициализирован: Vite + React 19 + TS + зависимости установлены
