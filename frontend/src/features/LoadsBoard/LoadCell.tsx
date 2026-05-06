import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import type { CellContext } from '@tanstack/react-table'
import type { Load } from '../../types/Load'
import { useWSStore } from '../../store/wsStore'
import { useAuthStore } from '../../store/authStore'
import { useSelectionStore, useIsCellSelected } from '../../store/selectionStore'

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
  onUpdate?: (id: number, key: string, value: string | number | null) => void
  colKey?: string
  onCellSelect?: (loadId: number, colKey: string) => void
  fillHeight?: boolean
}

function blendWithBlue(bg: string): string {
  if (!bg || bg === 'transparent') return 'rgba(26,115,232,0.1)'
  const r = parseInt(bg.slice(1, 3), 16)
  const g = parseInt(bg.slice(3, 5), 16)
  const b = parseInt(bg.slice(5, 7), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 'rgba(26,115,232,0.1)'
  return `rgba(${Math.round(r * 0.85 + 26 * 0.15)},${Math.round(g * 0.85 + 115 * 0.15)},${Math.round(b * 0.85 + 232 * 0.15)},0.85)`
}

function blendWithOrange(bg: string): string {
  if (!bg || bg === 'transparent') return 'rgba(251,188,5,0.2)'
  const r = parseInt(bg.slice(1, 3), 16)
  const g = parseInt(bg.slice(3, 5), 16)
  const b = parseInt(bg.slice(5, 7), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 'rgba(251,188,5,0.2)'
  return `rgba(${Math.round(r * 0.85 + 251 * 0.15)},${Math.round(g * 0.85 + 188 * 0.15)},${Math.round(b * 0.85 + 5 * 0.15)},0.85)`
}

function getCellStyle(load: Load, colKey?: string): React.CSSProperties {
  if (!colKey) return {}
  const fmt = load.cell_formats?.[colKey]
  if (!fmt) return {}

  const textDecoration = [
    fmt.underline && 'underline',
    fmt.strikethrough && 'line-through',
  ].filter(Boolean).join(' ')

  return {
    backgroundColor: fmt.bg ?? undefined,
    color: fmt.fg ?? undefined,
    fontWeight: fmt.bold || load.is_bold ? 700 : 400,
    fontStyle: fmt.italic ? 'italic' : undefined,
    textDecoration: textDecoration || undefined,
    fontSize: fmt.fontSize ? `${fmt.fontSize}pt` : undefined,
    textAlign: fmt.textAlign ?? undefined,
    verticalAlign: fmt.verticalAlign ?? undefined,
  }
}

function LoadCellInner({ cell, onUpdate, colKey, onCellSelect, fillHeight }: LoadCellProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(cell.getValue() ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)

  const currentUser = useAuthStore((s) => s.user)
  const sendMessage = useWSStore((s) => s.sendMessage)

  const loadId = cell.row.original.id
  const field = cell.column.id
  const focusKey = `${loadId}:${field}`

  // Per-cell subscriptions — only re-renders when THIS cell's focus/selection changes
  const focusInfo = useWSStore((s) => s.focusedCells[focusKey])
  const formatPainterActive = useSelectionStore((s) => s.formatPainterActive)
  const cellKey = colKey ? `${loadId}:${colKey}` : ''
  const isSelected = useIsCellSelected(cellKey)

  const isFocused = focusInfo !== undefined
  const isFocusedByOther = isFocused && focusInfo!.user_id !== currentUser?.id
  const isEditingByOther = isFocusedByOther && focusInfo!.editing
  const focusColor = isFocused ? getUserColor(focusInfo!.user_id) : undefined
  const isBold = cell.row.original.is_bold
  const isLocked = cell.row.original.is_lock
  const isMCC = cell.row.original.is_mcc
  const isGateCode = cell.column.id === 'gate_code'

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

    if (loadMyFocusRef.current?.loadId === loadId && loadMyFocusRef.current?.field === field) return

    const { removeCellFocus, setCellFocus } = useWSStore.getState()

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

    loadMyFocusRef.current = { loadId, field }
    setCellFocus({
      user_id: currentUser.id,
      user_name: currentUser.email,
      load_id: loadId,
      field,
    })
    sendFocus('focus')
    onCellSelect?.(loadId, colKey ?? field)
  }, [isGateCode, isLocked, isFocusedByOther, currentUser, sendMessage, loadId, field, sendFocus, onCellSelect, colKey])

  const handleDoubleClick = useCallback(() => {
    if (isGateCode || isLocked || isFocusedByOther) return
    sendFocus('editing')
    setEditing(true)
  }, [isGateCode, isLocked, isFocusedByOther, sendFocus])

  const finishEditing = useCallback(() => {
    setEditing(false)
    loadMyFocusRef.current = null
    sendFocus('blur')
    useWSStore.getState().removeCellFocus(loadId, field)
    const newVal = value.trim()
    const oldVal = String(cell.getValue() ?? '').trim()
    if (newVal !== oldVal) {
      const parsed = cell.column.id === 'rate' ? (Number(newVal) || null) : newVal || null
      onUpdate?.(cell.row.original.id, cell.column.id, parsed)
    }
  }, [value, cell, onUpdate, sendFocus, loadId, field])

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

  const cellStyle = useMemo(
    () => getCellStyle(cell.row.original, colKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cell.row.original.cell_formats, colKey, cell.row.original.is_bold],
  )

  const selectionBg = isSelected
    ? (formatPainterActive
        ? (cellStyle.backgroundColor ? blendWithOrange(cellStyle.backgroundColor as string) : 'rgba(251,188,5,0.2)')
        : (cellStyle.backgroundColor ? blendWithBlue(cellStyle.backgroundColor as string) : 'rgba(26,115,232,0.1)'))
    : undefined

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isGateCode || isLocked) return
    e.preventDefault()
    if (!colKey || !currentUser) return

    const { removeCellFocus, setCellFocus } = useWSStore.getState()
    const { startDrag } = useSelectionStore.getState()

    if (loadMyFocusRef.current) {
      const prev = loadMyFocusRef.current
      if (sendMessage) {
        sendMessage(
          JSON.stringify({
            type: 'cell.focus',
            payload: { load_id: prev.loadId, field: prev.field, action: 'blur' },
          }),
        )
      }
      removeCellFocus(prev.loadId, prev.field)
    }

    loadMyFocusRef.current = { loadId, field }
    if (sendMessage) {
      setCellFocus({
        user_id: currentUser.id,
        user_name: currentUser.email,
        load_id: loadId,
        field,
      })
      sendFocus('focus')
    }
    startDrag(loadId, colKey)
  }, [loadId, colKey, isGateCode, isLocked, currentUser, sendMessage, sendFocus])

  const handleMouseEnter = useCallback(() => {
    if (!colKey) return
    const { isDragging, extendDrag } = useSelectionStore.getState()
    if (!isDragging) return
    extendDrag(loadId, colKey)
  }, [loadId, colKey])

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
            outline: isSelected ? '2px solid #1a73e8' : 'none',
            outlineOffset: '-1px',
            padding: '1px',
            fontSize: cellStyle.fontSize ?? 'inherit',
            fontWeight: cellStyle.fontWeight ?? (isBold ? 700 : 400),
            fontStyle: cellStyle.fontStyle ?? undefined,
            textDecoration: cellStyle.textDecoration ?? undefined,
            textAlign: cellStyle.textAlign ?? undefined,
            color: cellStyle.color ?? undefined,
            background: selectionBg ?? cellStyle.backgroundColor ?? '#fff',
          }}
        />
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      style={{
        position: 'relative',
        display: fillHeight ? 'flex' : undefined,
        alignItems: fillHeight ? 'center' : undefined,
        cursor: formatPainterActive ? 'cell' : (isGateCode || isLocked || isFocusedByOther ? 'default' : 'pointer'),
        fontWeight: cellStyle.fontWeight ?? (isBold ? 700 : 400),
        fontStyle: cellStyle.fontStyle ?? undefined,
        textDecoration: cellStyle.textDecoration ?? undefined,
        textAlign: cellStyle.textAlign ?? undefined,
        verticalAlign: cellStyle.verticalAlign ?? undefined,
        background: selectionBg ?? cellStyle.backgroundColor ?? (isMCC ? '#fff3cd' : isEditingByOther ? '#f5f5f5' : isFocused ? '#f0f7ff' : 'transparent'),
        color: cellStyle.color ?? undefined,
        fontSize: cellStyle.fontSize ?? undefined,
        outline: isSelected ? `2px solid ${formatPainterActive ? '#fbbc04' : '#1a73e8'}` : undefined,
        outlineOffset: '-1px',
        ...(fillHeight ? { height: '100%', boxSizing: 'border-box' } : {}),
        overflow: 'hidden',
        padding: '1px',
        borderLeft: isFocused ? `3px solid ${focusColor}` : '3px solid transparent',
        opacity: isEditingByOther ? 0.6 : 1,
        userSelect: 'none',
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
      {cell.column.id === 'pick_up_date' ? formatDate(cell.getValue() as string | null) : (cell.getValue() as string)}
    </div>
  )
}

function shallowEqualFormats(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (a === b) return true
  if (!a && !b) return true
  if (!a || !b) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function areLoadCellPropsEqual(prev: LoadCellProps, next: LoadCellProps): boolean {
  if (prev.colKey !== next.colKey) return false
  if (prev.fillHeight !== next.fillHeight) return false
  if (prev.onUpdate !== next.onUpdate) return false
  if (prev.onCellSelect !== next.onCellSelect) return false
  const po = prev.cell.row.original
  const no = next.cell.row.original
  if (po.id !== no.id) return false
  if (po.is_lock !== no.is_lock) return false
  if (po.is_bold !== no.is_bold) return false
  if (po.is_mcc !== no.is_mcc) return false
  if (prev.cell.getValue() !== next.cell.getValue()) return false
  const colK = next.colKey ?? ''
  if (!shallowEqualFormats(po.cell_formats?.[colK] as Record<string, unknown> | undefined, no.cell_formats?.[colK] as Record<string, unknown> | undefined)) return false
  return true
}

export const LoadCell = memo(LoadCellInner, areLoadCellPropsEqual)

function formatDate(val: string | null): string {
  if (!val) return ''
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${mm}/${dd}/${yyyy}`
}
