import { create } from 'zustand'
import { apiClient } from '../api/client'
import type { LoginRequest, LoginResponse, User } from '../types/Load'

interface AuthState {
  token: string | null
  user: User | null
  loading: boolean
  error: string | null
  login: (data: LoginRequest) => Promise<void>
  logout: () => void
  loadFromStorage: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  loading: false,
  error: null,

  loadFromStorage: () => {
    const token = localStorage.getItem('auth_token')
    const userRaw = localStorage.getItem('auth_user')
    if (token && userRaw) {
      try {
        const user = JSON.parse(userRaw) as User
        set({ token, user })
      } catch {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('auth_user')
      }
    }
  },

  login: async (data) => {
    set({ loading: true, error: null })
    try {
      const res = await apiClient.post<LoginResponse>('/api/auth/login', data)
      localStorage.setItem('auth_token', res.token)
      localStorage.setItem('auth_user', JSON.stringify(res.user))
      set({ token: res.token, user: res.user, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      set({ error: message, loading: false })
      throw err
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    set({ token: null, user: null })
  },
}))
