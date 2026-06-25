import { create } from 'zustand'
import { apiClient } from '../api/client'
import type { LoginRequest, LoginResponse, User } from '../types/Load'

function loadFromStorage(): { token: string | null; user: User | null } {
  const token = localStorage.getItem('auth_token')
  const userRaw = localStorage.getItem('auth_user')
  if (token && userRaw) {
    try {
      const user = JSON.parse(userRaw) as User
      // Ensure color field exists (for users who logged in before color was added)
      if (!user.color) {
        user.color = '#4a90d9'
      }
      return { token, user }
    } catch {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
    }
  }
  return { token: null, user: null }
}

const initial = loadFromStorage()

interface AuthState {
  token: string | null
  user: User | null
  loading: boolean
  error: string | null
  login: (data: LoginRequest) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: initial.token,
  user: initial.user,
  loading: false,
  error: null,

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
