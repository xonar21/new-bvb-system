import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSelectionStore } from '../../store/selectionStore'
import { useClipboardStore } from '../../store/clipboardStore'
import type { Load, BulkUpdateItem, BulkUpdateResponse } from '../../types/Load'
import { COL_ORDER, columnToColKey } from './columns'

const MAX_PASTE_ROWS = 100

// colKey (col1-col9) → column ID (gate_code, rate, etc.)
const colKeyToColumnId: Record<string, string> = {}
for (const [colId, ck] of Object.entries(columnToColKey)) {
  colKeyToColumnId[ck] = colId
}

// Column ID → backend field name
const COL_ID_TO_FIELD: Record<string, string> = {
  pick_up_date: 'pick_up_date_col1',
  commodity: 'commodity_col2',
  pickup_location: 'pickup_date_location_col3',
  delivery_location: 'delivery_date_location_col4',
  assigned_user: 'assigned_user_col5',
  gate_code: 'gate_code_col6',
  rate: 'rate_col7',
  notes: 'note_mcc',
}

// Display names for TSV header
const COL_DISPLAY_NAMES: Record<string, string> = {
  pick_up_date: 'Pick Up Date',
  commodity: 'Broker / Commodity',
  pickup_location: 'Shipper / Pickup',
  delivery_location: 'Delivery',
  assigned_user: 'Assigned',
  gate_code: 'Gate Code',
  rate: 'Rate',
  notes: 'Notes',
}

const STATUS_SET = new Set(['pick up', 'pending', 'delivered'])

function getBounds(
  selectedCells: Set<string>,
  orderedLoadIds: number[],
): { minRow: number; maxRow: number; minColIdx: number; maxColIdx: number } | null {
  let minRow = Infinity, maxRow = -Infinity
  let minColIdx = Infinity, maxColIdx = -Infinity

  for (const key of selectedCells) {
    const [loadIdStr, colKey] = key.split(':')
    const loadId = Number(loadIdStr)
    const rowIdx = orderedLoadIds.indexOf(loadId)
    const colIdx = COL_ORDER.indexOf(colKey as typeof COL_ORDER[number])
    if (rowIdx < 0 || colIdx < 0) continue
    minRow = Math.min(minRow, rowIdx)
    maxRow = Math.max(maxRow, rowIdx)
    minColIdx = Math.min(minColIdx, colIdx)
    maxColIdx = Math.max(maxColIdx, colIdx)
  }

  if (minRow === Infinity) return null
  return { minRow, maxRow, minColIdx, maxColIdx }
}

function formatTSV(data: string[][], headers: string[]): string {
  return [headers.join('\t'), ...data.map((r) => r.join('\t'))].join('\n')
}

function parseTSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = lines[0].split('\t').map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const cols = line.split('\t')
    while (cols.length < headers.length) cols.push('')
    return cols.slice(0, headers.length).map((c) => c.trim())
  })

  return { headers, rows }
}

function mapHeadersToFields(
  headers: string[],
): { colId: string; field: string; index: number }[] {
  const result: { colId: string; field: string; index: number }[] = []

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]

    // Direct match: column ID
    const field = COL_ID_TO_FIELD[h]
    if (field) {
      result.push({ colId: h, field, index: i })
      continue
    }

    // Column display name match (for Google Sheets compatibility)
    for (const [colId, displayName] of Object.entries(COL_DISPLAY_NAMES)) {
      if (displayName.toLowerCase() === h.toLowerCase()) {
        result.push({ colId, field: COL_ID_TO_FIELD[colId], index: i })
        break
      }
    }
  }

  return result
}

function validateValue(colId: string, raw: string): { valid: boolean; error?: string; transformed?: unknown } {
  if (raw === '') return { valid: true, transformed: undefined }

  switch (colId) {
    case 'gate_code':
      if (!/^\d+$/.test(raw)) return { valid: false, error: 'Digits only' }
      return { valid: true, transformed: raw.trim() }

    case 'rate':
    case 'rate_min':
    case 'rate_max': {
      const n = Number(raw)
      if (isNaN(n)) return { valid: false, error: 'Must be a number' }
      if (n < 0 || n > 9999) return { valid: false, error: 'Must be 0-9999' }
      return { valid: true, transformed: n }
    }

    case 'status': {
      const lower = raw.toLowerCase()
      if (!STATUS_SET.has(lower)) return { valid: false, error: 'Must be: pick up, pending, delivered' }
      return { valid: true, transformed: lower }
    }

    case 'pick_up_date':
      // Accept YYYY-MM-DD and RFC3339/ISO 8601
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { valid: true, transformed: raw }
      const d = new Date(raw)
      if (!isNaN(d.getTime())) return { valid: true, transformed: d.toISOString().split('T')[0] }
      return { valid: false, error: 'Format: YYYY-MM-DD' }

    case 'commodity':
    case 'pickup_location':
    case 'delivery_location':
    case 'assigned_user':
    case 'notes':
      return { valid: true, transformed: raw || null }

    default:
      return { valid: false, error: `Unknown column: ${colId}` }
  }
}

export function useClipboard(loads: Load[]) {
  const queryClient = useQueryClient()
  const orderedLoadIds = useSelectionStore((s) => s.orderedLoadIds)

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator?.clipboard?.writeText !== 'function') {
        useClipboardStore.getState().setCopyToast('Clipboard not available (HTTPS required)')
        return
      }

      const { selectedCells } = useSelectionStore.getState()

      if (selectedCells.size === 0) {
        useClipboardStore.getState().setCopyToast('Nothing selected')
        return
      }

      const bounds = getBounds(selectedCells, orderedLoadIds)
      if (!bounds) {
        useClipboardStore.getState().setCopyToast('Invalid selection')
        return
      }

      const { minRow, maxRow, minColIdx, maxColIdx } = bounds
      const numRows = maxRow - minRow + 1
      const numCols = maxColIdx - minColIdx + 1

      if (numRows > MAX_PASTE_ROWS) {
        useClipboardStore.getState().setCopyToast(`Too many rows. Max ${MAX_PASTE_ROWS}`)
        return
      }

      const colIdsInRange: string[] = []
      for (let c = minColIdx; c <= maxColIdx; c++) {
        const colKey = COL_ORDER[c]
        const colId = colKeyToColumnId[colKey]
        if (colId) colIdsInRange.push(colId)
      }

      const headers = colIdsInRange.map((colId) => COL_DISPLAY_NAMES[colId] ?? colId)
      const data: string[][] = []

      for (let r = minRow; r <= maxRow; r++) {
        const loadId = orderedLoadIds[r]
        const load = loads.find((l) => l.id === loadId)
        const rowData: string[] = []

        for (let c = minColIdx; c <= maxColIdx; c++) {
          const colKey = COL_ORDER[c]
          const cellKey = `${loadId}:${colKey}`
          if (selectedCells.has(cellKey) && load) {
            const colId = colKeyToColumnId[colKey]
            const fieldName = COL_ID_TO_FIELD[colId] ?? colId
            const val = (load as unknown as Record<string, unknown>)[fieldName]
            rowData.push(val != null ? String(val) : '')
          } else {
            rowData.push('')
          }
        }
        data.push(rowData)
      }

      const tsv = formatTSV(data, headers)
      await navigator.clipboard.writeText(tsv)
      useClipboardStore.getState().setCopyToast(`Copied ${numRows} row${numRows > 1 ? 's' : ''} × ${numCols} col${numCols > 1 ? 's' : ''}`)
    } catch (err) {
      console.error('Copy failed:', err)
      useClipboardStore.getState().setCopyToast('Copy failed')
    }
  }, [loads, orderedLoadIds])

  const handlePaste = useCallback(async () => {
    try {
      if (typeof navigator?.clipboard?.readText !== 'function') {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Clipboard not available (HTTPS required)' }])
        return
      }

      useClipboardStore.getState().setIsPasting(true)

      const { selectedCells } = useSelectionStore.getState()

      if (selectedCells.size === 0) {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Click a cell first to set paste target' }])
        return
      }

      const [firstKey] = selectedCells
      const [targetLoadIdStr] = firstKey.split(':')
      const targetLoadId = Number(targetLoadIdStr)
      const targetRowIdx = orderedLoadIds.indexOf(targetLoadId)

      if (targetRowIdx < 0) {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Target cell not found in current data' }])
        return
      }

      let text: string
      try {
        text = await navigator.clipboard.readText()
      } catch {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Clipboard access denied. Allow clipboard access in browser settings.' }])
        return
      }

      if (!text || text.trim() === '') {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Nothing in clipboard' }])
        return
      }

      const parsed = parseTSV(text)
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Invalid format: no data found' }])
        return
      }

      if (parsed.rows.length > MAX_PASTE_ROWS) {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: `Too many rows. Max ${MAX_PASTE_ROWS}` }])
        return
      }

      const mapping = mapHeadersToFields(parsed.headers)
      if (mapping.length === 0) {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'No matching columns found. Try: Gate Code, Rate, Status, etc.' }])
        return
      }

      const updates: BulkUpdateItem[] = []
      const errors: { row: number; col: string; reason: string }[] = []

      for (let i = 0; i < parsed.rows.length; i++) {
        const rowData = parsed.rows[i]
        const absRowIdx = targetRowIdx + i

        if (absRowIdx >= orderedLoadIds.length) {
          errors.push({ row: i + 1, col: '', reason: 'Paste exceeds table size' })
          continue
        }

        const loadId = orderedLoadIds[absRowIdx]
        if (!loadId) {
          errors.push({ row: i + 1, col: '', reason: 'Target row not found' })
          continue
        }

        const patch: Record<string, unknown> = {}

        for (const { colId, field, index } of mapping) {
          const rawVal = rowData[index] ?? ''
          if (rawVal === '') continue

          const result = validateValue(colId, rawVal)
          if (!result.valid) {
            errors.push({ row: i + 1, col: colId, reason: result.error ?? 'Invalid' })
            continue
          }
          if (result.transformed !== undefined) {
            patch[field] = result.transformed
          }
        }

        if (Object.keys(patch).length > 0) {
          updates.push({ id: loadId, patch })
        }
      }

      if (errors.length > 0) {
        useClipboardStore.getState().setPasteErrors(errors)
        return
      }

      if (updates.length === 0) {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'No changes to apply' }])
        return
      }

      // Optimistic update
      queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) =>
        old?.map((load) => {
          const upd = updates.find((u) => u.id === load.id)
          if (!upd) return load
          return { ...load, ...upd.patch } as Load
        }) ?? [],
      )

      try {
        const res = await fetch('/api/loads/bulk-update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          },
          body: JSON.stringify({ updates }),
        })

        if (!res.ok) {
          const body: BulkUpdateResponse = await res.json()
          if (body.errors && body.errors.length > 0) {
            const mappedErrors = body.errors.map((e) => ({
              row: updates.findIndex((u) => u.id === e.id) + 1,
              col: e.field,
              reason: e.reason,
            }))
            useClipboardStore.getState().setPasteErrors(mappedErrors)
          } else {
            useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: `Server error: ${res.status}` }])
          }
          queryClient.invalidateQueries({ queryKey: ['loads'] })
          return
        }

        useClipboardStore.getState().setCopyToast(`Pasted ${updates.length} row${updates.length > 1 ? 's' : ''}`)
        useSelectionStore.getState().clearSelection()

        setTimeout(() => {
          const current = useClipboardStore.getState().copyToast
          if (current && current.startsWith('Pasted')) {
            useClipboardStore.getState().setCopyToast(null)
          }
        }, 3000)
      } catch {
        useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Network error. Try again.' }])
        queryClient.invalidateQueries({ queryKey: ['loads'] })
      }
    } catch (err) {
      console.error('Paste failed:', err)
      useClipboardStore.getState().setPasteErrors([{ row: 0, col: '', reason: 'Unexpected error. Check console.' }])
      queryClient.invalidateQueries({ queryKey: ['loads'] })
    } finally {
      useClipboardStore.getState().setIsPasting(false)
    }
  }, [loads, orderedLoadIds, queryClient])

  const clearPasteErrors = useCallback(() => {
    useClipboardStore.getState().setPasteErrors(null)
  }, [])

  return { handleCopy, handlePaste, clearPasteErrors }
}
