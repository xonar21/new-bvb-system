import { useCallback } from 'react'
import { useUpdateCellFormat } from '../../hooks/useLoads'
import type { CellFormat } from '../../types/Load'

const COLOR_PRESETS = [
  '#ffffff', '#ffcccc', '#ffebcc', '#fff9cc', '#d4edda', '#d1ecf1',
  '#d6d8db', '#f5f5f5', '#ff6b6b', '#ffa726', '#ffee58', '#66bb6a',
  '#42a5f5', '#ab47bc', '#ef5350', '#ec407a', '#7e57c2', '#5c6bc0',
  '#26c6da', '#26a69a', '#9ccc65', '#ff7043', '#8d6e63', '#78909c',
]

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24]

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 10px',
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: '6px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  fontSize: '13px',
  flexWrap: 'wrap',
}

const btnBase: React.CSSProperties = {
  width: '28px',
  height: '28px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  background: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  padding: 0,
}

const colorBtn = (color: string, active: boolean): React.CSSProperties => ({
  ...btnBase,
  background: color,
  border: active ? '2px solid #4a90d9' : '1px solid #ccc',
  boxShadow: active ? '0 0 0 1px #4a90d9' : undefined,
})

interface FormatToolbarProps {
  loadId: number
  colKey: string
  currentFormat: CellFormat | undefined
  onClose: () => void
}

export function FormatToolbar({ loadId, colKey, currentFormat, onClose }: FormatToolbarProps) {
  const updateCellFormat = useUpdateCellFormat()

  const applyFormat = useCallback(
    (patch: Partial<CellFormat>) => {
      const cleaned: Record<string, unknown> = {}
      if ('bg' in patch) cleaned.bg = patch.bg ?? null
      if ('fg' in patch) cleaned.fg = patch.fg ?? null
      if ('bold' in patch) cleaned.bold = patch.bold ?? false
      if ('fontSize' in patch) cleaned.fontSize = patch.fontSize ?? null
      updateCellFormat.mutate({ id: loadId, column: colKey, format: cleaned as CellFormat })
    },
    [loadId, colKey, updateCellFormat],
  )

  const toggleBold = useCallback(() => {
    applyFormat({ bold: !currentFormat?.bold })
  }, [applyFormat, currentFormat])

  const setBg = useCallback(
    (color: string) => {
      applyFormat({ bg: color === '#ffffff' ? null : color })
    },
    [applyFormat],
  )

  const setFg = useCallback(
    (color: string) => {
      applyFormat({ fg: color === '#000000' ? null : color })
    },
    [applyFormat],
  )

  const setFontSize = useCallback(
    (size: number) => {
      applyFormat({ fontSize: size === 10 ? null : size })
    },
    [applyFormat],
  )

  return (
    <div style={toolbarStyle}>
      <button
        onClick={toggleBold}
        style={{
          ...btnBase,
          fontWeight: 700,
          background: currentFormat?.bold ? '#e3f2fd' : '#fff',
          borderColor: currentFormat?.bold ? '#4a90d9' : '#ccc',
        }}
        title="Bold"
      >
        B
      </button>

      <div style={{ width: '1px', height: '20px', background: '#ddd' }} />

      <span style={{ fontSize: '11px', color: '#666' }}>Bg:</span>
      <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', maxWidth: '160px' }}>
        {COLOR_PRESETS.slice(0, 12).map((color) => (
          <button
            key={`bg-${color}`}
            onClick={() => setBg(color)}
            style={colorBtn(color, currentFormat?.bg === color)}
            title={color}
          />
        ))}
      </div>

      <div style={{ width: '1px', height: '20px', background: '#ddd' }} />

      <span style={{ fontSize: '11px', color: '#666' }}>Fg:</span>
      <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', maxWidth: '160px' }}>
        {COLOR_PRESETS.slice(0, 12).map((color) => (
          <button
            key={`fg-${color}`}
            onClick={() => setFg(color)}
            style={{
              ...colorBtn(color, currentFormat?.fg === color),
              position: 'relative',
            }}
            title={color}
          >
            {color === '#ffffff' && (
              <span style={{ fontSize: '10px', color: '#999', lineHeight: '1' }}>/</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ width: '1px', height: '20px', background: '#ddd' }} />

      <span style={{ fontSize: '11px', color: '#666' }}>Size:</span>
      <select
        value={currentFormat?.fontSize ?? 10}
        onChange={(e) => setFontSize(Number(e.target.value))}
        style={{
          padding: '2px 4px',
          borderRadius: '4px',
          border: '1px solid #ccc',
          fontSize: '12px',
        }}
      >
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div style={{ flex: 1 }} />

      <button
        onClick={onClose}
        style={{
          ...btnBase,
          width: 'auto',
          padding: '0 8px',
          fontSize: '16px',
          lineHeight: '1',
        }}
        title="Close"
      >
        &times;
      </button>
    </div>
  )
}
