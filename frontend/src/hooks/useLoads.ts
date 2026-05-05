import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import type { BulkFormatCell, BulkOrderItem, CellFormat, Load, LoadsResponse, UpdateCellFormatArgs, UpdateLoadRequest } from '../types/Load'

interface LoadsFilters {
  date_from?: string
  date_to?: string
  status?: string
  gate_code?: string
  is_mcc?: string
  is_bold?: string
  is_lock?: string
}

function buildQueryString(filters: LoadsFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useLoads(filters: LoadsFilters = {}) {
  return useQuery<Load[]>({
    queryKey: ['loads', filters],
    queryFn: async () => {
      const qs = buildQueryString(filters)
      const res = await apiClient.get<LoadsResponse>(`/api/loads${qs}`)
      return res.loads
    },
    refetchInterval: 300_000,
  })
}

export function useLoad(id: number | undefined) {
  return useQuery<Load | null>({
    queryKey: ['load', id],
    queryFn: async () => {
      if (!id) return null
      const res = await apiClient.get<{ load: Load }>(`/api/loads/${id}`)
      return res.load
    },
    enabled: !!id,
  })
}

export function useUpdateLoad() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateLoadRequest }) => {
      const res = await apiClient.put<{ load: Load }>(`/api/loads/${id}`, data)
      return res.load
    },

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['loads'] })

      const prev = queryClient.getQueryData<Load[]>(['loads'])

      queryClient.setQueryData<Load[]>(['loads'], (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...data } as Load : l)) ?? [],
      )

      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['loads'], ctx.prev)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['loads'] })
    },
  })
}

export function useDeleteLoad() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/api/loads/${id}`)
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['loads'] })

      const prev = queryClient.getQueryData<Load[]>(['loads'])

      queryClient.setQueryData<Load[]>(['loads'], (old) =>
        old?.filter((l) => l.id !== id) ?? [],
      )

      return { prev }
    },

    onError: (_err, _id, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['loads'], ctx.prev)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['loads'] })
    },
  })
}

export function useUpdateCellFormat() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, column, format }: UpdateCellFormatArgs) => {
      const res = await apiClient.patch<{ load: Load }>(`/api/loads/${id}/format`, { column, format })
      return res.load
    },

    onMutate: async ({ id, column, format }) => {
      await queryClient.cancelQueries({ queryKey: ['loads'] })

      const prev = queryClient.getQueryData<Load[]>(['loads'])

      queryClient.setQueryData<Load[]>(['loads'], (old) =>
        old?.map((load) =>
          load.id === id
            ? {
                ...load,
                cell_formats: {
                  ...load.cell_formats,
                  [column]: format,
                } as Record<string, CellFormat>,
              }
            : load,
        ) ?? [],
      )

      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['loads'], ctx.prev)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['loads'] })
    },
  })
}

export function useUpdateBulkFormat() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (cells: BulkFormatCell[]) => {
      await apiClient.post('/api/loads/bulk-format', { cells })
    },

    onMutate: async (cells) => {
      await queryClient.cancelQueries({ queryKey: ['loads'] })

      const prev = queryClient.getQueryData<Load[]>(['loads'])

      queryClient.setQueryData<Load[]>(['loads'], (old) =>
        old?.map((load) => {
          const loadCells = cells.filter((c) => c.load_id === load.id)
          if (!loadCells.length) return load
          const newFormats = { ...load.cell_formats }
          loadCells.forEach((c) => { newFormats[c.column] = c.format })
          return { ...load, cell_formats: newFormats as Record<string, CellFormat> }
        }) ?? [],
      )

      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['loads'], ctx.prev)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['loads'] })
    },
  })
}

export function useBulkOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (items: BulkOrderItem[]) => {
      await apiClient.post('/api/loads/bulk-order', { items })
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['loads'] })
    },
  })
}
