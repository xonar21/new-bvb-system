import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Load, WSMessage } from '../types/Load'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws'
const RECONNECT_DELAY = 2000

interface OnlineUser {
  user_id: number
  user_name: string
}

export function useWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queryClient = useQueryClient()
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [isConnected, setIsConnected] = useState(false)

  const connect = useCallback(() => {
    if (!token) return

    const ws = new WebSocket(`${WS_URL}?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data)

        switch (msg.type) {
          case 'load.updated': {
            const load = msg.payload as Load
            queryClient.setQueryData<Load[]>(['loads'], (old) =>
              old?.map((l) => (l.id === load.id ? load : l)) ?? [],
            )
            break
          }
          case 'load.created': {
            const load = msg.payload as Load
            queryClient.setQueryData<Load[]>(['loads'], (old) =>
              old ? [...old, load] : [load],
            )
            break
          }
          case 'load.deleted': {
            const { id } = msg.payload as { id: number }
            queryClient.setQueryData<Load[]>(['loads'], (old) =>
              old?.filter((l) => l.id !== id) ?? [],
            )
            break
          }
          case 'load.order-updated': {
            queryClient.invalidateQueries({ queryKey: ['loads'] })
            break
          }
          case 'presence': {
            const payload = msg.payload as { user_id: number; user_name?: string; online: boolean; count: number }
            setOnlineUsers((prev) => {
              if (payload.online) {
                const exists = prev.find((u) => u.user_id === payload.user_id)
                if (!exists) {
                  return [...prev, { user_id: payload.user_id, user_name: payload.user_name || `User ${payload.user_id}` }]
                }
                return prev
              }
              return prev.filter((u) => u.user_id !== payload.user_id)
            })
            break
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [token, queryClient])

  useEffect(() => {
    connect()

    return () => {
      clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { isConnected, onlineUsers }
}
