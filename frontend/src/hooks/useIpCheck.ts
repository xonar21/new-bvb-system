import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import type { AllowedIpsResponse } from '../types/Load'

const IPIFY_URL = 'https://api.ipify.org?format=json'

async function getCurrentIp(): Promise<string> {
  const res = await fetch(IPIFY_URL)
  const data = await res.json() as { ip: string }
  return data.ip
}

export function useIpCheck() {
  return useQuery({
    queryKey: ['ip-check'],
    queryFn: async () => {
      const [currentIp, allowedRes] = await Promise.all([
        getCurrentIp(),
        apiClient.get<AllowedIpsResponse>('/api/allowed-ips'),
      ])

      const allowedIps = allowedRes.allowed_ips.map((a) => a.ip)
      const isAllowed = allowedIps.length > 0 && allowedIps.includes(currentIp)

      return { currentIp, isAllowed }
    },
    retry: 1,
    refetchInterval: 3000,
  })
}
