/**
 * cellStore — single source of truth for all cell values and styles.
 *
 * Keys are `${loadId}:${columnId}` where columnId is the TanStack column id
 * (e.g. "pick_up_date"), which is consistent with focusKey / selectedCells.
 *
 * Flow:
 *   1. initFromLoads() — called once after the initial REST fetch.
 *   2. setCell() — optimistic update when the local user edits a cell.
 *   3. patchFromLoad() — merge server truth on load.updated WS events
 *      (Google Sheets sync, REST-based format changes).
 *   4. bulkSetCells() — TSV paste or other batch operations.
 */
import { create } from 'zustand'
import type { Load } from '../types/Load'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CellStyle {
  bg?: string       // background color hex
  fc?: string       // foreground (text) color hex
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: number
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
}

export interface CellData {
  value: string
  style?: CellStyle
}

interface CellStore {
  /** Map of `${loadId}:${columnId}` → CellData */
  cells: Record<string, CellData>

  /** Populate the store from a full loads array (initial load / reconnect). */
  initFromLoads: (loads: Load[]) => void

  /** Patch a single cell (optimistic update or WS receive). */
  setCell: (loadId: number, colId: string, patch: Partial<CellData>) => void

  /** Patch many cells atomically (TSV paste). */
  bulkSetCells: (updates: Array<{ loadId: number; colId: string; patch: Partial<CellData> }>) => void

  /** Merge DB truth for one load (called on load.updated WS event). */
  patchFromLoad: (load: Load) => void

  /** Remove all cells belonging to a deleted load. */
  removeRow: (loadId: number) => void
}

// ── Column-id → DB-field mapping ─────────────────────────────────────────────
// Maps TanStack column IDs to the actual DB column names used in WS messages.
export const COLUMN_TO_FIELD: Record<string, string> = {
  pick_up_date:     'pick_up_date_col1',
  commodity:        'commodity_col2',
  pickup_location:  'pickup_date_location_col3',
  delivery_location:'delivery_date_location_col4',
  assigned_user:    'assigned_user_col5',
  gate_code:        'gate_code_col6',
  rate:             'rate_col7',
  notes:            'note_mcc',
}

// Editable column IDs in display order (used for TSV paste range clamping).
export const EDITABLE_COLS = [
  'pick_up_date', 'commodity', 'pickup_location', 'delivery_location',
  'assigned_user', 'gate_code', 'rate', 'notes',
] as const
export type EditableCol = typeof EDITABLE_COLS[number]

// ── Helper: load → cell map ───────────────────────────────────────────────────
function loadToCells(load: Load): Record<string, CellData> {
  const result: Record<string, CellData> = {}
  for (const [col, field] of Object.entries(COLUMN_TO_FIELD)) {
    const rawVal = (load as any)[field]
    const strVal = rawVal === null || rawVal === undefined ? '' : String(rawVal)
    const fmt = load.cell_formats?.[col]
    const style: CellStyle | undefined = fmt
      ? {
          bg: fmt.bg ?? undefined,
          fc: fmt.fg ?? undefined,
          bold: fmt.bold,
          italic: fmt.italic,
          underline: fmt.underline,
          strikethrough: fmt.strikethrough,
          fontSize: fmt.fontSize ?? undefined,
          textAlign: (fmt.textAlign as CellStyle['textAlign']) ?? undefined,
          verticalAlign: (fmt.verticalAlign as CellStyle['verticalAlign']) ?? undefined,
        }
      : undefined
    result[`${load.id}:${col}`] = { value: strVal, style }
  }
  return result
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useCellStore = create<CellStore>((set) => ({
  cells: {},

  initFromLoads: (loads) => {
    const cells: Record<string, CellData> = {}
    for (const load of loads) {
      Object.assign(cells, loadToCells(load))
    }
    set({ cells })
  },

  setCell: (loadId, colId, patch) =>
    set((state) => {
      const key = `${loadId}:${colId}`
      return {
        cells: {
          ...state.cells,
          [key]: { ...(state.cells[key] ?? { value: '' }), ...patch },
        },
      }
    }),

  bulkSetCells: (updates) =>
    set((state) => {
      const next = { ...state.cells }
      for (const { loadId, colId, patch } of updates) {
        const key = `${loadId}:${colId}`
        next[key] = { ...(next[key] ?? { value: '' }), ...patch }
      }
      return { cells: next }
    }),

  patchFromLoad: (load) =>
    set((state) => {
      const incoming = loadToCells(load)
      const next = { ...state.cells }
      for (const [key, data] of Object.entries(incoming)) {
        // Merge only keys that already exist (don't introduce phantom rows).
        if (key in next) next[key] = data
      }
      return { cells: next }
    }),

  removeRow: (loadId) =>
    set((state) => {
      const next = { ...state.cells }
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${loadId}:`)) delete next[key]
      }
      return { cells: next }
    }),
}))
