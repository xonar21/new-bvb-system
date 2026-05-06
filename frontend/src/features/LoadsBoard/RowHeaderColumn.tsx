import { useCallback, useRef, useState } from 'react'
import { useTableLayoutStore } from '../../store/tableLayoutStore'
import { useAuthStore } from '../../store/authStore'
import { apiClient } from '../../api/client'
import type { LockAcquireResponse } from '../../types/Load'

const DEFAULT_ROW_HEIGHT = 36

interface RowResizeHandleProps {
  rowIdx: number
}

export function RowResizeHandle({ rowIdx }: RowResizeHandleProps) {
  const lockInfo = useTableLayoutStore((s) => s.activeLocks.rows[String(rowIdx)] ?? null)
  const currentUser = useAuthStore((s) => s.user)
  const draggingRef = useRef<{ startY: number; startHeight: number; currentHeight?: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const lockAcquired = useRef(false)
  const rowIdxStr = String(rowIdx)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!currentUser) return

      const store = useTableLayoutStore.getState()
      const currentHeight = store.rowHeights[rowIdx] ?? DEFAULT_ROW_HEIGHT

      apiClient.post<LockAcquireResponse>('/api/table-layout/lock-acquire', {
        target_type: 'row',
        target_name: rowIdxStr,
      }).then((res) => {
        if (!res.success) return
        lockAcquired.current = true
        draggingRef.current = { startY: e.clientY, startHeight: currentHeight }
        setIsDragging(true)

        const rowElement = (e.target as HTMLElement).closest('tr') as HTMLElement | null

        const onMove = (ev: MouseEvent) => {
          if (!draggingRef.current) return
          const diff = ev.clientY - draggingRef.current.startY
          const newHeight = Math.max(20, draggingRef.current.startHeight + diff)
          draggingRef.current.currentHeight = newHeight

          if (rowElement) {
            rowElement.style.height = `${newHeight}px`
            const tds = rowElement.querySelectorAll('td')
            tds.forEach((td) => {
              ;(td as HTMLElement).style.height = `${newHeight}px`
            })
            const firstTd = tds[0] as HTMLElement | null
            if (firstTd) {
              firstTd.style.lineHeight = `${newHeight}px`
            }
          }
        }

        const onUp = () => {
          if (draggingRef.current?.currentHeight !== undefined) {
            const finalHeight = draggingRef.current.currentHeight
            useTableLayoutStore.getState().updateRowHeight(rowIdx, finalHeight)
            apiClient.put(`/api/table-layout/row/${rowIdx}/height`, { height: finalHeight }).catch(() => {})
          }
          if (lockAcquired.current) {
            apiClient.post('/api/table-layout/lock-release', {
              target_type: 'row',
              target_name: rowIdxStr,
            }).catch(() => {})
            useTableLayoutStore.getState().removeLock('row', rowIdxStr)
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
    [currentUser, rowIdx, rowIdxStr],
  )

  const isRowLocked = lockInfo !== null

  return (
    <div
      onMouseDown={handleMouseDown}
      title={
        isRowLocked && lockInfo
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
        background: isRowLocked ? '#f57f17' : 'transparent',
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