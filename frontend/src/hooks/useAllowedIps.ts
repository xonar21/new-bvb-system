import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import type { AllowedIp, AllowedIpsResponse } from '../types/Load'

interface AllowedIpResponse {
  allowed_ip: AllowedIp
}

export function useAllowedIps() {
  return useQuery<AllowedIp[]>({
    queryKey: ['allowed-ips'],
    queryFn: async () => {
      const res = await apiClient.get<AllowedIpsResponse>('/api/allowed-ips')
      return res.allowed_ips
    },
  })
}

export function useCreateAllowedIp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ip: string) => {
      const res = await apiClient.post<AllowedIpResponse>('/api/allowed-ips', { ip })
      return res.allowed_ip
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowed-ips'] })
    },
  })
}

export function useDeleteAllowedIp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/api/allowed-ips/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowed-ips'] })
    },
  })
}
