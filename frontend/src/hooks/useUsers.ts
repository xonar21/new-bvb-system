import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import type { User } from '../types/Load'

interface UsersResponse {
  users: User[]
}

interface UserResponse {
  user: User
}

export interface CreateUserRequest {
  email: string
  password: string
  name: string
  role: string
}

export interface UpdateUserRequest {
  email?: string
  password?: string
  name?: string
  role?: string
  is_blocked?: boolean
}

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiClient.get<UsersResponse>('/api/users')
      return res.users
    },
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateUserRequest) => {
      const res = await apiClient.post<UserResponse>('/api/users', data)
      return res.user
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateUserRequest }) => {
      const res = await apiClient.put<UserResponse>(`/api/users/${id}`, data)
      return res.user
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/api/users/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
