import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { BulkFormatCell, CellFormat, Load } from '../../types/Load'
import { useSelectionStore } from '../../store/selectionStore'
import { ColorPicker } from './ColorPicker'

const btnStyles = `
  .format-btn {
    outline: none !important;
    box-shadow: none !important;
  }
  .format-btn:focus, .format-btn:focus-visible, .format-btn:active {
    outline: none !important;
    box-shadow: none !important;
  }
`

const btnBase: React.CSSProperties = {
  width: 28,
  height: 28,
  border: '1px solid #dadce0',
  borderRadius: '4px',
  background: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  color: '#3c4043',
  padding: 0,
  outline: 'none',
  boxShadow: 'none',
  transition: 'background-color 0.15s, border-color 0.15s',
} as React.CSSProperties & { WebkitAppearance: string }

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: '#e8f0fe',
  borderColor: '#aecbfa',
}

const separator: React.CSSProperties = {
  width: '1px',
  height: '20px',
  background: '#e0e0e0',
  margin: '0 4px',
}

interface FormatToolbarProps {
  orderedLoadIds: number[]
}

function mergeFormats(formats: CellFormat[]): CellFormat {
  if (formats.length === 0) return {}
  const result: CellFormat = {}
  const keys: (keyof CellFormat)[] = ['bg', 'fg', 'bold', 'italic', 'underline', 'strikethrough', 'fontSize', 'textAlign', 'verticalAlign']
  for (const key of keys) {
    const vals = formats.map((f) => f[key]).filter((v) => v !== undefined)
    if (vals.length === 0) continue
    const allSame = vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0]))
    if (allSame) {
      (result as any)[key] = vals[0]
    }
  }
  return result
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function FormatToolbar({ orderedLoadIds: _orderedLoadIds }: FormatToolbarProps) {
  const queryClient = useQueryClient()
  const selectedCells = useSelectionStore((s) => s.selectedCells)
  const formatPainterActive = useSelectionStore((s) => s.formatPainterActive)
  const formatPainterSticky = useSelectionStore((s) => s.formatPainterSticky)
  const activateFormatPainter = useSelectionStore((s) => s.activateFormatPainter)
  const deactivateFormatPainter = useSelectionStore((s) => s.deactivateFormatPainter)

  const [colorPickerType, setColorPickerType] = useState<'text' | 'fill' | null>(null)
  const [fontSizeInput, setFontSizeInput] = useState('')
  const [showFontInput, setShowFontInput] = useState(false)
  const colorBtnRef = useRef<HTMLButtonElement | null>(null)
  const fillBtnRef = useRef<HTMLButtonElement | null>(null)

  const hasSelection = selectedCells.size > 0

  const loads = queryClient.getQueryData<Load[]>(['loads']) ?? []

  const resolvedFormat = useMemo(() => {
    if (!hasSelection) return {}
    const formats: CellFormat[] = [...selectedCells].map((key) => {
      const [loadId, col] = key.split(':')
      const load = loads.find((l) => l.id === +loadId)
      return load?.cell_formats?.[col] ?? {}
    })
    return mergeFormats(formats)
  }, [selectedCells, loads, hasSelection])

  const applyFormat = useCallback((patch: Partial<CellFormat>) => {
    if (!hasSelection) return
    const cells: BulkFormatCell[] = [...selectedCells].map((key) => {
      const [loadId, col] = key.split(':')
      const load = loads.find((l) => l.id === +loadId)
      const existing = load?.cell_formats?.[col] ?? {}
      return { load_id: +loadId, column: col, format: { ...existing, ...patch } }
    })

    queryClient.setQueryData<Load[]>(['loads'], (old) =>
      old?.map((load) => {
        const updates = cells.filter((c) => c.load_id === load.id)
        if (!updates.length) return load
        const newFormats = { ...load.cell_formats }
        updates.forEach((u) => { newFormats[u.column] = u.format })
        return { ...load, cell_formats: newFormats as Record<string, CellFormat> }
      }) ?? [],
    )

    fetch('/api/loads/bulk-format', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
      },
      body: JSON.stringify({ cells }),
    }).catch(() => queryClient.invalidateQueries({ queryKey: ['loads'] }))
  }, [selectedCells, loads, hasSelection, queryClient])

  const toggleBold = useCallback(() => applyFormat({ bold: !resolvedFormat.bold }), [applyFormat, resolvedFormat.bold])
  const toggleItalic = useCallback(() => applyFormat({ italic: !resolvedFormat.italic }), [applyFormat, resolvedFormat.italic])
  const toggleUnderline = useCallback(() => applyFormat({ underline: !resolvedFormat.underline }), [applyFormat, resolvedFormat.underline])
  const toggleStrikethrough = useCallback(() => applyFormat({ strikethrough: !resolvedFormat.strikethrough }), [applyFormat, resolvedFormat.strikethrough])

  const setTextAlign = useCallback((align: 'left' | 'center' | 'right') => applyFormat({ textAlign: align }), [applyFormat])
  const setVerticalAlign = useCallback((align: 'top' | 'middle' | 'bottom') => applyFormat({ verticalAlign: align }), [applyFormat])

  const handleFontSizeChange = useCallback((delta: number) => {
    const current = resolvedFormat.fontSize ?? 10
    const newSize = Math.max(6, Math.min(96, current + delta))
    applyFormat({ fontSize: newSize })
  }, [applyFormat, resolvedFormat.fontSize])

  const handleFontSizeInput = useCallback(() => {
    const val = parseInt(fontSizeInput, 10)
    if (!isNaN(val) && val >= 6 && val <= 96) {
      applyFormat({ fontSize: val })
    }
    setShowFontInput(false)
  }, [fontSizeInput, applyFormat])

  const handleColorChange = useCallback((hex: string | null) => {
    if (colorPickerType === 'text') {
      applyFormat({ fg: hex })
    } else {
      applyFormat({ bg: hex })
    }
    setColorPickerType(null)
  }, [colorPickerType, applyFormat])

  const handleFormatPainterClick = useCallback(() => {
    if (formatPainterActive) {
      deactivateFormatPainter()
      return
    }
    if (!hasSelection) return
    const source: Record<string, CellFormat> = {}
    selectedCells.forEach((key) => {
      const [loadId, col] = key.split(':')
      const load = loads.find((l) => l.id === +loadId)
      if (load?.cell_formats?.[col]) {
        source[col] = load.cell_formats[col]
      }
    })
    activateFormatPainter(source, false)
  }, [formatPainterActive, hasSelection, selectedCells, loads, activateFormatPainter, deactivateFormatPainter])

  const handleFormatPainterDoubleClick = useCallback(() => {
    if (!hasSelection) return
    const source: Record<string, CellFormat> = {}
    selectedCells.forEach((key) => {
      const [loadId, col] = key.split(':')
      const load = loads.find((l) => l.id === +loadId)
      if (load?.cell_formats?.[col]) {
        source[col] = load.cell_formats[col]
      }
    })
    activateFormatPainter(source, true)
  }, [hasSelection, selectedCells, loads, activateFormatPainter])

  const selectedFgColor = resolvedFormat.fg ?? null
  const selectedBgColor = resolvedFormat.bg ?? null

  if (!hasSelection && !formatPainterActive) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 8px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #e0e0e0', opacity: 0.4 }}>
        <span style={{ fontSize: '12px', color: '#80868b' }}>Select cells to format</span>
      </div>
    )
  }

  return (
    <>
      <style>{btnStyles}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 8px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #e0e0e0', flexWrap: 'wrap' }}>
      {/* Font size */}
      <button className="format-btn" style={btnBase} onClick={() => handleFontSizeChange(-1)} title="Decrease font size">−</button>
      {showFontInput ? (
        <input
          autoFocus
          value={fontSizeInput}
          onChange={(e) => setFontSizeInput(e.target.value)}
          onBlur={handleFontSizeInput}
          onKeyDown={(e) => { if (e.key === 'Enter') handleFontSizeInput(); if (e.key === 'Escape') setShowFontInput(false) }}
          style={{ width: 30, textAlign: 'center', padding: '2px', border: '1px solid #dadce0', borderRadius: '4px', fontSize: '12px', outline: 'none' }}
        />
      ) : (
        <button
          style={{ ...btnBase, width: 36, fontSize: '12px', fontFamily: 'monospace' }}
          onClick={() => { setFontSizeInput(String(resolvedFormat.fontSize ?? 10)); setShowFontInput(true) }}
          title="Font size"
        >
          {resolvedFormat.fontSize ?? 10}
        </button>
      )}
      <button className="format-btn" style={btnBase} onClick={() => handleFontSizeChange(1)} title="Increase font size">+</button>

      <div style={separator} />

      {/* Text style */}
      <button className="format-btn"
        style={resolvedFormat.bold ? btnActive : btnBase}
        onClick={toggleBold}
        title="Bold (Ctrl+B)"
      >
        <strong style={{ fontSize: '13px' }}>B</strong>
      </button>
      <button className="format-btn"
        style={resolvedFormat.italic ? btnActive : btnBase}
        onClick={toggleItalic}
        title="Italic (Ctrl+I)"
      >
        <em style={{ fontSize: '13px', fontStyle: 'italic' }}>I</em>
      </button>
      <button className="format-btn"
        style={resolvedFormat.underline ? btnActive : btnBase}
        onClick={toggleUnderline}
        title="Underline (Ctrl+U)"
      >
        <span style={{ fontSize: '13px', textDecoration: 'underline' }}>U</span>
      </button>
      <button className="format-btn"
        style={resolvedFormat.strikethrough ? btnActive : btnBase}
        onClick={toggleStrikethrough}
        title="Strikethrough"
      >
        <span style={{ fontSize: '13px', textDecoration: 'line-through' }}>S</span>
      </button>

      <div style={separator} />

      {/* Text color */}
      <button className="format-btn"
        ref={colorBtnRef}
        style={{
          ...btnBase,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
        }}
        onClick={() => setColorPickerType('text')}
        title="Text color"
      >
        <span style={{ fontSize: '11px', fontWeight: 700 }}>A</span>
        <span style={{ width: 14, height: 3, borderRadius: 1, backgroundColor: selectedFgColor ?? '#000' }} />
      </button>

      {/* Fill color */}
      <button className="format-btn"
        ref={fillBtnRef}
        style={{
          ...btnBase,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
        }}
        onClick={() => setColorPickerType('fill')}
        title="Fill color"
      >
        <span style={{ fontSize: '11px' }}>◉</span>
        <span style={{ width: 14, height: 3, borderRadius: 1, backgroundColor: selectedBgColor ?? '#fff', border: '1px solid #dadce0' }} />
      </button>

      {colorPickerType && (
        <ColorPicker
          value={colorPickerType === 'text' ? selectedFgColor : selectedBgColor}
          onChange={handleColorChange}
          onClose={() => setColorPickerType(null)}
          label={colorPickerType}
          anchorEl={colorPickerType === 'text' ? colorBtnRef.current : fillBtnRef.current}
        />
      )}

      <div style={separator} />

      {/* Horizontal align */}
      <button className="format-btn" style={resolvedFormat.textAlign === 'left' ? btnActive : btnBase} onClick={() => setTextAlign('left')} title="Align left">
        <span style={{ fontSize: '11px' }}>≡</span>
      </button>
      <button className="format-btn" style={resolvedFormat.textAlign === 'center' ? btnActive : btnBase} onClick={() => setTextAlign('center')} title="Align center">
        <span style={{ fontSize: '11px' }}>⊶</span>
      </button>
      <button className="format-btn" style={resolvedFormat.textAlign === 'right' ? btnActive : btnBase} onClick={() => setTextAlign('right')} title="Align right">
        <span style={{ fontSize: '11px' }}>⊷</span>
      </button>

      <div style={separator} />

      {/* Vertical align */}
      <button className="format-btn" style={resolvedFormat.verticalAlign === 'top' ? btnActive : btnBase} onClick={() => setVerticalAlign('top')} title="Align top">
        <span style={{ fontSize: '11px' }}>⊤</span>
      </button>
      <button className="format-btn" style={resolvedFormat.verticalAlign === 'middle' ? btnActive : btnBase} onClick={() => setVerticalAlign('middle')} title="Align middle">
        <span style={{ fontSize: '11px' }}>⊟</span>
      </button>
      <button className="format-btn" style={resolvedFormat.verticalAlign === 'bottom' ? btnActive : btnBase} onClick={() => setVerticalAlign('bottom')} title="Align bottom">
        <span style={{ fontSize: '11px' }}>⊥</span>
      </button>

      <div style={separator} />

      {/* Format painter */}
      <button className="format-btn"
        style={formatPainterActive ? { ...btnBase, background: '#e8f0fe', borderColor: '#aecbfa' } : btnBase}
        onClick={handleFormatPainterClick}
        onDoubleClick={handleFormatPainterDoubleClick}
        title={formatPainterSticky ? 'Format painter (sticky) — click to deactivate' : 'Format painter — double-click for sticky'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={formatPainterActive ? '#1a73e8' : '#5f6368'}>
          <path d="M18 4V2H4v6h14V6h1v4H9v12h4V12h8V4h-3z"/>
        </svg>
      </button>
    </div>
    </>
  )
}
