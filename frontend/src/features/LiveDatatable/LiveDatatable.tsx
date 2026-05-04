import { useMemo, useState } from 'react'
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

export function LiveDatatable() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [pageIndex, setPageIndex] = useState(0)

  const filters = useMemo(
    () => ({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      gate_code: search || undefined,
    }),
    [dateFrom, dateTo, search],
  )

  const { data: loads, isLoading, isError, error } = useLoads(filters)
  const updateMutation = useUpdateLoad()

  const table = useReactTable({
    data: loads ?? [],
    columns,
    state: { sorting, pagination: { pageIndex, pageSize: 50 } },
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

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '8px',
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
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPageIndex(0) }}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc', width: '180px' }}
          />
        </div>
        <OnlineUsersBar />
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
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
          }}
        >
          <span style={{ color: '#666' }}>
            Showing {pageIndex * 50 + 1}–{Math.min((pageIndex + 1) * 50, loads.length)} of {loads.length}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={pageIndex === 0}
              style={btnStyle}
            >
              Previous
            </button>
            {Array.from({ length: Math.min(pageCount, 10) }, (_, i) => (
              <button
                key={i}
                onClick={() => setPageIndex(i)}
                style={{
                  ...btnStyle,
                  background: pageIndex === i ? '#4a90d9' : undefined,
                  color: pageIndex === i ? '#fff' : undefined,
                }}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              disabled={pageIndex >= pageCount - 1}
              style={btnStyle}
            >
              Next
            </button>
          </div>
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
