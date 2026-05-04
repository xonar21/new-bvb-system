import { useState, useCallback, useRef, useEffect } from 'react'
import type { CellContext } from '@tanstack/react-table'
import type { Load } from '../../types/Load'
import { useWSStore } from '../../store/wsStore'
import { useAuthStore } from '../../store/authStore'

const USER_COLORS = [
  '#4a90d9', '#e67e22', '#2ecc71', '#9b59b6',
  '#e74c3c', '#1abc9c', '#f39c12', '#3498db',
  '#8e44ad', '#16a085', '#d35400', '#27ae60',
]

function getUserColor(userId: number): string {
  return USER_COLORS[userId % USER_COLORS.length]
}

// Global mutable ref shared across all LoadCell instances
const loadMyFocusRef: { current: { loadId: number; field: string } | null } = { current: null }

interface LoadCellProps {
  cell: CellContext<Load, unknown>
  onUpdate: (id: number, key: string, value: string | number | null) => void
}

export function LoadCell({ cell, onUpdate }: LoadCellProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(cell.getValue() ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)
  const currentUser = useAuthStore((s) => s.user)
  const sendMessage = useWSStore((s) => s.sendMessage)
  const focusedCells = useWSStore((s) => s.focusedCells)
  const setCellFocus = useWSStore((s) => s.setCellFocus)
  const removeCellFocus = useWSStore((s) => s.removeCellFocus)

  const loadId = cell.row.original.id
  const field = cell.column.id
  const focusKey = `${loadId}:${field}`
  const focusInfo = focusedCells[focusKey]
  const isFocused = focusInfo !== undefined
  const isFocusedByOther = isFocused && focusInfo!.user_id !== currentUser?.id
  const isEditingByOther = isFocusedByOther && focusInfo!.editing
  const focusColor = isFocused ? getUserColor(focusInfo!.user_id) : undefined
  const isBold = cell.row.original.is_bold
  const isLocked = cell.row.original.is_lock
  const isMCC = cell.row.original.is_mcc
  const isGateCode = cell.column.id === 'gate_code'

  // Module-level ref shared across all LoadCell instances (use global object directly)

  useEffect(() => {
    if (!editing) {
      setValue(String(cell.getValue() ?? ''))
    }
  }, [cell.getValue(), editing])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    if (editing && isFocusedByOther) {
      setEditing(false)
    }
  }, [isFocusedByOther, editing])

  const sendFocus = useCallback(
    (action: 'focus' | 'blur' | 'editing') => {
      if (!sendMessage || !currentUser) return
      sendMessage(
        JSON.stringify({
          type: 'cell.focus',
          payload: { load_id: loadId, field, action },
        }),
      )
    },
    [sendMessage, currentUser, loadId, field],
  )

  const handleClick = useCallback(() => {
    if (isGateCode || isLocked || isFocusedByOther) return
    if (!currentUser || !sendMessage) return

    // Already focused on this cell — no op
    if (loadMyFocusRef.current?.loadId === loadId && loadMyFocusRef.current?.field === field) return

    // Clear previous focus
    if (loadMyFocusRef.current) {
      const prev = loadMyFocusRef.current
      sendMessage(
        JSON.stringify({
          type: 'cell.focus',
          payload: { load_id: prev.loadId, field: prev.field, action: 'blur' },
        }),
      )
      removeCellFocus(prev.loadId, prev.field)
    }

    // Set new focus
    loadMyFocusRef.current = { loadId, field }
    setCellFocus({
      user_id: currentUser.id,
      user_name: currentUser.email,
      load_id: loadId,
      field,
    })
    sendFocus('focus')
  }, [isGateCode, isLocked, isFocusedByOther, currentUser, sendMessage, loadId, field, removeCellFocus, setCellFocus, sendFocus])

  const handleDoubleClick = useCallback(() => {
    if (isGateCode || isLocked || isFocusedByOther) return
    sendFocus('editing')
    setEditing(true)
  }, [isGateCode, isLocked, isFocusedByOther, sendFocus])

  const finishEditing = useCallback(() => {
    setEditing(false)
    loadMyFocusRef.current = null
    sendFocus('blur')
    removeCellFocus(loadId, field)
    const newVal = value.trim()
    const oldVal = String(cell.getValue() ?? '').trim()
    if (newVal !== oldVal) {
      const parsed = cell.column.id === 'rate' ? (Number(newVal) || null) : newVal || null
      onUpdate(cell.row.original.id, cell.column.id, parsed)
    }
  }, [value, cell, onUpdate, sendFocus, removeCellFocus, loadId, field])

  const handleBlur = useCallback(() => {
    if (!editing) return
    finishEditing()
  }, [editing, finishEditing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        inputRef.current?.blur()
      }
      if (e.key === 'Escape') {
        setValue(String(cell.getValue() ?? ''))
        setEditing(false)
      }
    },
    [cell],
  )

  if (editing && !isGateCode && !isLocked) {
    return (
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            border: '1px solid #4a90d9',
            outline: 'none',
            padding: '2px 4px',
            fontSize: 'inherit',
            fontWeight: isBold ? 700 : 400,
            background: '#fff',
          }}
        />
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'relative',
        cursor: isGateCode || isLocked || isFocusedByOther ? 'default' : 'pointer',
        fontWeight: isBold ? 700 : 400,
        background: isMCC ? '#fff3cd' : isEditingByOther ? '#f5f5f5' : isFocused ? '#f0f7ff' : 'transparent',
        display: 'block',
        minHeight: '20px',
        padding: '2px 4px',
        borderLeft: isFocused ? `3px solid ${focusColor}` : '3px solid transparent',
        opacity: isEditingByOther ? 0.6 : 1,
      }}
      title={
        isLocked
          ? 'Locked'
          : isEditingByOther
            ? `${focusInfo!.user_name} is editing this cell`
            : isFocusedByOther
              ? `${focusInfo!.user_name} is viewing this cell`
              : isFocused
                ? 'Click to focus, double-click to edit'
                : 'Click to focus'
      }
    >
      {cell.getValue() as string}
    </div>
  )
}
