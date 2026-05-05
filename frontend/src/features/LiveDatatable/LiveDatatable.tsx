import { useEffect, useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { useLoads, useUpdateLoad } from '../../hooks/useLoads'
import { columns } from './columns'
import { LoadCell } from './LoadCell'
import { OnlineUsersBar } from './OnlineUsersBar'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

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

export function LiveDatatable() {
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

  const columnToField: Record<string, string> = {
    pick_up_date: 'pick_up_date_col1',
    commodity: 'commodity_col2',
    pickup_location: 'pickup_date_location_col3',
    delivery_location: 'delivery_date_location_col4',
    assigned_user: 'assigned_user_col5',
    rate: 'rate_col7',
    notes: 'note_mcc',
  }

  const handleUpdate = (id: number, key: string, value: string | number | null) => {
    const field = columnToField[key] ?? key
    updateMutation.mutate({ id, data: { [field]: value } })
  }

  const pageCount = table.getPageCount()
  const showPagination = pageSize > 0 && loads && loads.length > 0

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

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ background: '#f5f5f5' }}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderBottom: '2px solid #ddd',
                      whiteSpace: 'nowrap',
                      userSelect: 'none',
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  Loading...
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '40px', color: '#c62828', fontSize: '14px' }}>
                  Failed to load: {error instanceof Error ? error.message : 'Unknown error'}
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  No loads found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: '1px solid #eee',
                    background: row.original.is_mcc ? '#fffef5' : undefined,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: '2px 4px',
                        borderRight: '1px solid #eee',
                        maxWidth: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <LoadCell cell={cell as any} onUpdate={handleUpdate} />
                    </td>
                  ))}
                </tr>
              ))
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
