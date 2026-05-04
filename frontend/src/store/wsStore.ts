import { create } from 'zustand'

interface OnlineUser {
  user_id: number
  user_name: string
}

interface WSState {
  isConnected: boolean
  onlineUsers: OnlineUser[]
  setConnected: (connected: boolean) => void
  setOnlineUsers: (users: OnlineUser[]) => void
  addOnlineUser: (user: OnlineUser) => void
  removeOnlineUser: (userId: number) => void
}

export const useWSStore = create<WSState>((set) => ({
  isConnected: false,
  onlineUsers: [],

  setConnected: (connected) => set({ isConnected: connected }),

  setOnlineUsers: (users) => set({ onlineUsers: users }),

  addOnlineUser: (user) =>
    set((state) => {
      const exists = state.onlineUsers.find((u) => u.user_id === user.user_id)
      if (exists) return state
      return { onlineUsers: [...state.onlineUsers, user] }
    }),

  removeOnlineUser: (userId) =>
    set((state) => ({
      onlineUsers: state.onlineUsers.filter((u) => u.user_id !== userId),
    })),
}))
