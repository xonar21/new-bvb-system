import { create } from 'zustand'
import type { CellFormat } from '../types/Load'
import { COL_ORDER } from '../features/LoadsBoard/columns'

function computeRect(
  start: { loadId: number; col: string },
  end: { loadId: number; col: string },
  orderedLoadIds: number[],
): Set<string> {
  const r1 = orderedLoadIds.indexOf(start.loadId)
  const r2 = orderedLoadIds.indexOf(end.loadId)
  const c1 = COL_ORDER.indexOf(start.col as typeof COL_ORDER[number])
  const c2 = COL_ORDER.indexOf(end.col as typeof COL_ORDER[number])
  if (r1 === -1 || r2 === -1 || c1 === -1 || c2 === -1) return new Set()

  const cells = new Set<string>()
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      cells.add(`${orderedLoadIds[r]}:${COL_ORDER[c]}`)
    }
  }
  return cells
}

interface SelectionStore {
  selectedCells: Set<string>
  isDragging: boolean
  dragStart: { loadId: number; col: string } | null
  dragEnd: { loadId: number; col: string } | null
  orderedLoadIds: number[]
  formatPainterActive: boolean
  formatPainterSource: Record<string, CellFormat> | null
  formatPainterSticky: boolean

  setOrderedLoadIds: (ids: number[]) => void
  startDrag: (loadId: number, col: string) => void
  extendDrag: (loadId: number, col: string) => void
  endDrag: () => void
  clearSelection: () => void
  selectCells: (cells: Set<string>) => void
  activateFormatPainter: (source: Record<string, CellFormat>, sticky?: boolean) => void
  deactivateFormatPainter: () => void
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedCells: new Set(),
  isDragging: false,
  dragStart: null,
  dragEnd: null,
  orderedLoadIds: [],
  formatPainterActive: false,
  formatPainterSource: null,
  formatPainterSticky: false,

  setOrderedLoadIds: (ids) => set({ orderedLoadIds: ids }),

  startDrag: (loadId, col) => {
    set({
      isDragging: true,
      dragStart: { loadId, col },
      dragEnd: { loadId, col },
      selectedCells: new Set([`${loadId}:${col}`]),
    })
  },

  extendDrag: (loadId, col) => {
    const { isDragging, dragStart, orderedLoadIds } = get()
    if (!isDragging || !dragStart) return
    set({ dragEnd: { loadId, col } })
    const cells = computeRect(dragStart, { loadId, col }, orderedLoadIds)
    set({ selectedCells: cells })
  },

  endDrag: () => {
    set({ isDragging: false })
  },

  clearSelection: () => {
    set({
      selectedCells: new Set(),
      dragStart: null,
      dragEnd: null,
    })
  },

  selectCells: (cells) => set({ selectedCells: cells }),

  activateFormatPainter: (source, sticky = false) => {
    set({
      formatPainterActive: true,
      formatPainterSource: source,
      formatPainterSticky: sticky,
    })
    document.body.style.cursor = 'cell'
  },

  deactivateFormatPainter: () => {
    set({
      formatPainterActive: false,
      formatPainterSource: null,
      formatPainterSticky: false,
    })
    document.body.style.cursor = ''
  },
}))
