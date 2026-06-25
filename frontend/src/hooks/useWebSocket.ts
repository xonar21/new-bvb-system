import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWSStore } from '../store/wsStore'
import { useAuthStore } from '../store/authStore'
import { useTableLayoutStore } from '../store/tableLayoutStore'
import { useCellStore, COLUMN_TO_FIELD } from '../store/cellStore'
import type { CellFocusPayload, CellUpdateWSPayload, CellBulkUpdateWSPayload, LayoutColumnWidthChanged, LayoutLockAcquired, LayoutLockReleased, LayoutRowHeightChanged, Load, LockInfo, WSMessage } from '../types/Load'

// Reverse map: DB field name → column id  (e.g. "pick_up_date_col1" → "pick_up_date")
const FIELD_TO_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_TO_FIELD).map(([col, field]) => [field, col]),
)

const WS_URL = import.meta.env.VITE_WS_URL || (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('http', 'ws') + '/ws' : '/ws')
// Reconnect delays: first retry almost instant, then exponential back-off.
const BASE_RECONNECT_DELAY = 300
const MAX_RECONNECT_DELAY = 8000
const CONNECT_TIMEOUT = 5000

export function useWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)
  const attemptRef = useRef(0)
  const queryClient = useQueryClient()

  // Grab stable store actions once — Zustand guarantees these are stable references.
  const {
    setConnected,
    setOnlineUsers,
    setSendMessage,
    setCellFocus,
    removeCellFocus,
    clearOfflineUserFocuses,
    applyFocusSnapshot,
    requestFullRefresh,
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
        const wasReconnect = attemptRef.current > 1
        attemptRef.current = 0
        setConnected(true)
        setSendMessage((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data)
          }
        })
        // After a reconnect, data may have changed while we were offline — do a
        // full fetch AND signal LuckysheetBoard to rebuild the sheet from fresh data.
        if (wasReconnect) {
          queryClient.invalidateQueries({ queryKey: ['loads'] })
          requestFullRefresh()
        }
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const msg: WSMessage = JSON.parse(event.data)

          switch (msg.type) {
            case 'load.updated': {
              const load = msg.payload as Load
              // Update TanStack cache (keeps sort/filter working).
              queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) => {
                if (!old) return old
                return old.map((l) => (l.id === load.id ? { ...l, ...load } : l))
              })
              // Also patch cellStore so cells that read from it see the fresh values
              // without a full table rebuild (e.g. after Google Sheets sync).
              useCellStore.getState().patchFromLoad(load)
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
              useCellStore.getState().removeRow(id)
              break
            }

            case 'load.order-updated': {
              queryClient.invalidateQueries({ queryKey: ['loads'] })
              break
            }

            case 'cell.focus': {
              const p = msg.payload as CellFocusPayload
              const myId = useAuthStore.getState().user?.id
              // Skip echoes of our own focus messages — we track our own focus locally
              // (in myFocusRef / optimistic setCellFocus) and don't need the server echo.
              // Without this filter, each cell click triggers: send → echo → setCellFocus
              // → wsStore update → LuckysheetBoard re-render → Workbook re-render → flash.
              if (myId && p.user_id === myId) break
              if (p.action === 'focus' || p.action === 'editing') {
                setCellFocus({
                  user_id: p.user_id!,
                  user_name: p.user_name || `User ${p.user_id}`,
                  color: p.color || '#4a90d9',
                  load_id: p.load_id,
                  field: p.field,
                  editing: p.action === 'editing',
                })
              } else if (p.action === 'blur') {
                removeCellFocus(p.load_id, p.field)
              }
              break
            }

            // focus.snapshot is sent to a newly connected client so it immediately
            // knows which cells other users already have focused — no page refresh needed.
            case 'focus.snapshot': {
              const payload = msg.payload as { focuses: CellFocusPayload[] }
              if (payload?.focuses?.length) {
                applyFocusSnapshot(payload.focuses)
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

            case 'ip.restriction-changed': {
              queryClient.invalidateQueries({ queryKey: ['ip-check'] })
              break
            }

            case 'layout.column-width-changed': {
              const p = msg.payload as LayoutColumnWidthChanged
              useTableLayoutStore.getState().updateColumnWidth(p.column_name, p.width)
              break
            }

            case 'layout.row-height-changed': {
              const p = msg.payload as LayoutRowHeightChanged
              useTableLayoutStore.getState().updateRowHeight(Number(p.row_index), p.height)
              break
            }

            case 'layout.lock-acquired': {
              const p = msg.payload as LayoutLockAcquired
              const info: LockInfo = {
                user_id: p.user_id,
                user_name: p.user_name,
                expires_at: p.expires_at || new Date(Date.now() + 30000).toISOString(),
              }
              useTableLayoutStore.getState().addLock(p.target_type as 'column' | 'row', p.target_name, info)
              break
            }

            case 'layout.lock-released': {
              const p = msg.payload as LayoutLockReleased
              useTableLayoutStore.getState().removeLock(p.target_type as 'column' | 'row', p.target_name)
              break
            }

            case 'layout.reset': {
              useTableLayoutStore.getState().resetLayout()
              break
            }

            case 'loads.synced': {
              // Google Sheets sync may have changed cell values — refresh data AND rebuild sheet.
              queryClient.invalidateQueries({ queryKey: ['loads'] })
              requestFullRefresh()
              break
            }

            case 'sheet.op': {
              // Legacy Fortune Sheet op forwarding (kept for backward compat).
              const payload = msg.payload as { ops: any[] }
              if (payload?.ops?.length) {
                useWSStore.getState().applySheetOp?.(payload.ops)
              }
              break
            }

            case 'cell.update': {
              // Another user edited a single cell.
              // ① Patch cellStore (TanStack Table view — only that cell re-renders).
              // ② Call applyCellUpdate (Fortune Sheet view — applyOp, zero flash).
              const p = msg.payload as CellUpdateWSPayload
              const colId = FIELD_TO_COLUMN[p.field]
              if (colId) {
                const patch: { value?: string; style?: any } = {}
                if (p.value !== undefined) {
                  patch.value = p.value === null ? '' : String(p.value)
                }
                if (p.style) {
                  patch.style = {
                    bg: (p.style as any).bg,
                    fc: (p.style as any).fc ?? (p.style as any).fg,
                    bold: (p.style as any).bold,
                    italic: (p.style as any).italic,
                    underline: (p.style as any).underline,
                    strikethrough: (p.style as any).strikethrough,
                    fontSize: (p.style as any).fontSize,
                    textAlign: (p.style as any).textAlign,
                    verticalAlign: (p.style as any).verticalAlign,
                  }
                }
                useCellStore.getState().setCell(p.load_id, colId, patch)
              }
              // Fortune Sheet surgical patch (if LuckysheetBoard is mounted)
              useWSStore.getState().applyCellUpdate?.(p.load_id, p.field, p.value ?? null)
              break
            }

            case 'cell.bulk-update': {
              // TSV paste from another user — batch-patch cellStore + Fortune Sheet.
              const p = msg.payload as CellBulkUpdateWSPayload
              // ① cellStore (TanStack Table view)
              const updates = p.updates
                .map((u) => {
                  const colId = FIELD_TO_COLUMN[u.field]
                  if (!colId) return null
                  return {
                    loadId: u.load_id,
                    colId,
                    patch: { value: u.value === null || u.value === undefined ? '' : String(u.value) },
                  }
                })
                .filter((u): u is NonNullable<typeof u> => u !== null)
              if (updates.length > 0) {
                useCellStore.getState().bulkSetCells(updates)
              }
              // ② Fortune Sheet (LuckysheetBoard)
              const applyCell = useWSStore.getState().applyCellUpdate
              if (applyCell) {
                for (const u of p.updates) {
                  applyCell(u.load_id, u.field, u.value ?? null)
                }
              }
              break
            }

            case 'sync.error': {
              break
            }
          }
        } catch {
          // Ignore malformed messages.
        }
      }

      ws.onclose = () => {
        clearTimeout(connectTimeout)
        if (!mountedRef.current) return
        setConnected(false)
        setSendMessage(null)
        wsRef.current = null

        // Exponential back-off + jitter. First retry is almost instant.
        const expDelay = Math.min(
          BASE_RECONNECT_DELAY * Math.pow(2, Math.max(0, attemptRef.current - 1)),
          MAX_RECONNECT_DELAY,
        )
        const jitter = Math.floor(Math.random() * 200)
        reconnectRef.current = setTimeout(connect, expDelay + jitter)
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
  }, [token, queryClient, setConnected, setOnlineUsers, setSendMessage, setCellFocus, removeCellFocus, clearOfflineUserFocuses, applyFocusSnapshot, requestFullRefresh])
}
