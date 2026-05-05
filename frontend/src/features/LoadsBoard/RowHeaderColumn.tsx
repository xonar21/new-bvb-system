import { useCallback, useRef, useState } from 'react'
import { useTableLayout } from '../../hooks/useTableLayout'
import { useAuthStore } from '../../store/authStore'

interface RowHeaderColumnProps {
  rowCount: number
  startIndex?: number
}

const ROW_HEADER_WIDTH = 54
const DEFAULT_ROW_HEIGHT = 36

export function RowHeaderColumn({ rowCount, startIndex = 0 }: RowHeaderColumnProps) {
  const {
    getRowHeight,
    isRowLocked,
    getRowLockInfo,
    acquireLock,
    releaseLock,
    debouncedUpdateRowHeight,
  } = useTableLayout()

  const currentUser = useAuthStore((s) => s.user)
  const draggingRef = useRef<{ rowIdx: number; startY: number; startHeight: number } | null>(null)
  const lockAcquiredRef = useRef<Record<number, boolean>>({})
  const [draggingRow, setDraggingRow] = useState<number | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, rowIdx: number) => {
      e.preventDefault()
      e.stopPropagation()
      if (!currentUser) return

      const rowIndexStr = String(rowIdx)
      acquireLock('row', rowIndexStr).then((success) => {
        if (!success) return
        lockAcquiredRef.current[rowIdx] = true
        const currentHeight = getRowHeight(rowIdx, DEFAULT_ROW_HEIGHT)
        draggingRef.current = { rowIdx, startY: e.clientY, startHeight: currentHeight }
        setDraggingRow(rowIdx)

        const handleMouseMove = (ev: MouseEvent) => {
          if (!draggingRef.current) return
          const diff = ev.clientY - draggingRef.current.startY
          const newHeight = Math.max(20, draggingRef.current.startHeight + diff)
          debouncedUpdateRowHeight(draggingRef.current.rowIdx, newHeight)
        }

        const handleMouseUp = () => {
          if (draggingRef.current) {
            const idx = draggingRef.current.rowIdx
            releaseLock('row', String(idx))
            lockAcquiredRef.current[idx] = false
          }
          draggingRef.current = null
          setDraggingRow(null)
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('mouseup', handleMouseUp)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
      })
    },
    [currentUser, acquireLock, releaseLock, getRowHeight, debouncedUpdateRowHeight],
  )

  const rows = []
  for (let i = 0; i < rowCount; i++) {
    const rowIdx = startIndex + i
    const height = getRowHeight(rowIdx, DEFAULT_ROW_HEIGHT)
    const locked = isRowLocked(rowIdx)
    const lockInfo = getRowLockInfo(rowIdx)
    const isDragging = draggingRow === rowIdx

    rows.push(
      <div
        key={rowIdx}
        style={{
          height: `${height}px`,
          minHeight: `${height}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          background: locked ? '#fff8e1' : '#f5f5f5',
          borderBottom: isDragging ? '2px solid #4a90d9' : '1px solid #ddd',
          borderRight: '1px solid #ddd',
          fontFamily: 'monospace',
          fontSize: '11px',
          color: locked ? '#f57f17' : '#888',
          boxSizing: 'border-box',
          userSelect: 'none',
        }}
        title={
          locked && lockInfo
            ? `${lockInfo.user_name} editing (expires ${new Date(lockInfo.expires_at).toLocaleTimeString()})`
            : `Row ${rowIdx + 1}`
        }
      >
        <span style={{ lineHeight: `${height}px` }}>{rowIdx + 1}</span>
        <div
          onMouseDown={(e) => handleMouseDown(e, rowIdx)}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            cursor: 'row-resize',
            background: locked ? '#f57f17' : 'transparent',
            opacity: 0.6,
          }}
          title="Drag to resize row height"
        />
      </div>,
    )
  }

  return (
    <div
      style={{
        width: `${ROW_HEADER_WIDTH}px`,
        flexShrink: 0,
        overflow: 'hidden',
        borderRight: '1px solid #ccc',
      }}
    >
      <div
        style={{
          height: '40px',
          background: '#e8e8e8',
          borderBottom: '2px solid #ddd',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          fontSize: '11px',
          fontWeight: 600,
          color: '#666',
          userSelect: 'none',
        }}
      >
        #
      </div>
      {rows}
    </div>
  )
}
