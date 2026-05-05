import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { BulkFormatCell, CellFormat, Load } from '../../types/Load'
import { useSelectionStore } from '../../store/selectionStore'
import { ColorPicker } from './ColorPicker'

const btnBase: React.CSSProperties = {
  width: 28, height: 28,
  border: '1px solid #dadce0', borderRadius: '4px',
  background: '#fff', cursor: 'pointer', outline: 'none',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '13px', color: '#3c4043', padding: 0,
}

const btnActive: React.CSSProperties = {
  ...btnBase, background: '#e8f0fe', borderColor: '#aecbfa',
}

const separator: React.CSSProperties = {
  width: '1px', height: '20px', background: '#e0e0e0', margin: '0 4px',
}

interface FormatToolbarProps {
  orderedLoadIds: number[]
  loads: Load[]
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
      ;(result as any)[key] = vals[0]
    }
  }
  return result
}

function getResolvedFormat(loads: Load[], selectedCells: Set<string>): CellFormat {
  if (selectedCells.size === 0) return {}
  const formats: CellFormat[] = [...selectedCells].map((key) => {
    const [loadId, col] = key.split(':')
    return loads.find((l) => l.id === +loadId)?.cell_formats?.[col] ?? {}
  })
  return mergeFormats(formats)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function FormatToolbar({ orderedLoadIds: _orderedLoadIds, loads }: FormatToolbarProps) {
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

  const resolvedFormat = getResolvedFormat(loads, selectedCells)

  const buildCells = useCallback((patch: Partial<CellFormat>): BulkFormatCell[] => {
    return [...selectedCells].map((key) => {
      const [loadId, col] = key.split(':')
      const load = loads.find((l) => l.id === +loadId)
      const existing = load?.cell_formats?.[col] ?? {}
      return { load_id: +loadId, column: col, format: { ...existing, ...patch } }
    })
  }, [selectedCells, loads])

  const applyFormat = useCallback((patch: Partial<CellFormat>) => {
    if (!hasSelection) return
    const cells = buildCells(patch)

    queryClient.setQueriesData<Load[]>({ queryKey: ['loads'] }, (old) =>
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
  }, [hasSelection, buildCells, queryClient])

  const clearFormatting = useCallback(() => {
    const patch: CellFormat = {
      bg: null, fg: null, bold: false, italic: false,
      underline: false, strikethrough: false,
      fontSize: null, textAlign: null, verticalAlign: null,
    }
    applyFormat(patch)
  }, [applyFormat])

  const toggleBold = useCallback(() => {
    const merged = getResolvedFormat(loads, selectedCells)
    applyFormat({ bold: !merged.bold })
  }, [applyFormat, loads, selectedCells])

  const toggleItalic = useCallback(() => {
    const merged = getResolvedFormat(loads, selectedCells)
    applyFormat({ italic: !merged.italic })
  }, [applyFormat, loads, selectedCells])

  const toggleUnderline = useCallback(() => {
    const merged = getResolvedFormat(loads, selectedCells)
    applyFormat({ underline: !merged.underline })
  }, [applyFormat, loads, selectedCells])

  const toggleStrikethrough = useCallback(() => {
    const merged = getResolvedFormat(loads, selectedCells)
    applyFormat({ strikethrough: !merged.strikethrough })
  }, [applyFormat, loads, selectedCells])

  const setTextAlign = useCallback((align: 'left' | 'center' | 'right') => applyFormat({ textAlign: align }), [applyFormat])
  const setVerticalAlign = useCallback((align: 'top' | 'middle' | 'bottom') => applyFormat({ verticalAlign: align }), [applyFormat])

  const handleFontSizeChange = useCallback((delta: number) => {
    const merged = getResolvedFormat(loads, selectedCells)
    const current = merged.fontSize ?? 10
    const newSize = Math.max(6, Math.min(96, current + delta))
    applyFormat({ fontSize: newSize })
  }, [applyFormat, loads, selectedCells])

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

  const buildFormatPainterSource = useCallback(() => {
    const source: Record<string, CellFormat> = {}
    selectedCells.forEach((key) => {
      const [loadId, col] = key.split(':')
      const load = loads.find((l) => l.id === +loadId)
      const base = load?.cell_formats?.[col] ?? {}
      if (load?.is_bold && !base.bold) base.bold = true
      if (load?.font_size && !base.fontSize) base.fontSize = load.font_size
      if (Object.keys(base).length > 0) {
        source[col] = base
      }
    })
    return source
  }, [selectedCells, loads])

  const handleFormatPainterClick = useCallback(() => {
    if (formatPainterActive) { deactivateFormatPainter(); return }
    if (!hasSelection) return
    const source = buildFormatPainterSource()
    if (Object.keys(source).length === 0) return
    activateFormatPainter(source, false)
  }, [formatPainterActive, hasSelection, buildFormatPainterSource, activateFormatPainter, deactivateFormatPainter])

  const handleFormatPainterDoubleClick = useCallback(() => {
    if (!hasSelection) return
    const source = buildFormatPainterSource()
    if (Object.keys(source).length === 0) return
    activateFormatPainter(source, true)
  }, [hasSelection, buildFormatPainterSource, activateFormatPainter])

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
    <div
      onMouseUp={(e) => {
        const btn = e.target instanceof HTMLButtonElement ? e.target : (e.target as HTMLElement).closest?.('button')
        if (btn) (btn as HTMLElement).blur()
      }}
      style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 8px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #e0e0e0', flexWrap: 'wrap' }}>
      {/* Font size */}
      <button style={btnBase} onClick={() => handleFontSizeChange(-1)} title="Decrease font size">−</button>
      {showFontInput ? (
        <input
          autoFocus
          value={fontSizeInput}
          onChange={(e) => setFontSizeInput(e.target.value)}
          onBlur={handleFontSizeInput}
          onKeyDown={(e) => { if (e.key === 'Enter') handleFontSizeInput(); if (e.key === 'Escape') setShowFontInput(false) }}
          style={{ width: 30, textAlign: 'center', padding: '2px', border: '1px solid #dadce0', borderRadius: '4px', fontSize: '12px' }}
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
      <button style={btnBase} onClick={() => handleFontSizeChange(1)} title="Increase font size">+</button>

      <div style={separator} />

      {/* Text style */}
      <button style={resolvedFormat.bold ? btnActive : btnBase} onClick={toggleBold} title="Bold (Ctrl+B)">
        <strong style={{ fontSize: '13px' }}>B</strong>
      </button>
      <button style={resolvedFormat.italic ? btnActive : btnBase} onClick={toggleItalic} title="Italic (Ctrl+I)">
        <em style={{ fontSize: '13px', fontStyle: 'italic' }}>I</em>
      </button>
      <button style={resolvedFormat.underline ? btnActive : btnBase} onClick={toggleUnderline} title="Underline (Ctrl+U)">
        <span style={{ fontSize: '13px', textDecoration: 'underline' }}>U</span>
      </button>
      <button style={resolvedFormat.strikethrough ? btnActive : btnBase} onClick={toggleStrikethrough} title="Strikethrough">
        <span style={{ fontSize: '13px', textDecoration: 'line-through' }}>S</span>
      </button>

      <div style={separator} />

      {/* Text color */}
      <button
        ref={colorBtnRef}
        style={{ ...btnBase, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}
        onClick={() => setColorPickerType('text')}
        title="Text color"
      >
        <span style={{ fontSize: '11px', fontWeight: 700 }}>A</span>
        <span style={{ width: 14, height: 3, borderRadius: 1, backgroundColor: selectedFgColor ?? '#000' }} />
      </button>

      {/* Fill color */}
      <button
        ref={fillBtnRef}
        style={{ ...btnBase, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}
        onClick={() => setColorPickerType('fill')}
        title="Fill color"
      >
        <span style={{ fontSize: '11px' }}>◉</span>
        <span style={{ width: 14, height: 3, borderRadius: 1, backgroundColor: selectedBgColor ?? 'transparent' }} />
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
      <button style={resolvedFormat.textAlign === 'left' ? btnActive : btnBase} onClick={() => setTextAlign('left')} title="Align left">
        <span style={{ fontSize: '11px' }}>≡</span>
      </button>
      <button style={resolvedFormat.textAlign === 'center' ? btnActive : btnBase} onClick={() => setTextAlign('center')} title="Align center">
        <span style={{ fontSize: '11px' }}>⊶</span>
      </button>
      <button style={resolvedFormat.textAlign === 'right' ? btnActive : btnBase} onClick={() => setTextAlign('right')} title="Align right">
        <span style={{ fontSize: '11px' }}>⊷</span>
      </button>

      <div style={separator} />

      {/* Vertical align */}
      <button style={resolvedFormat.verticalAlign === 'top' ? btnActive : btnBase} onClick={() => setVerticalAlign('top')} title="Align top">
        <span style={{ fontSize: '11px' }}>⊤</span>
      </button>
      <button style={resolvedFormat.verticalAlign === 'middle' ? btnActive : btnBase} onClick={() => setVerticalAlign('middle')} title="Align middle">
        <span style={{ fontSize: '11px' }}>⊟</span>
      </button>
      <button style={resolvedFormat.verticalAlign === 'bottom' ? btnActive : btnBase} onClick={() => setVerticalAlign('bottom')} title="Align bottom">
        <span style={{ fontSize: '11px' }}>⊥</span>
      </button>

      <div style={separator} />

      {/* Clear formatting */}
      <button style={btnBase} onClick={clearFormatting} title="Clear formatting">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#5f6368">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </button>

      <div style={separator} />

      {/* Format painter */}
      <button
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
  )
}
