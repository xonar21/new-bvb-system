import { useState, useCallback, useRef, useEffect } from 'react'
import type { CellContext } from '@tanstack/react-table'
import type { Load } from '../../types/Load'

interface LoadCellProps {
  cell: CellContext<Load, unknown>
  onUpdate: (id: number, key: string, value: string | number | null) => void
}

export function LoadCell({ cell, onUpdate }: LoadCellProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(cell.getValue() ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)

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

  const handleDoubleClick = useCallback(() => {
    if (cell.column.id === 'gate_code') return
    setEditing(true)
  }, [cell.column.id])

  const handleBlur = useCallback(() => {
    setEditing(false)
    const newVal = value.trim()
    const oldVal = String(cell.getValue() ?? '').trim()
    if (newVal !== oldVal) {
      const parsed = cell.column.id === 'rate' ? (Number(newVal) || null) : newVal || null
      onUpdate(cell.row.original.id, cell.column.id, parsed)
    }
  }, [value, cell, onUpdate])

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

  const isBold = cell.row.original.is_bold
  const isLocked = cell.row.original.is_lock
  const isMCC = cell.row.original.is_mcc
  const isGateCode = cell.column.id === 'gate_code'

  if (editing && !isGateCode && !isLocked) {
    return (
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
    )
  }

  return (
    <span
      onDoubleClick={handleDoubleClick}
      style={{
        cursor: isGateCode ? 'default' : 'pointer',
        fontWeight: isBold ? 700 : 400,
        background: isMCC ? '#fff3cd' : 'transparent',
        display: 'block',
        minHeight: '20px',
        padding: '2px 4px',
      }}
      title={isLocked ? 'Locked' : 'Double-click to edit'}
    >
      {cell.getValue() as string}
    </span>
  )
}
