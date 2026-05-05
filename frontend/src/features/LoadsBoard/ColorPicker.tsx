import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { SHEETS_PALETTE, STANDARD_COLORS } from './ColorPicker.constants'

const SWATCH_SIZE = 16

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 128
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler()
      }
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, handler])
}

interface ColorPickerProps {
  value: string | null
  onChange: (hex: string | null) => void
  onClose: () => void
  label: 'text' | 'fill'
  anchorEl: HTMLElement | null
}

export function ColorPicker({ value, onChange, onClose, label: _label, anchorEl }: ColorPickerProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [showHexInput, setShowHexInput] = useState(false)
  const [hexValue, setHexValue] = useState('')

  useClickOutside(popupRef, onClose)

  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect()
      setPosition({ top: rect.bottom + 4, left: rect.left })
    }
  }, [anchorEl])

  const handleSwatchClick = useCallback((hex: string) => {
    onChange(hex)
    onClose()
  }, [onChange, onClose])

  const handleReset = useCallback(() => {
    onChange(null)
    onClose()
  }, [onChange, onClose])

  const handleHexSubmit = useCallback(() => {
    const h = hexValue.trim()
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) {
      onChange(h)
      onClose()
    }
  }, [hexValue, onChange, onClose])

  const handleEyeDropper = useCallback(async () => {
    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper()
        const result = await eyeDropper.open()
        onChange(result.sRGBHex)
        onClose()
      } catch { }
    }
  }, [onChange, onClose])

  if (!position) return null

  return createPortal(
    <div
      ref={popupRef}
      className="color-picker-popup"
      style={{
        position: 'fixed',
        zIndex: 9999,
        top: position.top,
        left: position.left,
        background: '#fff',
        border: '1px solid #dadce0',
        borderRadius: '4px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        padding: '8px',
        minWidth: '212px',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        fontSize: '13px',
      }}
    >
      <button
        onClick={handleReset}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer',
          borderRadius: '4px', color: '#3c4043', fontSize: '13px',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f3f4')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" fill="none" stroke="#444" strokeWidth="1.5" />
          <line x1="3" y1="13" x2="13" y2="3" stroke="#dc3912" strokeWidth="1.5" />
        </svg>
        <span>Сбросить параметры</span>
      </button>

      <div style={{ height: '1px', background: '#e0e0e0', margin: '6px 0' }} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(10, ${SWATCH_SIZE}px)`,
          gap: '2px',
          padding: '4px 0',
        }}
      >
        {SHEETS_PALETTE.map((row, ri) =>
          row.map((hex) => (
            <button
              key={`${ri}-${hex}`}
              title={hex.toUpperCase()}
              onClick={() => handleSwatchClick(hex)}
              style={{
                width: SWATCH_SIZE,
                height: SWATCH_SIZE,
                borderRadius: '50%',
                backgroundColor: hex,
                border: value === hex ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.1)',
                cursor: 'pointer',
                position: 'relative',
                flexShrink: 0,
                padding: 0,
              }}
            >
              {value === hex && (
                <span style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isLightColor(hex) ? '#000' : '#fff',
                  fontSize: 10, fontWeight: 700,
                }}>✓</span>
              )}
            </button>
          ))
        )}
      </div>

      <div style={{ height: '1px', background: '#e0e0e0', margin: '6px 0' }} />

      <div style={{ fontSize: '11px', fontWeight: 500, color: '#80868b', letterSpacing: '0.8px', textTransform: 'uppercase', margin: '6px 0 4px', display: 'flex', justifyContent: 'space-between' }}>
        <span>СТАНДАРТНАЯ</span>
      </div>

      <div style={{ display: 'flex', gap: '2px' }}>
        {STANDARD_COLORS.map((hex) => (
          <button
            key={hex}
            title={hex.toUpperCase()}
            onClick={() => handleSwatchClick(hex)}
            style={{
              width: SWATCH_SIZE,
              height: SWATCH_SIZE,
              borderRadius: '50%',
              backgroundColor: hex,
              border: value === hex ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.1)',
              cursor: 'pointer',
              position: 'relative',
              flexShrink: 0,
              padding: 0,
              outline: hex === '#ffffff' ? '1px solid #dadce0' : undefined,
              outlineOffset: '-1px',
            }}
          >
            {value === hex && (
              <span style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isLightColor(hex) ? '#000' : '#fff',
                fontSize: 10, fontWeight: 700,
              }}>✓</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '6px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0' }}>
          {!showHexInput ? (
            <button
              onClick={() => setShowHexInput(true)}
              style={{
                width: 24, height: 24, borderRadius: '50%',
                border: '1px solid #dadce0', background: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#5f6368', fontSize: 18, fontWeight: 300,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f3f4')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              +
            </button>
          ) : (
            <input
              autoFocus
              value={hexValue}
              onChange={(e) => setHexValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleHexSubmit(); if (e.key === 'Escape') setShowHexInput(false) }}
              onBlur={handleHexSubmit}
              placeholder="#000000"
              style={{
                width: 90, padding: '4px 8px', border: '1px solid #dadce0',
                borderRadius: '4px', fontSize: 13, fontFamily: 'monospace', outline: 'none',
              }}
            />
          )}
          {'EyeDropper' in window && (
            <button
              onClick={handleEyeDropper}
              title="Pick color from screen"
              style={{
                width: 24, height: 24, border: 'none', background: 'none',
                cursor: 'pointer', color: '#5f6368', display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#1a73e8')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#5f6368')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.35 11.72l-7.07-7.07-1.41 1.41 1.06 1.06-4.24 4.24-1.06-1.06-1.41 1.41 7.07 7.07 7.07-7.07zM7.76 12.17l4.24-4.24 4.24 4.24H7.76z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
