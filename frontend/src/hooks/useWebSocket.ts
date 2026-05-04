import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWSStore } from '../store/wsStore'
import type { CellFocusPayload, Load, WSMessage } from '../types/Load'

const WS_URL = import.meta.env.VITE_WS_URL || '/ws'
const RECONNECT_DELAY = 2000
const MAX_RECONNECT_ATTEMPTS = 5
const CONNECT_TIMEOUT = 5000

export function useWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)
  const attemptRef = useRef(0)
  const queryClient = useQueryClient()
  const {
    setConnected,
    setOnlineUsers,
    setSendMessage,
    setCellFocus,
    removeCellFocus,
    clearOfflineUserFocuses,
  } = useWSStore()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!token) return

    attemptRef.current = 0

    function connect() {
      if (!mountedRef.current) return
      if (wsRef.current?.readyState === WebSocket.OPEN) return

      attemptRef.current++

      const ws = new WebSocket(`${WS_URL}?token=${token}`)
      wsRef.current = ws

      const connectTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      }, CONNECT_TIMEOUT)

      ws.onopen = () => {
        clearTimeout(connectTimeout)
        if (!mountedRef.current) { ws.close(); return }
        attemptRef.current = 0
        setConnected(true)
        setSendMessage((data: string) => { ws.send(data) })
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const msg: WSMessage = JSON.parse(event.data)

          switch (msg.type) {
            case 'load.updated': {
              const load = msg.payload as Load
              queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) =>
                old?.map((l) => (l.id === load.id ? load : l)) ?? [],
              )
              break
            }
            case 'load.created': {
              const load = msg.payload as Load
              queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) =>
                old ? [...old, load] : [load],
              )
              break
            }
            case 'load.deleted': {
              const { id } = msg.payload as { id: number }
              queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) =>
                old?.filter((l) => l.id !== id) ?? [],
              )
              break
            }
            case 'load.order-updated': {
              queryClient.invalidateQueries({ queryKey: ['loads'] })
              break
            }
            case 'cell.focus': {
              const p = msg.payload as CellFocusPayload
              if (p.action === 'focus' || p.action === 'editing') {
                setCellFocus({
                  user_id: p.user_id!,
                  user_name: p.user_name || `User ${p.user_id}`,
                  load_id: p.load_id,
                  field: p.field,
                  editing: p.action === 'editing',
                })
              } else if (p.action === 'blur') {
                removeCellFocus(p.load_id, p.field)
              }
              break
            }

            case 'presence': {
              const payload = msg.payload as { users: { user_id: number; user_name: string }[]; count: number }
              setOnlineUsers(payload.users.map(u => ({
                user_id: u.user_id,
                user_name: u.user_name || `User ${u.user_id}`,
              })))
              clearOfflineUserFocuses(new Set(payload.users.map(u => u.user_id)))
              break
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onclose = () => {
        clearTimeout(connectTimeout)
        if (!mountedRef.current) return
        setConnected(false)
        setSendMessage(null)
        wsRef.current = null

        if (attemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectRef.current = setTimeout(connect, RECONNECT_DELAY)
        }
      }

      ws.onerror = () => {
        clearTimeout(connectTimeout)
        ws.close()
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.onmessage = null
        wsRef.current.onopen = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [token, queryClient, setConnected, setOnlineUsers, setSendMessage, setCellFocus, removeCellFocus, clearOfflineUserFocuses])
}
