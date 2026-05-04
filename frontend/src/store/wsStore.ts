import { create } from 'zustand'

interface OnlineUser {
  user_id: number
  user_name: string
}

export interface CellFocusInfo {
  user_id: number
  user_name: string
  load_id: number
  field: string
  editing?: boolean
}

function cellFocusKey(loadId: number, field: string): string {
  return `${loadId}:${field}`
}

interface WSState {
  isConnected: boolean
  onlineUsers: OnlineUser[]
  sendMessage: ((data: string) => void) | null
  focusedCells: Record<string, CellFocusInfo>

  setConnected: (connected: boolean) => void
  setOnlineUsers: (users: OnlineUser[]) => void
  setSendMessage: (fn: ((data: string) => void) | null) => void
  setCellFocus: (info: CellFocusInfo) => void
  removeCellFocus: (loadId: number, field: string) => void
  clearOfflineUserFocuses: (onlineUserIds: Set<number>) => void
}

export const useWSStore = create<WSState>((set) => ({
  isConnected: false,
  onlineUsers: [],
  sendMessage: null,
  focusedCells: {},

  setConnected: (connected) => set({ isConnected: connected }),

  setOnlineUsers: (users) => set({ onlineUsers: users }),

  setSendMessage: (fn) => set({ sendMessage: fn }),

  setCellFocus: (info) =>
    set((state) => ({
      focusedCells: {
        ...state.focusedCells,
        [cellFocusKey(info.load_id, info.field)]: info,
      },
    })),

  removeCellFocus: (loadId, field) =>
    set((state) => {
      const key = cellFocusKey(loadId, field)
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
}))
