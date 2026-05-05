import { create } from 'zustand'
import type { LockInfo, ActiveLocks } from '../types/Load'

interface TableLayoutState {
  columnWidths: Record<string, number>
  rowHeights: Record<number, number>
  activeLocks: ActiveLocks
  isLoading: boolean

  setColumnWidths: (widths: Record<string, number>) => void
  setRowHeights: (heights: Record<string, number>) => void
  setActiveLocks: (locks: ActiveLocks) => void
  updateColumnWidth: (colName: string, width: number) => void
  updateRowHeight: (rowIdx: number, height: number) => void
  addLock: (targetType: 'column' | 'row', targetName: string, info: LockInfo) => void
  removeLock: (targetType: 'column' | 'row', targetName: string) => void
  setIsLoading: (v: boolean) => void
  resetLayout: () => void
}

export const useTableLayoutStore = create<TableLayoutState>((set) => ({
  columnWidths: {},
  rowHeights: {},
  activeLocks: { columns: {}, rows: {} },
  isLoading: false,

  setColumnWidths: (widths) => set({ columnWidths: widths }),

  setRowHeights: (heights) => {
    const numeric: Record<number, number> = {}
    for (const [k, v] of Object.entries(heights)) {
      numeric[Number(k)] = v
    }
    set({ rowHeights: numeric })
  },

  setActiveLocks: (locks) => set({ activeLocks: locks }),

  updateColumnWidth: (colName, width) =>
    set((state) => ({
      columnWidths: { ...state.columnWidths, [colName]: width },
    })),

  updateRowHeight: (rowIdx, height) =>
    set((state) => ({
      rowHeights: { ...state.rowHeights, [rowIdx]: height },
    })),

  addLock: (targetType, targetName, info) =>
    set((state) => {
      if (targetType === 'column') {
        return {
          activeLocks: {
            ...state.activeLocks,
            columns: { ...state.activeLocks.columns, [targetName]: info },
          },
        }
      }
      return {
        activeLocks: {
          ...state.activeLocks,
          rows: { ...state.activeLocks.rows, [targetName]: info },
        },
      }
    }),

  removeLock: (targetType, targetName) =>
    set((state) => {
      if (targetType === 'column') {
        const next = { ...state.activeLocks.columns }
        delete next[targetName]
        return { activeLocks: { ...state.activeLocks, columns: next } }
      }
      const next = { ...state.activeLocks.rows }
      delete next[targetName]
      return { activeLocks: { ...state.activeLocks, rows: next } }
    }),

  setIsLoading: (v) => set({ isLoading: v }),

  resetLayout: () =>
    set({
      columnWidths: {},
      rowHeights: {},
      activeLocks: { columns: {}, rows: {} },
    }),
}))
