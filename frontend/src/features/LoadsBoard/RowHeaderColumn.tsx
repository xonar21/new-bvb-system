import { useCallback, useRef, useState } from 'react'
import { useTableLayout } from '../../hooks/useTableLayout'
import { useAuthStore } from '../../store/authStore'

const DEFAULT_ROW_HEIGHT = 36

interface RowResizeHandleProps {
  rowIdx: number
}

export function RowResizeHandle({ rowIdx }: RowResizeHandleProps) {
  const {
    getRowHeight,
    isRowLocked,
    getRowLockInfo,
    acquireLock,
    releaseLock,
    updateRowHeightLocal,
    persistRowHeight,
  } = useTableLayout()

  const currentUser = useAuthStore((s) => s.user)
  const draggingRef = useRef<{ startY: number; startHeight: number; currentHeight?: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const lockAcquired = useRef(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!currentUser) return

      const rowIndexStr = String(rowIdx)
      acquireLock('row', rowIndexStr).then((success) => {
        if (!success) return
        lockAcquired.current = true
        const currentHeight = getRowHeight(rowIdx, DEFAULT_ROW_HEIGHT)
        draggingRef.current = { startY: e.clientY, startHeight: currentHeight }
        setIsDragging(true)

        const onMove = (ev: MouseEvent) => {
          if (!draggingRef.current) return
          const diff = ev.clientY - draggingRef.current.startY
          const newHeight = Math.max(20, draggingRef.current.startHeight + diff)
          draggingRef.current.currentHeight = newHeight
          updateRowHeightLocal(rowIdx, newHeight)
        }

        const onUp = () => {
          if (draggingRef.current?.currentHeight !== undefined) {
            persistRowHeight(rowIdx, draggingRef.current.currentHeight)
          }
          if (lockAcquired.current) {
            releaseLock('row', String(rowIdx))
            lockAcquired.current = false
          }
          draggingRef.current = null
          setIsDragging(false)
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
      })
    },
    [currentUser, rowIdx, acquireLock, releaseLock, getRowHeight, updateRowHeightLocal, persistRowHeight],
  )

  const locked = isRowLocked(rowIdx)
  const lockInfo = getRowLockInfo(rowIdx)

  return (
    <div
      onMouseDown={handleMouseDown}
      title={
        locked && lockInfo
          ? `${lockInfo.user_name} editing (expires ${new Date(lockInfo.expires_at).toLocaleTimeString()})`
          : 'Drag to resize row height'
      }
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '4px',
        cursor: 'row-resize',
        background: locked ? '#f57f17' : 'transparent',
        opacity: isDragging ? 1 : 0.3,
        zIndex: 2,
      }}
    >
      {isDragging && (
        <div style={{
          position: 'absolute',
          top: '1px',
          left: 0,
          right: 0,
          height: '2px',
          background: '#4a90d9',
        }} />
      )}
    </div>
  )
}
