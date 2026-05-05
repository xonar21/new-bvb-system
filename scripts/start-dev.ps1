# BVB Freight — Dev mode startup script (Windows)
# Останавливает старые контейнеры, удаляет volumes и запускает dev-режим с polling

docker compose down --volumes 2>$null
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
