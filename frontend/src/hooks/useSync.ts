import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../api/client'

export function useSync() {
  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/api/sync')
    },
  })
}
