import { useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUndoStore } from '../store/undoStore'
import { apiClient } from '../api/client'
import type { Load } from '../types/Load'

export function useUndo() {
  const queryClient = useQueryClient()
  const entry = useUndoStore((s) => s.entry)

  const performUndo = useCallback(async (): Promise<{ success: boolean; message: string } | null> => {
    const e = useUndoStore.getState().pop()
    if (!e) return null

    try {
      await apiClient.put(`/api/loads/${e.loadId}`, { [e.field]: e.oldValue })

      queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) =>
        old?.map((l) => (l.id === e.loadId ? { ...l, [e.field]: e.oldValue } as Load : l)) ?? [],
      )

      return { success: true, message: 'Undo successful' }
    } catch (err: unknown) {
      const apiErr = err as { status?: number }
      const status = apiErr?.status

      if (status === 404) {
        queryClient.invalidateQueries({ queryKey: ['loads'] })
        return { success: false, message: 'Load no longer exists' }
      }
      if (status === 403) {
        return { success: false, message: 'Load is locked — cannot undo' }
      }

      queryClient.invalidateQueries({ queryKey: ['loads'] })
      return { success: false, message: 'Undo failed — data may have changed' }
    }
  }, [queryClient])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
        e.preventDefault()
        performUndo()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [performUndo])

  return { canUndo: !!entry, performUndo }
}
