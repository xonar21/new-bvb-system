import { create } from 'zustand'

interface OnlineUser {
  user_id: number
  user_name: string
}

export interface CellFocusInfo {
  user_id: number
  user_name: string
  color: string
  // Sheet coordinates — presence is tracked by cell position so that even
  // empty cells (no backing load record) can be highlighted.
  row: number
  col: number
  editing?: boolean
}

// One presence per user → key the map by user id.
function focusKey(userId: number): string {
  return `user:${userId}`
}

interface WSState {
  isConnected: boolean
  onlineUsers: OnlineUser[]
  sendMessage: ((data: string) => void) | null
  focusedCells: Record<string, CellFocusInfo>
  /** Callback registered by LuckysheetBoard to apply incoming sheet.op ops surgically. */
  applySheetOp: ((ops: any[]) => void) | null
  /**
   * Callback registered by LuckysheetBoard to apply a single cell value change
   * from another user's cell.update WS message — no full rebuild, no flash.
   */
  applyCellUpdate: ((loadId: number, field: string, value: any) => void) | null
  /** Increments on WS reconnect or loads.synced — signals that a full sheet rebuild is needed. */
  fullRefreshSeq: number

  setConnected: (connected: boolean) => void
  setOnlineUsers: (users: OnlineUser[]) => void
  setSendMessage: (fn: ((data: string) => void) | null) => void
  setCellFocus: (info: CellFocusInfo) => void
  removeCellFocus: (userId: number) => void
  clearOfflineUserFocuses: (onlineUserIds: Set<number>) => void
  /** Bulk-replace focusedCells from a server snapshot (sent on WS connect). */
  applyFocusSnapshot: (focuses: Array<{ row: number; col: number; user_id?: number; user_name?: string; color?: string; action: string }>) => void
  /** Register/unregister the Fortune Sheet applyOp callback from LuckysheetBoard. */
  setApplySheetOp: (fn: ((ops: any[]) => void) | null) => void
  /** Register/unregister the cell.update patch callback from LuckysheetBoard. */
  setApplyCellUpdate: (fn: ((loadId: number, field: string, value: any) => void) | null) => void
  /** Signal that the Fortune Sheet needs a full data rebuild (e.g. after reconnect or sync). */
  requestFullRefresh: () => void
}

export const useWSStore = create<WSState>((set) => ({
  isConnected: false,
  onlineUsers: [],
  sendMessage: null,
  focusedCells: {},
  applySheetOp: null,
  applyCellUpdate: null,
  fullRefreshSeq: 0,

  setConnected: (connected) => set({ isConnected: connected }),

  setOnlineUsers: (users) => set({ onlineUsers: users }),

  setSendMessage: (fn) => set({ sendMessage: fn }),

  setCellFocus: (info) => {
    const fullInfo: CellFocusInfo = {
      ...info,
      color: info.color || '#4a90d9',
    }
    return set((state) => ({
      focusedCells: {
        ...state.focusedCells,
        [focusKey(info.user_id)]: fullInfo,
      },
    }))
  },

  removeCellFocus: (userId) =>
    set((state) => {
      const key = focusKey(userId)
      if (!(key in state.focusedCells)) return state
      const next = { ...state.focusedCells }
      delete next[key]
      return { focusedCells: next }
    }),

  clearOfflineUserFocuses: (onlineUserIds) =>
    set((state) => {
      const next: Record<string, CellFocusInfo> = {}
      for (const [key, info] of Object.entries(state.focusedCells)) {
        if (onlineUserIds.has(info.user_id)) {
          next[key] = info
        }
      }
      return { focusedCells: next }
    }),

  applyFocusSnapshot: (focuses) =>
    set((state) => {
      // Start from current focusedCells so our own local focus isn't wiped.
      const next = { ...state.focusedCells }
      for (const f of focuses) {
        if (f.action === 'blur') continue
        if (!f.user_id) continue
        next[focusKey(f.user_id)] = {
          user_id: f.user_id,
          user_name: f.user_name || `User ${f.user_id}`,
          color: f.color || '#4a90d9',
          row: f.row,
          col: f.col,
          editing: f.action === 'editing',
        }
      }
      return { focusedCells: next }
    }),

  setApplySheetOp: (fn) => set({ applySheetOp: fn }),

  setApplyCellUpdate: (fn) => set({ applyCellUpdate: fn }),

  requestFullRefresh: () => set((s) => ({ fullRefreshSeq: s.fullRefreshSeq + 1 })),
}))
