#!/bin/bash
# BVB Freight — Dev mode startup script (Linux/macOS)
# Останавливает старые контейнеры, удаляет volumes и запускает dev-режим с polling

docker compose down --volumes 2>/dev/null || true
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
