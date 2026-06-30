import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../api/client'

export function useMccSync() {
  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/api/mcc/sync')
    },
  })
}
