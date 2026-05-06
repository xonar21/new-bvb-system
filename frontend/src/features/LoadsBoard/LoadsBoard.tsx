import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQueryClient } from '@tanstack/react-query'
import { useLoads, useUpdateLoad } from '../../hooks/useLoads'
import { useUndo } from '../../hooks/useUndo'
import { useTableLayout } from '../../hooks/useTableLayout'
import { columns, columnToColKey } from './columns'
import { LoadCell } from './LoadCell'
import { OnlineUsersBar } from './OnlineUsersBar'
import { FormatToolbar } from './FormatToolbar'
import { RowResizeHandle } from './RowHeaderColumn'
import { useSelectionStore } from '../../store/selectionStore'
import { useTableLayoutStore } from '../../store/tableLayoutStore'
import type { BulkFormatCell, CellFormat, Load } from '../../types/Load'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

const COLUMN_TO_FIELD: Record<string, string> = {
  pick_up_date: 'pick_up_date_col1',
  commodity: 'commodity_col2',
  pickup_location: 'pickup_date_location_col3',
  delivery_location: 'delivery_date_location_col4',
  assigned_user: 'assigned_user_col5',
  rate: 'rate_col7',
  notes: 'note_mcc',
}

function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i)
  }

  const pages = new Set<number>()

  pages.add(0)
  pages.add(1)
  pages.add(total - 2)
  pages.add(total - 1)

  for (let i = Math.max(2, current - 1); i <= Math.min(total - 3, current + 1); i++) {
    pages.add(i)
  }

  const sorted = Array.from(pages).sort((a, b) => a - b)

  const result: (number | 'ellipsis')[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1) {
      result.push('ellipsis')
    }
    result.push(sorted[i])
  }

  return result
}

export function LoadsBoard() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(0)

  const search = useDebounce(searchInput, 300)
  const debouncedDateFrom = useDebounce(dateFrom, 300)
  const debouncedDateTo = useDebounce(dateTo, 300)

  const filters = useMemo(
    () => ({
      date_from: debouncedDateFrom || undefined,
      date_to: debouncedDateTo || undefined,
      gate_code: search || undefined,
    }),
    [debouncedDateFrom, debouncedDateTo, search],
  )

  const { data: loads, isLoading, isError, error } = useLoads(filters)
  const updateMutation = useUpdateLoad()
  const { canUndo, performUndo } = useUndo()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const handleUndo = useCallback(async () => {
    const result = await performUndo()
    if (result) {
      setToastMessage(result.message)
      setToastType(result.success ? 'success' : 'error')
      setTimeout(() => setToastMessage(null), 3000)
    }
  }, [performUndo])

  const rowHeights = useTableLayoutStore((s) => s.rowHeights)
  const {
    getColumnWidth,
    isColumnLocked,
    isRowLocked,
    getColumnLockInfo,
    acquireLock: acquireLayoutLock,
    releaseLock: releaseLayoutLock,
    updateColumnWidthLocal,
    persistColumnWidth,
  } = useTableLayout()

  const columnResizeDragging = useRef<{ colId: string; startX: number; startWidth: number; currentWidth?: number } | null>(null)
  const columnLockAcquired = useRef<Record<string, boolean>>({})

  const queryClient = useQueryClient()
  const setOrderedLoadIds = useSelectionStore((s) => s.setOrderedLoadIds)
  const endDrag = useSelectionStore((s) => s.endDrag)
  const deactivateFormatPainter = useSelectionStore((s) => s.deactivateFormatPainter)

  useEffect(() => {
    if (loads) {
      setOrderedLoadIds(loads.map((l) => l.id))
    }
  }, [loads, setOrderedLoadIds])

  useEffect(() => {
    const onUp = () => {
      const state = useSelectionStore.getState()
      if (state.isDragging) {
        endDrag()

        if (state.formatPainterActive && state.formatPainterSource && state.selectedCells.size > 0) {
          const all = queryClient.getQueriesData<Load[]>({ queryKey: ['loads'] })
          const freshLoads = all.flatMap(([_, data]) => data ?? [])
          const source = state.formatPainterSource

          const mergedSource: CellFormat = {}
          for (const src of Object.values(source)) {
            Object.assign(mergedSource, src)
          }

          const cells: BulkFormatCell[] = [...state.selectedCells].map((key) => {
            const [loadId, col] = key.split(':')
            const load = freshLoads.find((l) => l.id === +loadId)
            const existing = load?.cell_formats?.[col] ?? {}
            return { load_id: +loadId, column: col, format: { ...existing, ...mergedSource } }
          })

          if (cells.length === 0) return

          queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) =>
            old?.map((load) => {
              const updates = cells.filter((c) => c.load_id === load.id)
              if (!updates.length) return load
              const newFormats = { ...load.cell_formats }
              updates.forEach((u) => { newFormats[u.column] = u.format })
              return { ...load, cell_formats: newFormats as Record<string, CellFormat> }
            }) ?? [],
          )

          fetch('/api/loads/bulk-format', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            },
            body: JSON.stringify({ cells }),
          }).catch(() => queryClient.invalidateQueries({ queryKey: ['loads'] }))
        }

        const fmtState = useSelectionStore.getState()
        if (fmtState.formatPainterActive && !fmtState.formatPainterSticky) {
          deactivateFormatPainter()
        }
      }
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [endDrag, deactivateFormatPainter, queryClient])

  const handleCellSelect = useCallback((_loadId: number, _colKey: string) => {}, [])

  const actualPageSize = pageSize > 0 ? pageSize : (loads?.length ?? 50)

  const table = useReactTable({
    data: loads ?? [],
    columns,
    state: { sorting, pagination: { pageIndex, pageSize: actualPageSize } },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const handleUpdate = useCallback(
    (id: number, key: string, value: string | number | null) => {
      const field = COLUMN_TO_FIELD[key] ?? key
      updateMutation.mutate({ id, data: { [field]: value } })
    },
    [updateMutation],
  )

  const handleColumnResizeMouseDown = useCallback((e: React.MouseEvent, colId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const currentWidth = getColumnWidth(colId, 150)
    acquireLayoutLock('column', colId).then((success) => {
      if (!success) return
      columnLockAcquired.current[colId] = true
      columnResizeDragging.current = { colId, startX: e.clientX, startWidth: currentWidth }

      const thEl = (e.target as HTMLElement).closest('th') as HTMLElement | null

      const onMove = (ev: MouseEvent) => {
        if (!columnResizeDragging.current) return
        const diff = ev.clientX - columnResizeDragging.current.startX
        const newWidth = Math.max(50, columnResizeDragging.current.startWidth + diff)
        columnResizeDragging.current.currentWidth = newWidth

        if (thEl) {
          thEl.style.width = `${newWidth}px`
          thEl.style.maxWidth = `${newWidth}px`
          thEl.style.minWidth = `${newWidth}px`
          const tableEl = thEl.closest('table')
          if (tableEl) {
            const allThs = Array.from(thEl.parentElement!.children)
            const colIndex = allThs.indexOf(thEl)
            tableEl.querySelectorAll('tr').forEach((tr) => {
              const cells = tr.querySelectorAll('td')
              const tdElem = cells[colIndex - 1] as HTMLElement | undefined
              if (tdElem) {
                tdElem.style.width = `${newWidth}px`
                tdElem.style.maxWidth = `${newWidth}px`
              }
            })
          }
        }
      }

      const onUp = () => {
        if (columnResizeDragging.current) {
          const { colId: cid, startWidth, currentWidth } = columnResizeDragging.current
          const finalWidth = currentWidth ?? startWidth
          updateColumnWidthLocal(cid, finalWidth)
          persistColumnWidth(cid, finalWidth)
          releaseLayoutLock('column', cid)
          columnLockAcquired.current[cid] = false
        }
        columnResizeDragging.current = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    })
  }, [getColumnWidth, acquireLayoutLock, updateColumnWidthLocal, persistColumnWidth, releaseLayoutLock])

  const tableContainerRef = useRef<HTMLDivElement>(null)
  const rows = table.getRowModel().rows

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: (index) => rowHeights[index] ?? 36,
    getItemKey: (index) => rows[index]?.id ?? String(index),
    overscan: 10,
  })

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowHeights, rowVirtualizer])

  const virtualRows = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()

  const pageCount = table.getPageCount()
  const showPagination = pageSize > 0 && loads && loads.length > 0

  const columnHeaderWidths = useMemo(() => {
    return columns.map((col) => ({
      id: col.id!,
      width: getColumnWidth(col.id!, 150),
    }))
  }, [getColumnWidth, columns])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif', padding: '16px', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '13px' }}>
            From:
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPageIndex(0) }}
              style={{ marginLeft: '4px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </label>
          <label style={{ fontSize: '13px' }}>
            To:
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPageIndex(0) }}
              style={{ marginLeft: '4px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </label>
          <input
            type="text"
            placeholder="Search gate code..."
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPageIndex(0) }}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc', width: '180px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo last change (Ctrl+Z)"
            style={{
              padding: '4px 10px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: canUndo ? '#fff' : '#f5f5f5',
              cursor: canUndo ? 'pointer' : 'default',
              fontSize: '13px',
              color: canUndo ? '#333' : '#bbb',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
            </svg>
            Undo
          </button>
          <label style={{ fontSize: '13px', color: '#666' }}>
            Rows:
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPageIndex(0) }}
              style={{ marginLeft: '4px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '13px' }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
              <option value={0}>All</option>
            </select>
          </label>
          <OnlineUsersBar />
        </div>
      </div>

      <div style={{ marginBottom: '8px', flexShrink: 0 }}>
        <FormatToolbar orderedLoadIds={loads?.map((l) => l.id) ?? []} loads={loads ?? []} />
      </div>

      <div ref={tableContainerRef} style={{ flex: 1, overflow: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ background: '#f5f5f5' }}>
                <th style={{
                  width: '50px', minWidth: '50px', maxWidth: '50px',
                  padding: '8px 2px', textAlign: 'center',
                  borderBottom: '2px solid #ddd', borderRight: '1px solid #ddd',
                  fontFamily: 'monospace', fontSize: '11px', fontWeight: 600,
                  color: '#666', userSelect: 'none',
                }}>#</th>
                {hg.headers.map((header) => {
                  const colId = header.column.id
                  const colWidth = columnHeaderWidths.find((c) => c.id === colId)?.width ?? 150
                  const locked = isColumnLocked(colId)
                  const lockInfo = getColumnLockInfo(colId)
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{
                        padding: '8px 4px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderBottom: '2px solid #ddd',
                        borderRight: locked ? '3px solid #f57f17' : '1px solid #ddd',
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                        width: `${colWidth}px`,
                        minWidth: '50px',
                        maxWidth: `${colWidth}px`,
                        position: 'relative',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        background: locked ? 'linear-gradient(to bottom, #fff8e1, #f5f5f5)' : undefined,
                      }}
                      title={locked && lockInfo ? `${lockInfo.user_name} editing (expires ${new Date(lockInfo.expires_at).toLocaleTimeString()})` : header.column.columnDef.header as string}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                      <div
                        onMouseDown={(e) => handleColumnResizeMouseDown(e, colId)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          width: '5px',
                          height: '100%',
                          cursor: 'col-resize',
                          background: locked ? '#f57f17' : 'transparent',
                        }}
                      />
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  Loading...
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#c62828', fontSize: '14px' }}>
                  Failed to load: {error instanceof Error ? error.message : 'Unknown error'}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  No loads found
                </td>
              </tr>
            ) : (
              <>
                {virtualRows.length > 0 && virtualRows[0].start > 0 && (
                  <tr style={{ height: virtualRows[0].start }}>
                    <td colSpan={columns.length + 1} style={{ padding: 0, border: 'none' }} />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  const rowIdx = virtualRow.index
                  const rHeight = virtualRow.size
                  const actualRowNum = (pageSize > 0 ? pageIndex * actualPageSize : 0) + rowIdx + 1
                  const rowLocked = isRowLocked(rowIdx)
                  return (
                    <tr
                      key={row.id}
                      data-index={virtualRow.index}
                      style={{
                        borderBottom: '1px solid #eee',
                        background: row.original.is_mcc ? '#fffef5' : undefined,
                        height: `${rHeight}px`,
                      }}
                    >
                      <td style={{
                        width: '50px', minWidth: '50px', maxWidth: '50px',
                        padding: '0 2px', textAlign: 'center',
                        borderRight: '1px solid #ddd', borderBottom: '1px solid #eee',
                        fontFamily: 'monospace', fontSize: '11px',
                        color: rowLocked ? '#f57f17' : '#888',
                        background: rowLocked ? '#fff8e1' : '#f5f5f5',
                        position: 'relative', userSelect: 'none',
                        height: `${rHeight}px`, lineHeight: `${rHeight}px`,
                        overflow: 'hidden',
                      }}
                        title={rowLocked ? 'Row locked by another user' : `Row ${actualRowNum}`}
                      >
                        {actualRowNum}
                        <RowResizeHandle rowIdx={rowIdx} />
                      </td>
                      {row.getVisibleCells().map((cell) => {
                        const colId = cell.column.id
                        const colWidth = columnHeaderWidths.find((c) => c.id === colId)?.width ?? 150
                        return (
                          <td
                            key={cell.id}
                            style={{
                              padding: 0,
                              height: `${rHeight}px`,
                              borderRight: '1px solid #eee',
                              width: `${colWidth}px`,
                              minWidth: '50px',
                              maxWidth: `${colWidth}px`,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <LoadCell
                              cell={cell as any}
                              onUpdate={handleUpdate}
                              colKey={columnToColKey[cell.column.id]}
                              onCellSelect={handleCellSelect}
                              fillHeight={true}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {virtualRows.length > 0 && (
                  <tr style={{ height: totalSize - virtualRows[virtualRows.length - 1].end }}>
                    <td colSpan={columns.length + 1} style={{ padding: 0, border: 'none' }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && loads && loads.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            fontSize: '13px',
            flexShrink: 0,
          }}
        >
          <span style={{ color: '#666' }}>
            {showPagination
              ? `Showing ${pageIndex * actualPageSize + 1}–${Math.min((pageIndex + 1) * actualPageSize, loads.length)} of ${loads.length}`
              : `Showing all ${loads.length} rows`
            }
          </span>
          {showPagination && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                disabled={pageIndex === 0}
                style={btnStyle}
              >
                Previous
              </button>
              {getPageNumbers(pageIndex, pageCount).map((p, idx) =>
                p === 'ellipsis' ? (
                  <span key={`e-${idx}`} style={{ padding: '4px 4px', color: '#999', fontSize: '13px' }}>…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPageIndex(p)}
                    style={{
                      ...btnStyle,
                      background: pageIndex === p ? '#4a90d9' : undefined,
                      color: pageIndex === p ? '#fff' : undefined,
                    }}
                  >
                    {p + 1}
                  </button>
                )
              )}
              <button
                onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                disabled={pageIndex >= pageCount - 1}
                style={btnStyle}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            padding: '10px 20px',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '14px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            zIndex: 9999,
            background: toastType === 'success' ? '#4caf50' : '#f44336',
            transition: 'opacity 0.3s',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
}