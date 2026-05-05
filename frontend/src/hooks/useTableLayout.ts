import { useEffect, useCallback, useRef } from 'react'
import { apiClient } from '../api/client'
import { useTableLayoutStore } from '../store/tableLayoutStore'
import type { TableLayoutResponse, LockAcquireResponse } from '../types/Load'

export function useTableLayout() {
  const {
    columnWidths,
    rowHeights,
    activeLocks,
    isLoading,
    setColumnWidths,
    setRowHeights,
    setActiveLocks,
    updateColumnWidth,
    updateRowHeight,
    addLock,
    removeLock,
    setIsLoading,
    resetLayout,
  } = useTableLayoutStore()

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    apiClient.get<TableLayoutResponse>('/api/table-layout')
      .then((data) => {
        if (cancelled) return
        setColumnWidths(data.column_widths)
        setRowHeights(data.row_heights)
        setActiveLocks(data.active_locks)
        setIsLoading(false)
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [setColumnWidths, setRowHeights, setActiveLocks, setIsLoading])

  const getColumnWidth = useCallback(
    (colName: string, defaultWidth = 150): number => {
      return columnWidths[colName] ?? defaultWidth
    },
    [columnWidths],
  )

  const getRowHeight = useCallback(
    (rowIdx: number, defaultHeight = 36): number => {
      return rowHeights[rowIdx] ?? defaultHeight
    },
    [rowHeights],
  )

  const isColumnLocked = useCallback(
    (colName: string): boolean => {
      return colName in activeLocks.columns
    },
    [activeLocks.columns],
  )

  const isRowLocked = useCallback(
    (rowIdx: number): boolean => {
      return String(rowIdx) in activeLocks.rows
    },
    [activeLocks.rows],
  )

  const getColumnLockInfo = useCallback(
    (colName: string) => {
      return activeLocks.columns[colName] ?? null
    },
    [activeLocks.columns],
  )

  const getRowLockInfo = useCallback(
    (rowIdx: number) => {
      return activeLocks.rows[String(rowIdx)] ?? null
    },
    [activeLocks.rows],
  )

  const acquireLock = useCallback(
    async (targetType: 'column' | 'row', targetName: string): Promise<boolean> => {
      try {
        const res = await apiClient.post<LockAcquireResponse>('/api/table-layout/lock-acquire', {
          target_type: targetType,
          target_name: targetName,
        })
        return res.success
      } catch {
        return false
      }
    },
    [],
  )

  const releaseLock = useCallback(
    async (targetType: 'column' | 'row', targetName: string): Promise<void> => {
      try {
        await apiClient.post('/api/table-layout/lock-release', {
          target_type: targetType,
          target_name: targetName,
        })
      } catch {
        // silent
      }
    },
    [],
  )

  const debouncedUpdateColumnWidth = useCallback(
    (colName: string, width: number) => {
      const key = `col:${colName}`
      if (debounceTimers.current[key]) {
        clearTimeout(debounceTimers.current[key])
      }
      updateColumnWidth(colName, width)
      debounceTimers.current[key] = setTimeout(() => {
        apiClient.put(`/api/table-layout/column/${encodeURIComponent(colName)}/width`, {
          width,
        }).catch(() => {
          // conflict or error - will be handled by WebSocket sync
        })
      }, 200)
    },
    [updateColumnWidth],
  )

  const debouncedUpdateRowHeight = useCallback(
    (rowIdx: number, height: number) => {
      const key = `row:${rowIdx}`
      if (debounceTimers.current[key]) {
        clearTimeout(debounceTimers.current[key])
      }
      updateRowHeight(rowIdx, height)
      debounceTimers.current[key] = setTimeout(() => {
        apiClient.put(`/api/table-layout/row/${rowIdx}/height`, {
          height,
        }).catch(() => {
          // silent
        })
      }, 200)
    },
    [updateRowHeight],
  )

  return {
    columnWidths,
    rowHeights,
    activeLocks,
    isLoading,
    getColumnWidth,
    getRowHeight,
    isColumnLocked,
    isRowLocked,
    getColumnLockInfo,
    getRowLockInfo,
    acquireLock,
    releaseLock,
    debouncedUpdateColumnWidth,
    debouncedUpdateRowHeight,
    updateColumnWidth,
    updateRowHeight,
    addLock,
    removeLock,
    resetLayout,
  }
}
