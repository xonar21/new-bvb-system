import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import type { CellContext } from '@tanstack/react-table'
import type { Load } from '../../types/Load'
import { useWSStore } from '../../store/wsStore'
import { useAuthStore } from '../../store/authStore'
import { useSelectionStore, useIsCellSelected } from '../../store/selectionStore'
import { useCellStore, COLUMN_TO_FIELD } from '../../store/cellStore'

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
  const inputRef = useRef<HTMLInputElement>(null)

  const currentUser = useAuthStore((s) => s.user)
  const sendMessage = useWSStore((s) => s.sendMessage)


  const loadId = cell.row.original.id
  const field = cell.column.id          // TanStack column id (e.g. "pick_up_date")
  const focusKey = `${loadId}:${field}`

  // ── cellStore subscription: fine-grained, only this cell re-renders ──────
  // Falls back to cell.getValue() if cellStore hasn't been initialised yet.
  const storeValue = useCellStore((s) => s.cells[focusKey]?.value)
  const storeStyle = useCellStore((s) => s.cells[focusKey]?.style)
  const displayValue = storeValue ?? String(cell.getValue() ?? '')

  // Local edit buffer — initialised from displayValue when edit starts.
  const [value, setValue] = useState(displayValue)

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

  // Sync local buffer when displayValue changes (WS update, load.updated, etc.)
  // but only when not currently editing.
  useEffect(() => {
    if (!editing) {
      setValue(displayValue)
    }
  }, [displayValue, editing])

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
    // Allow focus/presence for all cells (even read-only ones like gate_code).
    // But prevent editing if locked or gate_code.
    if (isFocusedByOther) return
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
  }, [isFocusedByOther, currentUser, sendMessage, loadId, field, sendFocus, onCellSelect, colKey])

  const handleDoubleClick = useCallback(() => {
    // Prevent editing gate_code (read-only) or locked/editing-by-other cells
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
    const oldVal = displayValue.trim()
    if (newVal === oldVal) return

    // Don't save if this is a read-only column (like gate_code)
    if (isGateCode) return

    const isNumeric = ['rate', 'rate_min', 'rate_max', 'font_size', 'order_number'].includes(field)
    const parsed = isNumeric ? (Number(newVal) || null) : newVal || null

    // 1. Optimistic update in cellStore — instant, no round-trip.
    const colId = colKey ?? field
    useCellStore.getState().setCell(loadId, colId, {
      value: parsed === null ? '' : String(parsed),
    })

    // 2. Forward via WebSocket — backend broadcasts to others + async DB write.
    // Include current cell style so it's preserved when other users see the update.
    const dbField = COLUMN_TO_FIELD[field]
    if (dbField && sendMessage) {
      const cellStyle = storeStyle ? {
        bg: storeStyle.bg,
        fc: storeStyle.fc,
        bold: storeStyle.bold,
        italic: storeStyle.italic,
        underline: storeStyle.underline,
        strikethrough: storeStyle.strikethrough,
        fontSize: storeStyle.fontSize,
        textAlign: storeStyle.textAlign,
        verticalAlign: storeStyle.verticalAlign,
      } : undefined

      sendMessage(JSON.stringify({
        type: 'cell.update',
        payload: {
          load_id: loadId,
          field: dbField,
          value: parsed,
          style: cellStyle,
        },
      }))
    }

    // 3. Backward compat: notify parent (e.g. for REST-based fallback if WS is down).
    onUpdate?.(cell.row.original.id, cell.column.id, parsed)
  }, [value, displayValue, cell, onUpdate, sendFocus, loadId, field, colKey, sendMessage, storeStyle, isGateCode])

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

  const cellStyle = useMemo(() => {
    const base = getCellStyle(cell.row.original, colKey)
    // Overlay optimistic style from cellStore (takes precedence over DB data).
    if (storeStyle) {
      if (storeStyle.bg) base.backgroundColor = storeStyle.bg
      if (storeStyle.fc) base.color = storeStyle.fc
      if (storeStyle.bold !== undefined) base.fontWeight = storeStyle.bold ? 700 : 400
      if (storeStyle.italic !== undefined) base.fontStyle = storeStyle.italic ? 'italic' : undefined
      if (storeStyle.underline !== undefined || storeStyle.strikethrough !== undefined) {
        const decs = [storeStyle.underline && 'underline', storeStyle.strikethrough && 'line-through'].filter(Boolean)
        base.textDecoration = decs.length > 0 ? decs.join(' ') : undefined
      }
      if (storeStyle.fontSize) base.fontSize = `${storeStyle.fontSize}pt`
      if (storeStyle.textAlign) base.textAlign = storeStyle.textAlign as any
      if (storeStyle.verticalAlign) base.verticalAlign = storeStyle.verticalAlign as any
    }
    return base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.row.original.cell_formats, colKey, cell.row.original.is_bold, storeStyle])

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

  const presenceBorder = isFocused
    ? `2px solid ${focusColor}`
    : isEditingByOther || isFocusedByOther
      ? `2px dashed ${focusColor}`
      : undefined

  const presenceShadow = isFocused
    ? `inset 0 0 0 2px ${focusColor}, 0 0 0 1px ${focusColor}33`
    : isEditingByOther
      ? `inset 0 0 0 2px ${focusColor}40, 0 0 3px ${focusColor}60`
      : isFocusedByOther
        ? `inset 0 0 0 1px ${focusColor}40`
        : undefined

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
        background: selectionBg ?? cellStyle.backgroundColor ?? (isMCC ? '#fff3cd' : isEditingByOther ? 'rgba(255,193,7,0.08)' : isFocused ? 'transparent' : 'transparent'),
        color: cellStyle.color ?? undefined,
        fontSize: cellStyle.fontSize ?? undefined,
        outline: isSelected ? `2px solid ${formatPainterActive ? '#fbbc04' : '#1a73e8'}` : undefined,
        outlineOffset: '-1px',
        ...(fillHeight ? { height: '100%', boxSizing: 'border-box' } : {}),
        overflow: 'hidden',
        padding: '1px',
        border: presenceBorder || 'none',
        boxShadow: presenceShadow,
        opacity: 1,
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
  if (JSON.stringify(po.cell_formats?.[colK]) !== JSON.stringify(no.cell_formats?.[colK])) return false
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
