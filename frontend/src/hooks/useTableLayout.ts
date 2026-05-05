import { useEffect, useCallback } from 'react'
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

  const updateColumnWidthLocal = useCallback(
    (colName: string, width: number) => {
      updateColumnWidth(colName, width)
    },
    [updateColumnWidth],
  )

  const persistColumnWidth = useCallback(
    (colName: string, width: number) => {
      apiClient.put(`/api/table-layout/column/${encodeURIComponent(colName)}/width`, { width })
        .catch(() => {})
    },
    [],
  )

  const updateRowHeightLocal = useCallback(
    (rowIdx: number, height: number) => {
      updateRowHeight(rowIdx, height)
    },
    [updateRowHeight],
  )

  const persistRowHeight = useCallback(
    (rowIdx: number, height: number) => {
      apiClient.put(`/api/table-layout/row/${rowIdx}/height`, { height })
        .catch(() => {})
    },
    [],
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
    updateColumnWidthLocal,
    persistColumnWidth,
    updateRowHeightLocal,
    persistRowHeight,
    updateColumnWidth,
    updateRowHeight,
    addLock,
    removeLock,
    resetLayout,
  }
}
